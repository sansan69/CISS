import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ guard:vi.fn(), writes:new Map<string,Record<string,unknown>>(), next:0 }));
vi.mock('@/lib/server/guard-auth', () => ({requireGuard:mock.guard}));
vi.mock('firebase-admin/firestore', () => ({FieldValue:{serverTimestamp:()=>new Date()}}));
vi.mock('@/lib/firebaseAdmin', () => ({db:{
 collection:()=>({doc:(id?:string)=>({id:id || `new-${mock.next++}`})}),
 runTransaction:async (action:(tx:unknown)=>unknown)=>action({
  get:async (ref:{id:string})=>({exists:mock.writes.has(ref.id), data:()=>mock.writes.get(ref.id)}),
  create:(ref:{id:string},data:Record<string,unknown>)=>mock.writes.set(ref.id,data),
  update:(ref:{id:string},data:Record<string,unknown>)=>mock.writes.set(ref.id,{...mock.writes.get(ref.id),...data}),
 }),
}}));
import {POST,PATCH} from './route';
const call=(body:object)=>new NextRequest('http://localhost/api/guard/leave',{method:'POST',body:JSON.stringify(body)});
const body={type:'Annual',startDate:'2026-10-18',endDate:'2026-10-19',reason:'Family',clientRequestId:'10000000-1000-4000-8000-100000000000'};
describe('guard leave writes',()=>{
 beforeEach(()=>{mock.writes.clear();mock.guard.mockResolvedValue({uid:'u1',employeeDocId:'e1',employeeId:'E1'});});
 it('replay creates one request owned by the authenticated guard',async()=>{
  const a=await POST(call({...body,employeeDocId:'forged'}));const b=await POST(call(body));
  expect(a.status).toBe(200);expect(b.status).toBe(200);expect(mock.writes.size).toBe(1);
  expect([...mock.writes.values()][0].employeeDocId).toBe('e1');
 });
 it('rejects reversed dates without writes',async()=>{expect((await POST(call({...body,endDate:'2026-10-01'}))).status).toBe(400);expect(mock.writes.size).toBe(0);});
 it('only pending owner requests can be cancelled',async()=>{
  mock.writes.set('leave',{employeeDocId:'e1',status:'approved'});
  expect((await PATCH(call({requestId:'leave'}))).status).toBe(409);
  mock.writes.set('leave',{employeeDocId:'e2',status:'pending'});
  expect((await PATCH(call({requestId:'leave'}))).status).toBe(403);
  mock.writes.set('leave',{employeeDocId:'e1',status:'pending'});
  expect((await PATCH(call({requestId:'leave'}))).status).toBe(200);
  expect(mock.writes.get('leave')?.status).toBe('cancelled');
 });
});
