const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createPrivacyInventoryPreview,bytes}=require('../server/privacyInventoryPreview');
const {requiredSurfaces}=require('../server/privacyInventoryReader');
const target={businessId:11,callerId:22},surfaces=['database:Caller','database:Call','database:Lead','database:SmsSuppression','file:missing'];
function fixture(change=()=>{}){
 const keys=crypto.generateKeyPairSync('ed25519'),clock=1700000000000,referenceKey=crypto.randomBytes(32);let authorityReads=0,inventoryReads=0;
 const state={revision:1,throughSequence:1,hold:'clear'};
 const readAuthority=async({scopeRef,challenge})=>{authorityReads++;const proof={version:1,authorityId:'fixture-current-authority',scopeRef,challenge,issuedAt:clock,revision:state.revision,
  throughSequence:state.throughSequence,journal:Array.from({length:state.throughSequence},(_,i)=>({sequence:i+1,scopeRef,decisionRef:'fixture-invented-policy'})),holds:[{scopeRef,revision:state.revision,state:state.hold}]};
  change(proof,{authorityReads,state});return {proof,signature:crypto.sign(null,bytes(proof),keys.privateKey).toString('base64url')};};
 const inventory={identity:{...target,exact:true},foreignTenantCount:1,coveredSurfaces:surfaces.slice(0,4),records:[{surface:'database:Call',id:'fixture-call',...target}]};
 const config={authorityId:'fixture-current-authority',publicKey:keys.publicKey.export({type:'spki',format:'pem'}),referenceKey,requiredSurfaces:surfaces,now:()=>clock,
  readAuthority,readInventory:async()=>{inventoryReads++;return structuredClone(inventory);}};
 return {config,inventory,state,keys,counts:()=>({authorityReads,inventoryReads}),preview:()=>createPrivacyInventoryPreview(config)};
}
test('no-write partial inventory is opaque, scoped, explicitly blocked and independently checked twice',async()=>{
 const f=fixture(),r=await f.preview()(target);assert.deepEqual(f.counts(),{authorityReads:2,inventoryReads:1});assert.equal(r.authority.verified,true);
 assert.equal(r.coverage.complete,false);assert.deepEqual(r.coverage.missing,['file:missing']);assert.equal(r.sharedIdentity,true);assert.equal(r.applyAllowed,false);assert.equal(r.ready,false);
 assert.ok(!JSON.stringify(r).includes('fixture-call'));assert.equal(r.inventory[0].reference.length,64);
});
for(const [name,change,code]of [
 ['stale',p=>p.issuedAt-=10001,'PRIVACY_AUTHORITY_STALE'],['future',p=>p.issuedAt++,'PRIVACY_AUTHORITY_STALE'],
 ['absent timestamp',p=>delete p.issuedAt,'PRIVACY_AUTHORITY_STALE'],['wrong challenge',p=>p.challenge='replayed','PRIVACY_AUTHORITY_UNTRUSTED'],
 ['wrong scope',p=>p.scopeRef='0'.repeat(64),'PRIVACY_AUTHORITY_UNTRUSTED'],['wrong authority',p=>p.authorityId='untrusted','PRIVACY_AUTHORITY_UNTRUSTED'],
 ['missing journal',p=>delete p.journal,'PRIVACY_JOURNAL_INCOMPLETE'],['missing sequence',p=>delete p.throughSequence,'PRIVACY_JOURNAL_INCOMPLETE'],
 ['gap',p=>p.throughSequence=2,'PRIVACY_JOURNAL_INCOMPLETE'],['unordered',p=>p.journal[0].sequence=2,'PRIVACY_JOURNAL_UNORDERED'],
 ['missing hold',p=>p.holds=[],'PRIVACY_HOLD_CONFLICT'],['conflicting holds',p=>p.holds.push({...p.holds[0],state:'held'}),'PRIVACY_HOLD_CONFLICT'],
 ['wrong hold scope',p=>p.holds[0].scopeRef='0'.repeat(64),'PRIVACY_HOLD_CONFLICT'],['wrong hold revision',p=>p.holds[0].revision++,'PRIVACY_HOLD_CONFLICT'],
 ['held',p=>p.holds[0].state='held','PRIVACY_HOLD_NOT_CLEAR'],['unknown hold',p=>p.holds[0].state='unknown','PRIVACY_HOLD_NOT_CLEAR']
 ])test(name+' authority refuses before inventory reads',async()=>{const f=fixture(change);await assert.rejects(f.preview()(target),e=>e.code===code);assert.equal(f.counts().inventoryReads,0);});
test('different signing key cannot attest authority',async()=>{const f=fixture(),other=crypto.generateKeyPairSync('ed25519');f.config.publicKey=other.publicKey.export({type:'spki',format:'pem'});await assert.rejects(f.preview()(target),e=>e.code==='PRIVACY_AUTHORITY_UNTRUSTED');});
test('same payload cannot self-assert journal/hold freshness or change trust configuration',async()=>{for(const field of ['journalComplete','holds','throughSequence','publicKey','authorityId']){
 const f=fixture();await assert.rejects(f.preview()({...target,[field]:true}),e=>e.code==='PRIVACY_TARGET_REQUIRED');assert.equal(f.counts().authorityReads,0);
}});
test('changed authority after inventory prevents returning the stale preview',async()=>{const f=fixture((p,c)=>{if(c.authorityReads===2)p.revision=2;});await assert.rejects(f.preview()(target));});
test('same revision with conflicting journal contents refuses',async()=>{const f=fixture((p,c)=>{if(c.authorityReads===2)p.journal[0].decisionRef='fixture-changed';});await assert.rejects(f.preview()(target),e=>e.code==='PRIVACY_AUTHORITY_CHANGED');});
test('signed snapshot replay cannot answer a second challenge',async()=>{const f=fixture(),original=f.config.readAuthority;let saved;f.config.readAuthority=async x=>saved||(saved=await original(x));await assert.rejects(f.preview()(target),e=>e.code==='PRIVACY_AUTHORITY_UNTRUSTED');});
for(const [name,change]of [
 ['tenant mismatch',r=>r.records[0].businessId++],['subject mismatch',r=>r.records[0].callerId++],['wrong identity',r=>r.identity.exact=false],
 ['duplicate record',r=>r.records.push({...r.records[0]})],['unknown surface',r=>r.coveredSurfaces.push('made-up')],['negative foreign count',r=>r.foreignTenantCount=-1]
 ])test(name+' inventory refuses',async()=>{const f=fixture();change(f.inventory);await assert.rejects(f.preview()(target));});
test('actual schema and all four stores required; missing adapters cannot be hidden',()=>{
 const fs=require('node:fs'),path=require('node:path'),list=requiredSurfaces(fs.readFileSync(path.join(__dirname,'../prisma/schema.prisma'),'utf8'));
 assert.equal(list.length,40);assert.equal(list.filter(s=>s.startsWith('database:')).length,36);assert.equal(list.filter(s=>s.startsWith('file:')).length,4);
});
test('invented-policy preview never clears full/live privacy or recovery gates',async()=>{
 const r=await fixture().preview()(target),p=require('../scripts/launch-evidence');for(const name of ['privacyApplicationPassed','logicalRestorePassed','fullRecoveryPassed'])assert.equal(p[name](r,'8f218834361f5ec22de23c5cedd6690897d40f99'),false);
});
module.exports={fixture};
