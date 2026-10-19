"use client";
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
type Leave = {id:string; type:string; startDate:string|null; endDate:string|null; reason:string; status:string};
type LeaveData = {balance:{entitled:number; taken:number; balance:number; pending:number}; requests:Leave[]};
export default function GuardLeavePage() {
 const {user} = useAppAuth();
 const [data,setData] = useState<LeaveData|null>(null);
 const [error,setError] = useState('');
 const [busy,setBusy] = useState(false);
 const [loading,setLoading] = useState(true);
 const [type,setType] = useState('Annual');
 const [start,setStart] = useState(''); const [end,setEnd] = useState(''); const [reason,setReason] = useState('');
 const requestId = useRef<string|null>(null);
 const api = useCallback(async (method='GET', body?:object) => {
   if (!user) throw new Error('Sign in to continue.');
   const response = await fetch('/api/guard/leave', {method, cache:'no-store', headers:{Authorization:`Bearer ${await user.getIdToken()}`, 'Content-Type':'application/json'}, ...(body ? {body:JSON.stringify(body)} : {})});
   const result = await response.json();
   if (!response.ok) throw new Error(result.error || 'Could not update leave.');
   return result;
 }, [user]);
 const load = useCallback(async () => {setLoading(true);setError('');try{setData(await api());}catch{setError('Could not load leave. Please retry.');}finally{setLoading(false);}},[api]);
 useEffect(() => {setData(null); requestId.current=null; void load();},[load]);
 async function submit(event:React.FormEvent) {
   event.preventDefault(); if(busy) return;
   if(!start || !end || end < start || !reason.trim()) {setError('Choose a valid date range and enter a reason.');return;}
   setBusy(true);setError('');
   try {requestId.current ??= crypto.randomUUID(); await api('POST',{type,startDate:start,endDate:end,reason:reason.trim(),clientRequestId:requestId.current});requestId.current=null;setReason('');setStart('');setEnd('');await load();}
   catch(error){setError(error instanceof Error ? error.message : 'Request failed. Retry to check the same request.');}
   finally{setBusy(false);}
 }
 async function cancel(id:string) {if(busy)return;setBusy(true);setError('');try{await api('PATCH',{requestId:id});await load();}catch{setError('Could not cancel leave. Refresh and retry.');}finally{setBusy(false);}}
 const change = () => {requestId.current=null;};
 return <div className="space-y-4 p-4">
   <h1 className="text-xl font-bold">Leave</h1>
   {error && <div role="alert" className="space-y-2 rounded-xl border border-destructive p-3"><p>{error}</p><Button variant="outline" onClick={() => void load()} disabled={busy}>Refresh</Button></div>}
   {loading ? <p role="status">Loading leave…</p> : data && <Card><CardContent className="space-y-1 p-4"><p className="font-semibold">Leave balance: {data.balance.balance}</p><p className="text-sm text-muted-foreground">{data.balance.taken} taken · {data.balance.pending} pending</p></CardContent></Card>}
   <Card><CardContent className="p-4"><form onSubmit={submit} className="space-y-3">
     <h2 className="font-semibold">Request leave</h2>
     <label className="block">Type<select className="mt-1 block min-h-11 w-full rounded-md border bg-background p-2" value={type} disabled={busy} onChange={e => {setType(e.target.value);change();}}>{['Annual','Sick','Casual','Unpaid'].map(value=><option key={value}>{value}</option>)}</select></label>
     <label className="block">From<Input type="date" required value={start} disabled={busy} onChange={e=>{setStart(e.target.value);change();}} /></label>
     <label className="block">To<Input type="date" required min={start || undefined} value={end} disabled={busy} onChange={e=>{setEnd(e.target.value);change();}} /></label>
     <label className="block">Reason<textarea className="mt-1 block min-h-24 w-full rounded-md border bg-background p-2" required maxLength={500} value={reason} disabled={busy} onChange={e=>{setReason(e.target.value);change();}} /></label>
     <Button type="submit" disabled={busy}>{busy?'Saving…':'Submit request'}</Button>
   </form></CardContent></Card>
   <h2 className="font-semibold">Recent requests</h2>
   {data?.requests.length === 0 && <p>No leave requests yet.</p>}
   {data?.requests.map(row=><Card key={row.id}><CardContent className="space-y-2 p-4"><p className="font-semibold">{row.type} · {row.status}</p><p>{row.startDate?.slice(0,10)} – {row.endDate?.slice(0,10)}</p><p className="break-words">{row.reason}</p>{row.status.toLowerCase()==='pending' && <Button variant="outline" disabled={busy} onClick={()=>void cancel(row.id)}>Cancel request</Button>}</CardContent></Card>)}
 </div>;
}
