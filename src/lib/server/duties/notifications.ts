import { after } from 'next/server';
import { log } from '@/lib/server/log';
import { randomUUID } from 'node:crypto';
import { db, messaging } from '@/lib/firebaseAdmin';
import { canonicalizeDistrictList, districtMatches } from '@/lib/districts';
import { isActiveLinkedProfile } from '@/lib/server/linked-profiles';
import { hash, iso } from './requests';
export type DutyNotificationType = 'duty_assigned' | 'duty_changed' | 'duty_cancelled' | 'duty_willingness';
export type NotificationWrite = {
  ref: FirebaseFirestore.DocumentReference;
  data: Record<string, any>;
};
export type DutyEvent = {
  entityId: string;
  version: number | string;
  operation: string;
  type: DutyNotificationType;
  recipientUid: string;
  recipientRole: 'guard' | 'fieldOfficer';
  district: string;
  title: string;
  body: string;
  data: Record<string, string>;
};
/** Persist these creates in the same transaction/batch as the duty mutation. */
export function buildDutyNotificationWrites(event: DutyEvent): NotificationWrite[] {
  if (!event.recipientUid)
    return [];
  const id = hash([event.operation, event.entityId, event.version, event.type, event.recipientUid]);
  return [{
      ref: db.collection('notifications').doc(id),
      data: {
        type: event.type,
        title: event.title,
        body: event.body,
        recipientUid: event.recipientUid,
        recipientRole: event.recipientRole,
        recipientDistrict: event.district,
        data: {
          ...event.data,
          notifId: id,
          type: event.type,
          recipientUid: event.recipientUid,
          recipientRole: event.recipientRole
        },
        read: false,
        createdAt: new Date(),
        dutyEvent: true,
        pushStatus: 'pending',
        pushAttempts: 0,
        pushLeaseUntil: null,
        pushLeaseOwner: null
      }
    }];
}
export async function willingnessAudience(tx: FirebaseFirestore.Transaction, district: string) {
  const snap = await tx.get(db.collection('fieldOfficers'));
  const byUid = new Map<string, Record<string, any>[]>();
  for (const doc of snap.docs) {
    const data = doc.data();
    if (typeof data.uid !== 'string' || !data.uid.trim())
      continue;
    byUid.set(data.uid, [...(byUid.get(data.uid) ?? []), data]);
  }
  return [...byUid.entries()].filter(([, profiles]) => {
    if (profiles.length !== 1)
      return false;
    const data = profiles[0];
    const districts = Array.isArray(data.assignedDistricts) ? data.assignedDistricts.filter((value: unknown): value is string => typeof value === 'string') : [];
    return isActiveLinkedProfile(data) && canonicalizeDistrictList(districts).some(value => districtMatches(value, district));
  }).map(([uid]) => uid);
}
export async function dispatchDutyNotifications(eventIds: string[]) {
  const summary = {
    sent: 0,
    pending: 0,
    skipped: 0
  };
  for (const id of [...new Set(eventIds)]) {
    const ref = db.collection('notifications').doc(id);
    const owner = randomUUID();
    let row: Record<string, any> | null = null;
    try {
      row = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.data();
        if (!data?.dutyEvent || data.pushStatus === 'sent' || Number(data.pushLeaseUntil ?? 0) > Date.now())
          return null;
        tx.update(ref, {
          pushLeaseOwner: owner,
          pushLeaseUntil: Date.now() + 60000,
          pushAttempts: Number(data.pushAttempts ?? 0) + 1
        });
        return data;
      });
      if (!row) {
        summary.skipped++;
        continue;
      }
      const tokensSnap = await db.collection('fcmTokens').where('uid', '==', row.recipientUid).get();
      const tokens = [...new Set(tokensSnap.docs.map(d => String(d.data().token ?? '').trim()).filter(Boolean))];
      let failed = false;
      for (let index = 0; index < tokens.length; index += 500) {
        const result = await messaging.sendEachForMulticast({
          tokens: tokens.slice(index, index + 500),
          notification: {
            title: row.title,
            body: row.body
          },
          data: row.data,
          android: {
            collapseKey: id,
            notification: {
              tag: id
            }
          },
          apns: {
            headers: {
              'apns-collapse-id': id
            }
          }
        });
        if (result.failureCount > 0)
          failed = true;
      }
      await finish(ref, owner, failed ? 'pending' : 'sent', tokens.length === 0 ? 'no_tokens' : failed ? 'failed' : 'sent');
      if (failed)
        summary.pending++;
      else
        summary.sent++;
    }
    catch {
      summary.pending++;
      if (row)
        try {
          await finish(ref, owner, 'pending', 'failed');
        }
        catch { /* Inbox persists and an expired lease permits the next recipient poll to recover. */
        }
    }
  }
  return summary;
}
async function finish(ref: FirebaseFirestore.DocumentReference, owner: string, status: string, outcome: string) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.data()?.pushLeaseOwner !== owner)
      return;
    tx.update(ref, {
      pushStatus: status,
      pushOutcome: outcome,
      pushLeaseUntil: null,
      pushLeaseOwner: null,
      pushLastAttemptAt: new Date()
    });
  });
}
export async function retryPendingDutyNotifications(uid: string) {
  const snap = await db.collection('notifications').where('recipientUid', '==', uid).where('pushStatus', '==', 'pending').orderBy('createdAt', 'desc').limit(10).get();
  return dispatchDutyNotifications(snap.docs.map(d => d.id));
}
function roster(order: Record<string, any>) {
  const guards = order.recordStatus === 'cancelled' ? [] : Array.isArray(order.assignedGuards) ? order.assignedGuards : [];
  return guards.map((g: any) => typeof g === 'string' ? g : String(g?.uid ?? '')).filter(Boolean) as string[];
}
function examMetadata(order: Record<string, any>) {
  return [order.siteId, order.siteName, order.district, iso(order.date)?.slice(0, 10) ?? order.date, order.examName, order.examCode, order.shiftLabel, iso(order.startsAt), iso(order.endsAt), order.maleGuardsRequired, order.femaleGuardsRequired];
}
/** Reader is either a transaction adapter or Firestore; all reads precede writes. */
export async function buildExamRosterNotificationWrites(reader: Pick<FirebaseFirestore.Firestore, 'collection'>, id: string, previous: Record<string, any>, next: Record<string, any>, version: number | string, operation = "exam_roster"): Promise<NotificationWrite[]> {
  const before = new Set(roster(previous));
  const after = new Set(roster(next));
  const changed = hash(examMetadata(previous)) !== hash(examMetadata(next));
  // Two employee records can share one guard account (guardAuthUid), which would
  // otherwise emit the same notification document twice and fail the whole
  // transaction with ALREADY_EXISTS.
  const writes = new Map<string, NotificationWrite>();
  for (const guardId of new Set([...before, ...after])) {
    const type = before.has(guardId) ? after.has(guardId) ? changed ? 'duty_changed' : null : 'duty_cancelled' : 'duty_assigned';
    if (!type)
      continue;
    const employee = await reader.collection('employees').doc(guardId).get();
    const uid = employee.data()?.guardAuthUid;
    if (typeof uid !== 'string' || !uid)
      continue;
    for (const write of buildDutyNotificationWrites({
      operation,
      entityId: id,
      version,
      type,
      recipientUid: uid,
      recipientRole: 'guard',
      district: String(next.district || previous.district || ''),
      title: type === 'duty_assigned' ? 'Exam duty assigned' : type === 'duty_cancelled' ? 'Exam duty cancelled' : 'Exam duty changed',
      body: 'Open Duties to view your exam duty.',
      data: {
        workOrderId: id,
        routeKind: 'guard_duties'
      }
    })) {
      writes.set(write.ref.id, write);
    }
  }
  return [...writes.values()];
}
export function transactionNotificationReader(tx: FirebaseFirestore.Transaction): Pick<FirebaseFirestore.Firestore, 'collection'> {
  return {
    collection: (name: string) => ({
      doc: (id: string) => ({
        get: () => tx.get(db.collection(name).doc(id))
      })
    }) as unknown as FirebaseFirestore.CollectionReference
  };
}

/** Inbox events already committed with the roster; push delivery must not delay its acknowledgement. */
export function scheduleDutyNotifications(eventIds: string[]) {
  if (!eventIds.length) return;
  try {
    after(async () => {
      try { await dispatchDutyNotifications(eventIds); }
      catch { log('warn', 'duties', 'Push delivery deferred; persisted inbox events remain pending.'); }
    });
  } catch {
    // A missing request context must not turn an already committed save into a failure.
    // Recipient polling retries the durable pending inbox events.
    log('warn', 'duties', 'Push scheduling unavailable; persisted inbox events remain pending.');
  }
}
