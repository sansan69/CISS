import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Regression for the finding "an assignment batch continues under the next
// signed-in account after its form unmounts". These tests drive the real
// auth/fetch boundary (`authorizedFetch`) with the same owner binding the duty
// form uses: they hold the first response, switch the active account, unmount
// the form, release the response, and assert nothing is dispatched as the next
// account.

const fields = {siteId:'fixture-site',date:'2026-10-20',shiftLabel:'Day',startTime:'08:00',endTime:'20:00',crossesMidnight:false,type:'regular' as const};
type AuthUser = { uid: string; getIdToken: (forceRefresh?: boolean) => Promise<string> };
let authStub: { currentUser: AuthUser | null };

const supervisorA: AuthUser = {uid:'supervisor-a',getIdToken:async()=> 'fixture-token-A'};
const supervisorB: AuthUser = {uid:'supervisor-b',getIdToken:async()=> 'fixture-token-B'};

beforeEach(() => {
  vi.resetModules();
  authStub = {currentUser: supervisorA};
  vi.doMock('@/lib/firebase', () => ({auth: authStub}));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.doUnmock('@/lib/firebase');
});

async function loadModules() {
  const api = await import('@/lib/api-client');
  const duty = await import('./duty-scheduling');
  const owner = await import('./duty-owner');
  return {authorizedFetch: api.authorizedFetch, duty, readDutyOwner: owner.readDutyOwner};
}

function recordFetch(behaviour: 'hold-first' | 'fail-first' | 'respond') {
  const calls: { url: string; authorization: string | null; body: any }[] = [];
  let releaseFirst: () => void = () => {};
  let startedFirst: () => void = () => {};
  const firstStarted = new Promise<void>((resolve) => { startedFirst = resolve; });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    calls.push({url:String(url),authorization:new Headers(init.headers).get('Authorization'),body:JSON.parse(String(init.body))});
    if (calls.length === 1) {
      startedFirst();
      if (behaviour === 'fail-first') throw new Error('Connection lost');
      if (behaviour === 'hold-first') return new Promise<Response>((resolve) => { releaseFirst = () => resolve(Response.json({success:true})); });
    }
    return Response.json({success:true});
  });
  return {calls,firstStarted,releaseFirst:() => releaseFirst()};
}

describe('assignment batch ownership', () => {
  it('never dispatches a later guard as the account that replaced the initiating supervisor', async () => {
    const {authorizedFetch,duty,readDutyOwner} = await loadModules();
    const {calls,firstStarted,releaseFirst} = recordFetch('hold-first');
    let receipt = 0;
    const operations = duty.prepareAssignmentRequests(['guard-one','guard-two'],fields,()=>`fixture-receipt-${++receipt}`);
    // Bound once, when the operations are prepared, exactly like the duty form.
    const owner = readDutyOwner();
    const fetcher = duty.createOwnerBoundFetcher(authorizedFetch,owner,readDutyOwner);
    let disposed = false;
    const pending = duty.submitAssignmentRequests(operations,fetcher,[],{owner,readOwner:readDutyOwner,isDisposed:()=>disposed});

    await firstStarted;
    authStub.currentUser = supervisorB;
    disposed = true;
    releaseFirst();

    const outcomes = await pending;
    expect(calls.map((call) => call.authorization)).toEqual(['Bearer fixture-token-A']);
    expect(calls.map((call) => call.body.employeeDocId)).toEqual(['guard-one']);
    expect(outcomes.map((outcome) => [outcome.employeeDocId,outcome.status,outcome.code])).toEqual([
      ['guard-one','saved',undefined],
      ['guard-two','rejected','owner_changed'],
    ]);
  });

  it('keeps an unconfirmed retry on its original owner instead of retargeting it', async () => {
    const {authorizedFetch,duty,readDutyOwner} = await loadModules();
    const {calls} = recordFetch('fail-first');
    const operations = duty.prepareAssignmentRequests(['guard-one','guard-two'],fields,()=> 'fixture-receipt');
    const owner = readDutyOwner();
    const fetcher = duty.createOwnerBoundFetcher(authorizedFetch,owner,readDutyOwner);
    const binding = {owner,readOwner:readDutyOwner};

    const first = await duty.submitAssignmentRequests(operations,fetcher,[],binding);
    expect(calls).toHaveLength(2);
    expect(first.map((outcome) => [outcome.employeeDocId,outcome.status,outcome.retryable])).toEqual([
      ['guard-one','uncertain',true],
      ['guard-two','saved',false],
    ]);

    authStub.currentUser = supervisorB;
    const retry = await duty.submitAssignmentRequests(operations,fetcher,first,binding);
    expect(calls.every((call) => call.authorization !== 'Bearer fixture-token-B')).toBe(true);
    expect(retry.map((outcome) => [outcome.employeeDocId,outcome.status,outcome.code])).toEqual([
      ['guard-one','rejected','owner_changed'],
      ['guard-two','saved',undefined],
    ]);
    expect(calls).toHaveLength(2);
  });

  it('refuses a batch that is not bound to the account that started it', async () => {
    const {authorizedFetch,duty} = await loadModules();
    const {calls} = recordFetch('hold-first');
    const operations = duty.prepareAssignmentRequests(['guard-one','guard-two'],fields,()=> 'fixture-receipt');
    await expect(duty.submitAssignmentRequests(operations,authorizedFetch)).rejects.toThrow(/bound to the signed-in account/);
    expect(calls).toEqual([]);
  });

  it('refuses a different account or a different origin before any request leaves', async () => {
    vi.stubGlobal('window',{location:{origin:'https://cisskerala.site'}});
    const {authorizedFetch,duty,readDutyOwner} = await loadModules();
    const {calls} = recordFetch('respond');
    const owner = readDutyOwner();
    expect(owner).toEqual({uid:'supervisor-a',origin:'https://cisskerala.site'});

    const bound = duty.createOwnerBoundFetcher(authorizedFetch,owner,readDutyOwner);
    const stillOwner = await bound('/api/field-officer/assignments',{method:'POST',body:'{}'});
    expect(stillOwner.status).toBe(200);

    authStub.currentUser = supervisorB;
    await expect(bound('/api/field-officer/assignments',{method:'POST',body:'{}'})).rejects.toMatchObject({code:'owner_changed',retryable:false});

    authStub.currentUser = supervisorA;
    vi.stubGlobal('window',{location:{origin:'https://fixture.example'}});
    await expect(bound('/api/field-officer/assignments',{method:'POST',body:'{}'})).rejects.toMatchObject({code:'owner_changed'});

    authStub.currentUser = null;
    expect(readDutyOwner()).toBeNull();
    await expect(bound('/api/field-officer/assignments',{method:'POST',body:'{}'})).rejects.toMatchObject({code:'owner_changed'});
    expect(calls.map((call) => call.authorization)).toEqual(['Bearer fixture-token-A']);
  });
});
