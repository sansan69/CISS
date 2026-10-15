import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {GuardAssignmentsPanel} from '../guard-assignments-panel';
import {WorkOrderWillingness,WillingnessResponses} from '../work-order-willingness';
const mode=new URLSearchParams(location.search).get('mode') || 'populated';
(window as any).fixtureMode=mode;
function Preview() {
  const [dark,setDark]=useState(false);
  return <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-8"><header className="flex flex-wrap items-center justify-between gap-3"><div><h1 className="text-2xl font-semibold">Duty scheduling · local fixtures</h1><p className="text-sm text-muted-foreground">No live data or network connections</p></div><button className="rounded-md border p-2 text-sm" onClick={()=>{setDark(!dark);document.documentElement.classList.toggle('dark',!dark);}}>Toggle dark mode</button></header><nav className="flex flex-wrap gap-3 text-sm">{['populated','empty','error','loading','off'].map(m=><a key={m} href={`/?mode=${m}`} className="underline">{m}</a>)}</nav><GuardAssignmentsPanel enabled={mode!=='off'}/><section className="space-y-3 rounded-xl border bg-card p-5"><h2 className="text-base font-semibold">Fixture exam centre with a deliberately long name for narrow screens and response details</h2><WorkOrderWillingness enabled={mode!=='off'} workOrderId="fixture-exam" siteName="Fixture exam centre with a deliberately long name for narrow screens and response details" counts={{willingCount:1,unavailableCount:1}}/>{mode==='loading' && <WillingnessResponses loading selected={[]} assigned={[]} onToggle={()=>{}}/>}{mode==='off' && <p className="text-sm text-muted-foreground">Work orders disabled</p>}</section></main>;
}
createRoot(document.getElementById('root')!).render(<Preview/>);
