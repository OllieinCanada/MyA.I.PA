const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {validateEnvironment,ownedDatabase,safeCode,verifyReport,REQUIRED_CHECKS}=require('../scripts/run-synthetic-backup-ci');
const env=()=>({GITHUB_ACTIONS:'true',CI:'true',RUN_SYNTHETIC_BACKUP_RESTORE:'1',SYNTHETIC_BACKUP_TEST_PASSWORD:'synthetic-ci-only',SYNTHETIC_BACKUP_HEAD:'a'.repeat(40)});
test('driver accepts only the exact synthetic CI service and independently bound head',()=>{
  assert.equal(validateEnvironment(env(),'linux').host,'postgres');
  for(const change of [{CI:'false'},{GITHUB_ACTIONS:'false'},{RUN_SYNTHETIC_BACKUP_RESTORE:''},{SYNTHETIC_BACKUP_TEST_PASSWORD:'other'},{SYNTHETIC_BACKUP_HEAD:''}])assert.throws(()=>validateEnvironment({...env(),...change},'linux'));
  assert.throws(()=>validateEnvironment(env(),'win32'),/CI_ONLY/);
});
test('foreign database archive key provider and injected runtime configuration refuse',()=>{
  for(const name of ['DATABASE_URL','RESTORE_BACKUP_PATH','RESTORE_DATABASE_URL','BACKUP_ENCRYPTION_KEY','PGHOST','PGSERVICE','PGPASSFILE','PGOPTIONS','NODE_OPTIONS','OPERATIONS_ENV_FILE','VAPI_API_KEY','TWILIO_AUTH_TOKEN','SMTP_HOST','RENDER_API_KEY'])assert.throws(()=>validateEnvironment({...env(),[name]:'SYNTHETIC_DO_NOT_ECHO'},'linux'),e=>e.code==='SYNTHETIC_BACKUP_FOREIGN_CONFIGURATION'&&!e.message.includes('SYNTHETIC_DO_NOT_ECHO'));
});
test('cleanup requires both execution membership and bounded database identity',()=>{
  const name='myaipa_restore_drill_'+'a'.repeat(12);assert.equal(ownedDatabase(name,new Set([name])),true);
  for(const other of ['postgres','template1','myaipa_backup_control_ci',name+'bad','foreign',undefined])assert.equal(ownedDatabase(other,new Set([other])),false);
  assert.equal(ownedDatabase(name,new Set()),false);
});
test('unexpected errors do not expose database credentials or backup data',()=>{
  assert.equal(safeCode(Error('SYNTHETIC_DO_NOT_ECHO')),'SYNTHETIC_BACKUP_CHECK_FAILED');
  assert.equal(safeCode({code:'23503',message:'SYNTHETIC_DO_NOT_ECHO'}),'SYNTHETIC_BACKUP_CHECK_FAILED');
});
test('dedicated CI uses PG18 client and service with no production secrets or archive upload',()=>{
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/synthetic-backup-restore.yml'),'utf8');
  assert.equal((workflow.match(/image: postgres:18/g)||[]).length,2);assert.match(workflow,/node-version: '24\.22\.3'/);
  assert.match(workflow,/persist-credentials: false/);assert.match(workflow,/if: always\(\)/);assert.match(workflow,/if-no-files-found: error/);
  assert.match(workflow,/diagnostics\/synthetic-backup-ci\/result\.json/);assert.match(workflow,/expected-abort\.json/);assert.doesNotMatch(workflow,/secrets\.|DATABASE_URL|BACKUP_ENCRYPTION_KEY|\.dump|\.enc/);
});
test('evidence consumption refuses partial skipped or wrong-head proof and live recovery claims',()=>{
  const r={schemaVersion:1,releaseCommit:'a'.repeat(40),scope:'two-table-synthetic-encrypted-postgres18-restore',passed:true,
    generatedFixtureArchive:true,ownedDatabaseCount:3,cleanup:{databasesRemoved:true,filesRemoved:true,unrelatedDatabasesUnchanged:true},
    productionDataUsed:false,productionRequests:0,providerCallsOrMessages:0,applicationWorkersStarted:false,
    checks:REQUIRED_CHECKS.map(name=>({name,passed:true}))};
  for(const k of ['completeRecoveryProven','fullApplicationSchemaProven','fileStoreRecoveryProven','privacyReplayProven','uncertainActionReconciliationProven','liveRpoRtoProven','osNetworkSandboxProven'])r[k]=false;
  assert.equal(verifyReport(r,r.releaseCommit),true);
  assert.equal(verifyReport(r,'b'.repeat(40)),false);assert.equal(verifyReport({...r,checks:r.checks.slice(1)},r.releaseCommit),false);
  assert.equal(verifyReport({...r,checks:[...r.checks.slice(1),r.checks[1]]},r.releaseCommit),false);
  assert.equal(verifyReport({...r,completeRecoveryProven:true},r.releaseCommit),false);
  assert.equal(verifyReport({...r,cleanup:{...r.cleanup,filesRemoved:false}},r.releaseCommit),false);
  const aborted={...r,passed:false,failureCode:'SYNTHETIC_BACKUP_INJECTED_ABORT',checks:[r.checks[0]]};
  assert.equal(verifyReport(aborted,r.releaseCommit,true),true);assert.equal(verifyReport(aborted,r.releaseCommit),false);
});
test('relay has one fixed service destination and never executes application code',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../scripts/synthetic-backup-loopback-relay.js'),'utf8');
  assert.match(source,/host:'postgres',port:5432/);assert.match(source,/listen\(0,'127\.0\.0\.1'/);
  assert.doesNotMatch(source,/process\.env|fetch\(|server\/index|eval\(/);
});
