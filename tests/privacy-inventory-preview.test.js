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
function readerFixture(t,{failAfterFirstFile=false}={}){
 const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{NAMES}=require('../server/recoveryFileStore');
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-privacy-reader-'));
 t.after(()=>{
  const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.match(path.basename(resolved),/^myaipa-privacy-reader-/);
  for(const name of fs.readdirSync(resolved)){assert.ok(NAMES.includes(name));assert.equal(fs.lstatSync(path.join(resolved,name)).isFile(),true);fs.unlinkSync(path.join(resolved,name));}
  fs.rmdirSync(resolved);assert.equal(fs.existsSync(directory),false);
 });
 for(const [i,n]of NAMES.entries()){fs.writeFileSync(path.join(directory,n),'{}');if(failAfterFirstFile&&i===0)throw Error('FIXTURE_SETUP_EXPECTED_FAILURE');}
 const state={calls:[{id:1,...target}],foreign:[],changeFile:false},commands=[];
 const tx={business:{findUnique:async()=>({id:target.businessId})},caller:{findUnique:async()=>({id:target.callerId,phone:'+15555550100'})},
  call:{findMany:async({where})=>typeof where.businessId==='object'?state.foreign:state.calls},lead:{findMany:async()=>[]},smsSuppression:{findUnique:async()=>null},
  $executeRawUnsafe:async sql=>{commands.push(sql);assert.equal(sql,'SET TRANSACTION READ ONLY');}};
 const prisma={$transaction:async(work,options)=>{assert.equal(options.isolationLevel,'RepeatableRead');const result=await work(tx);if(state.changeFile)fs.writeFileSync(path.join(directory,NAMES[0]),'{"changed":true}');return result;}};
 const read=require('../server/privacyInventoryReader').createReadOnlyInventoryReader({prisma,directory});return {read,state,commands,directory};
}
test('actual reader uses read-only repeatable-read and retains explicit missing file adapters',async t=>{const f=readerFixture(t),r=await f.read(target);assert.deepEqual(f.commands,['SET TRANSACTION READ ONLY']);assert.equal(r.coveredSurfaces.length,4);assert.ok(!r.coveredSurfaces.some(x=>x.startsWith('file:')));});
test('actual reader rejects empty identity binding and truncated inventories',async t=>{for(const rows of [[],Array.from({length:1001},(_,i)=>({id:i,...target}))]){const f=readerFixture(t);f.state.calls=rows;await assert.rejects(f.read(target),e=>['PRIVACY_TARGET_NOT_OWNED','PRIVACY_INVENTORY_TRUNCATED'].includes(e.code));}});
test('actual reader refuses changed file values across SQL snapshot',async t=>{const f=readerFixture(t);f.state.changeFile=true;await assert.rejects(f.read(target),e=>e.code==='PRIVACY_FILE_SNAPSHOT_CHANGED');});
test('unit fixture cleanup runs after partial setup and body failures',()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const inventory=()=>fs.readdirSync(os.tmpdir()).filter(n=>n.startsWith('myaipa-privacy-reader-')).sort(),before=inventory();
 for(const partial of [true,false]){const callbacks=[];try{assert.throws(()=>{readerFixture({after:fn=>callbacks.push(fn)},{failAfterFirstFile:partial});throw Error('FIXTURE_BODY_EXPECTED_FAILURE');},/FIXTURE_(SETUP|BODY)_EXPECTED_FAILURE/);}finally{for(const cleanup of callbacks)cleanup();}}
 assert.deepEqual(inventory(),before);
});
