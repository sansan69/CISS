import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TestStore } from '@/lib/server/duties/test-store';

/**
 * Regression cover for the "Save Assignments" failure that reached supervisors as
 * "Assignment not saved / Could not process duty request.":
 *
 *  - the cross-centre guard rule is enforced without making the transaction lock
 *    every duty on the date,
 *  - transient transaction contention is retried and then reported as retryable,
 *  - two employee records sharing one guard account cannot fail the save.
 */

let store: ContendedStore;
let token: any;

/** A store whose transaction can fail with Firestore contention before succeeding. */
class ContendedStore extends TestStore {
  abortsLeft: number;
  transactionReads: string[] = [];
  private depth = 0;
  private autoId = 0;

  constructor(aborts = 0) {
    super();
    this.abortsLeft = aborts;
  }

  async runTransaction(fn: (t: any) => Promise<any>) {
    if (this.abortsLeft > 0) {
      this.abortsLeft -= 1;
      const error: any = new Error('10 ABORTED: Transaction lock timeout. Transaction lock timeout.');
      error.code = 10;
      throw error;
    }
    this.depth += 1;
    try {
      return await super.runTransaction(fn);
    } finally {
      this.depth -= 1;
    }
  }

  collection(name: string): any {
    const base = super.collection(name);
    const wrapRef = (ref: any) => ({
      id: ref.id,
      path: ref.path,
      parent: ref.parent,
      get: async () => {
        if (this.depth > 0) this.transactionReads.push(ref.path);
        return ref.get();
      },
      set: (value: any, options?: any) => ref.set(value, options),
      update: (value: any) => ref.update(value),
    });
    const wrapQuery = (query: any): any => ({
      doc: (id?: string) => wrapRef(query.doc(id ?? `generated-${++this.autoId}`)),
      where: (field: string, op: string, value: any) => wrapQuery(query.where(field, op, value)),
      orderBy: (field: string, direction?: string) => wrapQuery(query.orderBy(field, direction)),
      limit: (n: number) => wrapQuery(query.limit(n)),
      startAfter: (doc: any) => wrapQuery(query.startAfter(doc)),
      get: async () => {
        const snapshot = await query.get();
        return {
          ...snapshot,
          docs: snapshot.docs.map((doc: any) => ({ ...doc, ref: wrapRef(doc.ref) })),
        };
      },
    });
    return wrapQuery(base);
  }
}

beforeEach(() => {
  vi.resetModules();
  store = new ContendedStore();
  token = { uid: 'fo', role: 'fieldOfficer' };
  store.seed('fieldOfficers', 'fo-record', { uid: 'fo', status: 'active', assignedDistricts: ['Cochin'] });
  store.seed('sites', 'site', { siteName: 'Centre', clientName: 'TCS', district: 'Ernakulam', status: 'active' });
  store.seed('workOrders', 'exam', {
    siteId: 'site',
    siteName: 'Centre',
    clientName: 'TCS',
    district: 'Thrissur',
    date: new Date('2026-10-14T06:30:00Z'),
    recordStatus: 'active',
    maleGuardsRequired: 2,
    femaleGuardsRequired: 0,
    assignedGuards: [],
  });
  store.seed('employees', 'emp', {
    employeeId: 'CISS/1',
    fullName: 'Canonical',
    gender: 'Male',
    district: 'cochin',
    status: 'active',
    guardAuthUid: 'auth',
  });
  seedMocks();
});

function seedMocks() {
  vi.doMock('@/lib/firebaseAdmin', () => ({
    db: store,
    messaging: { sendEachForMulticast: vi.fn() },
  }));
  vi.doMock('@/lib/server/auth', () => ({
    verifyRequestAuth: vi.fn().mockImplementation(() => token),
    requireAdminOrFieldOfficer: (t: any) => t,
    hasAdminAccess: (t: any) => t.role === 'admin',
    hasFieldOfficerAccess: (t: any) => t.role === 'fieldOfficer',
    unauthorizedResponse: (error: string, status: number) => Response.json({ error }, { status }),
  }));
}

afterEach(() => {
  vi.doUnmock('@/lib/firebaseAdmin');
  vi.doUnmock('@/lib/server/auth');
});

async function patch(body: any, id = 'exam') {
  const { PATCH } = await import('./route');
  return PATCH(new Request('http://local/api', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id }),
  });
}

it('retries a contended transaction instead of failing the save', async () => {
  store.abortsLeft = 2;

  const response = await patch({ assignedGuards: [{ uid: 'emp' }] });

  expect(response.status).toBe(200);
  expect(store.row('workOrders', 'exam')?.assignedGuards).toEqual([
    { uid: 'emp', name: 'Canonical', employeeId: 'CISS/1', gender: 'Male' },
  ]);
});

it('reports exhausted contention as a retryable 503 rather than a lost save', async () => {
  store.abortsLeft = 10;

  const response = await patch({ assignedGuards: [{ uid: 'emp' }] });
  const payload = await response.json();

  expect(response.status).toBe(503);
  expect(payload.code).toBe('busy');
  expect(payload.retryable).toBe(true);
  expect(payload.error.toLowerCase()).toContain('try again');
  expect(store.row('workOrders', 'exam')?.assignedGuards).toEqual([]);
});

