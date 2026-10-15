import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TestStore } from '@/lib/server/duties/test-store';
let store: TestStore;
const retry = vi.fn();
beforeEach(() => {
  vi.resetModules();
  retry.mockReset().mockResolvedValue({
    sent: 0
  });
  store = new TestStore();
  store.seed('notifications', 'event', {
    recipientUid: 'owner',
    type: 'duty_assigned',
    title: 'Duty',
    body: 'Open duties',
    read: true,
    createdAt: new Date(),
    dutyEvent: true,
    pushStatus: 'pending'
  });
  vi.doMock('@/lib/firebaseAdmin', () => ({
    db: store
  }));
  vi.doMock('@/lib/server/auth', () => ({
    verifyRequestAuth: vi.fn().mockResolvedValue({
      uid: 'owner'
    }),
    unauthorizedResponse: (error: string, status: number) => Response.json({
      error
    }, {
      status
    })
  }));
  vi.doMock('@/lib/server/mobile-session', () => ({
    resolveMobileSession: vi.fn().mockResolvedValue({
      uid: 'owner',
      role: 'guard',
      district: 'Ernakulam'
    })
  }));
  vi.doMock('@/lib/server/duties/notifications', () => ({
    retryPendingDutyNotifications: retry
  }));
});
afterEach(() => {
  vi.doUnmock('@/lib/firebaseAdmin');
  vi.doUnmock('@/lib/server/auth');
  vi.doUnmock('@/lib/server/mobile-session');
  vi.doUnmock('@/lib/server/duties/notifications');
});
it('readable recipient inbox triggers targeted bounded retry without resetting read state', async () => {
  const { GET } = await import('./route');
  const r = await GET(new Request('http://local/api'));
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
  expect(await r.json()).toMatchObject({
    notifications: [{
        id: 'event',
        read: true
      }]
  });
  expect(retry).toHaveBeenCalledWith('owner');
});
it('push recovery error leaves successful inbox read intact', async () => {
  retry.mockRejectedValue(new Error('FCM down'));
  const { GET } = await import('./route');
  const r = await GET(new Request('http://local/api'));
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
  expect(await r.json()).toMatchObject({
    notifications: [{
        id: 'event'
      }]
  });
  expect(retry).toHaveBeenCalledTimes(1);
});
