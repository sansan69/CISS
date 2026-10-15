import { describe, expect, it } from 'vitest';
import { buildAssignmentFields, prepareAssignmentRequests, submitAssignmentRequests, prepareRosterRequest, requestDutyJson, schedulingEnabled } from './duty-scheduling';

const fields = {siteId:'site-fixture', date:'2026-10-20', shiftLabel:'Day', startTime:'08:00', endTime:'20:00', crossesMidnight:false, type:'relieving' as const};
const site = {siteId:'site-fixture', siteName:'Fixture site', clientName:'Fixture client', district:'Fixture district', shiftTemplates:[]};
const guard = {employeeDocId:'employee-doc',employeeId:'CISS/KL/123',name:'Fixture guard',gender:'Male',tcsCategory:'adhoc' as const,response:'willing' as const,respondedAt:null,version:1};
const dispatchOwner={uid:'supervisor-fixture',origin:'https://cisskerala.test'};
const binding={owner:dispatchOwner,readOwner:()=>dispatchOwner};

describe('supervisor scheduling contract', () => {
  it('requires a real date, site and complete explicit shift before create', () => {
    expect(buildAssignmentFields(fields,site)).toEqual(fields);
    for (const invalid of [{...fields,siteId:''},{...fields,date:'2026-02-30'},{...fields,shiftLabel:''},{...fields,startTime:''},{...fields,endTime:'07:00'}]) {
      expect(()=>buildAssignmentFields(invalid,site)).toThrow();
    }
    expect(buildAssignmentFields({...fields,startTime:'20:00',endTime:'08:00',crossesMidnight:true},site).crossesMidnight).toBe(true);
  });
  it('uses configured shift code and never sends stale explicit shift fields', () => {
    const configured = {...site,shiftTemplates:[{code:'night',label:'Night',startTime:'20:00',endTime:'08:00',crossesMidnight:true}]};
    expect(buildAssignmentFields({...fields,shiftCode:'night'},configured)).toEqual({siteId:'site-fixture',date:'2026-10-20',shiftCode:'night',type:'relieving'});
    expect(()=>buildAssignmentFields({...fields,shiftCode:'missing'},configured)).toThrow();
  });
  it('reports per-guard partial results and reuses only uncertain requests on retry', async () => {
    let n=0;
    const operations=prepareAssignmentRequests(['employee-doc','other-doc','third-doc'],fields,()=>`receipt-${++n}`);
    const calls: {url:string,body:any}[]=[];
    const fetcher=async(url:string,init:RequestInit)=> {
      const body=JSON.parse(String(init.body)); calls.push({url,body});
      if(body.employeeDocId==='other-doc') return new Response(JSON.stringify({error:'Duplicate fixture',code:'duplicate_assignment'}),{status:409});
      if(body.employeeDocId==='third-doc' && calls.length===3) throw new Error('Connection lost');
      return new Response(JSON.stringify({success:true,assignment:{id:body.employeeDocId}}));
    };
    const first=await submitAssignmentRequests(operations,fetcher,[],binding);
    expect(first.map(r=>[r.employeeDocId,r.status,r.retryable])).toEqual([['employee-doc','saved',false],['other-doc','rejected',false],['third-doc','uncertain',true]]);
    const second=await submitAssignmentRequests(operations,fetcher,first,binding);
    expect(calls.map(c=>c.body)).toEqual([
      {...fields,employeeDocId:'employee-doc',clientRequestId:'receipt-1'},
      {...fields,employeeDocId:'other-doc',clientRequestId:'receipt-2'},
      {...fields,employeeDocId:'third-doc',clientRequestId:'receipt-3'},
      {...fields,employeeDocId:'third-doc',clientRequestId:'receipt-3'},
    ]);
    expect(second.map(r=>r.status)).toEqual(['saved','rejected','saved']);
  });
  it('edits and cancels with immutable guard identity and optimistic version', () => {
    const prior={id:'assignment-fixture',version:4};
    expect(prepareAssignmentRequests([],fields,()=> 'edit-receipt',prior)[0]).toEqual({url:'/api/field-officer/assignments/assignment-fixture',method:'PATCH',employeeDocId:null,body:{...fields,expectedVersion:4,clientRequestId:'edit-receipt'}});
    expect(prepareAssignmentRequests([],{status:'cancelled'},()=> 'cancel-receipt',prior)[0].body).toEqual({status:'cancelled',expectedVersion:4,clientRequestId:'cancel-receipt'});
  });
  it('adds willing or unavailable guards through the existing roster using document identity', () => {
    const existing=[{uid:'existing-doc',name:'Existing',employeeId:'CISS/KL/1',gender:'Female'}];
    for(const response of ['willing','unavailable'] as const) {
      const request=prepareRosterRequest('exam-fixture',existing,[{...guard,response}],3,()=> 'roster-receipt');
      expect(request.url).toBe('/api/admin/work-orders/exam-fixture');
      expect(request.body).toEqual({assignedGuards:[...existing,{uid:'employee-doc',name:'Fixture guard',employeeId:'CISS/KL/123',gender:'Male'}],expectedVersion:3,clientRequestId:'roster-receipt'});
    }
    expect(()=>prepareRosterRequest('exam-fixture',[],[{...guard,gender:''}],0,()=> 'r')).toThrow();
  });
  it('distinguishes retryable failures from terminal business conflicts', async () => {
    for(const [status,retryable] of [[429,true],[500,true],[403,false],[409,false]] as const) {
      await expect(requestDutyJson('/fixture',{},async()=>new Response(JSON.stringify({error:'Fixture error',code:'fixture_code'}),{status}))).rejects.toMatchObject({message:'Fixture error',code:'fixture_code',retryable});
    }
  });
  it('honors workOrders false without depending on attendance or profile flags',()=> {
    expect(schedulingEnabled({modules:{workOrders:false,attendance:true}})).toBe(false);
    expect(schedulingEnabled({data:{modules:{workOrders:false}}})).toBe(false);
    expect(schedulingEnabled({modules:{attendance:false}})).toBe(true);
  });
});

