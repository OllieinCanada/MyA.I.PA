const test = require('node:test');
const assert = require('node:assert/strict');
const {assessWindow,recordSample,collectSample,readFailureLogs,run}=require('../scripts/observe-provider-release');
const {reviewIncidents}=require('../scripts/audit-historical-incidents');
const commit='a'.repeat(40),start=Date.parse('2026-10-27T03:00:00Z');
const sample=(minutes,change={})=>({checkedAt:new Date(start+minutes*60000).toISOString(),releaseCommit:commit,healthy:true,...change});
test('three samples or a merely old deployment cannot prove a sampled day',()=>{
  let state;for(const at of [0,15,30])state=recordSample(state,sample(at),commit);
  assert.equal(assessWindow(state).complete,false);assert.equal(assessWindow(state).passed,false);
});
test('a full day passes only with bounded gaps, no failures and the exact release',()=>{
  let state;for(let at=0;at<=1440;at+=15)state=recordSample(state,sample(at),commit);
  assert.equal(state.assessment.passed,true);assert.equal(state.assessment.sampleCount,97);
  const bad=structuredClone(state);bad.samples[4].healthy=false;assert.equal(assessWindow(bad).passed,false);
  const missing=structuredClone(state);missing.samples.splice(4,1);assert.equal(assessWindow(missing).status,'INCOMPLETE_COVERAGE');
  const changed=structuredClone(state);changed.samples[4].releaseCommit='b'.repeat(40);assert.equal(assessWindow(changed).status,'RELEASE_CHANGED');
  assert.throws(()=>recordSample(state,sample(1455),'b'.repeat(40)),/another release/);
});
test('duplicates and backwards clocks do not inflate observation coverage',()=>{
  const state=recordSample(null,sample(0),commit);
  assert.throws(()=>recordSample(state,sample(0),commit),/timestamp/);
  assert.throws(()=>recordSample(state,sample(-5),commit),/timestamp/);
});
test('collector rejects current warnings and never acknowledges old incidents or retries work',async()=>{
  const urls=[];let now='2026-10-27T04:00:00Z';
  const fetchImpl=async(input,options={})=>{
    urls.push(String(input));assert.equal(options.method,'GET');let body={};const p=new URL(input).pathname;
    if(p.endsWith('/ready'))body={ok:true,releaseCommit:commit};
    else if(p.endsWith('/operations/health'))body={attention:{total:1},twilioReceipts:{status:'healthy',workerAgeSeconds:3,lastSuccessfulRunAt:now,counts:{failed:0,expiredLeases:0,pending:0}},issues:[{kind:'runtime_incident',id:'warning',severity:'warning',detectedAt:'2026-10-26T03:00:00Z',incident:{reasonCode:'CLIENT_RESOURCE_ERROR'}}]};
    else if(p.endsWith('/deploys'))body=[{deploy:{status:'live',commit:{id:commit},finishedAt:'2026-10-27T03:00:00Z'}}];
    else if(p.endsWith('/logs'))body={logs:[],hasMore:false};
    else body={ownerId:'tea-d9247q1o3t8c73avjscg'};
    return{ok:true,status:200,json:async()=>body};
  };
  const r=await collectSample({commit,credentials:{host:'https://api.render.com/v1',key:'fixture'},token:'fixture',fetchImpl,now:()=>now});
  assert.equal(r.healthy,false);assert.equal(r.logsComplete,true);assert.equal(r.incidents[0].postDeployment,false);
  assert.ok(urls.every(u=>!/acknowledge|retry|sms|voice/.test(new URL(u).pathname)));
});
test('unavailable endpoints and incomplete log pagination are not healthy evidence',async()=>{
  const r=await collectSample({commit,credentials:{host:'https://api.render.com/v1'},fetchImpl:async()=>{throw Error('secret must not be saved');}});
  assert.equal(r.healthy,false);assert.doesNotMatch(JSON.stringify(r),/secret/);
  const logs=await readFailureLogs({credentials:{host:'https://api.render.com/v1'},ownerId:'owner',from:'start',until:'end',fetchImpl:async()=>({ok:true,json:async()=>({logs:[],hasMore:true})})});
  assert.ok(logs.every(l=>l.complete===false));
});
test('unsafe flags are rejected before credential or network access',async()=>{
  await assert.rejects(run({argv:['--apply']}),/read-only/);
});
test('fresh worker recovery never converts a recurrent browser warning into a resolved incident',()=>{
  const proof={commit,security:{commit,ok:true},currentHealthPassed:false,checkedAt:new Date().toISOString(),samples:[1,2,3].map(i=>({httpStatus:200,ready:true,releaseCommit:commit,worker:{status:'healthy',workerAgeSeconds:1,lastSuccessfulRunAt:new Date(i*60000).toISOString(),counts:{pending:0,failed:0,expiredLeases:0}}})),logEvidence:[{filter:'saved Twilio delivery reports',complete:true,matches:[]}],deployedAt:'2026-10-27T03:00:00Z'};
  const rows=reviewIncidents({issues:[{kind:'runtime_incident',id:'old',snapshot:{Workflow:'saved Twilio delivery reports background job','Provider code':'P2028'},detectedAt:'2026-10-23T00:00:00Z'},
    {kind:'runtime_incident',id:'audio',detectedAt:'2026-10-27T03:05:00Z'}]},proof);
  assert.match(rows[0].assessment,/RECOVERY_VERIFIED/);assert.match(rows[1].assessment,/UNRESOLVED/);
  assert.ok(rows.every(r=>r.acknowledged===false&&r.deleted===false));
});
