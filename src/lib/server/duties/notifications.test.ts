import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TestStore } from './test-store';
let store: TestStore;
let send: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetModules();
  store = new TestStore();
  send = vi.fn().mockResolvedValue({
    failureCount: 0,
    successCount: 1,
    responses: [{
        success: true
      }]
  });
  vi.doMock('@/lib/firebaseAdmin', () => ({
    db: store,
    messaging: {
      sendEachForMulticast: send
    }
  }));
});
afterEach(() => vi.doUnmock('@/lib/firebaseAdmin'));
const event = {
  entityId: 'assignment',
  version: 1,
  operation: 'assignment',
  type: 'duty_assigned' as const,
  recipientUid: 'auth-guard',
  recipientRole: 'guard' as const,
  district: 'Ernakulam',
  title: 'Duty assigned',
  body: 'Your duty',
  data: {
    assignmentId: 'assignment',
    routeKind: 'guard_duties'
  }
};
async function persist() {
  const { buildDutyNotificationWrites } = await import('./notifications');
  const writes = buildDutyNotificationWrites(event);
  await store.runTransaction(async (tx) => {
    for (const w of writes)
      tx.create(w.ref, w.data);
  });
  return writes[0].ref.id;
}
it('builds stable recipient identity and atomic inbox writes', async () => {
  const { buildDutyNotificationWrites } = await import('./notifications');
  const a = buildDutyNotificationWrites(event);
  const b = buildDutyNotificationWrites(event);
  expect(a[0].ref.id).toBe(b[0].ref.id);
  expect(a[0].data).toMatchObject({
    recipientUid: 'auth-guard',
    read: false,
    dutyEvent: true,
    pushStatus: 'pending',
    data: {
      notifId: a[0].ref.id,
      assignmentId: 'assignment',
      type: 'duty_assigned',
      recipientUid: 'auth-guard',
      recipientRole: 'guard'
    }
  });
  store.failCommit = true;
  await expect(persist()).rejects.toThrow('commit failed');
  expect(store.list('notifications')).toHaveLength(0);
});
it('no token is success and uses no topic', async () => {
  const id = await persist();
  const { dispatchDutyNotifications } = await import('./notifications');
  await dispatchDutyNotifications([id]);
  expect(send).not.toHaveBeenCalled();
  expect(store.row('notifications', id)).toMatchObject({
    pushStatus: 'sent',
    pushOutcome: 'no_tokens'
  });
});
it('failure retains inbox, retry preserves read state and dedupes all token strings', async () => {
  const id = await persist();
  store.seed('fcmTokens', 'web', {
    uid: 'auth-guard',
    token: 'same'
  });
  store.seed('fcmTokens', 'mobile', {
    uid: 'auth-guard',
    token: 'same'
  });
  store.seed('fcmTokens', 'foreign', {
    uid: 'other',
    token: 'foreign'
  });
  send.mockRejectedValueOnce(new Error('FCM down'));
  const { dispatchDutyNotifications } = await import('./notifications');
  await dispatchDutyNotifications([id]);
  expect(store.row('notifications', id)?.pushStatus).toBe('pending');
  store.row('notifications', id)!.read = true;
  await dispatchDutyNotifications([id]);
  expect(send.mock.calls[1][0]).toMatchObject({
    tokens: ['same'],
    data: {
      notifId: id,
      type: 'duty_assigned',
      recipientUid: 'auth-guard',
      recipientRole: 'guard'
    },
    android: {
      collapseKey: id,
      notification: {
        tag: id
      }
    }
  });
  expect(store.row('notifications', id)).toMatchObject({
    pushStatus: 'sent',
    read: true,
    pushAttempts: 2
  });
  expect(store.list('notifications')).toHaveLength(1);
});
it('concurrent dispatch lease sends once', async () => {
  const id = await persist();
  store.seed('fcmTokens', 'mobile', {
    uid: 'auth-guard',
    token: 'device'
  });
  const { dispatchDutyNotifications } = await import('./notifications');
  await Promise.all([dispatchDutyNotifications([id]), dispatchDutyNotifications([id])]);
  expect(send).toHaveBeenCalledTimes(1);
});
it('targeted pending retry only selects the recipient bounded inbox', async () => {
  const id = await persist();
  const { buildDutyNotificationWrites, retryPendingDutyNotifications } = await import('./notifications');
  const foreign = buildDutyNotificationWrites({
    ...event,
    recipientUid: 'other'
  })[0];
  await foreign.ref.set(foreign.data);
  await retryPendingDutyNotifications('auth-guard');
  expect(store.row('notifications', id)?.pushStatus).toBe('sent');
  expect(store.row('notifications', foreign.ref.id)?.pushStatus).toBe('pending');
});
it('roster change/cancel/add emits only affected recipients and unchanged is empty', async () => {
  store.seed('employees', 'emp', {
    guardAuthUid: 'auth-guard',
    status: 'active'
  });
  store.seed('employees', 'other', {
    guardAuthUid: 'auth-other',
    status: 'active'
  });
  const { buildExamRosterNotificationWrites } = await import('./notifications');
  const order = {
    siteId: 'site',
    siteName: 'Centre',
    district: 'Ernakulam',
    date: '2026-10-14',
    examName: 'Exam',
    assignedGuards: [{
        uid: 'emp'
      }],
    recordStatus: 'active'
  };
  expect(await buildExamRosterNotificationWrites(store as any, 'exam', order, order, 1)).toEqual([]);
  const changed = await buildExamRosterNotificationWrites(store as any, 'exam', order, {
    ...order,
    examName: 'Changed'
  }, 2);
  expect(changed.map(w => w.data.type)).toEqual(['duty_changed']);
  const cancelled = await buildExamRosterNotificationWrites(store as any, 'exam', order, {
    ...order,
    recordStatus: 'cancelled',
    assignedGuards: []
  }, 3);
  expect(cancelled.map(w => w.data.type)).toEqual(['duty_cancelled']);
  expect(cancelled[0].data.recipientUid).toBe('auth-guard');
  const swap = await buildExamRosterNotificationWrites(store as any, 'exam', order, {
    ...order,
    assignedGuards: [{
        uid: 'other'
      }]
  }, 4);
  expect(swap.map(w => w.data.type).sort()).toEqual(['duty_assigned', 'duty_cancelled']);
});
it('import and manual roster changes with the same numeric version have distinct event IDs', async () => {
  store.seed('employees', 'emp', {
    guardAuthUid: 'auth-guard',
    status: 'active'
  });
  const { buildExamRosterNotificationWrites } = await import('./notifications');
  const previous = {
    siteId: 'site',
    date: '2026-10-14',
    examName: 'Before',
    assignedGuards: [{
        uid: 'emp'
      }]
  };
  const next = {
    ...previous,
    examName: 'After'
  };
  const manual = await buildExamRosterNotificationWrites(store as any, 'exam', previous, next, 2);
  const imported = await buildExamRosterNotificationWrites(store as any, 'exam', previous, next, 2, 'exam_import');
  expect(manual[0].ref.id).not.toBe(imported[0].ref.id);
});
