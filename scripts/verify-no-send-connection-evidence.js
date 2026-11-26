'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const REQUIRED_SQL_CASES=31;
const SOURCE_FILES=['server/index.js','server/signupConnectionControl.js','server/signupConnectionEvidence.js','server/signupConnectionTransport.js',
 'server/signupConnectionPreparation.js','server/signupAssociationRepair.js','server/provisioningState.js','server/vapiTwilioImportRequest.js',
 'server/trialUsagePolicy.js','prisma/schema.prisma','tests/helpers/signup-connection-fixture.js','tests/signup-connection-postgres.test.js',
 'tests/signup-connection-control.test.js','.github/workflows/signup-no-send-connection.yml',
 'scripts/verify-no-send-connection-evidence.js','tests/signup-connection-artifact.test.js',
 'server/signupPendingConnection.js','server/vapiPhoneImportVerification.js','tests/signup-recovery-ordering.test.js',
 'server/signupAgentTesting.js','server/smsDispatchReadiness.js','server/adminSignupSetup.js','server/incidentAlerts.js',
 'server/operationalErrorClassifier.js','server/automaticAssistantConnectionPlan.js','tests/signup-notification-readiness-regression.test.js'];
const CRITICAL=['actual HTTP signed session expires during SQL lock wait: zero import',
 'lost provider acknowledgement leaves durable uncertainty across restart even with absent receipt/resource',
 'two independent control instances with prepared plans cannot dispatch twice',
 'file changed then SQL failure is uncertain; no reset, rollback replay or retry',
 'association stage updates only three SQL/file references and preserves failures and history',
 'pending setup stages via actual HTTP without trial or record promotion',
 'pending gate secret changed during SQL lock wait refuses actual dispatch',
 'pending import uncertainty survives missing receipt, restart and direct-mode switch'];
function validate(report,{expectedHead,sourceHashes}){
 const fail=()=>{throw Error('Exact-head complete synthetic SQL evidence required; no live readiness granted');};
 if(!/^[a-f0-9]{40}$/.test(expectedHead||'')||report?.head!==expectedHead||report.scope!=='synthetic-no-send-connection-only'
  ||report.passed!==true||report.skips!==0||!/^18\./.test(report.postgresVersion||'')||report.providerNetworkRequests!==0
  ||report.realMessages!==0||report.productionUsed!==false||report.liveReadinessProven!==false||report.cleanup?.fixtures!==REQUIRED_SQL_CASES||report.cleanup?.failures!==0
  ||!Array.isArray(report.cases)||report.cases.length!==REQUIRED_SQL_CASES||report.cases.some(c=>c.passed!==true||typeof c.name!=='string')
  ||new Set(report.cases.map(c=>c.name)).size!==REQUIRED_SQL_CASES||CRITICAL.some(name=>!report.cases.some(c=>c.name===name)))fail();
 if(!report.sourceFiles||Object.keys(report.sourceFiles).length!==SOURCE_FILES.length||SOURCE_FILES.some(f=>!sourceHashes?.[f]
  ||report.sourceFiles[f]!==sourceHashes[f]||!/^[a-f0-9]{64}$/.test(report.sourceFiles[f])))fail();
 return {accepted:true,head:expectedHead,sqlCases:REQUIRED_SQL_CASES,cleanupVerified:true,scope:report.scope,liveReadinessProven:false};
}
if(require.main===module){
 try{
  if(process.argv.length!==3)throw Error('One artifact path required');
  console.log(JSON.stringify(validate(JSON.parse(fs.readFileSync(process.argv[2],'utf8')),{expectedHead:process.env.CONNECTION_EXPECTED_HEAD,
   sourceHashes:Object.fromEntries(SOURCE_FILES.map(f=>[f,crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')]))})));
 }catch{console.error('No-send SQL artifact missing, incomplete, mismatched or overclaimed.');process.exitCode=1;}
}
module.exports={validate,SOURCE_FILES,CRITICAL,REQUIRED_SQL_CASES};
