const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {verifyHttp,BASE_HEAD}=require('../scripts/restored-http-fixture');
function proof(){return {scope:'restored-disposable-http-read-only',passed:true,realSql:true,sourceDependency:BASE_HEAD,
 success:{authenticatedTenants:2,receiptDelivered:true,suppressionPreserved:true,authRefusals:4,databaseMutationAttempts:0,fileMutationAttempts:0},
 refusal:{forcedReadFailure:true,databaseMutationAttempts:0,fileMutationAttempts:1,fileWritesPrevented:true},
 databaseFingerprintsUnchanged:true,filesUnchanged:true,roleRemoved:true,providerCallsOrMessages:0,liveRecoveryProven:false,osSandboxProven:false,allPathsNaturallyReadOnly:false};}
test('complete bounded HTTP evidence accepted but every missing/changed claim refused',()=>{
 assert.equal(verifyHttp(proof()),true);
 for(const key of Object.keys(proof())){const p=proof();delete p[key];assert.ok(!verifyHttp(p),key);}
 for(const section of ['success','refusal'])for(const key of Object.keys(proof()[section])){
  const p=proof();delete p[section][key];assert.ok(!verifyHttp(p),section+'.'+key);
 }
 for(const [section,key,value] of [['success','authenticatedTenants',1],['success','fileMutationAttempts',1],['success','databaseMutationAttempts',1],['refusal','fileMutationAttempts',0],['refusal','fileWritesPrevented',false]]){
  const p=proof();p[section][key]=value;assert.ok(!verifyHttp(p));
 }
});
test('partial restored HTTP evidence cannot clear live or full recovery predicates',()=>{
 const gates=require('../scripts/launch-evidence');assert.equal(gates.logicalRestorePassed(proof(),BASE_HEAD),false);assert.equal(gates.fullRecoveryPassed(proof(),BASE_HEAD),false);
});
test('canonical pinned dependencies are exact; corruption refused',()=>{
 const pins=require('../scripts/restored-http-pins.json'),sha=require('../scripts/composite-recovery-fixture').sha;
 assert.equal(pins.reviewedHead,BASE_HEAD);assert.equal(Object.keys(pins.sha256).length,6);
 // Windows checkout conversion is not canonical-byte proof; Linux CI checks raw bytes.
 for(const [file,hash]of Object.entries(pins.sha256))assert.equal(sha(fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n')),hash,file);
});
test('sealed workflow uses disposable PG18 and publishes only result summaries',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../.github/workflows/restored-http.yml'),'utf8');
 assert.match(source,/image: postgres:18/);assert.match(source,/node-version: '24.22.3'/);assert.match(source,/persist-credentials: false/);
 assert.match(source,/run-restored-http-ci.js --verify-evidence/);assert.match(source,/expected-abort.json/);
 assert.ok(!source.includes('secrets.'));assert.ok(!source.includes('continue-on-error'));
});
test('worker is fixed read-only HTTP with native role ACLs and async filesystem detection',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../scripts/restored-http-worker.js'),'utf8');
 for(const term of ['has_table_privilege','NOSUPERUSER','fs.promises','createWriteStream','HTTP_DATABASE_WRITE_REFUSED']){
  if(term==='NOSUPERUSER')assert.ok(fs.readFileSync(path.join(__dirname,'../scripts/restored-http-fixture.js'),'utf8').includes(term));else assert.ok(source.includes(term));
 }
 assert.ok(!source.includes('startServer('));assert.ok(!source.includes('/api/webhooks/'));assert.ok(!source.includes('/api/internal/'));
});
