// Local-only fixture server. Builds real components with API/auth replacements.
// Does not load .env, Firebase, application routes or credentials.
import {build} from 'esbuild';
import {createServer} from 'node:http';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const output=resolve('output/playwright/duty-preview');
mkdirSync(output,{recursive:true});
const api=`
const site={siteId:'fixture-site',siteName:'Fixture centre with a long name for layout checks',clientName:'Fixture client',district:'Fixture district',shiftTemplates:[{code:'night',label:'Night',startTime:'20:00',endTime:'08:00',crossesMidnight:true}]};
const guards=[{id:'fixture-doc',fullName:'Fixture guard with a deliberately long name',employeeId:'FIXTURE/KL/1',gender:'Male'},{id:'other-fixture',fullName:'Second fixture guard',employeeId:'FIXTURE/KL/2',gender:'Female'}];
const responses=guards.map((g,i)=>({employeeDocId:g.id,employeeId:g.employeeId,name:g.fullName,gender:g.gender,tcsCategory:'adhoc',response:i?'unavailable':'willing',respondedAt:'2026-10-19T08:00:00Z',version:1}));
const assignment={id:'fixture-duty',guardId:'fixture-doc',guardUid:'fixture-auth',employeeId:'FIXTURE/KL/1',guardName:guards[0].fullName,district:site.district,clientName:site.clientName,siteId:site.siteId,siteName:site.siteName,date:'2026-10-20',shiftCode:'night',shiftLabel:'Night',startsAt:'2026-10-20T14:30:00Z',endsAt:'2026-10-21T02:30:00Z',type:'relieving',status:'assigned',version:2,assignedBy:'fixture-supervisor',assignedAt:'2026-10-19T00:00:00Z',updatedBy:'fixture-supervisor',updatedAt:'2026-10-19T00:00:00Z'};
let roster=[];let version=0;let once=true;
window.fixtureRequests=[];
export async function authorizedFetch(url,init={}) {
 window.fixtureRequests.push({url,body:init.body?JSON.parse(init.body):null});
 const mode=window.fixtureMode;
 if(mode==='loading') return new Promise(()=>{});
 if(mode==='error') return new Response(JSON.stringify({error:'Fixture transport error',code:'fixture_error'}),{status:503});
 let data;
 if(init.method==='POST' || init.method==='PATCH') {
  const body=JSON.parse(init.body);
  if(body.employeeDocId==='other-fixture') return new Response(JSON.stringify({error:'Fixture duplicate duty',code:'duplicate_assignment'}),{status:409});
  if(window.fixtureUncertain && once) {once=false;throw new Error('Fixture connection lost after save');}
  if(body.assignedGuards) {roster=body.assignedGuards;version++;}
  data={success:true,assignment:{...assignment,status:body.status || 'assigned'},replayed:false};
 } else if(url.endsWith('/sites')) data={sites:[site,{...site,siteId:'explicit-fixture',siteName:'Fixture site without shift templates',shiftTemplates:[]}]};
 else if(url.endsWith('/guards')) data={guards};
 else if(url.endsWith('/assignments')) data={assignments:mode==='empty'?[]:[assignment,{...assignment,id:'cancelled-fixture',status:'cancelled',type:'regular'}]};
 else if(url.endsWith('/willingness')) data={workOrderId:'fixture-exam',willingCount:mode==='empty'?0:1,unavailableCount:mode==='empty'?0:1,responses:mode==='empty'?[]:responses};
 else data={assignedGuards:roster,assignmentVersion:version};
 return new Response(JSON.stringify(data),{status:200});
}`;
await build({entryPoints:[resolve('src/components/field-officers/__fixtures__/scheduling-preview.tsx')],bundle:true,platform:'browser',format:'iife',outfile:resolve(output,'preview.js'),jsx:'transform',plugins:[{name:'fixture-api',setup(b){b.onResolve({filter:/^@\/lib\/api-client$/},()=>({path:'fixture-api',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:api}));}}]});
execFileSync(process.execPath,['node_modules/tailwindcss/lib/cli.js','-i','src/app/globals.css','-o',resolve(output,'preview.css')],{stdio:'inherit'});
writeFileSync(resolve(output,'index.html'),`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Safe duty fixture preview</title><link rel="stylesheet" href="/preview.css"><style>body{font-family:Inter,Arial,sans-serif}</style></head><body><div id="root"></div><script src="/preview.js"></script></body></html>`);
const assets={'/':'index.html','/preview.js':'preview.js','/preview.css':'preview.css'};
const server=createServer((req,res)=>{
 const path=new URL(req.url,'http://127.0.0.1:4179').pathname;
 const asset=assets[path];
 res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src 'self'; script-src 'self';");
 if(!asset){res.writeHead(404);res.end('Fixture asset not found');return;}
 res.setHeader('Content-Type',asset.endsWith('.js')?'application/javascript':asset.endsWith('.css')?'text/css':'text/html');res.end(readFileSync(resolve(output,asset)));
});
server.listen(4179,'127.0.0.1',()=>process.stdout.write('Safe fixture preview: http://127.0.0.1:4179\n'));
