'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {policy,valid,TESTS,SOURCES,run,tapSummary}=require('../scripts/run-combined-pilot-repair-ci');
const {SQL_CASES}=require('../scripts/compose-bounded-mapping-entry');
const {REQUIRED_CASES}=require('../scripts/compose-bounded-mapping-integration');
const head='a'.repeat(40),expected=policy(head);
test('actual TAP result parsing is callable and preserves failure and skip counts',()=>{
  assert.deepEqual(tapSummary('# tests 3\n# pass 1\n# fail 1\n# cancelled 0\n# skipped 1\n'),{tests:3,pass:1,fail:1,cancelled:0,skipped:1});
  assert.ok(Number.isNaN(tapSummary('').tests));
});
function fixture(phase){return {schemaVersion:1,...structuredClone(expected),phase,passed:true,scope:'synthetic-actual-combined-runtime',actualPublishedRuntime:true,
  ready:false,applyAllowed:false,providerMode:'synthetic-no-send',productionActions:0,osSandboxProven:false,testFiles:TESTS[phase],
  tap:{tests:phase==='entry'?41:phase==='reader'?20:150,pass:phase==='entry'?41:phase==='reader'?20:150,fail:0,skipped:0,cancelled:0},
  sql:phase==='focused'?null:phase==='entry'?{sqlMode:'real-postgresql',providerMode:'synthetic-no-send',disposableDatabaseRemoved:true,outcomes:SQL_CASES.map(id=>({id,status:'passed'}))}
    :{schemaVersion:1,ready:true,sqlMode:'real-postgresql',providerMode:'synthetic-no-send',disposableDatabaseRemoved:true,cases:REQUIRED_CASES.map(name=>({name,status:'passed'}))}};}
test('actual runtime and corrected safety bytes are pinned separately from historical composition',()=>{
  assert.equal(SOURCES.length,new Set(SOURCES).size);assert.ok(SOURCES.includes('server/index.js'));
  assert.ok(SOURCES.includes('server/signupAssociationRepair.js'));assert.ok(SOURCES.includes('server/boundedBusinessMappingWriter.js'));
  assert.throws(()=>policy('main'),/HEAD_REQUIRED/);
  assert.throws(()=>policy(head,p=>p==='server/boundedBusinessMappingWriter.js'?Buffer.from('uncorrected'):require('node:fs').readFileSync(require('node:path').resolve(__dirname,'..',p))),/RUNTIME_BYTES_CHANGED/);
});
test('index pin describes canonical committed bytes and refuses CRLF-transformed evidence',()=>{
  const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
  const r=spawnSync('git',['show','HEAD:server/index.js'],{cwd:path.resolve(__dirname,'..'),shell:false});
  assert.equal(r.status,0);const read=p=>p==='server/index.js'?r.stdout:fs.readFileSync(path.resolve(__dirname,'..',p));
  assert.doesNotThrow(()=>policy(head,read));
  assert.throws(()=>policy(head,p=>p==='server/index.js'?Buffer.from(r.stdout.toString().replace(/\n/g,'\r\n')):read(p)),/RUNTIME_BYTES_CHANGED/);
});
test('independently bound head and source digests are required for every phase',()=>{
  for(const phase of ['entry','reader','focused']){
    assert.equal(valid(fixture(phase),expected,phase),true);
    for(const mutate of [r=>r.head='b'.repeat(40),r=>delete r.sourceSha256[SOURCES[0]],r=>r.sourceSha256[SOURCES[0]]='0'.repeat(64),r=>r.testFiles=[],r=>r.actualPublishedRuntime=false]){
      const r=fixture(phase);mutate(r);assert.equal(valid(r,expected,phase),false);
    }
  }
});
test('failed skipped empty partial or overclaimed evidence never passes',()=>{
  for(const phase of ['entry','reader','focused'])for(const mutate of [r=>r.passed=false,r=>r.ready=true,r=>r.applyAllowed=true,r=>r.productionActions=1,
    r=>r.providerMode='live',r=>r.tap.skipped=1,r=>r.tap.fail=1,r=>r.tap.tests=0,r=>r.tap.pass--,r=>r.tap.cancelled=1]){
    const r=fixture(phase);mutate(r);assert.equal(valid(r,expected,phase),false);
  }
});
test('SQL phases reject subset duplicate cases and absent owned-database cleanup',()=>{
  for(const phase of ['entry','reader'])for(const mutate of [r=>r.sql.disposableDatabaseRemoved=false,r=>r.sql.sqlMode='synthetic',
    r=>(r.sql.outcomes||r.sql.cases).pop(),r=>{const xs=r.sql.outcomes||r.sql.cases;xs[1]=xs[0];},r=>r.sql=null]){
    const r=fixture(phase);mutate(r);assert.equal(valid(r,expected,phase),false);
  }
});
test('no local ambient database or arbitrary phase is admitted',()=>{
  assert.throws(()=>run('provider'),/DISPOSABLE_CI_REQUIRED/);
  if(process.platform!=='linux'||process.env.GITHUB_ACTIONS!=='true')assert.throws(()=>run('entry'),/DISPOSABLE_CI_REQUIRED/);
});
