const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ci=require('../scripts/run-pilot-safety-sql');
function fixture(){const p=ci.policy('a'.repeat(40));return{p,r:{...p,scope:'synthetic-actual-http-postgresql-pilot-safety',passed:true,checks:ci.CHECKS.map(name=>({name,passed:true})),realPostgres:true,actualHttp:true,realProviderActions:0,livePilotProven:false,osSandboxProven:false,cleanup:{databaseRemoved:true,filesRemoved:true,workersStopped:true,unrelatedDatabasesUnchanged:true}}};}
test('only complete exact-source SQL evidence can satisfy the scoped consumer',()=>{const {p,r}=fixture();assert.equal(ci.verify(r,p),true);
 for(const key of Object.keys(r)){const v=structuredClone(r);delete v[key];assert.equal(ci.verify(v,p),false,key);}
 for(const c of ci.CHECKS){const v=structuredClone(r);v.checks=v.checks.filter(x=>x.name!==c);assert.equal(ci.verify(v,p),false);}
 for(const f of ci.SOURCES){const v=structuredClone(r);v.sourceSha256[f]='0'.repeat(64);assert.equal(ci.verify(v,p),false);}
 for(const k of Object.keys(r.cleanup)){const v=structuredClone(r);v.cleanup[k]=false;assert.equal(ci.verify(v,p),false);}
});
test('expected abort is failure with no HTTP claim; never promotes to successful SQL proof',()=>{const {p,r}=fixture(),a={...r,passed:false,actualHttp:false,failureCode:'PILOT_SQL_EXPECTED_ABORT',checks:r.checks.slice(0,1)};assert.equal(ci.verify(a,p,true),true);assert.equal(ci.verify(a,p),false);assert.equal(ci.verify({...a,actualHttp:true},p,true),false);});
test('synthetic proof cannot establish production pilot/privacy/recovery and arbitrary DB configurations are refused',()=>{const {p,r}=fixture();for(const n of ['privacyApplicationPassed','logicalRestorePassed','fullRecoveryPassed'])assert.equal(require('../scripts/launch-evidence')[n](r,p.head),false);assert.throws(()=>ci.validate({}),/CI_CONTEXT/);
 const s=fs.readFileSync(path.join(__dirname,'../scripts/run-pilot-safety-sql.js'),'utf8');assert.ok(s.includes('PILOT_SQL_FOREIGN_CONFIGURATION'));assert.ok(!s.includes('loadProjectEnv'));});
test('dedicated workflow keeps exact-head tests and PG18 fixture, no deploy or secrets',()=>{const s=fs.readFileSync(path.join(__dirname,'../.github/workflows/pilot-safety.yml'),'utf8');for(const text of ['postgres:18',"node-version: '24.22.3'",'persist-credentials: false','--verify --aborted'])assert.ok(s.includes(text));for(const text of ['secrets.','continue-on-error','deploy:pages'])assert.ok(!s.includes(text));});
