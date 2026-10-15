import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
let WillingnessResponses:React.ComponentType<any>, WorkOrderWillingness:React.ComponentType<any>, AssignmentRows:React.ComponentType<any>, GuardAssignmentForm:React.ComponentType<any>;
beforeAll(async()=> {
  const require=createRequire(import.meta.url);
  async function load(file:string) {
    const built=await build({entryPoints:[resolve('src/components/field-officers',file)],bundle:true,platform:'node',format:'cjs',external:['react','react-dom','react-dom/*'],write:false,jsx:'transform',plugins:[{name:'no-network',setup(b){b.onResolve({filter:/^@\/lib\/api-client$/},()=>({path:'api-client',namespace:'mock'}));b.onResolve({filter:/^@\/lib\/firebase$/},()=>({path:'firebase',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},(args)=>({contents:args.path==='firebase'?'export const auth = { currentUser: null };':'export async function authorizedFetch() {throw new Error("Network disabled in fixture");}'}));}}]});
    const loaded={exports:{} as any};new Function('require','module','exports',built.outputFiles[0].text)(require,loaded,loaded.exports);return loaded.exports;
  }
  ({WillingnessResponses,WorkOrderWillingness}=await load('work-order-willingness.tsx'));
  ({AssignmentRows,GuardAssignmentForm}=await load('guard-assignment-form.tsx'));
});
const response={employeeDocId:'fixture-doc',employeeId:'CISS/KL/123',name:'A long fixture guard name',gender:'Male',tcsCategory:'adhoc' as const,response:'willing' as const,respondedAt:'2026-10-19T08:00:00Z',version:1};
const row={id:'fixture-duty',guardId:'fixture-doc',guardUid:'auth-fixture',employeeId:'CISS/KL/123',guardName:'Fixture guard',district:'Fixture district',clientName:'Fixture client',siteId:'fixture-site',siteName:'Fixture site',date:'2026-10-20',shiftCode:null,shiftLabel:'Night',startsAt:'2026-10-20T14:30:00Z',endsAt:'2026-10-21T02:30:00Z',type:'relieving' as const,status:'cancelled' as const,version:2,assignedBy:'fixture-supervisor',assignedAt:'2026-10-19T00:00:00Z',updatedBy:'fixture-supervisor',updatedAt:'2026-10-19T00:00:00Z'};
const render=(component:React.ComponentType<any>,props:any)=>renderToStaticMarkup(React.createElement(component,props));
describe('supervisor duty surfaces',()=>{
  it('shows scoped response counts and both choices without treating interest as assignment',()=>{
    const html=render(WillingnessResponses,{data:{workOrderId:'fixture-exam',willingCount:1,unavailableCount:1,responses:[response,{...response,employeeDocId:'other-fixture',response:'unavailable'}]},selected:[],assigned:[],onToggle:()=>{}});
    expect(html).toContain('1 willing');expect(html).toContain('1 unavailable');expect(html).toContain('This does not confirm assignment.');expect(html).toContain('CISS/KL/123');expect(html).toContain('Unavailable');
  });
  it('gives loading, retry and empty response states',()=>{
    const base={selected:[],assigned:[],onToggle:()=>{}};
    expect(render(WillingnessResponses,{...base,loading:true})).toContain('Loading responses');
    expect(render(WillingnessResponses,{...base,error:'Fixture unavailable',onRetry:()=>{}})).toContain('Retry');
    expect(render(WillingnessResponses,{...base,data:{workOrderId:'fixture-exam',willingCount:0,unavailableCount:0,responses:[]}})).toContain('No responses yet');
  });
  it('keeps cancelled ordinary assignments visible and read-only',()=>{
    const html=render(AssignmentRows,{assignments:[row],onEdit:()=>{}});
    expect(html).toContain('Cancelled');expect(html).toContain('Relieving');expect(html).toContain('Fixture site');expect(html).not.toContain('Edit duty');
    expect(render(AssignmentRows,{assignments:[{...row,status:'assigned'}],onEdit:()=>{}})).toContain('Edit duty');
  });
  it('renders no willingness or assignment entry point when workOrders is disabled',()=>{
    expect(render(WorkOrderWillingness,{enabled:false,workOrderId:'fixture-exam',siteName:'Fixture site'})).toBe('');
    expect(render(GuardAssignmentForm,{enabled:false,sites:[],guards:[],onSaved:()=>{}})).toBe('');
  });
  it('exposes each choice through the shared themed checkbox so light and dark states stay distinguishable',()=>{
    const entries={workOrderId:'fixture-exam',willingCount:1,unavailableCount:1,responses:[response,{...response,employeeDocId:'other-fixture',response:'unavailable'}]};
    const willingness=render(WillingnessResponses,{data:entries,selected:[],assigned:['fixture-doc'],onToggle:()=>{}});
    expect(willingness).toContain('role="checkbox"');
    expect(willingness).toContain('aria-checked="true"');
    expect(willingness).toContain('aria-checked="false"');
    const form=render(GuardAssignmentForm,{sites:[],guards:[{id:'fixture-doc',fullName:'Fixture guard',employeeId:'CISS/KL/123',gender:'Male'}],onSaved:()=>{}});
    expect(form).toContain('role="checkbox"');
    expect(form).toContain('aria-checked="false"');
  });
});
