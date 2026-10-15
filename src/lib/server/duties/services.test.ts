import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { TestStore } from './test-store';
let store: TestStore;
let token: Record<string, unknown>;
const req = () => new Request('http://local/api', {
  headers: {
    authorization: 'Bearer fake'
  }
});
const uuid = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const body = (response = 'willing', expectedVersion = 0, n = 1) => ({
  response,
  expectedVersion,
  clientRequestId: uuid(n)
});
const input = (n = 1) => ({
  employeeDocId: 'emp',
  siteId: 'site',
  date: '2026-10-14',
  shiftLabel: 'Night',
  startTime: '20:00',
  endTime: '08:00',
  crossesMidnight: true,
  type: 'relieving',
  clientRequestId: uuid(n)
});
function seed() {
  store.seed('employees', 'emp', {
    guardAuthUid: 'auth-guard',
    employeeId: 'CISS/001',
    fullName: 'Guard',
    clientName: 'TCS',
    tcsCategory: 'adhoc',
    district: 'Cochin',
    status: 'Active',
    gender: 'Male'
  });
  store.seed('fieldOfficers', 'fo-profile', {
    uid: 'auth-fo',
    assignedDistricts: ['cochin'],
    status: 'Active'
  });
  store.seed('sites', 'site', {
    siteName: 'Centre',
    clientName: 'TCS',
    district: 'Ernakulam',
    status: 'Active'
  });
  store.seed('workOrders', 'exam', {
    siteId: 'site',
    clientName: 'TCS',
    district: 'Thrissur',
    date: new Date('2026-10-14T00:00:00Z'),
    maleGuardsRequired: 2,
    femaleGuardsRequired: 0,
    examName: 'Exam',
    recordStatus: 'active',
    assignedGuards: [],
    startTime: '15:00'
  });
}
beforeEach(() => {
  vi.resetModules();
  store = new TestStore();
  seed();
  token = {
    uid: 'auth-guard',
    role: 'guard',
    employeeDocId: 'emp'
  };
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T18:29:59.999Z'));
  vi.doMock('@/lib/server/guard-auth', () => ({
    requireGuard: vi.fn().mockImplementation(async () => {
      const e = store.row('employees', String(token.employeeDocId ?? 'emp'));
      if (token.role !== 'guard' || !e || e.guardAuthUid !== token.uid || e.status !== 'Active')
        throw new Error('Guard employee record not found.');
      return {
        uid: token.uid,
        employeeDocId: token.employeeDocId ?? 'emp',
        employeeId: e.employeeId
      };
    })
  }));
  vi.doMock('@/lib/server/auth', () => ({
    verifyRequestAuth: vi.fn().mockImplementation(() => token),
    hasAdminAccess: (t: any) => t.admin === true || ['admin', 'superAdmin'].includes(t.role)
  }));
  vi.doMock('@/lib/firebaseAdmin', () => ({
    db: store,
    auth: {
      verifyIdToken: vi.fn().mockImplementation(() => token)
    }
  }));
  vi.doMock('firebase-admin/messaging', () => ({
    getMessaging: () => ({
      sendEachForMulticast: vi.fn().mockResolvedValue({
        failureCount: 0,
        successCount: 1,
        responses: [{
            success: true
          }]
      })
    })
  }));
});
afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('@/lib/firebaseAdmin');
  vi.doUnmock('@/lib/server/auth');
  vi.doUnmock('@/lib/server/guard-auth');
  vi.doUnmock('firebase-admin/messaging');
});
describe('guard willingness service', () => {
  it('derives identity, current site district, IST cutoff and declare-only response', async () => {
    const { setDutyWillingness } = await import('./willingness');
    const result = await setDutyWillingness(req(), 'exam', body());
    expect(result).toMatchObject({
      success: true,
      replayed: false,
      willingness: {
        response: 'willing',
        version: 1
      }
    });
    expect(store.row('dutyWillingness', 'exam_emp')).toMatchObject({
      guardId: 'emp',
      guardUid: 'auth-guard',
      employeeId: 'CISS/001',
      district: 'Ernakulam',
      dutyDate: '2026-10-14'
    });
    expect(store.row('workOrders', 'exam')?.assignedGuards).toEqual([]);
  });
  it('willingness timestamp at local midnight resolves the next IST duty date', async () => {
    store.row('workOrders', 'exam')!.date = new Date('2026-10-13T18:30:00Z');
    const { setDutyWillingness } = await import('./willingness');
    expect(await setDutyWillingness(req(), 'exam', body())).toMatchObject({
      success: true
    });
    expect(store.row('dutyWillingness', 'exam_emp')?.dutyDate).toBe('2026-10-14');
  });
  it('rejects exactly IST midnight despite afternoon shift or early capture', async () => {
    vi.setSystemTime(new Date('2026-10-13T18:30:00.000Z'));
    const { setDutyWillingness } = await import('./willingness');
    await expect(setDutyWillingness(req(), 'exam', body())).rejects.toMatchObject({
      status: 409,
      code: 'duty_closed'
    });
  });
  it.each(['permanent', undefined, 'invalid'])('rejects category %s', async (category) => {
    store.row('employees', 'emp')!.tcsCategory = category;
    const { setDutyWillingness } = await import('./willingness');
    await expect(setDutyWillingness(req(), 'exam', body())).rejects.toMatchObject({
      status: 403,
      code: 'ineligible_category'
    });
  });
  it.each(['inactive', 'disabled', 'terminated'])('rejects current %s guard', async (status) => {
    store.row('employees', 'emp')!.status = status;
    const { setDutyWillingness } = await import('./willingness');
    await expect(setDutyWillingness(req(), 'exam', body())).rejects.toMatchObject({
      status: 403
    });
  });
  it('rejects non TCS', async () => {
    store.row('employees', 'emp')!.clientName = 'Other';
    const { setDutyWillingness } = await import('./willingness');
    await expect(setDutyWillingness(req(), 'exam', body())).rejects.toMatchObject({
      code: 'ineligible_category'
    });
  });
  it.each(['cancelled', 'superseded', 'draft'])('rejects %s order', async (status) => {
    store.row('workOrders', 'exam')!.recordStatus = status;
    const { setDutyWillingness } = await import('./willingness');
    await expect(setDutyWillingness(req(), 'exam', body())).rejects.toMatchObject({
      status: 409
    });
  });
  it('rechecks authoritative moved site even on replay', async () => {
    const { setDutyWillingness } = await import('./willingness');
    await setDutyWillingness(req(), 'exam', body());
    store.row('sites', 'site')!.district = 'Thrissur';
    await expect(setDutyWillingness(req(), 'exam', body())).rejects.toMatchObject({
      status: 403,
      code: 'wrong_scope'
    });
  });
  it('replays old receipt after newer answer without rollback', async () => {
    const { setDutyWillingness } = await import('./willingness');
    await setDutyWillingness(req(), 'exam', body());
    await setDutyWillingness(req(), 'exam', body('unavailable', 1, 2));
    expect(await setDutyWillingness(req(), 'exam', body())).toMatchObject({
      replayed: true,
      willingness: {
        response: 'willing',
        version: 1
      }
    });
    expect(store.row('dutyWillingness', 'exam_emp')?.response).toBe('unavailable');
  });
  it('rejects reused key payload mismatch', async () => {
    const { setDutyWillingness } = await import('./willingness');
    await setDutyWillingness(req(), 'exam', body());
    await expect(setDutyWillingness(req(), 'exam', body('unavailable', 1))).rejects.toMatchObject({
      status: 409,
      code: 'request_conflict'
    });
  });
  it('serializes concurrent same version changes and returns current response', async () => {
    const { setDutyWillingness } = await import('./willingness');
    const results = await Promise.allSettled([setDutyWillingness(req(), 'exam', body()), setDutyWillingness(req(), 'exam', body('unavailable', 0, 2))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(r => r.status === 'rejected')).toMatchObject({
      reason: {
        code: 'version_conflict',
        details: {
          willingness: {
            version: 1
          }
        }
      }
    });
  });
  it('no-op current response does not increment or create event', async () => {
    const { setDutyWillingness } = await import('./willingness');
    await setDutyWillingness(req(), 'exam', body());
    const count = store.list('notifications').length;
    expect(await setDutyWillingness(req(), 'exam', body('willing', 1, 2))).toMatchObject({
      willingness: {
        version: 1
      }
    });
    expect(store.list('notifications')).toHaveLength(count);
  });
  it.each([{
      guardId: 'forged'
    }, {
      district: 'Thrissur'
    }, {
      respondedAt: 'before'
    }, {
      capturedAt: 'before'
    }, {
      response: 'yes'
    }, {
      expectedVersion: -1
    }, {
      clientRequestId: 'not-uuid'
    }])('rejects invalid body %j', async (extra) => {
    const { setDutyWillingness } = await import('./willingness');
    await expect(setDutyWillingness(req(), 'exam', {
      ...body(),
      ...extra
    })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_body'
    });
  });
  it('excludes transferred, inactive, reclassified and wrong uid tally records', async () => {
    const { setDutyWillingness, getWorkOrderWillingness } = await import('./willingness');
    await setDutyWillingness(req(), 'exam', body());
    token = {
      uid: 'auth-fo',
      role: 'fieldOfficer'
    };
    expect(await getWorkOrderWillingness(req(), 'exam')).toMatchObject({
      willingCount: 1,
      unavailableCount: 0,
      responses: [{
          employeeDocId: 'emp'
        }]
    });
    store.row('employees', 'emp')!.tcsCategory = 'permanent';
    expect(await getWorkOrderWillingness(req(), 'exam')).toMatchObject({
      willingCount: 0,
      responses: []
    });
  });
  it('malformed or duplicate FO profiles do not block saving or receive willingness events', async () => {
    store.seed('fieldOfficers', 'malformed', {
      uid: 'malformed',
      status: 'active',
      assignedDistricts: 'Ernakulam'
    });
    store.seed('fieldOfficers', 'duplicate1', {
      uid: 'duplicate',
      status: 'active',
      assignedDistricts: ['Ernakulam']
    });
    store.seed('fieldOfficers', 'duplicate2', {
      uid: 'duplicate',
      status: 'active',
      assignedDistricts: ['Ernakulam']
    });
    const { setDutyWillingness } = await import('./willingness');
    expect(await setDutyWillingness(req(), 'exam', body())).toMatchObject({
      success: true
    });
    expect(store.list('notifications').map(d => d.data().recipientUid)).toEqual(['auth-fo']);
  });
  it('50 interests are accepted against two required positions', async () => {
    const { setDutyWillingness } = await import('./willingness');
    for (let i = 0; i < 50; i++) {
      store.seed('employees', `emp${i}`, {
        ...store.row('employees', 'emp'),
        guardAuthUid: `uid${i}`
      });
      token = {
        uid: `uid${i}`,
        role: 'guard',
        employeeDocId: `emp${i}`
      };
      await setDutyWillingness(req(), 'exam', body('willing', 0, i + 1));
    }
    expect(store.list('dutyWillingness')).toHaveLength(50);
  });
});
describe('duty feed', () => {
  it('returns safe open exam with exact cutoff and unknown shift; ignores startTime-only', async () => {
    const { getGuardDuties } = await import('./guard-feed');
    const rows = await getGuardDuties(req());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'exam',
      kind: 'exam',
      district: 'Ernakulam',
      respondBy: '2026-10-13T18:30:00.000Z',
      canRespond: true,
      shiftLabel: null,
      startsAt: null,
      endsAt: null
    });
    expect(JSON.stringify(rows)).not.toMatch(/guardAuthUid|assignedGuards|CISS\/001/);
  });
  it('own exam roster appears once, ID differs from Auth UID', async () => {
    store.row('workOrders', 'exam')!.assignedGuards = [{
        uid: 'emp',
        name: 'Private'
      }];
    const { getGuardDuties } = await import('./guard-feed');
    expect(await getGuardDuties(req())).toMatchObject([{
        id: 'exam:exam',
        kind: 'assigned',
        canRespond: false
      }]);
  });
  it('IST-midnight timestamp uses the canonical local date and stays inside today feed bounds', async () => {
    store.row('workOrders', 'exam')!.date = new Date('2026-10-13T18:30:00Z');
    vi.setSystemTime(new Date('2026-10-13T18:30:00Z'));
    const { getGuardDuties } = await import('./guard-feed');
    expect(await getGuardDuties(req())).toMatchObject([{
        date: '2026-10-14',
        respondBy: '2026-10-13T18:30:00.000Z',
        canRespond: false
      }]);
  });
  it('today remains read-only; no missing cancelled draft foreign open exams', async () => {
    vi.setSystemTime(new Date('2026-10-14T01:00Z'));
    const { getGuardDuties } = await import('./guard-feed');
    expect(await getGuardDuties(req())).toMatchObject([{
        canRespond: false,
        ineligibilityReason: 'duty_closed'
      }]);
  });
  it.each(['superseded', 'draft'])('does not show own non-authoritative %s exam roster', async (status) => {
    store.row('workOrders', 'exam')!.recordStatus = status;
    store.row('workOrders', 'exam')!.assignedGuards = [{
        uid: 'emp'
      }];
    const { getGuardDuties } = await import('./guard-feed');
    expect(await getGuardDuties(req())).toEqual([]);
  });
  it('own cancelled exam stays visible if its site is missing, without exposing another roster', async () => {
    store.row('workOrders', 'exam')!.recordStatus = 'cancelled';
    store.row('workOrders', 'exam')!.cancelledAssignedGuards = [{
        uid: 'emp'
      }, {
        uid: 'other',
        name: 'Other private name'
      }];
    store.row('workOrders', 'exam')!.siteName = 'Saved centre';
    store.rows.delete('sites/site');
    const { getGuardDuties } = await import('./guard-feed');
    const rows = await getGuardDuties(req());
    expect(rows).toMatchObject([{
        id: 'exam:exam',
        status: 'cancelled',
        siteName: 'Saved centre'
      }]);
    expect(JSON.stringify(rows)).not.toContain('Other private name');
  });
  it('site moved to another client hides the stale open exam but keeps own cancelled duty', async () => {
    store.row('sites', 'site')!.clientName = 'Other';
    const { getGuardDuties } = await import('./guard-feed');
    expect(await getGuardDuties(req())).toEqual([]);
    store.row('workOrders', 'exam')!.cancelledAssignedGuards = [{
        uid: 'emp'
      }];
    expect(await getGuardDuties(req())).toMatchObject([{
        id: 'exam:exam',
        kind: 'assigned',
        status: 'cancelled',
        canRespond: false
      }]);
  });
  it('complete ordered feed pages beyond 500', async () => {
    for (let i = 0; i < 520; i++)
      store.seed('workOrders', `exam${String(i).padStart(3, '0')}`, {
        ...store.row('workOrders', 'exam')
      });
    const { getGuardDuties } = await import('./guard-feed');
    expect(await getGuardDuties(req())).toHaveLength(521);
  });
});
describe('ordinary assignments', () => {
  beforeEach(() => {
    token = {
      uid: 'auth-fo',
      role: 'fieldOfficer'
    };
  });
  it('creates informational overnight relieving duty with canonical metadata and no employee transfer', async () => {
    const { createGuardAssignment } = await import('./assignments');
    const result = await createGuardAssignment(req(), input());
    expect(result.assignment).toMatchObject({
      guardId: 'emp',
      guardUid: 'auth-guard',
      siteName: 'Centre',
      type: 'relieving',
      version: 1,
      startsAt: '2026-10-14T14:30:00.000Z',
      endsAt: '2026-10-15T02:30:00.000Z'
    });
    expect(store.row('employees', 'emp')!.assignedSiteId).toBeUndefined();
  });
  it('create replay is idempotent but another exact active slot conflicts', async () => {
    const { createGuardAssignment } = await import('./assignments');
    const a = await createGuardAssignment(req(), input());
    expect(await createGuardAssignment(req(), input())).toMatchObject({
      replayed: true,
      assignment: {
        id: a.assignment.id
      }
    });
    await expect(createGuardAssignment(req(), input(2))).rejects.toMatchObject({
      status: 409,
      code: 'duplicate_assignment'
    });
  });
  it('edit and cancel CAS; old replay never rolls newer state back', async () => {
    const { createGuardAssignment, updateGuardAssignment } = await import('./assignments');
    const a = await createGuardAssignment(req(), input());
    const b = {
      siteId: 'site',
      date: '2026-10-15',
      expectedVersion: 1,
      clientRequestId: uuid(2)
    };
    await updateGuardAssignment(req(), a.assignment.id, b);
    await updateGuardAssignment(req(), a.assignment.id, {
      status: 'cancelled',
      expectedVersion: 2,
      clientRequestId: uuid(3)
    });
    expect(await updateGuardAssignment(req(), a.assignment.id, b)).toMatchObject({
      replayed: true,
      assignment: {
        version: 2
      }
    });
    expect(store.row('guardAssignments', a.assignment.id)?.status).toBe('cancelled');
  });
  it('cancelled history cannot release a replacement assignment slot', async () => {
    const { createGuardAssignment, updateGuardAssignment } = await import('./assignments');
    const a = await createGuardAssignment(req(), input(1));
    await updateGuardAssignment(req(), a.assignment.id, {
      status: 'cancelled',
      expectedVersion: 1,
      clientRequestId: uuid(2)
    });
    const b = await createGuardAssignment(req(), input(3));
    const slot = store.row('guardAssignments', b.assignment.id)!.slotKey;
    await updateGuardAssignment(req(), a.assignment.id, {
      status: 'cancelled',
      date: '2026-10-15',
      expectedVersion: 2,
      clientRequestId: uuid(4)
    });
    expect(store.row('guardAssignmentSlots', slot)?.assignmentId).toBe(b.assignment.id);
    await expect(createGuardAssignment(req(), input(5))).rejects.toMatchObject({
      status: 409,
      code: 'duplicate_assignment'
    });
    expect(store.row('guardAssignments', b.assignment.id)?.status).toBe('assigned');
    expect(store.row('guardAssignments', a.assignment.id)).toMatchObject({
      status: 'cancelled',
      date: '2026-10-15'
    });
  });
  it('repeated cancellation with changed site metadata keeps the replacement slot', async () => {
    const { createGuardAssignment, updateGuardAssignment } = await import('./assignments');
    const a = await createGuardAssignment(req(), input(1));
    await updateGuardAssignment(req(), a.assignment.id, {
      status: 'cancelled',
      expectedVersion: 1,
      clientRequestId: uuid(2)
    });
    const b = await createGuardAssignment(req(), input(3));
    const slot = store.row('guardAssignments', b.assignment.id)!.slotKey;
    store.row('sites', 'site')!.siteName = 'Renamed centre';
    expect(await updateGuardAssignment(req(), a.assignment.id, {
      status: 'cancelled',
      expectedVersion: 2,
      clientRequestId: uuid(4)
    })).toMatchObject({
      assignment: {
        siteName: 'Renamed centre',
        status: 'cancelled'
      }
    });
    expect(store.row('guardAssignmentSlots', slot)?.assignmentId).toBe(b.assignment.id);
  });
  it('concurrent edits permit one version', async () => {
    const { createGuardAssignment, updateGuardAssignment } = await import('./assignments');
    const a = await createGuardAssignment(req(), input());
    const results = await Promise.allSettled([2, 3].map(n => updateGuardAssignment(req(), a.assignment.id, {
      date: `2026-10-${14 + n}`,
      expectedVersion: 1,
      clientRequestId: uuid(n)
    })));
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
  });
  it.each(['missing', 'inactive', 'disabled'])('denies %s linked FO despite claims', async (state) => {
    token.assignedDistricts = ['Ernakulam'];
    if (state === 'missing')
      store.rows.delete('fieldOfficers/fo-profile');
    else
      store.row('fieldOfficers', 'fo-profile')!.status = state;
    const { createGuardAssignment } = await import('./assignments');
    await expect(createGuardAssignment(req(), input())).rejects.toMatchObject({
      status: 403
    });
  });
  it('checks both current old/new site scope and guard district', async () => {
    const { createGuardAssignment, updateGuardAssignment } = await import('./assignments');
    const a = await createGuardAssignment(req(), input());
    store.row('sites', 'site')!.district = 'Thrissur';
    await expect(updateGuardAssignment(req(), a.assignment.id, {
      status: 'cancelled',
      expectedVersion: 1,
      clientRequestId: uuid(2)
    })).rejects.toMatchObject({
      code: 'wrong_scope'
    });
  });
  it.each([{
      district: 'forged'
    }, {
      clientName: 'forged'
    }, {
      guardName: 'forged'
    }, {
      date: '2026-02-30'
    }, {
      startTime: '24:00'
    }, {
      shiftLabel: undefined
    }, {
      crossesMidnight: false
    }, {
      type: 'exam'
    }])('validates body %j', async (extra) => {
    const { createGuardAssignment } = await import('./assignments');
    await expect(createGuardAssignment(req(), {
      ...input(),
      ...extra
    })).rejects.toMatchObject({
      status: 400
    });
  });
  it('configured site template is authoritative', async () => {
    store.row('sites', 'site')!.shiftTemplates = [{
        code: 'day',
        label: 'Day',
        startTime: '08:00',
        endTime: '20:00',
        crossesMidnight: false
      }];
    const { createGuardAssignment } = await import('./assignments');
    const { shiftLabel, startTime, endTime, crossesMidnight, ...b } = input();
    void shiftLabel;
    void startTime;
    void endTime;
    void crossesMidnight;
    expect(await createGuardAssignment(req(), {
      ...b,
      shiftCode: 'day'
    })).toMatchObject({
      assignment: {
        shiftLabel: 'Day',
        endsAt: '2026-10-14T14:30:00.000Z'
      }
    });
  });
  it('own cancelled duties visible to permanent/non TCS guards, others hidden', async () => {
    const { createGuardAssignment, updateGuardAssignment } = await import('./assignments');
    const a = await createGuardAssignment(req(), input());
    await updateGuardAssignment(req(), a.assignment.id, {
      status: 'cancelled',
      expectedVersion: 1,
      clientRequestId: uuid(2)
    });
    store.row('employees', 'emp')!.clientName = 'Other';
    token = {
      uid: 'auth-guard',
      role: 'guard',
      employeeDocId: 'emp'
    };
    const { getGuardDuties } = await import('./guard-feed');
    expect(await getGuardDuties(req())).toMatchObject([{
        id: a.assignment.id,
        status: 'cancelled',
        relieving: true
      }]);
  });
  it('same-day explicit shift permits omitted optional crossesMidnight', async () => {
    const { createGuardAssignment } = await import('./assignments');
    const b = input();
    delete (b as any).crossesMidnight;
    b.startTime = '08:00';
    b.endTime = '20:00';
    expect(await createGuardAssignment(req(), b)).toMatchObject({
      assignment: {
        startsAt: '2026-10-14T02:30:00.000Z',
        endsAt: '2026-10-14T14:30:00.000Z'
      }
    });
  });
  it('changing a configured shift code derives the selected template', async () => {
    store.row('sites', 'site')!.shiftTemplates = [{
        code: 'day',
        label: 'Day',
        startTime: '08:00',
        endTime: '20:00',
        crossesMidnight: false
      }, {
        code: 'night',
        label: 'Night',
        startTime: '20:00',
        endTime: '08:00',
        crossesMidnight: true
      }];
    const { createGuardAssignment, updateGuardAssignment } = await import('./assignments');
    const a = await createGuardAssignment(req(), {
      employeeDocId: 'emp',
      siteId: 'site',
      date: '2026-10-14',
      shiftCode: 'day',
      type: 'regular',
      clientRequestId: uuid(1)
    });
    expect(a.assignment).toMatchObject({
      shiftCode: 'day',
      shiftLabel: 'Day',
      startsAt: '2026-10-14T02:30:00.000Z',
      endsAt: '2026-10-14T14:30:00.000Z'
    });
    const b = await updateGuardAssignment(req(), a.assignment.id, {
      shiftCode: 'night',
      expectedVersion: 1,
      clientRequestId: uuid(2)
    });
    expect(b.assignment).toMatchObject({
      shiftCode: 'night',
      shiftLabel: 'Night',
      startsAt: '2026-10-14T14:30:00.000Z',
      endsAt: '2026-10-15T02:30:00.000Z'
    });
    expect(store.row('guardAssignmentSlots', store.row('guardAssignments', a.assignment.id)!.slotKey)?.assignmentId).toBe(a.assignment.id);
    await expect(updateGuardAssignment(req(), a.assignment.id, {
      shiftCode: 'day',
      shiftLabel: 'Forged',
      expectedVersion: 2,
      clientRequestId: uuid(3)
    })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_body'
    });
  });
  it('template day assignment can be edited to a new date without forged label rejection', async () => {
    store.row('sites', 'site')!.shiftTemplates = [{
        code: 'day',
        label: 'Day',
        startTime: '08:00',
        endTime: '20:00',
        crossesMidnight: false
      }];
    const { createGuardAssignment, updateGuardAssignment } = await import('./assignments');
    const a = await createGuardAssignment(req(), {
      employeeDocId: 'emp',
      siteId: 'site',
      date: '2026-10-14',
      shiftCode: 'day',
      shiftLabel: 'Day',
      type: 'regular',
      clientRequestId: uuid()
    });
    expect(await updateGuardAssignment(req(), a.assignment.id, {
      date: '2026-10-15',
      expectedVersion: 1,
      clientRequestId: uuid(2)
    })).toMatchObject({
      assignment: {
        date: '2026-10-15',
        shiftLabel: 'Day'
      }
    });
  });
  it('malformed PATCH site identity is rejected rather than silently ignored', async () => {
    const { createGuardAssignment, updateGuardAssignment } = await import('./assignments');
    const a = await createGuardAssignment(req(), input());
    await expect(updateGuardAssignment(req(), a.assignment.id, {
      siteId: '',
      date: '2026-10-15',
      expectedVersion: 1,
      clientRequestId: uuid(2)
    })).rejects.toMatchObject({
      status: 400
    });
  });
  it('assignment body date is a strict YYYY-MM-DD calendar date', async () => {
    const { createGuardAssignment } = await import('./assignments');
    await expect(createGuardAssignment(req(), {
      ...input(),
      date: '2026-10-14T23:00:00Z'
    })).rejects.toMatchObject({
      status: 400,
      code: 'invalid_body'
    });
  });
});
describe('exam roster removal history', () => {
  const patch = async (assignedGuards: unknown[]) => {
    const { PATCH } = await import('@/app/api/admin/work-orders/[id]/route');
    return PATCH(new Request('http://local/api', {
      method: 'PATCH',
      body: JSON.stringify({
        assignedGuards
      })
    }), {
      params: Promise.resolve({
        id: 'exam'
      })
    });
  };
  it('manual removal keeps the guard own cancelled duty and reassignment overrides it', async () => {
    token = {
      uid: 'auth-fo',
      role: 'fieldOfficer'
    };
    expect((await patch([{
        uid: 'emp'
      }])).status).toBe(200);
    expect((await patch([])).status).toBe(200);
    const types = store.list('notifications').map(d => d.data().type);
    expect(types).toContain('duty_assigned');
    expect(types).toContain('duty_cancelled');
    expect(store.row('workOrders', 'exam')?.assignedGuards).toEqual([]);
    expect(store.row('workOrders', 'exam')?.cancelledAssignedGuards).toEqual([{
        uid: 'emp',
        name: 'Guard',
        employeeId: 'CISS/001',
        gender: 'Male'
      }]);
    token = {
      uid: 'auth-guard',
      role: 'guard',
      employeeDocId: 'emp'
    };
    const { getGuardDuties } = await import('./guard-feed');
    expect(await getGuardDuties(req())).toContainEqual(expect.objectContaining({
      id: 'exam:exam',
      kind: 'assigned',
      status: 'cancelled',
      canRespond: false
    }));
    store.row('employees', 'emp')!.clientName = 'Other';
    expect(await getGuardDuties(req())).toContainEqual(expect.objectContaining({
      id: 'exam:exam',
      status: 'cancelled'
    }));
    store.row('employees', 'emp')!.clientName = 'TCS';
    token = {
      uid: 'auth-fo',
      role: 'fieldOfficer'
    };
    expect((await patch([{
        uid: 'emp'
      }])).status).toBe(200);
    expect(store.row('workOrders', 'exam')?.cancelledAssignedGuards).toEqual([]);
    token = {
      uid: 'auth-guard',
      role: 'guard',
      employeeDocId: 'emp'
    };
    const reassigned = await getGuardDuties(req());
    expect(reassigned).toContainEqual(expect.objectContaining({
      id: 'exam:exam',
      kind: 'assigned',
      status: 'assigned',
      ineligibilityReason: 'already_assigned',
      canRespond: false
    }));
    expect(reassigned.some(row => row.status === 'cancelled')).toBe(false);
  });
});
