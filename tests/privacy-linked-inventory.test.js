const test=require('node:test'),assert=require('node:assert/strict');
const {discoverSubjectLinks}=require('../server/privacyLinkedInventory');
const target={businessId:11,callerId:21};
function fixture(){
 const calls=[{id:1,...target,externalProvider:'vapi',externalId:'fixture-call-a'}],leads=[{id:2,...target}];
 const rows={callNote:[{id:3,callId:1}],callTask:[{id:4,callId:1}],leadOutcomeEvent:[{id:5,leadId:2,businessId:11}],
  leadHandoff:[{id:'fixture-handoff',leadId:2,callId:1,businessId:11}],leadNotificationAttempt:[{id:'fixture-attempt',handoffId:'fixture-handoff'}],
  leadNotificationEvent:[{id:'fixture-event',handoffId:'fixture-handoff',attemptId:'fixture-attempt'}],call:[...calls,{id:99,businessId:12,callerId:33,externalProvider:'vapi',externalId:'fixture-other-call'}]};
 const queries=[],tx=Object.fromEntries(Object.keys(rows).map(name=>[name,{findMany:async q=>{queries.push({name,q});if(name==='call')return structuredClone(rows.call.filter(r=>q.where.id.in.includes(r.id)));return structuredClone(rows[name]);}}]));
 const syncStore={'fixture-call-a':{vapiCallId:'fixture-call-a',localCallId:1,businessId:11},'fixture-other-call':{vapiCallId:'fixture-other-call',localCallId:99,businessId:12}};
 return {target,calls,leads,rows,tx,syncStore,queries,run(){return discoverSubjectLinks(this);}};
}
test('six required-relation adapters plus verified Vapi file candidates; unrelated caller omitted',async()=>{
 const f=fixture(),r=await f.run();assert.equal(r.coveredSurfaces.length,7);assert.equal(r.records.length,7);
 assert.equal(r.records.filter(x=>x.surface.startsWith('file:')).length,1);assert.equal(r.records.find(x=>x.surface.startsWith('file:')).id,'fixture-call-a');
 assert.ok(r.records.every(x=>x.businessId===11&&x.callerId===21));assert.equal(r.unresolvedSurfaces.length,3);
 assert.ok(f.queries.every(({q})=>q.take===1001));assert.deepEqual(f.queries.find(x=>x.name==='leadNotificationEvent').q.where.OR,[{handoffId:{in:['fixture-handoff']}},{attemptId:{in:['fixture-attempt']}}]);
});
for(const [name,change]of [
 ['note wrong parent',f=>f.rows.callNote[0].callId=99],['task wrong parent',f=>f.rows.callTask[0].callId=99],
 ['outcome wrong tenant',f=>f.rows.leadOutcomeEvent[0].businessId=12],['outcome wrong subject',f=>f.rows.leadOutcomeEvent[0].leadId=99],
 ['handoff wrong tenant',f=>f.rows.leadHandoff[0].businessId=12],['handoff wrong lead',f=>f.rows.leadHandoff[0].leadId=99],['handoff conflicting call',f=>f.rows.leadHandoff[0].callId=99],
 ['attempt wrong handoff',f=>f.rows.leadNotificationAttempt[0].handoffId='foreign'],['event wrong handoff',f=>f.rows.leadNotificationEvent[0].handoffId='foreign'],
 ['event conflicting attempt',f=>f.rows.leadNotificationEvent[0].attemptId='foreign']
 ])test(name+' refuses rather than projecting ownership',async()=>{const f=fixture();change(f);await assert.rejects(f.run(),e=>e.code==='PRIVACY_LINK_BINDING_CONFLICT');});
test('optional missing attempt and call links remain resolvable through required parent',async()=>{const f=fixture();f.rows.leadHandoff[0].callId=null;f.rows.leadNotificationEvent[0].attemptId=null;assert.equal((await f.run()).coveredSurfaces.length,7);});
for(const [name,change]of [
 ['wrong sync business',f=>f.syncStore['fixture-call-a'].businessId=12],['wrong provider',f=>f.rows.call[0].externalProvider='other'],['wrong external ID',f=>f.rows.call[0].externalId='other']
 ])test(name+' rejects saved-identity conflict',async()=>{const f=fixture();change(f);await assert.rejects(f.run(),e=>e.code==='PRIVACY_FILE_BINDING_CONFLICT');});
for(const [name,change]of [
 ['legacy row',f=>f.syncStore.legacy={ownerPhone:'+15555550121'}],['orphan call',f=>f.syncStore['fixture-call-a'].localCallId=999],['mismatched index key',f=>f.syncStore['fixture-call-a'].vapiCallId='other']
 ])test(name+' keeps file adapter unresolved without guessing subject',async()=>{const f=fixture();change(f);const r=await f.run();assert.ok(!r.coveredSurfaces.includes('file:vapi-call-sync.json'));assert.equal(r.records.filter(x=>x.surface.startsWith('file:')).length,0);assert.ok(r.unresolvedSurfaces.some(x=>x.reason==='UNRESOLVED_ROW_LINK'));});
