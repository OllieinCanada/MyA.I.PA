'use strict';
const fs=require('node:fs'),crypto=require('node:crypto');
const SOURCE_FILES=Object.freeze(['server/index.js','server/provisioningPreflightDiagnostic.js','server/signupProvisioning.js','server/signupProvisioningContext.js','scripts/prepare-provider-disabled-make-diagnostic.js','scripts/verify-provider-disabled-diagnostic-evidence.js','tests/provisioning-preflight-diagnostic-postgres.test.js','tests/helpers/provisioning-error-route-fixture.js','.github/workflows/provider-disabled-diagnostic.yml']);
const REQUIRED_CASES=Object.freeze(['read-only SQL preserves unrelated fixture','SQL refuses and rolls back an injected write','synthetic key conflict refuses without mutation','nonblocking lock conflict and release','SQL timeout retains P2028 checkpoint','invalid auth never reaches SQL','real HTTP empty multipart','real HTTP marker multipart']);
function sourceHashes(){return Object.fromEntries(SOURCE_FILES.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));}
function validate(value,{expectedHead,expectedSources}={}){
 if(!/^[a-f0-9]{40}$/.test(expectedHead||'')||value?.head!==expectedHead)throw Error('EXACT_HEAD_REQUIRED');
 if(value.scope!=='provider-disabled-diagnostic-disposable-sql-only'||value.passed!==true||value.skips!==0||!/^18\./.test(value.postgresVersion||''))throw Error('REAL_SQL_PROOF_REQUIRED');
 if(value.productionUsed!==false||value.providerRequests!==0||value.forbiddenTransportAttempts!==0||value.messages!==0||value.originalHistoricalCauseProven!==false||value.makeEngineVerified!==false||value.osSandboxProven!==false)throw Error('SCOPE_OVERCLAIM_OR_TRANSPORT');
 if(value.cleanup?.ownedRowsRemaining!==0||value.cleanup?.connectionsClosed!==true||value.cleanup?.httpServerClosed!==true||value.cleanup?.complete!==true)throw Error('CLEANUP_REQUIRED');
 if(!Array.isArray(value.cases)||value.cases.length!==REQUIRED_CASES.length||new Set(value.cases.map(c=>c.name)).size!==REQUIRED_CASES.length||REQUIRED_CASES.some(name=>!value.cases.some(c=>c.name===name&&c.passed===true)))throw Error('REQUIRED_CASE_MISSING');
 if(!expectedSources||Object.keys(value.sourceFiles||{}).length!==SOURCE_FILES.length||SOURCE_FILES.some(p=>!/^[a-f0-9]{64}$/.test(expectedSources[p]||'')||value.sourceFiles[p]!==expectedSources[p]))throw Error('SOURCE_PROOF_MISMATCH');
 return {accepted:true,scope:value.scope,head:expectedHead,sqlCases:REQUIRED_CASES.length,makeEngineVerified:false,originalHistoricalCauseProven:false};
}
module.exports={SOURCE_FILES,REQUIRED_CASES,sourceHashes,validate};
if(require.main===module){try{if(process.argv.length!==3)throw Error('ONE_ARTIFACT_REQUIRED');const report=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(validate(report,{expectedHead:process.env.DIAGNOSTIC_EXPECTED_HEAD,expectedSources:sourceHashes()})));}catch(e){console.error(String(e.message));process.exitCode=1;}}
