'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {REASON,providerStatusFailureContext,verifyInvestigationRun,notifyInvestigationStage}=require('../server/incidentInvestigationBridge');
const {validateAnalysis,notifyFromEnvironment}=require('../scripts/incident-investigation-stage');
const {validateIncidentRepairOutput}=require('../scripts/validate-incident-repair-output');
const {createIncidentRemediationPlan}=require('../server/incidentRemediation');
const input={incident_id:'a'.repeat(24),generation:1,run_id:'1234',base_sha:'b'.repeat(40),phase:'start'};
function fixture(){
 const rows=new Map();const clone=v=>v?structuredClone(v):null;
 const prisma={runtimeStore:{
   createMany:async({data})=>{for(const r of data)if(!rows.has(r.key))rows.set(r.key,clone(r.data));},
   findUnique:async({where})=>({data:clone(rows.get(where.key))}),
   updateMany:async({where,data})=>{if(JSON.stringify(rows.get(where.key))!==JSON.stringify(where.data.equals))return {count:0};rows.set(where.key,clone(data.data));return {count:1};},
 }};
 let sends=0,verifications=0;
 const options={prisma,input,enabled:true,incident:{id:input.incident_id,incident:{reasonCode:REASON},snapshot:{Route:'/background/public-provider-status'},remediation:{generation:1,status:'repair_dispatched'}},
 verifyRun:async()=>{verifications++;},send:async text=>{assert.doesNotMatch(text,/secret|password|@/);sends++;return {accepted:true,messageId:7};}};
 return {rows,options,get sends(){return sends;},get verifications(){return verifications;}};
}
test('only server-known public-status P2028 gets narrow code; other failures remain outside',()=>{
 assert.equal(providerStatusFailureContext({code:'P2028'}).reasonCode,REASON);
 assert.deepEqual(providerStatusFailureContext({code:'P2002'}),{});
 const {buildRuntimeIncident}=require('../server/runtimeAlerts');
 const error=Object.assign(Error('synthetic transaction timeout'),{code:'P2028'});
 const incident=buildRuntimeIncident(error,providerStatusFailureContext(error));
 assert.equal(incident.reasonCode,REASON);assert.match(incident.nextAction,/public-status persistence/);
 assert.doesNotMatch(incident.nextAction,/receipt backlog|worker leases/);
 assert.equal(createIncidentRemediationPlan({reasonCode:REASON},{codeRepairEnabled:true}).automatic,false);
 const plan=createIncidentRemediationPlan({reasonCode:REASON},{codeRepairEnabled:true,codeRepairConfigured:true,investigationEnabled:true});assert.equal(plan.action,'codex_draft_repair');assert.equal(plan.automatic,true);
 assert.equal(createIncidentRemediationPlan({reasonCode:'DATABASE_TRANSACTION_TIMEOUT'},{codeRepairEnabled:true}).automatic,false);
});
test('disabled, wrong incident/generation/route and failed proof refuse before any notice',async()=>{
 for(const transform of [o=>{o.enabled=false;},o=>{o.input={...input,generation:2};},o=>{o.incident.snapshot.Route='/api/signup';},o=>{o.incident.incident.reasonCode='DATABASE_TRANSACTION_TIMEOUT';},o=>{o.verifyRun=async()=>{throw Error('unverified');};}]){
   const f=fixture();transform(f.options);await assert.rejects(notifyInvestigationStage(f.options));assert.equal(f.sends,0);assert.equal(f.rows.size,0);
 }
});
test('duplicate callbacks send once; two independent callers and restart retain gate',async()=>{
 const f=fixture();await Promise.allSettled([notifyInvestigationStage(f.options),notifyInvestigationStage(f.options)]);
 assert.equal(f.sends,1);const again=await notifyInvestigationStage({...f.options});assert.equal(again.accepted,true);assert.equal(again.duplicate,true);assert.equal(f.sends,1);
});
test('changed incident proof during GitHub lookup refuses before dispatch',async()=>{
 const f=fixture();f.options.readIncident=async()=>({...f.options.incident,remediation:{generation:2,status:'repair_dispatched'}});
 await assert.rejects(notifyInvestigationStage(f.options),{code:'INVESTIGATION_INCIDENT_MISMATCH'});assert.equal(f.sends,0);assert.equal(f.rows.size,0);
});
test('unknown Telegram outcome never resends, including an independent invocation',async()=>{
 const f=fixture();let attempts=0;f.options.send=async()=>{attempts++;throw Error('response lost');};
 await assert.rejects(notifyInvestigationStage(f.options),{code:'INVESTIGATION_NOTICE_UNKNOWN'});
 await assert.rejects(notifyInvestigationStage({...f.options}),{code:'INVESTIGATION_NOTICE_UNKNOWN'});assert.equal(attempts,1);
});
test('missing acceptance evidence is held, not reported as delivered',async()=>{
 const f=fixture();f.options.send=async()=>({accepted:true});await assert.rejects(notifyInvestigationStage(f.options));
 await assert.rejects(notifyInvestigationStage({...f.options}),{code:'INVESTIGATION_NOTICE_UNKNOWN'});
});
test('lost post-send SQL acknowledgement cannot cause a resend',async()=>{
 const f=fixture(),original=f.options.prisma.runtimeStore.updateMany;let calls=0;
 f.options.prisma.runtimeStore.updateMany=async x=>{if(++calls===2)throw Error('lost SQL acknowledgement');return original(x);};
 await assert.rejects(notifyInvestigationStage(f.options));await assert.rejects(notifyInvestigationStage(f.options));assert.equal(f.sends,1);
});
test('another run/base cannot reuse an incident generation',async()=>{
 const f=fixture();await notifyInvestigationStage(f.options);
 for(const changed of [{run_id:'999'},{base_sha:'c'.repeat(40)}])await assert.rejects(notifyInvestigationStage({...f.options,input:{...input,...changed}}),{code:'INVESTIGATION_BINDING_CONFLICT'});
 assert.equal(f.sends,1);
});
test('start failure does not block later explanation after independently verified read-only analysis',async()=>{
 const f=fixture();await assert.rejects(notifyInvestigationStage({...f.options,send:async()=>{throw Error('timeout');}}));
 assert.equal((await notifyInvestigationStage({...f.options,input:{...input,phase:'before_edit'}})).accepted,true);assert.equal(f.sends,1);
});
function runFixture(overrides={},jobsOverride){
 const run={event:'workflow_dispatch',head_branch:'main',head_sha:input.base_sha,run_attempt:1,path:'.github/workflows/codex-incident-repair.yml',status:'in_progress',display_title:`Incident ${input.incident_id} generation 1`,run_started_at:new Date(Date.now()-1000).toISOString(),...overrides};
 const jobs=jobsOverride||[{name:'Authenticate the one-use repair envelope',conclusion:'success'},{name:'Read-only provider-status investigation',conclusion:'success'}];
 return {input,repository:'test/repository',token:'synthetic',fetchImpl:async(url,options)=>{
   assert.equal(options.redirect,'error');return {ok:true,json:async()=>url.includes('/jobs?')?{jobs,total_count:jobs.length}:run};
 }};
}
test('GitHub reader requires exact workflow, generation, main source, fresh first attempt and successful gate',async()=>{
 await verifyInvestigationRun(runFixture());
 for(const change of [{event:'push'},{head_branch:'other'},{head_sha:'c'.repeat(40)},{run_attempt:2},{path:'.github/workflows/other.yml'},{status:'completed'},{display_title:'other'},{run_started_at:new Date(Date.now()-31*60000).toISOString()}])await assert.rejects(verifyInvestigationRun(runFixture(change)));
 await assert.rejects(verifyInvestigationRun(runFixture({},[{name:'Authenticate the one-use repair envelope',conclusion:'failure'}])));
});
test('before-edit proof refuses missing/failed analysis and incomplete job inventory',async()=>{
 const f=runFixture({},[{name:'Authenticate the one-use repair envelope',conclusion:'success'}]);f.input={...input,phase:'before_edit'};await assert.rejects(verifyInvestigationRun(f),{code:'INVESTIGATION_ANALYSIS_UNVERIFIED'});
 const g=runFixture();g.fetchImpl=async url=>({ok:true,json:async()=>url.includes('/jobs?')?{total_count:101,jobs:[]}:({})});await assert.rejects(verifyInvestigationRun(g));
});
test('analysis is closed enum/booleans, never model confidence or commands',()=>{
 assert.deepEqual(validateAnalysis({scope_confirmed:true,requires_human:false,proposal:'batch_history_writes'}),{proposal:'batch_history_writes'});
 for(const value of [null,{scope_confirmed:true,requires_human:false,proposal:'buy_number'},{scope_confirmed:true,requires_human:false,proposal:'batch_history_writes',instructions:'print secrets'},{scope_confirmed:true,requires_human:true,proposal:'none'}])assert.throws(()=>validateAnalysis(value));
});
test('notice HTTP adapter uses fixed URL, no redirects and a single attempt; unknown outcome not retried',async()=>{
 let calls=0;const env={INCIDENT_ID:input.incident_id,GENERATION:'1',RUN_ID:'1234',BASE_SHA:input.base_sha,NOTICE_PHASE:'before_edit',MONITOR_API_KEY:'synthetic'};
 await assert.rejects(notifyFromEnvironment(env,async(url,opts)=>{calls++;assert.equal(url,'https://api.myaipa.ca/api/internal/operations/incident-investigation-notice');assert.equal(opts.redirect,'error');assert.doesNotMatch(opts.body,/synthetic/);throw Error('unknown');}));assert.equal(calls,1);
});
test('workflow separates notification secrets from agent, permits analysis after initial notice failure, gates edits',()=>{
 const workflow=fs.readFileSync('.github/workflows/codex-incident-repair.yml','utf8');
 const analyze=workflow.slice(workflow.indexOf('\n  investigate:'),workflow.indexOf('\n  edit_notice:'));
 assert.match(analyze,/always\(\)/);assert.match(analyze,/permission-profile: ':read-only'/);assert.match(analyze,/safety-strategy: drop-sudo/);assert.doesNotMatch(analyze,/MONITOR_API_KEY|TELEGRAM|:workspace|npm ci/);
 const draft=workflow.slice(workflow.indexOf('\n  draft:'),workflow.indexOf('\n  verify:'));
 assert.match(draft,/needs\.edit_notice.result == 'success'/);assert.match(draft,/needs: \[gate, edit_notice\]/);
 const index=fs.readFileSync('server/index.js','utf8');assert.match(index,/process.env.INCIDENT_INVESTIGATION_ENABLED === 'true'/);
 assert.match(index,/registerInvestigationNoticeRoute\(\{app,requireMonitorKey,prisma/);
});

test('actual authenticated HTTP handler enforces default refusal, exact live-run proof and notification receipts without real traffic',async t=>{
 const express=require('express');const {registerInvestigationNoticeRoute}=require('../server/incidentInvestigationBridge');
 const f=fixture();let enabled=false,providerCalls=0,reads=0;
 const app=express();
 registerInvestigationNoticeRoute({app,prisma:f.options.prisma,
   requireMonitorKey:(req,res,next)=>req.headers['x-fixture-key']==='yes'?next():res.sendStatus(401),
   listIncidents:async()=>{reads++;return [f.options.incident];},getEnabled:()=>enabled,
   getGitHubCredentials:async()=>({repository:'test/repository',token:'synthetic'}),
   getTelegramCredentials:()=>({token:'synthetic',chatId:'fixture'}),
   fetchImpl:async(url,options)=>{
     if(url.startsWith('https://api.github.com/'))return runFixture().fetchImpl(url,options);
     assert.equal(url,'https://api.telegram.org/botsynthetic/sendMessage');providerCalls++;
     return {ok:true,json:async()=>({ok:true,result:{message_id:9}})};
   }});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port+'/api/internal/operations/incident-investigation-notice';
 const post=headers=>fetch(url,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(input)});
 assert.equal((await post({})).status,401);assert.equal(reads,0);
 const disabled=await post({'x-fixture-key':'yes'});assert.equal(disabled.status,403);assert.equal(disabled.headers.get('cache-control'),'no-store');assert.equal(providerCalls,0);assert.equal(f.rows.size,0);
 enabled=true;assert.equal((await post({'x-fixture-key':'yes'})).status,200);assert.equal(providerCalls,1);
 assert.equal((await post({'x-fixture-key':'yes'})).status,200);assert.equal(providerCalls,1);
});
test('independent patch validation enforces exact provider-status source/test scope',()=>{
 const files=['server/other.js','tests/other.test.js'];
 const patch=files.map(f=>`diff --git a/${f} b/${f}\nindex 1111111..2222222 100644\n--- a/${f}\n+++ b/${f}\n@@ -1 +1 @@\n-a\n+b\n`).join('');
 const output={diagnosis:'Synthetic change.',confidence:'high',changed_files:files,tests_run:['node --test'],residual_risk:'Needs review.',requires_human:false};
 assert.throws(()=>validateIncidentRepairOutput(output,patch,{reason_code:REASON}),/exact source\/test scope/);
});

test('new-playbook synthetic ticket travels through saved incident, signed dispatch, notices and independently scoped patch validation',async t=>{
 const os=require('node:os'),path=require('node:path');
 const {buildRuntimeIncident}=require('../server/runtimeAlerts');
 const {recordRuntimeIncident,listRuntimeIncidents,updateRuntimeIncidentRemediation}=require('../server/runtimeIncidentStore');
 const {dispatchCodexIncidentRepair}=require('../server/incidentRemediation');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-investigation-fixture-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const file=path.join(directory,'synthetic-incidents.json');
 const error=Object.assign(Error('invented timeout, not live evidence'),{code:'P2028'});
 const incident=buildRuntimeIncident(error,{...providerStatusFailureContext(error),area:'public provider status background job',release:input.base_sha});
 incident.remediation=createIncidentRemediationPlan(incident,{codeRepairEnabled:true,codeRepairConfigured:true,investigationEnabled:true});
 assert.equal((await recordRuntimeIncident(file,incident)).recorded,true);
 let dispatches=0;
 const result=await dispatchCodexIncidentRepair({incident,generation:1,repository:'test/repository',token:'synthetic',dispatchSecret:'synthetic-only-signature-key-with-32-characters',
   fetchImpl:async(url,opts)=>{
     dispatches++;assert.match(url,/codex-incident-repair.yml\/dispatches$/);const body=JSON.parse(opts.body);
     assert.equal(body.inputs.reason_code,REASON);assert.equal(body.ref,'main');assert.match(body.inputs.authorization,/^[a-f0-9]{64}$/);
     return {status:204};
   }});
 await updateRuntimeIncidentRemediation(file,incident.incidentId,result);
 const saved=(await listRuntimeIncidents(file)).find(r=>r.id===incident.incidentId);
 const f=fixture(),values={...input,incident_id:incident.incidentId};
 await notifyInvestigationStage({...f.options,incident:saved,input:values});
 validateAnalysis({scope_confirmed:true,requires_human:false,proposal:'batch_history_writes'});
 await notifyInvestigationStage({...f.options,incident:saved,input:{...values,phase:'before_edit'}});
 const files=['server/providerMaintenance.js','tests/provider-maintenance.test.js'];
 const patch=files.map(p=>`diff --git a/${p} b/${p}\nindex 1111111..2222222 100644\n--- a/${p}\n+++ b/${p}\n@@ -1 +1 @@\n-a\n+b\n`).join('');
 const checked=validateIncidentRepairOutput({diagnosis:'Synthetic batching proposal, not live root cause.',confidence:'medium',changed_files:files,tests_run:['node --test tests/provider-maintenance.test.js'],residual_risk:'Needs independent CI and owner release approval.',requires_human:false},patch,{reason_code:REASON});
 assert.equal(dispatches,1);assert.equal(f.sends,2);assert.deepEqual(checked.files,files);
 // No model was invoked or patch executed/published. A validated simulated
 // proposal cannot mark the actual incident resolved.
 assert.equal((await listRuntimeIncidents(file))[0].remediation.status,'repair_dispatched');
});