test('duplicate and truncated relational results refuse',async()=>{for(const duplicate of [true,false]){const f=fixture();f.rows.callNote=duplicate?[f.rows.callNote[0],f.rows.callNote[0]]:Array.from({length:1001},(_,i)=>({id:i,callId:1}));await assert.rejects(f.run(),e=>e.code==='PRIVACY_LINK_INVENTORY_INCOMPLETE');}});
test('inaccessible adapter propagates refusal, never silently empty coverage',async()=>{const f=fixture();f.tx.callNote.findMany=async()=>{throw Error('SYNTHETIC_UNAVAILABLE');};await assert.rejects(f.run(),/SYNTHETIC_UNAVAILABLE/);});
test('unknown signup-owner linkage remains unresolved even when file can be read',async()=>{const r=await fixture().run();for(const name of ['pending-stripe-signups.json','trial-reminders.json','signup-dashboard.json'])assert.ok(r.unresolvedSurfaces.some(x=>x.surface==='file:'+name&&x.reason==='NO_CANONICAL_CALLER_LINK'));});
test('coverage remains partial and no production adapter/integration is implied',async()=>{const r=await fixture().run();assert.equal(r.coveredSurfaces.filter(x=>x.startsWith('database:')).length,6);assert.equal(r.coveredSurfaces.filter(x=>x.startsWith('file:')).length,1);
 assert.equal(require('../scripts/launch-evidence').privacyApplicationPassed(r,'544289336f2f07fa4dbe241009c89a1dfaa9dfac'),false);});
async function combined(t,legacy=false){
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{NAMES}=require('../server/recoveryFileStore');
 const f=fixture(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-linked-reader-'));
 t.after(()=>{const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.match(path.basename(resolved),/^myaipa-linked-reader-/);
  for(const name of fs.readdirSync(resolved)){assert.ok(NAMES.includes(name));assert.equal(fs.lstatSync(path.join(resolved,name)).isFile(),true);fs.unlinkSync(path.join(resolved,name));}fs.rmdirSync(resolved);});
 if(legacy)f.syncStore.legacy={ownerEmail:'fictitious@example.invalid'};
 for(const n of NAMES)fs.writeFileSync(path.join(directory,n),JSON.stringify(n==='vapi-call-sync.json'?f.syncStore:{fixture:{ownerEmail:'fictitious@example.invalid'}}));
 const allCalls=f.rows.call;
 f.tx.business={findUnique:async()=>({id:target.businessId})};f.tx.caller={findUnique:async()=>({id:target.callerId,phone:'+15555550121'})};f.tx.smsSuppression={findUnique:async()=>null};
 f.tx.call.findMany=async q=>q.where.id?allCalls.filter(r=>q.where.id.in.includes(r.id)):typeof q.where.businessId==='object'?[]:f.calls;
 f.tx.lead={findMany:async q=>typeof q.where.businessId==='object'?[]:f.leads};
 f.tx.$executeRawUnsafe=async sql=>assert.equal(sql,'SET TRANSACTION READ ONLY');
 const prisma={$transaction:async(fn,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');return fn(f.tx);}};
 const {createReadOnlyInventoryReader,requiredSurfaces}=require('../server/privacyInventoryReader'),{createPrivacyInventoryPreview,bytes}=require('../server/privacyInventoryPreview');
 const keys=crypto.generateKeyPairSync('ed25519'),readInventory=createReadOnlyInventoryReader({prisma,directory,discoverLinked:true});
 const preview=createPrivacyInventoryPreview({readInventory,requiredSurfaces:requiredSurfaces(fs.readFileSync(path.join(__dirname,'../prisma/schema.prisma'),'utf8')),
  authorityId:'fixture-combined',publicKey:keys.publicKey.export({type:'spki',format:'pem'}),referenceKey:crypto.randomBytes(32),readAuthority:async({scopeRef,challenge})=>{
   const proof={version:1,authorityId:'fixture-combined',scopeRef,challenge,issuedAt:Date.now(),revision:1,throughSequence:0,journal:[],holds:[{scopeRef,revision:1,state:'clear'}]};
   return {proof,signature:crypto.sign(null,bytes(proof),keys.privateKey).toString('base64url')};}});
 return preview(target);
}
test('combined real reader/library path reports 10 model adapters plus one file adapter but remains blocked',async t=>{
 const r=await combined(t);assert.equal(r.coverage.covered.filter(x=>x.startsWith('database:')).length,10);assert.equal(r.coverage.covered.filter(x=>x.startsWith('file:')).length,1);
 assert.equal(r.coverage.missing.length,29);assert.equal(r.coverage.unresolved.length,3);assert.equal(r.ready,false);assert.equal(r.applyAllowed,false);assert.ok(!JSON.stringify(r).includes('fixture-call-a'));
});
test('combined legacy file row cannot falsely clear file coverage or preview admission',async t=>{
 const r=await combined(t,true);assert.equal(r.coverage.missing.length,30);assert.equal(r.coverage.unresolved.length,4);assert.equal(r.coverage.complete,false);assert.equal(r.applyAllowed,false);
});
