const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const f=require('../scripts/composite-recovery-fixture'),pins=require('../scripts/composite-recovery-pins.json');
const {verifyPins}=require('../scripts/run-composite-recovery-ci');
const {NAMES}=require('../server/recoveryFileStore');
const root=path.join(__dirname,'..'),schema=fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8');
test('every actual model is inventoried and fixture hashes are order independent',()=>{
  assert.equal(f.expectedModels(schema).length,36);assert.equal(f.rowsHash([{a:1,b:2},{c:3}]),f.rowsHash([{c:3},{b:2,a:1}]));
  assert.notEqual(f.rowsHash([{a:1}]),f.rowsHash([{a:2}]));
});
test('reviewed dependency bytes cannot drift silently',()=>{
  assert.equal(pins.reviewedHead,'ed4007709d04e0c2c3ef028a6590520d9567c4d8');
  assert.throws(()=>verifyPins(()=>Buffer.from('changed')),/DEPENDENCY_BYTES_CHANGED/);
  assert.ok(Object.keys(pins.sha256).includes('prisma/schema.prisma'));assert.ok(Object.keys(pins.sha256).includes('package-lock.json'));
});
test('all required fake stores must match independently expected generation hash and key version',()=>{
  const expected=Object.fromEntries(NAMES.map(name=>[name,{generation:'fixture-g1',boundary:'fixture-b1',keyVersion:'fixture-v1',plainSha256:'a'.repeat(64)}]));
  const files=NAMES.map(name=>({name,...expected[name]}));assert.equal(f.validateFiles(files,expected),true);
  for(const change of [x=>x.pop(),x=>x[0]={...x[1]},x=>x[0].generation='older',x=>x[0].boundary='wrong',x=>x[0].keyVersion='v2',x=>x[0].plainSha256='b'.repeat(64)]){
    const rows=structuredClone(files);change(rows);assert.throws(()=>f.validateFiles(rows,expected),/COMPOSITE_FILE_/);
  }
});
test('generic seed traverses actual required relations and includes every model without provider functions',async()=>{
  const {Prisma}=require('@prisma/client'),meta=Prisma.dmmf.datamodel,seen=new Map(),client={};let id=0;
  for(const model of meta.models)client[model.name[0].toLowerCase()+model.name.slice(1)]={
    create:async({data})=>{const row={...data};for(const field of model.fields)if(field.isId&&row[field.name]===undefined)row[field.name]=field.type==='Int'?++id:'fixture-'+model.name;seen.set(model.name,row);return row;},
    update:async({data})=>Object.assign(seen.get(model.name),data),
  };
  const records=await f.seedEveryModel(client,meta,(model,text)=>'synthetic-encrypted-'+model+'-'+text);
  assert.equal(records.size,36);assert.equal(seen.get('Call').businessId,seen.get('Business').id);
  assert.equal(seen.get('Lead').callId,seen.get('Call').id);assert.equal(seen.get('WebhookReplayClaim').status,'COMPLETED');
  assert.equal(seen.get('LeadNotificationAttempt').status,'DELIVERED');assert.equal(seen.get('LeadNotificationAttempt').providerMessageId,'SM_SYNTHETIC_COMPOSITE');
});
function evidence(){
  const expected={head:'a'.repeat(40),schemaSha256:f.sha(schema),models:f.expectedModels(schema),dependencyHead:pins.reviewedHead,sourceSha256:{'fixture-source':'b'.repeat(64)}};
  const report={schemaVersion:1,scope:'actual-prisma-four-file-synthetic-recovery-only',head:expected.head,schemaSha256:expected.schemaSha256,
    dependencyHead:expected.dependencyHead,pinsVerified:true,sourceSha256:{...expected.sourceSha256},passed:true,
    checks:f.REQUIRED_CHECKS.map(name=>({name,passed:true})),modelInventory:[...expected.models],fileInventory:[...NAMES],modelsSeeded:36,
    ownedDatabaseCount:3,keyVersions:{...f.KEY_VERSIONS},cleanup:{databasesRemoved:true,filesRemoved:true,unrelatedDatabasesUnchanged:true,privateDirectoryInventoryRestored:true},productionDataUsed:false,
    providerCallsOrMessages:0,applicationWorkersStarted:false,liveRecoveryProven:false,productionWriterFenceProven:false,privacyReplayProven:false,
    uncertainReconciliationProven:false,osSandboxProven:false,unexercisedBehaviors:[...f.OMITTED_BEHAVIORS],
    modelRoundtrip:expected.models.map(model=>({model,rows:1,sourceSha256:'c'.repeat(64),targetSha256:'c'.repeat(64)})),
    fileRoundtrip:NAMES.map(name=>({name,verified:true,keyVersion:f.KEY_VERSIONS.backup}))};return {expected,report};
}
test('artifact consumer rejects partial skipped wrong-source proof and overclaims',()=>{
  const {expected,report}=evidence();assert.equal(f.verifyComposite(report,expected),true);
  for(const change of [r=>r.head='b'.repeat(40),r=>r.sourceSha256['fixture-source']='c'.repeat(64),r=>r.checks.pop(),r=>r.checks[0].passed=false,
    r=>r.checks[0]={...r.checks[1]},r=>r.modelRoundtrip.pop(),r=>r.modelRoundtrip[0].rows=0,r=>r.modelRoundtrip[0].targetSha256='d'.repeat(64),
    r=>r.fileRoundtrip.pop(),r=>r.fileInventory.pop(),r=>r.cleanup.filesRemoved=false,r=>r.privacyReplayProven=true,r=>r.liveRecoveryProven=true,
    r=>r.osSandboxProven=true,r=>r.productionWriterFenceProven=true,r=>r.unexercisedBehaviors=[],
    r=>r.keyVersions.backup='v2',r=>r.fileRoundtrip[0].keyVersion='v2',r=>r.cleanup.privateDirectoryInventoryRestored=false]){
    const r=structuredClone(report);change(r);assert.equal(f.verifyComposite(r,expected),false);
  }
  const aborted={...report,passed:false,failureCode:'COMPOSITE_EXPECTED_ABORT',checks:report.checks.slice(0,3)};
  assert.equal(f.verifyComposite(aborted,expected,true),true);assert.equal(f.verifyComposite(aborted,expected),false);
});
test('complete/live recovery predicates refuse composite synthetic evidence',()=>{
  const proof=require('../scripts/launch-evidence'),{expected,report}=evidence();
  assert.equal(proof.logicalRestorePassed(report,expected.head),false);assert.equal(proof.fullRecoveryPassed(report,expected.head),false);
});
test('workflow uploads only sanitized reports and does not alter existing runtime configuration',()=>{
  const source=fs.readFileSync(path.join(root,'.github/workflows/composite-recovery.yml'),'utf8');
  assert.equal((source.match(/image: postgres:18/g)||[]).length,2);assert.match(source,/node-version: '24\.22\.3'/);
  assert.match(source,/persist-credentials: false/);assert.match(source,/if: always\(\)/);assert.match(source,/--verify-evidence --aborted/);
  assert.doesNotMatch(source,/secrets\.|\.dump|\.enc|deploy|db:push/);
});
