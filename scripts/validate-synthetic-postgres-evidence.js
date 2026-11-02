const crypto=require('node:crypto');
const {timestamp, UUID, COMMIT, SHA} = require('./recovery-metadata');
function validateSyntheticPostgres(value,{now=Date.now(),expectedSourceFiles,releaseCommit}={}){
  const fail=code=>{throw Error(code);};
  if(value?.scope!=='real-app-real-postgres-synthetic-only'||value.passed!==true||value.postgresVersion!=='18.6'||value.clusterIdentityVerified!==true||value.privateDataCleaned!==true||value.productionDataUsed!==false||value.productionRequests!==0||value.providerCallsOrTexts!==0||value.workersActivated!==false)fail('REAL_POSTGRES_SYNTHETIC_PROOF_REQUIRED');
  if(typeof value.executionId!=='string'||!UUID.test(value.executionId)||typeof releaseCommit!=='string'||!COMMIT.test(releaseCommit)||value.releaseCommit!==releaseCommit)fail('EXACT_RELEASE_EXECUTION_REQUIRED');
  const app=value.application,recovery=value.syntheticRecovery;
  if(!app||['authenticationRequired','tenantAndAssistantScopeEnforced','concurrentDuplicateCommitOnce','correctionAndReplay','databaseRestart','outboxPending'].some(key=>app[key]!==true)||app.appRestarts!==2||app.leads!==1||app.outboxItems!==1||app.providerTransportDenials!==6)fail('APPLICATION_PERSISTENCE_CHECKS_INCOMPLETE');
  if(!recovery||['databaseAndFilesMatched','keyRecoveredFromSeparateFixtureVault','keyVersionBound','allApplicationWritersStopped'].some(key=>recovery[key]!==true)||recovery.filesVerified!==4||!Number.isFinite(recovery.restoreElapsedMs)||recovery.restoreElapsedMs<=0)fail('SYNTHETIC_COMPOSITE_RESTORE_INCOMPLETE');
  if(recovery.productionFenceImplemented!==false||recovery.privacyReplayProven!==false||recovery.productionRecoveryObjectivesProven!==false||value.osNetworkBoundaryProven!==false)fail('SYNTHETIC_SCOPE_OVERCLAIM');
  const times=[value.startedAt,recovery.recoveryPointAt,value.completedAt];
  if(times.some(at=>!timestamp(at)))fail('CAPTURE_TIMELINE_INVALID');const[start,capture,end]=times.map(Date.parse);
  if(!(start<=capture&&capture<=end&&end<=now+5000&&now-end<=24*3600000))fail('CAPTURE_TIMELINE_INVALID');
  const required=['server/index.js','server/stagingIntake.js','server/intakeLedger.js','prisma/schema.prisma','scripts/run-real-postgres-recovery-stage.js','tests/helpers/real-postgres-isolation-worker.js'];
  if(!expectedSourceFiles||required.some(name=>typeof value.sourceFiles?.[name]!=='string'||!SHA.test(value.sourceFiles[name])||typeof expectedSourceFiles[name]!=='string'||!SHA.test(expectedSourceFiles[name])||expectedSourceFiles[name]!==value.sourceFiles[name])||Object.keys(value.sourceFiles||{}).some(name=>!required.includes(name)))fail('EXERCISED_SOURCE_BINDING_MISSING');
  return{accepted:true,executionId:value.executionId,releaseCommit,scope:value.scope,testedAt:new Date(end).toISOString(),recoveryPointAt:new Date(capture).toISOString(),realPostgresExercised:true,privateDataCleaned:true,productionRecoveryObjectivesProven:false,productionFenceImplemented:false,privacyReplayProven:false,osNetworkBoundaryProven:false};
}
function main(args=process.argv.slice(2),{metadataIO=require('./recovery-metadata-io').createMetadataIO(),now=Date.now()}={}){
  const get=name=>args.filter(v=>v.startsWith('--'+name+'='));
  if(args.some(v=>!/^--(input|context|out)=.+$/.test(v))||['input','context','out'].some(n=>get(n).length!==1))throw Error('EXPLICIT_REVIEWED_CONTEXT_REQUIRED');
  const plan=metadataIO.prepare({input:{path:get('input')[0].slice(8),kind:'input'},context:{path:get('context')[0].slice(10),kind:'input'},out:{path:get('out')[0].slice(6),kind:'output-file'}});
  const report=metadataIO.readJson(plan,'input'),context=metadataIO.readJson(plan,'context').value;
  const result=validateSyntheticPostgres(report.value,{now,expectedSourceFiles:context.sourceFiles,releaseCommit:context.releaseCommit});
  result.sourceReportSha256=crypto.createHash('sha256').update(report.bytes).digest('hex');
  metadataIO.writeJson(plan,'out',result);console.log(JSON.stringify(result));return result;
}
module.exports={validateSyntheticPostgres,main};
if(require.main===module){try{main();}catch{console.error('Synthetic evidence requires fresh exact-source reviewed metadata; no production proof is granted.');process.exitCode=1;}}