import {loadSchedulingOptions,loadScopedWorkOrders} from './duty-scheduling';
it('loads current scoped orders/counts and selectors only from authenticated APIs',async()=>{
  const urls:string[]=[];
  const fetcher=async(url:string)=>{urls.push(url);return new Response(JSON.stringify(url.endsWith('/sites')?{sites:[site]}:url.endsWith('/guards')?{guards:[{id:'employee-doc',fullName:'Fixture guard'}]}:{workOrders:[{id:'exam-fixture',date:'2026-10-19T18:30:00Z',district:'Current district',willingCount:2,unavailableCount:1}]}));};
  const orders=await loadScopedWorkOrders(fetcher);
  const options=await loadSchedulingOptions(fetcher);
  expect(orders[0]).toMatchObject({id:'exam-fixture',district:'Current district',willingCount:2,unavailableCount:1});
  expect(options.sites[0].siteId).toBe('site-fixture');expect(options.guards[0].id).toBe('employee-doc');
  expect(urls).toEqual(['/api/field-officer/work-orders','/api/field-officer/sites','/api/field-officer/guards']);
});

describe('assignment batch dispatch binding', () => {
  it('never dispatches later guards once the form unmounts', async () => {
    const sent:string[]=[];
    const fetcher=async(url:string,init:RequestInit)=>{sent.push(JSON.parse(String(init.body)).employeeDocId);return Response.json({success:true});};
    const operations=prepareAssignmentRequests(['one','two','three'],fields,()=> 'fixture-receipt');
    const outcomes=await submitAssignmentRequests(operations,fetcher,[],{...binding,isDisposed:()=>sent.length>0});
    expect(sent).toEqual(['one']);
    expect(outcomes.map(outcome=>[outcome.status,outcome.code])).toEqual([['saved',undefined],['rejected','owner_changed'],['rejected','owner_changed']]);
  });
  it('never dispatches later guards after the signed-in account changes', async () => {
    let current={...dispatchOwner};
    const sent:string[]=[];
    const fetcher=async(url:string,init:RequestInit)=>{sent.push(JSON.parse(String(init.body)).employeeDocId);current={uid:'other-supervisor',origin:dispatchOwner.origin};return Response.json({success:true});};
    const operations=prepareAssignmentRequests(['one','two'],fields,()=> 'fixture-receipt');
    const outcomes=await submitAssignmentRequests(operations,fetcher,[],{owner:dispatchOwner,readOwner:()=>current});
    expect(sent).toEqual(['one']);
    expect(outcomes.map(outcome=>[outcome.status,outcome.code])).toEqual([['saved',undefined],['rejected','owner_changed']]);
  });
  it('keeps settled guards settled and refuses a batch without an owner binding', async () => {
    const sent:string[]=[];
    const fetcher=async(url:string,init:RequestInit)=>{sent.push(JSON.parse(String(init.body)).employeeDocId);return Response.json({success:true});};
    const operations=prepareAssignmentRequests(['one','two'],fields,()=> 'fixture-receipt');
    const previous=[{employeeDocId:'one',status:'rejected' as const,retryable:false,message:'Duplicate fixture'}];
    const outcomes=await submitAssignmentRequests(operations,fetcher,previous,binding);
    expect(sent).toEqual(['two']);
    expect(outcomes[0]).toEqual(previous[0]);
    await expect(submitAssignmentRequests(operations,fetcher)).rejects.toThrow(/bound to the signed-in account/);
  });
});
