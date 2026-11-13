const test=require('node:test'),assert=require('node:assert/strict');
const {discoverOptionalLinks}=require('../server/privacyOptionalInventory');
const target={businessId:11,callerId:21};
function fixture(){const rows={supportReport:[{id:'support-a',businessId:11,callId:1}],appointmentRequest:[{id:'appointment-a',businessId:11,callId:1,staffMemberId:'staff-a'}],
 fieldServiceSync:[{id:'sync-a',businessId:11,leadId:2,connectionId:'connection-a'}],call:[{id:1,...target},{id:9,businessId:11,callerId:99}],lead:[{id:2,...target}],
 staffMember:[{id:'staff-a',businessId:11}],fieldServiceConnection:[{id:'connection-a',businessId:11}]};
 const tx=Object.fromEntries(Object.keys(rows).map(model=>[model,{findMany:async q=>structuredClone(q.where.id?rows[model].filter(r=>q.where.id.in.includes(r.id)):rows[model])}]));
 return {rows,tx,target,calls:[{id:1,...target}],leads:[{id:2,...target}],run(){return discoverOptionalLinks(this);}};}
test('proven call/lead relationships discover three optional models without customer-content reads',async()=>{const r=await fixture().run();assert.equal(r.records.length,3);assert.equal(r.coveredSurfaces.length,3);assert.equal(r.partialRecords.length,0);assert.ok(r.records.every(r=>r.businessId===11&&r.callerId===21));});
for(const [model,key]of [['supportReport','callId'],['appointmentRequest','callId'],['fieldServiceSync','leadId']]){
 test(model+' null parent preserves missing coverage and known candidates separately',async()=>{const f=fixture();f.rows[model].push({...f.rows[model][0],id:'unresolved', [key]:null});const r=await f.run();assert.equal(r.coveredSurfaces.length,2);assert.equal(r.partialRecords.length,1);assert.equal(r.unresolvedSurfaces[0].reason,'NULLABLE_OR_UNRESOLVED_PARENT');});
 test(model+' orphan parent is unresolved, not guessed',async()=>{const f=fixture();f.rows[model][0][key]=999;const r=await f.run();assert.equal(r.coveredSurfaces.length,2);assert.equal(r.partialRecords.length,0);});
 test(model+' conflicting tenant refuses rather than assigning ownership',async()=>{const f=fixture();f.rows[model][0].businessId=12;await assert.rejects(f.run(),e=>e.code==='PRIVACY_OPTIONAL_BINDING_CONFLICT');});
}
test('different caller in same business is not bridged by contacts/names/phones',async()=>{const f=fixture();f.rows.supportReport[0].callId=9;assert.equal((await f.run()).records.filter(r=>r.surface==='database:SupportReport').length,0);});
for(const [model]of [['staffMember'],['fieldServiceConnection']])test(model+' contradictory tenant refuses',async()=>{const f=fixture();f.rows[model][0].businessId=12;await assert.rejects(f.run(),e=>e.code==='PRIVACY_OPTIONAL_BINDING_CONFLICT');});
test('missing staff/connection reference stays unresolved',async()=>{for(const key of ['staffMember','fieldServiceConnection']){const f=fixture();f.rows[key]=[];assert.equal((await f.run()).unresolvedSurfaces.length,1);}});
test('unavailable or truncated adapter never becomes empty green coverage',async()=>{for(const unavailable of [true,false]){const f=fixture();if(unavailable)f.tx.supportReport.findMany=async()=>{throw Error('SYNTHETIC_UNAVAILABLE');};else f.rows.supportReport=Array.from({length:1001},(_,i)=>({id:String(i),businessId:11,callId:1}));await assert.rejects(f.run());}});
test('partial candidates do not establish privacy or recovery readiness',async()=>{const r=await fixture().run(),p=require('../scripts/launch-evidence');for(const name of ['privacyApplicationPassed','logicalRestorePassed','fullRecoveryPassed'])assert.equal(p[name](r,'d00b734a729d987813054dea9315a6dc322bfa28'),false);});
async function previewPartial(change=()=>{}){
 const crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path'),{createPrivacyInventoryPreview,bytes}=require('../server/privacyInventoryPreview');
 const f=fixture();f.rows.supportReport.push({id:'unresolved',businessId:11,callId:null});const data=await f.run();change(data);
 const keys=crypto.generateKeyPairSync('ed25519');return createPrivacyInventoryPreview({readInventory:async()=>({...data,identity:{...target,exact:true},foreignTenantCount:0}),
  requiredSurfaces:require('../server/privacyInventoryReader').requiredSurfaces(fs.readFileSync(path.join(__dirname,'../prisma/schema.prisma'),'utf8')),
  authorityId:'fixture-optional',referenceKey:crypto.randomBytes(32),publicKey:keys.publicKey.export({type:'spki',format:'pem'}),readAuthority:async({scopeRef,challenge})=>{
   const proof={version:1,authorityId:'fixture-optional',scopeRef,challenge,issuedAt:Date.now(),revision:1,throughSequence:0,journal:[],holds:[{scopeRef,revision:1,state:'clear'}]};
   return {proof,signature:crypto.sign(null,bytes(proof),keys.privateKey).toString('base64url')};}})(target);
}
test('preview reports opaque partial candidates separately and retains missing coverage',async()=>{
 const r=await previewPartial();assert.equal(r.partialInventory.length,1);assert.equal(r.partialInventory[0].candidateOnly,true);assert.ok(!JSON.stringify(r).includes('support-a'));
 assert.ok(r.coverage.missing.includes('database:SupportReport'));assert.equal(r.ready,false);assert.equal(r.applyAllowed,false);
});
test('partial candidate tenant or subject conflicts refuse',async()=>{for(const field of ['businessId','callerId'])await assert.rejects(previewPartial(r=>r.partialRecords[0][field]++),e=>e.code==='PRIVACY_RECORD_CONFLICT');});
test('partial candidate cannot be duplicated or silently marked completely covered',async()=>{
 await assert.rejects(previewPartial(r=>r.partialRecords.push({...r.partialRecords[0]})),e=>e.code==='PRIVACY_RECORD_CONFLICT');
 await assert.rejects(previewPartial(r=>r.coveredSurfaces.push('database:SupportReport')),e=>e.code==='PRIVACY_INVENTORY_INCOMPLETE');
});