it('does not lock or read duties on the same date that hold none of the selected guards', async () => {
  store.seed('workOrders', 'other', {
    siteId: 'site',
    siteName: 'Other centre',
    clientName: 'TCS',
    district: 'Thrissur',
    date: new Date('2026-10-14T06:30:00Z'),
    recordStatus: 'active',
    assignedGuards: [{ uid: 'someone-else', name: 'Other', employeeId: 'CISS/9', gender: 'Male' }],
  });
  seedMocks();

  const response = await patch({ assignedGuards: [{ uid: 'emp' }] });

  expect(response.status).toBe(200);
  expect(store.transactionReads).not.toContain('workOrders/other');
});

it('still refuses a guard who already holds another duty on the same date', async () => {
  store.seed('workOrders', 'other', {
    siteId: 'site',
    siteName: 'Other centre',
    clientName: 'TCS',
    district: 'Thrissur',
    date: new Date('2026-10-14T06:30:00Z'),
    recordStatus: 'active',
    assignedGuards: [{ uid: 'emp', name: 'Canonical', employeeId: 'CISS/1', gender: 'Male' }],
  });
  seedMocks();

  const response = await patch({ assignedGuards: [{ uid: 'emp' }] });
  const payload = await response.json();

  expect(response.status).toBe(409);
  expect(payload.error).toBe('Canonical is already assigned to Other centre on this date.');
  expect(store.transactionReads).toContain('workOrders/other');
});

it('saves when two employee records share one guard account', async () => {
  store.seed('employees', 'emp-twin', {
    employeeId: 'CISS/2',
    fullName: 'Twin',
    gender: 'Male',
    district: 'cochin',
    status: 'active',
    guardAuthUid: 'auth',
  });
  seedMocks();

  const response = await patch({ assignedGuards: [{ uid: 'emp' }, { uid: 'emp-twin' }] });

  expect(response.status).toBe(200);
  const notified = store.list('notifications').map((doc) => doc.data().recipientUid);
  expect(notified).toEqual(['auth']);
});

it('acknowledges the committed assignment without waiting for push delivery', async () => {
  const deferred: Array<() => Promise<unknown>> = [];
  vi.doMock('next/server', async (original) => ({
    ...await original<typeof import('next/server')>(),
    after: (task: () => Promise<unknown>) => deferred.push(task),
  }));
  store.seed('fcmTokens', 'token', {uid:'auth',token:'push-token'});
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  vi.doMock('@/lib/firebaseAdmin', () => ({
    db: store,
    messaging: {sendEachForMulticast: async () => {await blocked; return {failureCount:0};}},
  }));
  try {
    let response: Response | undefined;
    const save = patch({assignedGuards:[{uid:'emp'}]}).then((value) => {response = value;});
    // A stuck push must not keep the HTTP save open after the roster committed.
    for(let i=0;i<10;i++) await new Promise(resolve=>setTimeout(resolve,10));
    expect(store.row('workOrders','exam')?.assignedGuards).toHaveLength(1);
    expect(response?.status).toBe(200);
    expect(deferred).toHaveLength(1);
    expect(store.list('notifications')[0].data().pushStatus).toBe('pending');
    release();
    await save;
    await deferred[0]();
    expect(store.list('notifications')[0].data().pushStatus).toBe('sent');
  } finally {release();vi.doUnmock('next/server');}
});

it('saves a recreated work order even when an earlier version-one notification still exists', async () => {
  const {buildDutyNotificationWrites} = await import('@/lib/server/duties/notifications');
  const historical = buildDutyNotificationWrites({
    operation:'exam_roster',entityId:'exam',version:1,type:'duty_assigned',
    recipientUid:'auth',recipientRole:'guard',district:'Ernakulam',
    title:'Old duty',body:'Old assignment',data:{workOrderId:'exam',routeKind:'guard_duties'},
  })[0];
  const previous = {...historical.data,read:true,pushStatus:'sent'};
  store.seed('notifications',historical.ref.id,previous);
  const response = await patch({assignedGuards:[{uid:'emp'}],expectedVersion:0,clientRequestId:'11111111-1111-4111-8111-111111111111'});
  expect(response.status).toBe(200);
  expect(store.row('workOrders','exam')?.assignedGuards).toHaveLength(1);
  expect(store.row('notifications',historical.ref.id)).toEqual(previous);
  expect(store.list('notifications')).toHaveLength(2);
});

it('keeps new event identities unique across recreation and replays each saved receipt', async () => {
  const initial = {...store.row('workOrders','exam')!};
  const firstBody = {assignedGuards:[{uid:'emp'}],expectedVersion:0,clientRequestId:'11111111-1111-4111-8111-111111111111'};
  expect((await patch(firstBody)).status).toBe(200);
  const old = store.list('notifications')[0];
  store.seed('notifications',old.id,{...old.data(),read:true,pushStatus:'sent'});
  const preserved = {...store.row('notifications',old.id)!};
  // Import/recreation starts a new roster at version zero under the same duty id.
  store.seed('workOrders','exam',initial);
  const secondBody = {...firstBody,clientRequestId:'22222222-2222-4222-8222-222222222222'};
  expect((await patch(secondBody)).status).toBe(200);
  const notifications = store.list('notifications');
  expect(notifications).toHaveLength(2);
  expect(store.row('notifications',old.id)).toEqual(preserved);
  expect(store.row('workOrders','exam')?.assignmentVersion).toBe(1);
  expect((await patch(secondBody)).status).toBe(200);
  expect(store.list('notifications')).toHaveLength(2);
  expect(store.row('workOrders','exam')?.assignmentVersion).toBe(1);
});
