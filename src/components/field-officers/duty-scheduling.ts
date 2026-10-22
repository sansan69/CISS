import type { Employee } from '@/types/employee';
import type { AssignedGuardSummary } from '@/types/work-orders';
import { getGuardAssignmentCapacityIssue } from '@/lib/work-orders/guard-assignment-capacity';

export type DutySiteOption = {siteId:string;siteName:string;clientName:string;district:string;shiftTemplates:{code:string;label:string;startTime:string;endTime:string;crossesMidnight:boolean}[]};
export type AssignmentFields = {siteId:string;date:string;shiftCode?:string;shiftLabel?:string;startTime?:string;endTime?:string;crossesMidnight?:boolean;type:'regular'|'relieving'};
export type WillingnessEntry = {employeeDocId:string;employeeId:string;name:string;gender:string;tcsCategory:'adhoc'|'permanent'|null;response:'willing'|'unavailable';respondedAt:string|null;version:number};
export type WillingnessList = {workOrderId:string;willingCount:number;unavailableCount:number;responses:WillingnessEntry[]};
export type DutyFetcher = (url:string, init:RequestInit)=>Promise<Response>;
export type DutyMutation = {url:string;method:'POST'|'PATCH';employeeDocId:string|null;body:Record<string,unknown>};
export type AssignmentOutcome = {employeeDocId:string|null;status:'saved'|'rejected'|'uncertain';retryable:boolean;message:string;code?:string};
export class DutyRequestError extends Error {
  constructor(message:string, readonly code:string, readonly retryable:boolean, readonly status:number) {super(message);}
}
/** The signed-in identity (and API origin) an in-flight duty batch belongs to. */
export type DutyOwner = {uid:string;origin:string};
export type DutyDispatchBinding = {owner:DutyOwner|null;readOwner:()=>DutyOwner|null;isDisposed?:()=>boolean};
export const DUTY_OWNER_CHANGED_MESSAGE = 'The signed-in account changed before this guard was submitted. Reopen the form to assign the remaining guards.';
export class DutyOwnerChangedError extends Error {
  readonly code = 'owner_changed';
  readonly retryable = false;
  constructor(message:string = DUTY_OWNER_CHANGED_MESSAGE) {super(message);}
}
export function isDutyOwnerCurrent(owner:DutyOwner|null|undefined, readOwner:()=>DutyOwner|null):boolean {
  const current=readOwner();
  return !!owner && !!current && current.uid===owner.uid && current.origin===owner.origin;
}
/** Refuses to run as any account or origin other than the one that started the work. */
export function createOwnerBoundFetcher(fetcher:DutyFetcher, owner:DutyOwner|null, readOwner:()=>DutyOwner|null):DutyFetcher {
  return async (url:string, init:RequestInit) => {
    if(!isDutyOwnerCurrent(owner,readOwner)) throw new DutyOwnerChangedError();
    return fetcher(url,init);
  };
}
const DUTY_REQUEST_TIMEOUT_MS = 30000;
/** Bound auth, transport and response parsing together; a timeout is never proof of failure. */
export async function requestDutyJson<T>(url:string,init:RequestInit,fetcher:DutyFetcher):Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  if (init.signal?.aborted) abort();
  else init.signal?.addEventListener('abort', abort, {once:true});
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new DutyRequestError('The request took too long to confirm. Your selection is kept. Retry to check the result.', 'timeout', true, 0));
      controller.abort();
    }, DUTY_REQUEST_TIMEOUT_MS);
  });
  try {
    return await Promise.race([readDutyJson<T>(url,{...init,signal:controller.signal},fetcher), deadline]);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort',abort);
  }
}
async function readDutyJson<T>(url:string,init:RequestInit,fetcher:DutyFetcher):Promise<T> {
  let res:Response;
  try {res=await fetcher(url,{...init,cache:'no-store'});} catch(error) {
    if(error instanceof DutyOwnerChangedError) throw error;
    throw new DutyRequestError(error instanceof Error ? error.message : 'Connection lost. Retry to check the result.','transport_error',true,0);
  }
  let payload:any;
  try {payload=await res.json();} catch {
    throw new DutyRequestError('Could not read the response. Retry to check the result.','invalid_response',res.ok || res.status===429 || res.status>=500,res.status);
  }
  if(!res.ok) throw new DutyRequestError(payload.error || 'Could not complete this request.',payload.code || 'request_failed',res.status===429 || res.status>=500,res.status);
  return payload as T;
}
export function buildAssignmentFields(input:AssignmentFields,site?:DutySiteOption):AssignmentFields {
  if(!input.siteId || site?.siteId!==input.siteId) throw new Error('Select a site.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !Number.isFinite(Date.parse(`${input.date}T00:00:00Z`)) || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0,10)!==input.date) throw new Error('Select a valid duty date.');
  if(!['regular','relieving'].includes(input.type)) throw new Error('Select regular or relieving duty.');
  const base={siteId:input.siteId,date:input.date,type:input.type};
  if(site.shiftTemplates.length) {
    if(!site.shiftTemplates.some(s=>s.code===input.shiftCode)) throw new Error('Select a configured site shift.');
    return {...base,shiftCode:input.shiftCode};
  }
  const shiftLabel=input.shiftLabel?.trim() || '';
  const time=/^([01]\d|2[0-3]):[0-5]\d$/;
  if(!shiftLabel || shiftLabel.length>120 || !time.test(input.startTime || '') || !time.test(input.endTime || '')) throw new Error('Enter a shift label and valid start and end times.');
  const startTime=input.startTime!; const endTime=input.endTime!; const crossesMidnight=input.crossesMidnight===true;
  if(crossesMidnight ? endTime>startTime : endTime<=startTime) throw new Error('End time must follow start time. Select overnight for a shift ending the next day.');
  return {...base,shiftLabel,startTime,endTime,crossesMidnight};
}
export function prepareAssignmentRequests(employeeDocIds:string[],fields:AssignmentFields|{status:'cancelled'},uuid:()=>string,prior?:{id:string;version:number}):DutyMutation[] {
  if(prior) return [{url:`/api/field-officer/assignments/${encodeURIComponent(prior.id)}`,method:'PATCH',employeeDocId:null,body:{...fields,expectedVersion:prior.version,clientRequestId:uuid()}}];
  if(!employeeDocIds.length) throw new Error('Select at least one guard.');
  return [...new Set(employeeDocIds)].map(employeeDocId=>({url:'/api/field-officer/assignments',method:'POST',employeeDocId,body:{...fields,employeeDocId,clientRequestId:uuid()}}));
}
export async function submitAssignmentRequests(operations:DutyMutation[],fetcher:DutyFetcher,previous:AssignmentOutcome[]=[],binding?:DutyDispatchBinding):Promise<AssignmentOutcome[]> {
  // A batch is an action of one signed-in account. Without that binding the
  // later items could be dispatched as whoever the global auth shell holds
  // when the response for an earlier guard finally resolves, so refuse instead.
  if(!binding || typeof binding.readOwner!=='function' || !binding.owner)
    throw new Error('Assignment batches must be bound to the signed-in account that started them.');
  const outcomes:AssignmentOutcome[]=[];
  for(let i=0;i<operations.length;i++) {
    if(previous[i] && !previous[i].retryable) {outcomes.push(previous[i]);continue;}
    // Stop dispatching once the form unmounts or the account/origin that owns
    // this batch changes; unsent and unconfirmed items stay with their owner.
    if(binding.isDisposed?.() || !isDutyOwnerCurrent(binding.owner,binding.readOwner)) {
      for(let j=i;j<operations.length;j++) {
        if(previous[j] && !previous[j].retryable) {outcomes.push(previous[j]);continue;}
        outcomes.push({employeeDocId:operations[j].employeeDocId,status:'rejected',retryable:false,code:'owner_changed',message:DUTY_OWNER_CHANGED_MESSAGE});
      }
      break;
    }
    const op=operations[i];
    try {
      await requestDutyJson(op.url,{method:op.method,body:JSON.stringify(op.body)},fetcher);
      outcomes.push({employeeDocId:op.employeeDocId,status:'saved',retryable:false,message:op.body.status==='cancelled'?'Cancelled':'Saved'});
    } catch(error) {
      const retryable=error instanceof DutyRequestError && error.retryable;
      outcomes.push({employeeDocId:op.employeeDocId,status:retryable?'uncertain':'rejected',retryable,message:error instanceof Error?error.message:'Could not save.',code:error instanceof DutyRequestError?error.code:undefined});
    }
  }
  return outcomes;
}
export function prepareRosterRequest(workOrderId:string,current:AssignedGuardSummary[],selected:WillingnessEntry[],expectedVersion:number,uuid:()=>string):DutyMutation {
  const assignedGuards=[...current];
  for(const guard of selected) {
    if(assignedGuards.some(g=>g.uid===guard.employeeDocId)) continue;
    const issue=getGuardAssignmentCapacityIssue(assignedGuards,guard.gender,{});
    if(issue) throw new Error(issue.description);
    assignedGuards.push({uid:guard.employeeDocId,name:guard.name,employeeId:guard.employeeId,gender:guard.gender});
  }
  return {url:`/api/admin/work-orders/${encodeURIComponent(workOrderId)}`,method:'PATCH',employeeDocId:null,body:{assignedGuards,expectedVersion,clientRequestId:uuid()}};
}
export type WorkOrderRoster = {assignedGuards:AssignedGuardSummary[];assignmentVersion:number};
export async function loadWorkOrderRoster(workOrderId:string,fetcher:DutyFetcher):Promise<WorkOrderRoster> {
  const detail=await requestDutyJson<{assignedGuards?:AssignedGuardSummary[];assignmentVersion?:number}>(`/api/admin/work-orders/${encodeURIComponent(workOrderId)}`,{},fetcher);
  return {assignedGuards:Array.isArray(detail.assignedGuards)?detail.assignedGuards:[],assignmentVersion:Number(detail.assignmentVersion ?? 0)};
}
export function prepareManualRosterRequest(workOrderId:string,assignedGuards:AssignedGuardSummary[],expectedVersion:number,uuid:()=>string):DutyMutation {
  return {url:`/api/admin/work-orders/${encodeURIComponent(workOrderId)}`,method:'PATCH',employeeDocId:null,body:{assignedGuards:[...assignedGuards],expectedVersion,clientRequestId:uuid()}};
}
/**
 * The manual dialog replaces the whole roster, so an unconfirmed save must be
 * re-issued exactly as it was first sent: same version, same receipt, same
 * selection. It is never rebuilt from a later selection or a newer version.
 */
export function retainedRosterMutation(current:DutyMutation|null,workOrderId:string,assignedGuards:AssignedGuardSummary[],expectedVersion:number,uuid:()=>string):DutyMutation {
  return current ?? prepareManualRosterRequest(workOrderId,assignedGuards,expectedVersion,uuid);
}
export type RosterSaveOutcome = {status:'saved'|'uncertain'|'rejected';retryable:boolean;message:string;code?:string;versionConflict:boolean};
export async function submitRosterRequest(mutation:DutyMutation,fetcher:DutyFetcher):Promise<RosterSaveOutcome> {
  try {
    await requestDutyJson(mutation.url,{method:mutation.method,body:JSON.stringify(mutation.body)},fetcher);
    return {status:'saved',retryable:false,message:'Saved',versionConflict:false};
  } catch(error) {
    const retryable=error instanceof DutyRequestError && error.retryable;
    const code=error instanceof DutyRequestError || error instanceof DutyOwnerChangedError ? error.code : undefined;
    return {status:retryable?'uncertain':'rejected',retryable,message:error instanceof Error?error.message:'Could not save assignments.',code,versionConflict:code==='version_conflict'};
  }
}
export function schedulingEnabled(payload:unknown):boolean {
  const p=payload as {data?:{modules?:{workOrders?:unknown}};modules?:{workOrders?:unknown}}|null;
  return (p?.data?.modules || p?.modules)?.workOrders!==false;
}
export type ScopedWorkOrder = {id:string;siteId:string;siteName:string;clientName:string;district:string;date:string;examName:string;examCode:string;maleGuardsRequired:number;femaleGuardsRequired:number;totalManpower:number;assignedGuards:AssignedGuardSummary[];assignmentReviewRequired:boolean;assignmentStatus:string;willingCount:number;unavailableCount:number};
export async function loadScopedWorkOrders(fetcher:DutyFetcher):Promise<ScopedWorkOrder[]> {
  const payload=await requestDutyJson<{workOrders:ScopedWorkOrder[]}>('/api/field-officer/work-orders',{},fetcher);
  return payload.workOrders;
}
export async function loadSchedulingOptions(fetcher:DutyFetcher):Promise<{sites:DutySiteOption[];guards:Employee[]}> {
  const [sites,guards]=await Promise.all([requestDutyJson<{sites:DutySiteOption[]}>('/api/field-officer/sites',{},fetcher),requestDutyJson<{guards:Employee[]}>('/api/field-officer/guards',{},fetcher)]);
  return {sites:sites.sites,guards:guards.guards};
}
