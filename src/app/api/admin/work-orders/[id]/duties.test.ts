import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TestStore } from '@/lib/server/duties/test-store';
let store: TestStore;
let token: any;
beforeEach(() => {
  vi.resetModules();
  store = new TestStore();
  token = {
    uid: 'fo',
    role: 'fieldOfficer'
  };
  store.seed('fieldOfficers', 'fo-record', {
    uid: 'fo',
    status: 'active',
    assignedDistricts: ['Cochin']
  });
  store.seed('sites', 'site', {
    siteName: 'Centre',
    clientName: 'TCS',
    district: 'Ernakulam',
    status: 'active'
  });
  store.seed('workOrders', 'exam', {
    siteId: 'site',
    siteName: 'Centre',
    clientName: 'TCS',
    district: 'Thrissur',
    date: new Date('2026-10-14T06:30:00Z'),
    recordStatus: 'active',
    maleGuardsRequired: 2,
    femaleGuardsRequired: 0,
    assignedGuards: []
  });
  store.seed('employees', 'emp', {
    employeeId: 'CISS/1',
    fullName: 'Canonical',
    gender: 'Male',
    district: 'cochin',
    status: 'active',
    guardAuthUid: 'auth'
  });
  vi.doMock('@/lib/firebaseAdmin', () => ({
    db: store,
    messaging: {
      sendEachForMulticast: vi.fn()
    }
  }));
  vi.doMock('@/lib/server/auth', () => ({
    verifyRequestAuth: vi.fn().mockImplementation(() => token),
    requireAdminOrFieldOfficer: (t: any) => t,
    hasAdminAccess: (t: any) => t.role === 'admin',
    hasFieldOfficerAccess: (t: any) => t.role === 'fieldOfficer',
    unauthorizedResponse: (error: string, status: number) => Response.json({
      error
    }, {
      status
    })
  }));
});
afterEach(() => {
  vi.doUnmock('@/lib/firebaseAdmin');
  vi.doUnmock('@/lib/server/auth');
});
async function patch(body: any) {
  const { PATCH } = await import('./route');
  return PATCH(new Request('http://local/api', {
    method: 'PATCH',
    body: JSON.stringify(body)
  }), {
    params: Promise.resolve({
      id: 'exam'
    })
  });
}
it('legacy FO URL remains alias and permits manual unavailable/unclassified assignment', async () => {
  const { PATCH } = await import('../../../field-officer/work-orders/[id]/route');
  const r = await PATCH(new Request('http://local/api', {
    method: 'PATCH',
    body: JSON.stringify({
      assignedGuards: [{
          uid: 'emp',
          name: 'Forged'
        }]
    })
  }), {
    params: Promise.resolve({
      id: 'exam'
    })
  });
  expect(r.status).toBe(200);
  expect(store.row('workOrders', 'exam')?.assignedGuards).toEqual([{
      uid: 'emp',
      name: 'Canonical',
      employeeId: 'CISS/1',
      gender: 'Male'
    }]);
  expect(store.list('notifications').map(d => d.data().recipientUid)).toEqual(['auth']);
});
it.each(['missing', 'disabled'])('denies %s linked FO despite claims', async (state) => {
  if (state === 'missing')
    store.rows.delete('fieldOfficers/fo-record');
  else
    store.row('fieldOfficers', 'fo-record')!.status = 'disabled';
  token.assignedDistricts = ['Ernakulam'];
  expect((await patch({
    assignedGuards: [{
        uid: 'emp'
      }]
  })).status).toBe(403);
  expect(store.list('notifications')).toHaveLength(0);
});
it('current site district wins and moved site forbids update', async () => {
  store.row('sites', 'site')!.district = 'Thrissur';
  store.row('workOrders', 'exam')!.district = 'Ernakulam';
  expect((await patch({
    assignedGuards: [{
        uid: 'emp'
      }]
  })).status).toBe(403);
});
it('same canonical roster is no-op and no duplicate inbox event', async () => {
  expect((await patch({
    assignedGuards: [{
        uid: 'emp'
      }]
  })).status).toBe(200);
  expect((await patch({
    assignedGuards: [{
        uid: 'emp'
      }]
  })).status).toBe(200);
  expect(store.row('workOrders', 'exam')?.assignmentVersion).toBe(1);
  expect(store.list('notifications')).toHaveLength(1);
});
it('manual roster removal records cancelled membership and reassignment clears it', async () => {
  expect((await patch({
    assignedGuards: [{
        uid: 'emp'
      }]
  })).status).toBe(200);
  expect(store.row('workOrders', 'exam')?.cancelledAssignedGuards).toEqual([]);
  expect((await patch({
    assignedGuards: []
  })).status).toBe(200);
  expect(store.row('workOrders', 'exam')?.assignedGuards).toEqual([]);
  expect(store.row('workOrders', 'exam')?.cancelledAssignedGuards).toEqual([{
      uid: 'emp',
      name: 'Canonical',
      employeeId: 'CISS/1',
      gender: 'Male'
    }]);
  expect((await patch({
    assignedGuards: [{
        uid: 'emp'
      }]
  })).status).toBe(200);
  expect(store.row('workOrders', 'exam')?.cancelledAssignedGuards).toEqual([]);
  expect(store.row('workOrders', 'exam')?.assignedGuards).toEqual([{
      uid: 'emp',
      name: 'Canonical',
      employeeId: 'CISS/1',
      gender: 'Male'
    }]);
});
it('optional request/CAS receipts replay prior roster after newer state', async () => {
  const b = {
    assignedGuards: [{
        uid: 'emp'
      }],
    clientRequestId: '00000000-0000-4000-8000-000000000001',
    expectedVersion: 0
  };
  expect((await patch(b)).status).toBe(200);
  expect((await patch({
    assignedGuards: []
  })).status).toBe(200);
  expect((await patch(b)).status).toBe(200);
  expect(store.row('workOrders', 'exam')?.assignedGuards).toEqual([]);
  expect(store.list('notifications')).toHaveLength(2);
});
it('reused receipt key conflicts and stale version returns 409', async () => {
  const b = {
    assignedGuards: [{
        uid: 'emp'
      }],
    clientRequestId: '00000000-0000-4000-8000-000000000001',
    expectedVersion: 0
  };
  await patch(b);
  const conflict = await patch({
    ...b,
    assignedGuards: []
  });
  expect(conflict.status).toBe(409);
  expect(await conflict.json()).toMatchObject({
    code: 'request_conflict'
  });
  const stale = await patch({
    ...b,
    clientRequestId: '00000000-0000-4000-8000-000000000002'
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: 'version_conflict'
  });
});
it('preserves same-day roster conflict and gender validation', async () => {
  store.seed('workOrders', 'other', {
    ...store.row('workOrders', 'exam'),
    assignedGuards: [{
        uid: 'emp'
      }]
  });
  expect((await patch({
    assignedGuards: [{
        uid: 'emp'
      }]
  })).status).toBe(409);
  store.rows.delete('workOrders/other');
  store.row('employees', 'emp')!.gender = '';
  expect((await patch({
    assignedGuards: [{
        uid: 'emp'
      }]
  })).status).toBe(409);
});
it('transaction failure preserves roster and inbox atomically', async () => {
  store.failCommit = true;
  expect((await patch({
    assignedGuards: [{
        uid: 'emp'
      }]
  })).status).toBe(500);
  expect(store.row('workOrders', 'exam')?.assignedGuards).toEqual([]);
  expect(store.list('notifications')).toHaveLength(0);
});
it('active false guard is rejected from existing manual roster despite active status', async () => {
  store.row('employees', 'emp')!.active = false;
  expect((await patch({
    assignedGuards: [{
        uid: 'emp'
      }]
  })).status).toBe(409);
});
it('wrong roster writer role is terminal 403 with stable code', async () => {
  token = {
    uid: 'auth',
    role: 'guard'
  };
  const r = await patch({
    assignedGuards: []
  });
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({
    code: 'wrong_role'
  });
});
it('legacy roster validation branches still have stable business codes', async () => {
  const r = await patch({
    assignmentHistory: []
  });
  expect(r.status).toBe(400);
  expect(await r.json()).toMatchObject({
    code: 'invalid_body'
  });
});
it('detail GET requires current linked FO and returns stable denial', async () => {
  store.rows.delete('fieldOfficers/fo-record');
  const { GET } = await import('./route');
  const r = await GET(new Request('http://local/api'), {
    params: Promise.resolve({
      id: 'exam'
    })
  });
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({
    code: 'wrong_scope'
  });
});
it('old roster receipt cannot report success for a currently cancelled work order',async()=>{const b={assignedGuards:[{uid:'emp'}],clientRequestId:'00000000-0000-4000-8000-000000000001',expectedVersion:0};expect((await patch(b)).status).toBe(200);store.row('workOrders','exam')!.recordStatus='cancelled';const r=await patch(b);expect(r.status).toBe(409);expect(await r.json()).toMatchObject({code:'duty_cancelled'});});
it('a stale manual roster save cannot cancel a newer supervisor assignment', async () => {
  store.seed('fieldOfficers', 'fo-b-record', {
    uid: 'fo-b',
    status: 'active',
    assignedDistricts: ['Ernakulam'],
  });
  store.seed('employees', 'emp-two', {
    employeeId: 'CISS/2',
    fullName: 'Second',
    gender: 'Male',
    district: 'Ernakulam',
    status: 'active',
    guardAuthUid: 'auth-two',
  });
  const { prepareManualRosterRequest, prepareRosterRequest } = await import('@/components/field-officers/duty-scheduling');
  // Supervisor B adds the second guard through the versioned panel path.
  token = {
    uid: 'fo-b',
    role: 'fieldOfficer',
  };
  const added = await patch(prepareRosterRequest('exam', [], [{
      employeeDocId: 'emp-two',
      employeeId: 'CISS/2',
      name: 'Second',
      gender: 'Male',
      tcsCategory: 'adhoc',
      response: 'willing',
      respondedAt: null,
      version: 1,
    }], 0, () => '00000000-0000-4000-8000-00000000000b').body);
  expect(added.status).toBe(200);
  expect(store.row('workOrders', 'exam')?.assignmentVersion).toBe(1);

  // Supervisor A's retained manual dialog still holds the roster it loaded at version 0.
  token = {
    uid: 'fo',
    role: 'fieldOfficer',
  };
  const stale = await patch(prepareManualRosterRequest('exam', [{
      uid: 'emp',
      name: 'Canonical',
      employeeId: 'CISS/1',
      gender: 'Male',
    }], 0, () => '00000000-0000-4000-8000-00000000000a').body);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({
    code: 'version_conflict'
  });
  expect(store.row('workOrders', 'exam')?.assignedGuards.map((g: any) => g.uid)).toEqual(['emp-two']);
  expect(store.row('workOrders', 'exam')?.cancelledAssignedGuards ?? []).toEqual([]);
});
it('replays an identical manual roster retry after a lost response', async () => {
  const { prepareManualRosterRequest } = await import('@/components/field-officers/duty-scheduling');
  const body = prepareManualRosterRequest('exam', [{
      uid: 'emp',
      name: 'Canonical',
      employeeId: 'CISS/1',
      gender: 'Male',
    }], 0, () => '00000000-0000-4000-8000-00000000000c').body;
  expect((await patch(body)).status).toBe(200);
  expect(store.row('workOrders', 'exam')?.assignmentVersion).toBe(1);
  expect(store.list('notifications')).toHaveLength(1);
  // The first response never reached the browser, so the supervisor retried the same request.
  expect((await patch(body)).status).toBe(200);
  expect(store.row('workOrders', 'exam')?.assignmentVersion).toBe(1);
  expect(store.row('workOrders', 'exam')?.assignedGuards.map((g: any) => g.uid)).toEqual(['emp']);
  expect(store.list('notifications')).toHaveLength(1);
});
