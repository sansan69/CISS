"use client";
import React,{useCallback,useEffect,useState} from 'react';
import {authorizedFetch} from '@/lib/api-client';
import {Button} from '@/components/ui/button';
import {Card,CardContent,CardHeader,CardTitle,CardDescription} from '@/components/ui/card';
import type {GuardAssignmentDto} from '@/types/duties';
import type {Employee} from '@/types/employee';
import {AssignmentEditorDialog,AssignmentRows} from './guard-assignment-form';
import {loadSchedulingOptions,requestDutyJson,type DutySiteOption} from './duty-scheduling';

export function GuardAssignmentsPanel({enabled=true}:{enabled?:boolean}) {
  const [assignments,setAssignments]=useState<GuardAssignmentDto[]>([]);
  const [sites,setSites]=useState<DutySiteOption[]>([]);
  const [guards,setGuards]=useState<Employee[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState('');
  const [editor,setEditor]=useState<'create'|GuardAssignmentDto|null>(null);
  const [revision,setRevision]=useState(0);
  const reload=useCallback(()=>setRevision(r=>r+1),[]);
  useEffect(()=> {
    let active=true;
    if(!enabled) return;
    setLoading(true);setError('');
    void Promise.all([requestDutyJson<{assignments:GuardAssignmentDto[]}>('/api/field-officer/assignments',{},authorizedFetch),loadSchedulingOptions(authorizedFetch)]).then(([rows,options])=>{if(active){setAssignments(rows.assignments);setSites(options.sites);setGuards(options.guards);}}).catch(e=>{if(active)setError(e instanceof Error?e.message:'Could not load duties.');}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[enabled,revision]);
  if(!enabled) return null;
  return <Card><CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><CardTitle className="text-base">Regular and relieving duties</CardTitle><CardDescription>Upcoming 90 days · Informational assignments</CardDescription></div><Button variant="outline" disabled={loading || !!error} onClick={()=>setEditor('create')}>Assign duty</Button></CardHeader><CardContent>{loading?<p role="status" className="text-sm text-muted-foreground">Loading duties…</p>:error?<div role="alert" className="space-y-3"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={reload}>Retry</Button></div>:<AssignmentRows assignments={assignments} onEdit={setEditor}/>}</CardContent>{editor && <AssignmentEditorDialog key={typeof editor==='string'?'create':editor.id} open onClose={()=>setEditor(null)} enabled={enabled} sites={sites} guards={guards} assignment={typeof editor==='string'?undefined:editor} onSaved={reload}/>}</Card>;
}
