const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseSimulationEvidence,readSimulationEvidence,classifyCallSyncExclusion:classify,summarizeCallSyncReporting:summarize}=require('../server/callSyncReporting');
const {prepare}=require('../scripts/prepare-call-sync-simulation-evidence');
const callId='00000000-0000-4000-8000-000000000001',otherId='00000000-0000-4000-8000-000000000002';
const REQUIRED='VAPI_BUSINESS_ROUTE_REQUIRED',UNKNOWN='VAPI_BUSINESS_ROUTE_UNKNOWN_IDENTIFIER';
const intake={assistantId:'intake-a',phoneNumberId:'intake-p'};
const call={id:callId,type:'vapi.websocketCall'};
function data(){return{schemaVersion:1,reportingOnly:true,sources:[{sha256:'a'.repeat(64)}],calls:[{callId,type:call.type,role:'tester',sourceSha256:'a'.repeat(64)}]};}
function dir(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'call-sync-report-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}

test('only exact operator-attested simulation IDs classify; caller tags, type and unparsed attestations are not proof',()=>{
  const simulationEvidence=parseSimulationEvidence(data());
  assert.equal(classify(call,REQUIRED,{simulationEvidence}),'verified_simulation');
  for(const options of [{},{simulationEvidence:data()},{simulationEvidence:{status:'loaded',callIds:[callId]}}])
    assert.equal(classify({...call,metadata:{synthetic:true,simulation:true}},REQUIRED,options),'unresolved_routing');
  for(const changed of [{...call,id:otherId},{...call,type:'inboundPhoneCall'},{...call,assistantId:'foreign'},{...call,phoneNumber:{id:'foreign'}}])
    assert.equal(classify(changed,REQUIRED,{simulationEvidence}),'unresolved_routing');
  assert.equal(classify(call,UNKNOWN,{simulationEvidence}),'unresolved_routing');
});
test('signup intake requires both exact configured provider IDs and consistent aliases',()=>{
  const c={type:'inboundPhoneCall',assistantId:'intake-a',phoneNumberId:'intake-p'};
  assert.equal(classify(c,UNKNOWN,{signupIntake:intake}),'signup_intake');
  assert.equal(classify({...c,assistant:{id:'intake-a'},phoneNumber:{id:'intake-p'}},UNKNOWN,{signupIntake:intake}),'signup_intake');
  for(const changed of [{...c,assistantId:undefined},{...c,phoneNumberId:undefined},{...c,assistantId:'foreign'},
    {...c,phoneNumber:{id:'foreign'}},{...c,assistant:{id:'foreign'}},{...c,assistantId:{}},{...c,type:'vapi.websocketCall'}])
    assert.equal(classify(changed,UNKNOWN,{signupIntake:intake}),'unresolved_routing');
  for(const signupIntake of [{},{assistantId:'intake-a'},{phoneNumberId:'intake-p'}])
    assert.equal(classify(c,UNKNOWN,{signupIntake}),'unresolved_routing');
});
test('conflicts, malformed IDs, incomplete reads and unexpected errors remain unresolved regardless of source labels',()=>{
  const simulationEvidence=parseSimulationEvidence(data());
  for(const code of ['VAPI_BUSINESS_ROUTE_CONFLICT','VAPI_BUSINESS_ROUTE_INVALID_IDENTIFIER','VAPI_BUSINESS_ROUTE_INCOMPLETE','P1001',undefined]){
    assert.equal(classify(call,code,{simulationEvidence}),'unresolved_routing');
    assert.equal(classify({type:'inboundPhoneCall',assistantId:'intake-a',phoneNumberId:'intake-p'},code,{signupIntake:intake}),'unresolved_routing');
  }
});
test('malformed, duplicate, oversized or missing-source attestations refuse',()=>{
  for(const mutate of [d=>d.reportingOnly=false,d=>d.calls.push(d.calls[0]),d=>d.calls[0].callId='bad',d=>d.calls[0].sourceSha256='b'.repeat(64),
    d=>d.calls[0].type='inboundPhoneCall',d=>d.calls[0].role='unknown',d=>d.sources=[],d=>d.sources.push(d.sources[0]),
    d=>d.calls=Array(501).fill(d.calls[0])]){const d=data();mutate(d);assert.throws(()=>parseSimulationEvidence(d),/INVALID/);}
});
test('private file reading is bounded, fails closed and creates or modifies nothing',t=>{
  const d=dir(t),file=path.join(d,'proof.json');
  assert.equal(readSimulationEvidence(file).status,'absent');assert.deepEqual(fs.readdirSync(d),[]);
  assert.equal(readSimulationEvidence(d).status,'invalid');
  fs.writeFileSync(file,JSON.stringify(data()));const before=fs.readFileSync(file);
  assert.equal(readSimulationEvidence(file).status,'loaded');assert.deepEqual(fs.readFileSync(file),before);
  fs.writeFileSync(file,'{ invalid private payload');assert.deepEqual(readSimulationEvidence(file),{status:'invalid',count:0});
  fs.writeFileSync(file,'x'.repeat(65537));assert.equal(readSimulationEvidence(file).status,'invalid');
});
test('report aggregates are bounded categories, contain no IDs, and never imply authorization or completion',()=>{
  const r=summarize([{reportingCategory:'verified_simulation',callId:'PRIVATE_ID'}, {reportingCategory:'signup_intake'},
    {reportingCategory:'caller-injected-label'},{code:UNKNOWN}],{status:'absent'});
  assert.deepEqual(r.counts,{verified_simulation:1,signup_intake:1,unresolved_routing:2});
  assert.equal(r.total,4);assert.equal(r.grantsRouting,false);assert.equal(r.completionEvidence,false);
  assert.doesNotMatch(JSON.stringify(r),/PRIVATE_ID|caller-injected/);
});
test('local preparation validates exact two-leg source results and preserves original bytes',t=>{
  const d=dir(t),file=path.join(d,'source.json');
  const rows=[{id:callId,role:'tester',type:call.type,transportProvider:'vapi.websocket',status:'ended'},
    {id:otherId,role:'target',type:call.type,transportProvider:'vapi.websocket',status:'ended'}];
  fs.writeFileSync(file,JSON.stringify(rows));const before=fs.readFileSync(file),p=prepare([file]);
  assert.equal(p.calls.length,2);assert.equal(parseSimulationEvidence(p).status,'loaded');
  assert.deepEqual(fs.readFileSync(file),before);assert.throws(()=>prepare([file,file]),/INVALID/);
  for(const mutate of [r=>r.pop(),r=>r[0].type='inboundPhoneCall',r=>r[0].status='in-progress',r=>r[0].role='target']){
    const r=structuredClone(rows);mutate(r);fs.writeFileSync(file,JSON.stringify(r));assert.throws(()=>prepare([file]),/INVALID/);
  }
});
