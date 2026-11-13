const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ci=require('../scripts/run-privacy-inventory-ci');
function fixture(){const p=ci.expected('a'.repeat(40));return {p,r:{...p,scope:'synthetic-readonly-privacy-inventory-ci',passed:true,modelsFingerprinted:36,adapterModels:4,missingSurfaces:36,fileStores:4,ownedDatabases:2,
 checks:ci.CHECKS.map(name=>({name,passed:true})),cleanup:{databasesRemoved:true,roleRemoved:true,filesRemoved:true,unrelatedDatabasesUnchanged:true},productionDataUsed:false,providerCallsOrMessages:0,previewMutationQueries:0,
 workersStarted:false,authorityDatabaseIndependent:true,livePrivacyProven:false,liveRecoveryProven:false,productionAuthorityAdapterImplemented:false,osSandboxProven:false}};}
test('complete bounded CI contract is accepted, missing or corrupted proof refused',()=>{
 const {p,r}=fixture();assert.equal(ci.verifyReport(r,p),true);
 for(const key of Object.keys(r)){const v=structuredClone(r);delete v[key];assert.ok(!ci.verifyReport(v,p),key);}
 for(const name of ci.CHECKS){const v=structuredClone(r);v.checks=v.checks.filter(c=>c.name!==name);assert.equal(ci.verifyReport(v,p),false);}
 for(const file of Object.keys(p.sourceSha256)){const v=structuredClone(r);v.sourceSha256[file]='0'.repeat(64);assert.equal(ci.verifyReport(v,p),false);}
 for(const key of ['livePrivacyProven','liveRecoveryProven','productionAuthorityAdapterImplemented','osSandboxProven']){const v=structuredClone(r);v[key]=true;assert.equal(ci.verifyReport(v,p),false);}
});
test('partial SQL inventory proof never clears live privacy/recovery',()=>{
 const {p,r}=fixture(),g=require('../scripts/launch-evidence');for(const f of ['privacyApplicationPassed','logicalRestorePassed','fullRecoveryPassed'])assert.equal(g[f](r,p.head),false);
});
test('CI runner does not admit arbitrary database URLs or local invocation',()=>{
 assert.throws(()=>ci.validateEnvironment({}),/CI_CONTEXT/);
 const source=fs.readFileSync(path.join(__dirname,'../scripts/run-privacy-inventory-ci.js'),'utf8');assert.ok(source.includes('PRIVACY_FOREIGN_CONFIGURATION'));assert.ok(source.includes('NOSUPERUSER NOCREATEDB NOCREATEROLE'));assert.ok(!source.includes('require(\'../server/index\')'));
});
test('service workflow is exact-head PG18, no secrets, no deploy and summary-only',()=>{
 const s=fs.readFileSync(path.join(__dirname,'../.github/workflows/privacy-inventory.yml'),'utf8');for(const v of ['image: postgres:18',"node-version: '24.22.3'",'persist-credentials: false','--verify-evidence','diagnostics/privacy-inventory-ci/result.json'])assert.ok(s.includes(v));
 for(const v of ['secrets.','continue-on-error','deploy:pages'])assert.ok(!s.includes(v));
});
