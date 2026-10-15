import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { TestStore } from './test-store';
let store: TestStore;
let token: any;
beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-13T10:00:00Z'));
  store = new TestStore();
  token = {
    uid: 'fo',
    role: 'fieldOfficer',
    assignedDistricts: ['Thrissur']
  };
  store.seed('fieldOfficers', 'linked', {
    uid: 'fo',
    status: 'active',
    assignedDistricts: ['cochin']
  });
  store.seed('sites', 'site', {
    siteName: 'Current centre',
    clientName: 'TCS',
    district: 'Ernakulam',
    shiftTemplates: [{
        code: 'day',
        label: 'Day',
        startTime: '08:00',
        endTime: '20:00',
        crossesMidnight: false
      }]
  });
  store.seed('workOrders', 'exam', {
    siteId: 'site',
    siteName: 'Old',
    clientName: 'TCS',
    district: 'Thrissur',
    date: new Date('2026-10-14T06:30:00Z'),
    recordStatus: 'active'
  });
  store.seed('employees', 'emp', {
    guardAuthUid: 'auth',
    employeeId: 'CISS/1',
    fullName: 'Guard',
    gender: 'Male',
    clientName: 'TCS',
    tcsCategory: 'adhoc',
    district: 'cochin',
    status: 'active'
  });
  store.seed('dutyWillingness', 'exam_emp', {
    workOrderId: 'exam',
    guardId: 'emp',
    guardUid: 'auth',
    dutyDate: '2026-10-14',
    response: 'willing',
    version: 1,
    respondedAt: new Date()
  });
  vi.doMock('@/lib/firebaseAdmin', () => ({
    db: store
  }));
  vi.doMock('@/lib/server/auth', () => ({
    verifyRequestAuth: vi.fn().mockImplementation(() => token),
    requireAdmin: vi.fn().mockImplementation(() => token),
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
  vi.useRealTimers();
  vi.doUnmock('@/lib/firebaseAdmin');
  vi.doUnmock('@/lib/server/auth');
});
const request = () => new Request('http://local/api');
it('FO and admin list count current eligible responses using current site scope', async () => {
  const route = await import('@/app/api/field-officer/work-orders/route');
  let r = await route.GET(request());
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    workOrders: [{
        id: 'exam',
        district: 'Ernakulam',
        willingCount: 1,
        unavailableCount: 0
      }]
  });
  token = {
    uid: 'admin',
    role: 'admin'
  };
  const admin = await import('@/app/api/admin/work-orders/route');
  expect(await (await admin.GET(request())).json()).toMatchObject({
    workOrders: [{
        willingCount: 1,
        unavailableCount: 0
      }]
  });
  store.row('employees', 'emp')!.status = 'inactive';
  expect(await (await admin.GET(request())).json()).toMatchObject({
    workOrders: [{
        willingCount: 0
      }]
  });
});
it('inactive site on one work order does not hide healthy work orders', async () => {
  store.row('sites', 'site')!.status = 'inactive';
  store.seed('sites', 'healthy-site', {
    siteName: 'Healthy centre',
    clientName: 'TCS',
    district: 'Ernakulam',
    status: 'active'
  });
  store.seed('workOrders', 'healthy-order', {
    siteId: 'healthy-site',
    clientName: 'TCS',
    district: 'Ernakulam',
    date: new Date('2026-10-14T06:30:00Z'),
    recordStatus: 'active'
  });

  const { GET } = await import('@/app/api/field-officer/work-orders/route');
  const response = await GET(request());

  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.workOrders).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: 'healthy-order', willingCount: 0 }),
    expect.objectContaining({ id: 'exam', willingCount: 0 }),
  ]));
});
it('work-order listing still fails on a backend tally error', async () => {
  vi.doMock('@/lib/server/duties/willingness', () => ({
    tallyWorkOrderWillingness: vi.fn().mockRejectedValue(new Error('backend outage'))
  }));
  const { GET } = await import('@/app/api/field-officer/work-orders/route');
  expect((await GET(request())).status).toBe(500);
});
it('missing/inactive linked FO does not fall back to claims and is 403', async () => {
  store.row('fieldOfficers', 'linked')!.status = 'inactive';
  const { GET } = await import('@/app/api/field-officer/work-orders/route');
  expect((await GET(request())).status).toBe(403);
});
it('moved or missing authoritative site excludes FO list even when stored workorder is in scope', async () => {
  store.row('sites', 'site')!.district = 'Thrissur';
  store.row('workOrders', 'exam')!.district = 'Ernakulam';
  const { GET } = await import('@/app/api/field-officer/work-orders/route');
  expect(await (await GET(request())).json()).toMatchObject({
    workOrders: []
  });
});
it('site DTO contains configured shift templates and admin has no linked FO requirement', async () => {
  token = {
    uid: 'admin',
    role: 'admin'
  };
  const { GET } = await import('@/app/api/field-officer/sites/route');
  const r = await GET(request());
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    sites: [{
        shiftTemplates: [{
            code: 'day',
            label: 'Day'
          }]
      }]
  });
});
it('ordinary assignment list uses current sites, not stale stored district, and validates window', async () => {
  store.seed('guardAssignments', 'a', {
    guardId: 'emp',
    siteId: 'site',
    siteName: 'Old',
    district: 'Thrissur',
    date: '2026-10-14',
    status: 'assigned',
    type: 'regular',
    version: 1
  });
  const { listGuardAssignments } = await import('./assignments');
  expect(await listGuardAssignments(request(), '2026-10-13', '2026-10-15')).toMatchObject([{
      id: 'a',
      district: 'Ernakulam',
      siteName: 'Current centre'
    }]);
  store.row('sites', 'site')!.district = 'Thrissur';
  expect(await listGuardAssignments(request(), '2026-10-13', '2026-10-15')).toEqual([]);
  await expect(listGuardAssignments(request(), '2026-10-13', '2027-03-15')).rejects.toMatchObject({
    status: 400,
    code: 'invalid_body'
  });
});
