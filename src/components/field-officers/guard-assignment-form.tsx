"use client";

import React, {useEffect,useRef,useState} from 'react';
import {authorizedFetch} from '@/lib/api-client';
import type {Employee} from '@/types/employee';
import type {GuardAssignmentDto} from '@/types/duties';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Checkbox} from '@/components/ui/checkbox';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {buildAssignmentFields,createOwnerBoundFetcher,prepareAssignmentRequests,submitAssignmentRequests,type AssignmentFields,type AssignmentOutcome,type DutyFetcher,type DutyMutation,type DutyOwner,type DutySiteOption} from './duty-scheduling';
import {readDutyOwner} from './duty-owner';

const selectClass='h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const istTime=(iso:string)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(iso));
const istDate=(iso:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));

export function AssignmentRows({assignments,onEdit}:{assignments:GuardAssignmentDto[];onEdit:(assignment:GuardAssignmentDto)=>void}) {
  if(!assignments.length) return <p className="py-4 text-sm text-muted-foreground">No regular or relieving duties in the next 90 days.</p>;
  return <ul className="divide-y">{assignments.map(a=><li key={a.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0 space-y-1"><p className="break-words text-sm font-medium">{a.guardName} · {a.siteName}</p><p className="break-words text-xs text-muted-foreground">{a.clientName} · {a.district}</p><p className="text-xs text-muted-foreground">{a.date} · {a.shiftLabel} · {istTime(a.startsAt)}–{istTime(a.endsAt)} IST{istDate(a.startsAt)!==istDate(a.endsAt)?' (next day)':''}</p><div className="flex gap-2"><Badge variant="outline">{a.type==='relieving'?'Relieving':'Regular'}</Badge><Badge variant={a.status==='cancelled'?'secondary':'outline'}>{a.status==='cancelled'?'Cancelled':'Assigned'}</Badge></div></div>{a.status==='assigned' && <Button size="sm" variant="outline" className="shrink-0" onClick={()=>onEdit(a)}>Edit duty</Button>}</li>)}</ul>;
}

export function GuardAssignmentForm({sites,guards,assignment,enabled=true,onSaved,onClose,onPendingChange}:{sites:DutySiteOption[];guards:Employee[];assignment?:GuardAssignmentDto;enabled?:boolean;onSaved:()=>void;onClose?:()=>void;onPendingChange?:(pending:boolean)=>void}) {
  const [fields,setFields]=useState<AssignmentFields>(()=>assignment?{siteId:assignment.siteId,date:assignment.date,shiftCode:assignment.shiftCode ?? '',shiftLabel:assignment.shiftLabel,startTime:istTime(assignment.startsAt),endTime:istTime(assignment.endsAt),crossesMidnight:istDate(assignment.startsAt)!==istDate(assignment.endsAt),type:assignment.type}:{siteId:'',date:'',shiftCode:'',shiftLabel:'',startTime:'',endTime:'',crossesMidnight:false,type:'regular'});
  const [selected,setSelected]=useState<string[]>([]);
  const [search,setSearch]=useState('');
  const [outcomes,setOutcomes]=useState<AssignmentOutcome[]>([]);
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const operations=useRef<DutyMutation[]|null>(null);
  const owner=useRef<DutyOwner|null>(null);
  const fetcher=useRef<DutyFetcher|null>(null);
  const disposed=useRef(false);
  const site=sites.find(s=>s.siteId===fields.siteId);
  const locked=saving || outcomes.length>0;
  const uncertain=outcomes.some(o=>o.retryable);
  const done=outcomes.length>0 && !uncertain;
  useEffect(()=>{onPendingChange?.(saving || uncertain);},[saving,uncertain,onPendingChange]);
  useEffect(()=>{disposed.current=false;return ()=>{disposed.current=true;};},[]);
  const visibleGuards=guards.filter(g=>`${g.fullName} ${g.employeeId}`.toLowerCase().includes(search.toLowerCase()));
  async function submit(cancel=false) {
    if(!enabled || saving || done) return;
    setError('');setSaving(true);
    try {
      if(!operations.current) {
        const ownerAtPrepare=readDutyOwner();
        if(!ownerAtPrepare) throw new Error('You must be signed in to perform this action.');
        // Bind this batch and its retries to the account and origin that started
        // it, so a later guard can never be dispatched as the next signed-in user.
        owner.current=ownerAtPrepare;
        fetcher.current=createOwnerBoundFetcher(authorizedFetch,ownerAtPrepare,readDutyOwner);
        operations.current=prepareAssignmentRequests(selected,cancel?{status:'cancelled'}:buildAssignmentFields(fields,site),()=>crypto.randomUUID(),assignment);
      }
      const boundFetcher=fetcher.current;
      if(!boundFetcher) throw new Error('You must be signed in to perform this action.');
      const results=await submitAssignmentRequests(operations.current,boundFetcher,outcomes,{owner:owner.current,readOwner:readDutyOwner,isDisposed:()=>disposed.current});
      setOutcomes(results);
      if(results.some(r=>r.status==='saved') || results.some(r=>r.code==='version_conflict')) onSaved();
    } catch(e) {setError(e instanceof Error?e.message:'Could not save duty.');}
    finally {setSaving(false);}
  }
  if(!enabled) return null;
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">Informational assignment. Attendance and the guard’s permanent site stay unchanged. Dates and shift times use IST.</p>
    {assignment && <p className="text-sm font-medium">{assignment.guardName} · {assignment.employeeId}</p>}
    <fieldset disabled={locked} className="space-y-4">
      <div className="space-y-2"><Label htmlFor="duty-site">Client and site</Label><select id="duty-site" className={selectClass} value={fields.siteId} onChange={e=>setFields(f=>({...f,siteId:e.target.value,shiftCode:'',shiftLabel:'',startTime:'',endTime:'',crossesMidnight:false}))}><option value="">Select a site</option>{sites.map(s=><option key={s.siteId} value={s.siteId}>{s.clientName} · {s.siteName} · {s.district}</option>)}</select></div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="duty-date">Duty date</Label><Input id="duty-date" type="date" value={fields.date} onChange={e=>setFields(f=>({...f,date:e.target.value}))}/></div><div className="space-y-2"><Label htmlFor="duty-type">Duty type</Label><select id="duty-type" className={selectClass} value={fields.type} onChange={e=>setFields(f=>({...f,type:e.target.value as 'regular'|'relieving'}))}><option value="regular">Regular</option><option value="relieving">Relieving</option></select></div></div>
      {site?.shiftTemplates.length ? <div className="space-y-2"><Label htmlFor="duty-shift">Site shift</Label><select id="duty-shift" className={selectClass} value={fields.shiftCode || ''} onChange={e=>setFields(f=>({...f,shiftCode:e.target.value}))}><option value="">Select a shift</option>{site.shiftTemplates.map(s=><option key={s.code} value={s.code}>{s.label} · {s.startTime}–{s.endTime}{s.crossesMidnight?' (next day)':''}</option>)}</select></div> : <div className="space-y-3"><div className="space-y-2"><Label htmlFor="duty-label">Shift label</Label><Input id="duty-label" maxLength={120} value={fields.shiftLabel || ''} onChange={e=>setFields(f=>({...f,shiftLabel:e.target.value}))}/></div><div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label htmlFor="duty-start">Start time</Label><Input id="duty-start" type="time" value={fields.startTime || ''} onChange={e=>setFields(f=>({...f,startTime:e.target.value}))}/></div><div className="space-y-2"><Label htmlFor="duty-end">End time</Label><Input id="duty-end" type="time" value={fields.endTime || ''} onChange={e=>setFields(f=>({...f,endTime:e.target.value}))}/></div></div><div className="flex items-center gap-2"><Checkbox id="duty-overnight" checked={fields.crossesMidnight || false} onCheckedChange={checked=>setFields(f=>({...f,crossesMidnight:checked===true}))}/><label htmlFor="duty-overnight" className="cursor-pointer text-sm">Ends the next day</label></div></div>}
      {!assignment && <div className="space-y-2"><Label htmlFor="duty-guard-search">Guards ({selected.length} selected)</Label><Input id="duty-guard-search" placeholder="Search by name or employee ID" value={search} onChange={e=>setSearch(e.target.value)}/><div className="max-h-52 overflow-y-auto rounded-md border">{!visibleGuards.length?<p className="p-3 text-sm text-muted-foreground">No guards found.</p>:visibleGuards.map(g=><div key={g.id} className="flex items-start gap-3 border-b p-3 last:border-b-0"><Checkbox id={`duty-guard-${g.id}`} className="mt-0.5" checked={selected.includes(g.id)} onCheckedChange={()=>setSelected(ids=>ids.includes(g.id)?ids.filter(id=>id!==g.id):[...ids,g.id])}/><label htmlFor={`duty-guard-${g.id}`} className="min-w-0 cursor-pointer text-sm"><span className="block break-words">{g.fullName}</span><span className="text-xs text-muted-foreground">{g.employeeId}</span></label></div>)}</div></div>}
    </fieldset>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!!outcomes.length && <div aria-live="polite" className="space-y-2 rounded-md border p-3"><p className="text-sm font-medium">{outcomes.filter(o=>o.status==='saved').length} saved · {outcomes.filter(o=>o.status==='rejected').length} rejected · {outcomes.filter(o=>o.status==='uncertain').length} unconfirmed</p>{outcomes.map((o,i)=><p key={i} className="break-words text-sm">{guards.find(g=>g.id===o.employeeDocId)?.fullName || assignment?.guardName || o.employeeDocId}: {o.message}{o.code==='version_conflict'?' Close and reopen this duty to use its current version.':''}</p>)}{uncertain && <p className="text-xs text-muted-foreground">Retry checks the original requests. Saved and rejected guards will not be submitted again.</p>}</div>}
    <div className="flex flex-wrap justify-end gap-2">
      {onClose && <Button variant="outline" disabled={saving || uncertain} onClick={onClose}>Close</Button>}
      {assignment && !done && !uncertain && <Button variant="outline" disabled={saving} onClick={()=>void submit(true)}>Cancel duty</Button>}
      {!done && <Button disabled={saving} onClick={()=>void submit()}>{saving?'Saving…':uncertain?'Retry unconfirmed':assignment?'Save changes':'Assign selected guards'}</Button>}
    </div>
  </div>;
}

export function AssignmentEditorDialog({open,onClose,...props}:{open:boolean;onClose:()=>void;sites:DutySiteOption[];guards:Employee[];assignment?:GuardAssignmentDto;enabled?:boolean;onSaved:()=>void}) {
  // Keep the form mounted while a request is uncertain, so its UUID cannot be lost on a modal close.
  const [preventClose,setPreventClose]=useState(false);
  return <Dialog open={open} onOpenChange={next=>{if(!next && !preventClose)onClose();}}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl" onInteractOutside={e=>e.preventDefault()} onEscapeKeyDown={e=>{if(preventClose)e.preventDefault();}}><DialogHeader><DialogTitle>{props.assignment?'Edit duty':'Assign duty'}</DialogTitle><DialogDescription>Regular and relieving duties</DialogDescription></DialogHeader><GuardAssignmentForm {...props} onClose={onClose} onPendingChange={setPreventClose}/></DialogContent></Dialog>;
}
