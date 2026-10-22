import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ currentUser: null as null | {getIdToken: (refresh: boolean) => Promise<string>} }));
vi.mock('@/lib/firebase', () => ({auth:state}));
vi.mock('firebase/auth', () => ({onAuthStateChanged:vi.fn()}));
import { authorizedFetch } from './api-client';

beforeEach(() => {vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({ok:true})));});
afterEach(() => {vi.unstubAllGlobals();state.currentUser=null;});

it('does not send a timed-out assignment after a delayed token finally arrives', async () => {
  let release!: (token: string) => void;
  state.currentUser = {getIdToken: () => new Promise<string>(resolve => { release=resolve; })};
  const controller = new AbortController();
  const save = authorizedFetch('/api/admin/work-orders/exam',{method:'PATCH',signal:controller.signal,body:'{}'});
  // waitForCurrentUser resolves before token acquisition.
  await Promise.resolve();
  controller.abort();
  release('not-a-real-token');
  await expect(save).rejects.toMatchObject({name:'AbortError'});
  expect(fetch).not.toHaveBeenCalled();
});

it('does not refresh and retry an expired session after its request was aborted', async () => {
  state.currentUser = {getIdToken:vi.fn().mockResolvedValue('not-a-real-token')};
  const controller = new AbortController();
  vi.mocked(fetch).mockImplementation(async () => {
    controller.abort();
    return new Response(null,{status:401});
  });
  await expect(authorizedFetch('/api/admin/work-orders/exam',{method:'PATCH',signal:controller.signal,body:'{}'})).rejects.toMatchObject({name:'AbortError'});
  expect(fetch).toHaveBeenCalledTimes(1);
});
