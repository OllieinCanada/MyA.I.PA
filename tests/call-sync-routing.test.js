const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCallSyncMonitor, completeSync, isCallSyncRoutingRefusal, WORKFLOW } = require('../server/callSyncHealth');
const { parseSimulationEvidence, classifyCallSyncExclusion, summarizeCallSyncReporting } = require('../server/callSyncReporting');
const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
const syncSource = source.slice(source.indexOf('async function performVapiCallSync('), source.indexOf('async function fetchTwilioCalls('));
const resolverSource = source.slice(source.indexOf('async function resolveBusinessIdForVapiCall('), source.indexOf('function getVapiVoiceSignupExecutionBusinessId('));

function fixture(kind = 'unknown', fatalCode, reporting = {}) {
  const known = id => ({ id, assistantId: 'fixture-assistant' });
  const bad = { id: 'fixture-blocked', assistantId: 'fixture-assistant', phoneNumberId: 'fixture-unknown-phone' };
  if (kind === 'required') { delete bad.assistantId; delete bad.phoneNumberId; }
  if (kind === 'invalid') bad.phoneNumberId = { id: 'not-a-string' };
  if (kind === 'conflict') bad.phoneNumberId = 'fixture-other-phone';
  const calls = reporting.calls || [known('fixture-before'), bad, known('fixture-after')];
  const writes = [], usage = [], warnings = [];
  let fileWrites = 0, active;
  const context = {
    path, dataDir: 'unused-fixture-directory',
    readSimulationEvidence: () => reporting.simulationEvidence || { status: 'absent' },
    classifyCallSyncExclusion, summarizeCallSyncReporting,
    VAPI_VOICE_SIGNUP_ASSISTANT_ID: 'fixture-intake-assistant', VAPI_VOICE_SIGNUP_PHONE_NUMBER_ID: 'fixture-intake-phone',
    parseVapiBusinessMap: () => ({}), normalizePhoneForMatch: value => String(value || ''),
    prisma: {
      vapiBusinessMapping: { findMany: async ({where}) => {
        if (active === 'fixture-blocked' && fatalCode) throw Object.assign(Error('fixture failure'), {code:fatalCode});
        const rows = [{businessId:1,matchValue:'fixture-assistant'}, {businessId:2,matchValue:'fixture-other-phone'}].filter(r=>where.matchValue.in.includes(r.matchValue));
        return kind === 'incomplete' && active === 'fixture-blocked' ? [...rows,...rows] : rows;
      } }, business: {findMany:async()=>[]}
    },
    fetchVapiCalls:async()=>calls, fetchVapiCallDetail:async()=>null,
    readVapiCallSyncStore:()=>({}), writeVapiCallSyncStore:()=>{fileWrites++;},
    reconcileTrialUsageAfterCall:async r=>usage.push(r.id), isCallSyncRoutingRefusal,
    console:{warn:(...args)=>warnings.push(args)},
  };
  vm.createContext(context); vm.runInContext(resolverSource + '\n' + syncSource, context);
  context.upsertVapiCall = async call => {
    active = call.id;
    const businessId = await context.resolveBusinessIdForVapiCall(call);
    writes.push({id:call.id,businessId}); return {id:call.id,businessId,usageChanged:true};
  };
  return {run:()=>context.performVapiCallSync(),writes,usage,warnings,fileWrites:()=>fileWrites};
}

