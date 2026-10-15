"use client";

import React, {useCallback, useEffect, useRef, useState} from 'react';
import {authorizedFetch} from '@/lib/api-client';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Checkbox} from '@/components/ui/checkbox';
import {Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import type {AssignedGuardSummary} from '@/types/work-orders';
import {DutyRequestError, loadWorkOrderRoster, prepareRosterRequest, requestDutyJson, type DutyMutation, type WillingnessEntry, type WillingnessList} from './duty-scheduling';

export function WillingnessResponses({data,loading,error,onRetry,selected,assigned,onToggle,disabled=false}:{data?:WillingnessList;loading?:boolean;error?:string;onRetry?:()=>void;selected:string[];assigned:string[];onToggle:(entry:WillingnessEntry)=>void;disabled?:boolean}) {
  if(loading) return <p role="status" className="py-6 text-sm text-muted-foreground">Loading responses…</p>;
  if(error) return <div role="alert" className="space-y-3 py-4"><p className="text-sm text-destructive">{error}</p>{onRetry && <Button variant="outline" onClick={onRetry}>Retry</Button>}</div>;
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">This does not confirm assignment. Guards who are unavailable can still be assigned manually.</p>
    {data && <p className="text-sm font-medium">{`${data.willingCount} willing · ${data.unavailableCount} unavailable`}</p>}
    {!data?.responses.length ? <p className="py-6 text-sm text-muted-foreground">No responses yet. Use the existing guard selector to assign guards manually.</p> : <ul className="divide-y rounded-lg border">
      {data.responses.map(entry=> {
        const isAssigned=assigned.includes(entry.employeeDocId);
        const inputId=`willingness-${entry.employeeDocId}`;
        const isChecked=isAssigned || selected.includes(entry.employeeDocId);
        return <li key={entry.employeeDocId} className="p-3"><div className="flex items-start gap-3">
          <Checkbox id={inputId} className="mt-0.5" checked={isChecked} disabled={disabled || isAssigned} onCheckedChange={()=>onToggle(entry)} />
          <label htmlFor={inputId} className={`min-w-0 flex-1 ${disabled || isAssigned ? 'cursor-not-allowed' : 'cursor-pointer'}`}><span className="block break-words text-sm font-medium">{entry.name || 'Guard'}</span><span className="block text-xs text-muted-foreground">{entry.employeeId} · {entry.gender}</span><span className="mt-1 flex flex-wrap gap-2"><Badge variant="outline">{entry.response==='willing'?'Willing':'Unavailable'}</Badge>{isAssigned && <Badge variant="secondary">Assigned</Badge>}</span></label>
        </div></li>;
      })}
    </ul>}
  </div>;
}

export function WorkOrderWillingness({workOrderId,siteName,enabled=true,counts,onSaved}:{workOrderId:string;siteName:string;enabled?:boolean;counts?:{willingCount:number;unavailableCount:number};onSaved?:()=>void}) {
  const [open,setOpen]=useState(false);
  const [data,setData]=useState<WillingnessList>();
  const [roster,setRoster]=useState<{assignedGuards:AssignedGuardSummary[];assignmentVersion:number}>();
  const [selected,setSelected]=useState<string[]>([]);
  const [loading,setLoading]=useState(false);
  const [loadError,setLoadError]=useState('');
  const [saveError,setSaveError]=useState('');
  const [saving,setSaving]=useState(false);
  const [uncertain,setUncertain]=useState(false);
  const [saved,setSaved]=useState(false);
  const pending=useRef<DutyMutation|null>(null);
  const load=useCallback(async()=>{
    setLoading(true);setLoadError('');
    try {
      const [responses,detail]=await Promise.all([
        requestDutyJson<WillingnessList>(`/api/field-officer/work-orders/${encodeURIComponent(workOrderId)}/willingness`,{},authorizedFetch),
        loadWorkOrderRoster(workOrderId,authorizedFetch),
      ]);
      setData(responses);setRoster(detail);setSelected([]);
    } catch(e) {setLoadError(e instanceof Error?e.message:'Could not load responses.');setData(undefined);setRoster(undefined);}
    finally {setLoading(false);}
  },[workOrderId]);
  useEffect(()=>{if(open && enabled && !pending.current) {setSaveError('');setSaved(false);void load();}},[open,enabled,load]);
  async function save() {
    if(!enabled || saving || !roster || !data) return;
    setSaving(true);setSaveError('');setSaved(false);
    try {
      const op=pending.current ?? prepareRosterRequest(workOrderId,roster.assignedGuards,data.responses.filter(r=>selected.includes(r.employeeDocId)),roster.assignmentVersion,()=>crypto.randomUUID());
      pending.current=op;
      await requestDutyJson(op.url,{method:op.method,body:JSON.stringify(op.body)},authorizedFetch);
      pending.current=null;setUncertain(false);setSaved(true);await load();onSaved?.();
    } catch(e) {
      const retryable=e instanceof DutyRequestError && e.retryable;
      setUncertain(retryable);setSaveError(e instanceof Error?e.message:'Could not assign guards.');
      if(!retryable) {pending.current=null;if(e instanceof DutyRequestError && e.code==='version_conflict') await load();}
    } finally {setSaving(false);}
  }
  if(!enabled) return null;
  const shownCounts=data || counts;
  return <>
    <Button variant="outline" size="sm" className="h-auto whitespace-normal text-left" onClick={()=>setOpen(true)}>{shownCounts?`${shownCounts.willingCount} willing · ${shownCounts.unavailableCount} unavailable`:'View responses'}</Button>
    <Dialog open={open} onOpenChange={next=>{if(!saving)setOpen(next);}}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader><DialogTitle>Guard responses</DialogTitle><DialogDescription className="break-words">{siteName}</DialogDescription></DialogHeader>
        <WillingnessResponses data={data} loading={loading} error={loadError} onRetry={()=>void load()} selected={selected} assigned={roster?.assignedGuards.map(g=>g.uid) ?? []} disabled={saving || uncertain} onToggle={entry=>{setSaved(false);setSelected(ids=>ids.includes(entry.employeeDocId)?ids.filter(id=>id!==entry.employeeDocId):[...ids,entry.employeeDocId]);}}/>
        {saveError && <p role="alert" className="text-sm text-destructive">{saveError}{uncertain?' The result is unconfirmed. Retry the same request to check it.':''}</p>}
        {saved && <p role="status" className="text-sm text-success">Guard assignments updated.</p>}
        <DialogFooter><Button variant="outline" disabled={saving} onClick={()=>setOpen(false)}>Close</Button><Button disabled={saving || loading || !!loadError || (!selected.length && !uncertain)} onClick={()=>void save()}>{saving?'Saving…':uncertain?'Retry assignment':'Assign selected guards'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
