import { afterEach, expect, it, vi } from 'vitest';
const services = vi.hoisted(() => ({
  getGuardDuties: vi.fn(),
  setDutyWillingness: vi.fn(),
  getWorkOrderWillingness: vi.fn(),
  createGuardAssignment: vi.fn(),
  updateGuardAssignment: vi.fn(),
  listGuardAssignments: vi.fn()
}));
vi.mock('@/lib/server/duties/guard-feed', () => services);
vi.mock('@/lib/server/duties/willingness', () => services);
vi.mock('@/lib/server/duties/assignments', () => services);
afterEach(() => vi.resetAllMocks());
const request = (body?: unknown) => new Request('http://local/api?from=2026-10-14&to=2026-10-15', body === undefined ? {} : {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(body)
});
it('guard feed is private/no-store', async () => {
  services.getGuardDuties.mockResolvedValue([{
      id: 'safe'
    }]);
  const { GET } = await import('./route');
  const r = await GET(request());
  expect(r.headers.get('cache-control')).toBe('private, no-store');
  expect(await r.json()).toEqual({
    duties: [{
        id: 'safe'
      }]
  });
});
it('willingness route wires exact body and ID and catches malformed JSON', async () => {
  services.setDutyWillingness.mockResolvedValue({
    success: true
  });
  const { POST } = await import('./[id]/willingness/route');
  const b = {
    response: 'willing',
    clientRequestId: 'uuid',
    expectedVersion: 0
  };
  expect((await POST(request(b), {
    params: Promise.resolve({
      id: 'exam'
    })
  })).status).toBe(200);
  expect(services.setDutyWillingness.mock.calls[0].slice(1)).toEqual(['exam', b]);
  const bad = await POST(new Request('http://local/api', {
    method: 'POST',
    body: '{'
  }), {
    params: Promise.resolve({
      id: 'exam'
    })
  });
  expect(bad.status).toBe(400);
  expect(await bad.json()).toMatchObject({
    code: 'invalid_body'
  });
});
it('tally endpoint wires supervisor request and workOrder ID', async () => {
  services.getWorkOrderWillingness.mockResolvedValue({
    willingCount: 2
  });
  const { GET } = await import('../../field-officer/work-orders/[id]/willingness/route');
  expect(await (await GET(request(), {
    params: Promise.resolve({
      id: 'exam'
    })
  })).json()).toEqual({
    willingCount: 2
  });
});
it('assignment list/create/update routes wire window and versioned request', async () => {
  services.listGuardAssignments.mockResolvedValue([]);
  services.createGuardAssignment.mockResolvedValue({
    success: true
  });
  services.updateGuardAssignment.mockResolvedValue({
    success: true
  });
  const route = await import('../../field-officer/assignments/route');
  expect(await (await route.GET(request())).json()).toEqual({
    assignments: []
  });
  expect(services.listGuardAssignments.mock.calls[0].slice(1)).toEqual(['2026-10-14', '2026-10-15']);
  expect((await route.POST(request({
    employeeDocId: 'emp'
  }))).status).toBe(200);
  const edit = await import('../../field-officer/assignments/[id]/route');
  expect((await edit.PATCH(request({
    expectedVersion: 1
  }), {
    params: Promise.resolve({
      id: 'assignment'
    })
  })).status).toBe(200);
  expect(services.updateGuardAssignment.mock.calls[0].slice(1)).toEqual(['assignment', {
      expectedVersion: 1
    }]);
});
it.each([['Missing bearer token.', 401, 'invalid_session'], ['infrastructure down', 500, 'internal_error']])('auth failure %s classified correctly', async (message, status, code) => {
  services.getGuardDuties.mockRejectedValue(new Error(message));
  const { GET } = await import('./route');
  const r = await GET(request());
  expect(r.status).toBe(status);
  expect(await r.json()).toMatchObject({
    code
  });
});
it('CAS error returns current state to the client', async () => {
  const { DutyError } = await import('@/lib/server/duties/requests');
  services.setDutyWillingness.mockRejectedValue(new DutyError(409, 'version_conflict', 'Changed', {
    willingness: {
      version: 2,
      response: 'unavailable'
    }
  }));
  const { POST } = await import('./[id]/willingness/route');
  const r = await POST(request({}), {
    params: Promise.resolve({
      id: 'exam'
    })
  });
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({
    code: 'version_conflict',
    willingness: {
      version: 2
    }
  });
});