for (const [kind, code] of [['unknown','UNKNOWN_IDENTIFIER'],['invalid','INVALID_IDENTIFIER'],['conflict','CONFLICT'],['incomplete','INCOMPLETE']]) {
  test(`actual resolver and sync quarantine ${kind}, continue trusted calls, and never attest recovery`, async () => {
    const f=fixture(kind); const receipts=[],recoveries=[],failures=[];
    const monitor=createCallSyncMonitor({listIncidents:async()=>[{id:'fixture-existing-sync-incident',snapshot:{Workflow:WORKFLOW},remediation:{status:'verifying'}}],recordCompletion:async r=>receipts.push(r),
      recoverIncident:async r=>recoveries.push(r),notifyFailure:async(e,c)=>{failures.push({code:e.code,context:c});return{recorded:true};}});
    const result=await monitor(f.run);
    assert.deepEqual(f.writes,[{id:'fixture-before',businessId:1},{id:'fixture-after',businessId:1}]);
    assert.deepEqual(f.usage,['fixture-before','fixture-after']); assert.equal(f.fileWrites(),1);
    assert.equal(result.routingErrors[0].code,'VAPI_BUSINESS_ROUTE_'+code);
    assert.equal(result.synced,2); assert.equal(result.fetched,3);
    assert.equal(result.skippedUnmapped,0); assert.equal(result.quarantinedRouting,1);
    assert.equal(completeSync(result),false); assert.equal(receipts.length,0); assert.equal(recoveries.length,0);
    assert.equal(failures.length,1); assert.equal(failures[0].code,'VAPI_CALL_SYNC_ROUTING_BLOCKED');
    assert.doesNotMatch(JSON.stringify(f.warnings), /fixture-(blocked|unknown-phone|assistant)/);
  });
}
test('intentional absent/no-match call retains prior skip accounting without default tenant', async()=>{
  const f=fixture('required'); const r=await f.run();
  assert.equal(r.skippedUnmapped,1);assert.equal(r.quarantinedRouting,0);assert.equal(completeSync(r),true);
  assert.equal(f.writes.length,2);assert.ok(f.writes.every(r=>r.businessId===1));
});
for(const code of ['P1001','UNEXPECTED_IMPLEMENTATION_FAILURE'])test(`sync does not swallow or retry ${code}`,async()=>{
  const f=fixture('unknown',code);await assert.rejects(f.run(),{code});
  assert.deepEqual(f.writes,[{id:'fixture-before',businessId:1}]);assert.equal(f.fileWrites(),0);
});
test('monitor refuses unknown future routing codes, without relaxing legacy intentionally unmapped results',()=>{
  assert.equal(completeSync({fetched:1,synced:0,detailErrors:[],routingErrors:[{code:'FUTURE_ROUTE_FAILURE'}]}),false);
  assert.equal(isCallSyncRoutingRefusal({code:'VAPI_BUSINESS_ROUTE_FUTURE_FAILURE'}),false);
});

test('actual sync reports eight attested simulation legs and three exact intake calls without authorizing them',async()=>{
  const ids=Array.from({length:8},(_,i)=>'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'));
  const simulationEvidence=parseSimulationEvidence({schemaVersion:1,reportingOnly:true,sources:[{sha256:'a'.repeat(64)}],
    calls:ids.map((callId,i)=>({callId,type:'vapi.websocketCall',role:i%2?'target':'tester',sourceSha256:'a'.repeat(64)}))});
  const calls=[...ids.map(id=>({id,type:'vapi.websocketCall'})),...Array.from({length:3},(_,i)=>({id:'fixture-intake-'+i,
    type:'inboundPhoneCall',assistantId:'fixture-intake-assistant',phoneNumberId:'fixture-intake-phone'})),
    {id:'fixture-customer',assistantId:'fixture-assistant',type:'inboundPhoneCall'}];
  const f=fixture('unknown',null,{calls,simulationEvidence}),result=await f.run();
  assert.deepEqual(JSON.parse(JSON.stringify(result.reporting.counts)),{verified_simulation:8,signup_intake:3,unresolved_routing:0});
  assert.equal(result.fetched,12);assert.equal(result.synced,1);assert.equal(result.routingErrors.length,11);
  assert.equal(result.skippedUnmapped,8);assert.equal(result.quarantinedRouting,3);
  assert.deepEqual(f.writes,[{id:'fixture-customer',businessId:1}]);
  assert.equal(completeSync(result),false,'reporting labels cannot create completion or incident recovery');
  assert.equal(result.reporting.grantsRouting,false);assert.equal(result.reporting.completionEvidence,false);
});

test('absent private attestation cannot silently label arbitrary websocket calls as simulations',async()=>{
  const f=fixture('unknown',null,{calls:[{id:'fixture-websocket',type:'vapi.websocketCall',metadata:{synthetic:true,purpose:'simulation'}}]});
  const r=await f.run();assert.equal(r.reporting.counts.unresolved_routing,1);
  assert.equal(r.reporting.counts.verified_simulation,0);assert.equal(r.reporting.simulationEvidenceStatus,'absent');
  assert.equal(f.writes.length,0);
});
