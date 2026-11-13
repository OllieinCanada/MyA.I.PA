const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const express=require('express');
const {createFixture,digest}=require('./helpers/boundedMappingIntegrationFixture');
const {createBoundedMappingControl,registerBoundedMappingControlRoutes,readOperatorPolicy}=require('../server/boundedMappingControl');
function fixture(){
  const f=createFixture(fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-control-synthetic-'))),actor='2'.repeat(64);
  let rows=structuredClone(f.policy.preservedMappings),records=new Map(structuredClone([...f.records]));
  const state={control:true,apply:false,single:true,auth:true,clock:Date.parse(f.snapshot.checkedAt),queries:0,probes:0,creates:0,secret:'synthetic-integration-signing-secret'};
  const release=f.policy.release,doc={schemaVersion:1,policyId:'1'.repeat(64),operatorSessionHash:actor,target:structuredClone(f.policy),expiresAt:new Date(state.clock+600000).toISOString()};
  const attempt={...structuredClone(f.attemptData),updatedAt:new Date(state.clock)};
  const business={id:7,name:f.source.businessName,phone:f.source.ownerPhone,settings:{ownerPhone:f.source.ownerPhone}};
  let queue=Promise.resolve();
  const prisma={$transaction:async fn=>{
    const previous=queue;let release;queue=new Promise(r=>{release=r;});await previous;
    const next=structuredClone(rows),journal=new Map(structuredClone([...records]));let touched=false;
    const tx={$queryRaw:async()=>[], $executeRaw:async()=>0,
      business:{findUnique:async()=>structuredClone(business)},
      signupAttempt:{findUnique:async({where})=>where.eventKey===f.policy.sourceId?structuredClone(attempt):null,findMany:async()=>[]},
      runtimeStore:{findUnique:async({where})=>journal.has(where.key)?{data:structuredClone(journal.get(where.key))}:null,
        create:async({data})=>{assert.equal(journal.has(data.key),false);journal.set(data.key,structuredClone(data.data));},
        updateMany:async({where,data})=>{if(digest(journal.get(where.key))!==digest(where.data.equals))return{count:0};journal.set(where.key,structuredClone(data.data));return{count:1};}},
      vapiBusinessMapping:{findMany:async()=>structuredClone(next),create:async({data})=>{
        touched=true;state.creates++;if(state.failInsert===state.creates)throw Error('synthetic insert failure');
        next.push({id:30000+state.creates,...data});await state.onCreate?.();
      }} };
    state.queries++;
    try{const result=await fn(tx);rows=next;records=journal;if(touched&&state.loseAck){state.loseAck=false;throw Error('synthetic lost acknowledgement');}return result;}
    finally{release();}
  }};
  const config={prisma,fence:f.fence,readStore:f.readStore,getSigningSecret:()=>state.secret,getRelease:()=>release,
    getOperatorPolicy:()=>doc,probe:async()=>{state.probes++;await state.onProbe?.();return{...structuredClone(f.snapshot),checkedAt:new Date(state.clock).toISOString()};},
    readOverrides:()=>'',enabled:()=>state.control,applyEnabled:()=>state.apply,singleWriter:()=>state.single,now:()=>state.clock};
  const service=createBoundedMappingControl(config),auth={actorHash:actor,reauthorize:()=>state.auth?actor:''};
  const dry=()=>service.execute({action:'dry_run',policyId:doc.policyId},auth);
  const body=plan=>({action:'apply',policyId:doc.policyId,planDigest:plan.planDigest,confirmation:'APPLY_EXISTING_BUSINESS_MAPPINGS_ONLY'});
  async function approve(){const plan=await dry();doc.approvedPlanDigest=plan.planDigest;state.apply=true;return plan;}
  return {f,state,doc,actor,auth,config,service,prisma,attempt,dry,body,approve,get rows(){return rows;},get records(){return records;}};
}
test('default disabled control refuses before policy, proof or database reads',async()=>{
  const f=fixture(),service=createBoundedMappingControl({...f.config,enabled:undefined});
  await assert.rejects(service.execute({action:'identify'},f.auth),{code:'MAPPING_CONTROL_DISABLED'});assert.equal(f.state.probes,0);assert.equal(f.state.queries,0);
});
test('requires signed-session actor binding and returns only a non-secret session digest on identify',async()=>{
  const f=fixture();f.state.auth=false;await assert.rejects(f.dry(),{code:'MAPPING_CONTROL_SESSION_REQUIRED'});f.state.auth=true;
  const result=await f.service.execute({action:'identify'},f.auth);assert.equal(result.operatorSessionHash,f.actor);assert.equal(result.readinessGranted,false);assert.equal(f.state.probes,0);
});
test('client cannot supply target, proof, actor or unknown commands',async()=>{
  for(const extra of [{target:{}},{signatureVerified:true},{operatorSessionHash:'3'.repeat(64)},{action:'reset_uncertain'}]){
    const f=fixture();await assert.rejects(f.service.execute({action:'dry_run',policyId:f.doc.policyId,...extra},f.auth),{code:'MAPPING_CONTROL_REQUEST_INVALID'});assert.equal(f.state.probes,0);
  }
});
test('operator policy must match actor, target release, exact ID and bounded expiry',async()=>{
  for(const change of [f=>f.doc.operatorSessionHash='3'.repeat(64),f=>f.doc.policyId='4'.repeat(64),f=>f.doc.target.release='f'.repeat(40),f=>f.doc.expiresAt=new Date(f.state.clock-1).toISOString()]){
    const f=fixture();const id=f.doc.policyId;change(f);await assert.rejects(f.service.execute({action:'dry_run',policyId:id},f.auth),{code:'MAPPING_CONTROL_POLICY_REQUIRED'});assert.equal(f.state.probes,0);
  }
});
test('real-reader/native-writer dry run changes no file, mappings, receipt or readiness evidence',async()=>{
  const f=fixture(),before=digest({rows:f.rows,records:[...f.records],store:f.f.readStore()});
  const plan=await f.dry();assert.equal(plan.dryRun,true);assert.equal(plan.databaseWrites,0);assert.equal(f.state.creates,0);
  assert.equal(digest({rows:f.rows,records:[...f.records],store:f.f.readStore()}),before);
});
test('apply needs separate enabled flag, server-owned approval and exact confirmation',async()=>{
  for(const mode of ['flag','approval','confirmation']){const f=fixture(),plan=await f.dry();
    if(mode!=='flag')f.state.apply=true;if(mode!=='approval')f.doc.approvedPlanDigest=plan.planDigest;
    const body=f.body(plan);if(mode==='confirmation')body.confirmation='yes';
    await assert.rejects(f.service.execute(body,f.auth),{code:'MAPPING_CONTROL_APPLY_NOT_APPROVED'});assert.equal(f.state.creates,0);assert.equal(f.state.probes,1);
  }
});
test('explicit guarded admission invokes actual reader/writer once and preserves old rows/history/readiness',async()=>{
  const f=fixture(),before=digest(f.f.readStore()),plan=await f.approve();
  const result=await f.service.execute(f.body(plan),f.auth);assert.equal(result.applied,true);assert.equal(result.readinessGranted,false);
  assert.equal(f.rows.length,6);assert.deepEqual(f.rows.slice(0,3),f.f.policy.preservedMappings);assert.equal(digest(f.f.readStore()),before);
  await assert.rejects(f.service.execute(f.body(plan),f.auth),{code:'MAPPING_CONTROL_INSPECT_FIRST'});assert.equal(f.state.creates,3);
});
test('revalidates session and server approval after the fresh probe',async()=>{
  for(const mode of ['session','approval']){const f=fixture(),plan=await f.approve();f.state.onProbe=()=>{if(mode==='session')f.state.auth=false;else delete f.doc.approvedPlanDigest;};
    await assert.rejects(f.service.execute(f.body(plan),f.auth));assert.equal(f.state.creates,0);
  }
});
test('changed provider state refuses before mapping admission',async()=>{
  const f=fixture(),plan=await f.approve();f.f.snapshot.provider.phone.assistantId='different';
  await assert.rejects(f.service.execute(f.body(plan),f.auth),{code:'MAPPING_CONTROL_PROOF_CHANGED'});assert.equal(f.state.creates,0);
});
test('real reader rejects changed stored receipt and invalid signature without inventing evidence',async()=>{
  for(const mode of ['receipt','signature']){const f=fixture(),plan=await f.approve();
    if(mode==='receipt')f.records.get(f.f.receiptKey).status='uncertain';else f.state.secret='wrong';
    await assert.rejects(f.service.execute(f.body(plan),f.auth));assert.equal(f.state.creates,0);
  }
});
test('shared running fence excludes cleanup/repair while admitted writes run',async()=>{
  const f=fixture(),plan=await f.approve();let excluded=0;f.state.onCreate=()=>{assert.throws(()=>f.f.fence.hold([f.f.policy.sourceId,f.f.policy.phantomId]),{code:'ASSOCIATION_REPAIR_BUSY'});excluded++;};
  await f.service.execute(f.body(plan),f.auth);assert.equal(excluded,3);
});
test('failure rolls back mappings, retains durable uncertainty, and inspect cannot silently reset it',async()=>{
  const f=fixture(),plan=await f.approve();f.state.failInsert=2;
  await assert.rejects(f.service.execute(f.body(plan),f.auth),{code:'MAPPING_UNCERTAIN_INSPECT_FIRST'});assert.equal(f.rows.length,3);
  const result=await f.service.execute({action:'inspect',policyId:f.doc.policyId},f.auth);assert.equal(result.state,'attempt_started_unresolved');assert.equal(result.retryAuthorized,false);
  await assert.rejects(f.dry(),{code:'MAPPING_CONTROL_INSPECT_FIRST'});
  const restarted=createBoundedMappingControl(f.config);await assert.rejects(restarted.execute({action:'dry_run',policyId:f.doc.policyId},f.auth),{code:'MAPPING_UNCERTAIN_INSPECT_FIRST'});
});
test('lost commit acknowledgement is reported uncertain, inspected as committed, never replayed',async()=>{
  const f=fixture(),plan=await f.approve();f.state.loseAck=true;
  await assert.rejects(f.service.execute(f.body(plan),f.auth),{code:'MAPPING_UNCERTAIN_INSPECT_FIRST'});
  const result=await f.service.execute({action:'inspect',policyId:f.doc.policyId},f.auth);assert.equal(result.state,'committed_exact');assert.equal(f.rows.length,6);assert.equal(f.state.creates,3);
});
test('concurrent guarded admissions reserve the operation before awaiting proof',async()=>{
  const f=fixture(),plan=await f.approve();let release;const blocked=new Promise(r=>{release=r;});f.state.onProbe=()=>blocked;
  const first=f.service.execute(f.body(plan),f.auth);
  await assert.rejects(f.service.execute(f.body(plan),f.auth),{code:'MAPPING_CONTROL_BUSY'});release();await first;
  assert.equal(f.state.probes,2);assert.equal(f.state.creates,3);assert.equal(f.rows.length,6);
});
test('expired dry run and unconfirmed single-writer state refuse',async()=>{
  const f=fixture(),plan=await f.approve();f.state.clock+=240001;await assert.rejects(f.service.execute(f.body(plan),f.auth),{code:'MAPPING_CONTROL_FRESH_DRY_RUN_REQUIRED'});
  const other=fixture();other.state.single=false;await assert.rejects(other.dry(),{code:'MAPPING_LIFECYCLE_SCOPE_REQUIRED'});
});
test('route preserves auth, rate limiter, same-origin/custom-header and secret redaction',async()=>{
  const f=fixture(),app=express();app.use(express.json());let limited=0;
  registerBoundedMappingControlRoutes({app,service:f.service,limiter:(_q,_s,next)=>{limited++;next();},requireAdmin:(q,s,next)=>q.headers['x-test-admin']==='yes'?next():s.sendStatus(401),
    isAllowedOrigin:o=>o==='https://app.example.invalid',actorHash:q=>q.headers['x-test-session']==='valid'?f.actor:''});
  const server=app.listen(0,'127.0.0.1');await require('node:events').once(server,'listening');
  const post=async(headers,body)=>{const r=await fetch(`http://127.0.0.1:${server.address().port}/api/admin/signups/bounded-business-mapping`,{
    method:'POST',headers:{Origin:'https://app.example.invalid','content-type':'application/json','x-myaipa-mapping-correction':'1',...headers},body:JSON.stringify(body)});
    return{status:r.status,body:await r.json().catch(()=>null),headers:r.headers};};
  try{
    assert.equal((await post({},{action:'identify'})).status,401);
    assert.equal((await post({'x-test-admin':'yes'},{action:'identify'})).status,401);
    const foreign=await post({'x-test-admin':'yes','x-test-session':'valid',Origin:'https://foreign.invalid'},{action:'identify'});assert.equal(foreign.status,403);
    f.state.onProbe=()=>{throw Error('do-not-expose-private-provider-detail');};
    const failed=await post({'x-test-admin':'yes','x-test-session':'valid'},{action:'dry_run',policyId:f.doc.policyId});
    assert.equal(failed.status,503);assert.equal(JSON.stringify(failed.body).includes('do-not-expose'),false);assert.equal(failed.headers.get('cache-control'),'no-store');assert.equal(limited,4);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('application wiring shares the actual singleton and signed-session binding, never an IP audit hash',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../server/index.js'),'utf8');
  assert.match(source,/createBoundedMappingControl\(\{ prisma, fence: signupAssociationFence/);
  assert.match(source,/actorHash: req => hasValidAdminSession\(req\)/);
  assert.equal(fs.readFileSync(require.resolve('../server/boundedMappingControl'),'utf8').includes('createAssociationFence('),false);
});
test('operator policy absence is not inferred and only the fixed local filename is read',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-private-policy-test-'));assert.equal(readOperatorPolicy(dir),null);
  fs.writeFileSync(path.join(dir,'bounded-mapping-operator-policy.json'),JSON.stringify({synthetic:true}));assert.deepEqual(readOperatorPolicy(dir),{synthetic:true});
});
