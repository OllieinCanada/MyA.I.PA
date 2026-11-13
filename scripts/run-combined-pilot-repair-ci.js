'use strict';
// Exercise actual published bytes, not a reconstructed old draft tree.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..'),provenance=require('./combined-pilot-repair-provenance.json');
const {validCoverage}=require('./compose-bounded-mapping-entry');
const {validateSqlTarget,validateCoverage}=require('./compose-bounded-mapping-integration');
const {strictTap,REGRESSIONS}=require('./compose-expanded-release');
function tapSummary(text){
  const count=k=>Number(new RegExp('^# '+k+' (\\d+)$','m').exec(text)?.[1]??NaN);
  return Object.fromEntries(['tests','pass','fail','cancelled','skipped'].map(k=>[k,count(k)]));
}
const PHASES=['entry','reader','focused'];
const TESTS={entry:['tests/bounded-mapping-control.integration.cjs','tests/bounded-mapping-control-postgres.integration.cjs'],
  reader:['tests/bounded-business-mapping-integration.test.js'],
  focused:[...REGRESSIONS,'tests/signup-association-repair.test.js','tests/bounded-mapping-composition.test.js',
    'tests/bounded-mapping-entry-composition.test.js','tests/expanded-release-composition.test.js','tests/combined-pilot-repair-ci.test.js']};
const SOURCES=[...new Set([...Object.keys(provenance.runtimeSha256),...Object.values(TESTS).flat(),
  'server/leadHandoffs.js','server/vapiSms.js','server/vapiInventoryCoverage.js','scripts/recovery-notification-state.js',
  'scripts/audit-vapi-business-mappings.js','scripts/combined-pilot-repair-provenance.json','scripts/run-combined-pilot-repair-ci.js',
  'scripts/compose-bounded-mapping-entry.js','scripts/compose-bounded-mapping-integration.js','scripts/compose-expanded-release.js',
  'scripts/bounded-mapping-entry-pins.json','scripts/bounded-mapping-integration-pins.json','scripts/expanded-release-pins.json',
  'scripts/bounded-mapping-entry-index.patch','scripts/bounded-mapping-entry-safety.patch','tests/helpers/boundedMappingIntegrationFixture.js',
  'prisma/schema.prisma','package.json','package-lock.json','.github/workflows/bounded-mapping-entry.yml',
  '.github/workflows/bounded-mapping-integration.yml','.github/workflows/expanded-release.yml',
  '.github/workflows/quality.yml','.github/workflows/public-browser-quality.yml','.github/workflows/pilot-safety.yml'])];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function policy(head,read=p=>fs.readFileSync(path.join(ROOT,p))){
  if(!/^[a-f0-9]{40}$/.test(head||''))throw Error('COMBINED_HEAD_REQUIRED');
  const sourceSha256=Object.fromEntries(SOURCES.map(p=>[p,sha(read(p))]));
  for(const[p,h]of Object.entries(provenance.runtimeSha256))if(sourceSha256[p]!==h)throw Error('REVIEWED_RUNTIME_BYTES_CHANGED');
  return {head,sourceSha256};
}
function valid(r,e,phase){
  if(!PHASES.includes(phase)||r?.schemaVersion!==1||r.head!==e?.head||r.phase!==phase||r.passed!==true
    ||r.scope!=='synthetic-actual-combined-runtime'||r.actualPublishedRuntime!==true||r.ready!==false||r.applyAllowed!==false
    ||r.providerMode!=='synthetic-no-send'||r.productionActions!==0||r.osSandboxProven!==false
    ||!r.tap||r.tap.tests<=0||r.tap.tests!==r.tap.pass||r.tap.fail!==0||r.tap.skipped!==0||r.tap.cancelled!==0
    ||JSON.stringify(r.testFiles)!==JSON.stringify(TESTS[phase])||Object.keys(r.sourceSha256||{}).length!==SOURCES.length
    ||SOURCES.some(p=>r.sourceSha256[p]!==e.sourceSha256[p]))return false;
  if(phase==='entry')return r.tap.tests===41&&validCoverage(r.sql);
  if(phase==='reader')return r.tap.tests===20&&validateCoverage(r.sql)&&r.sql.disposableDatabaseRemoved===true;
  return r.sql===null;
}
function run(phase){
  if(!PHASES.includes(phase)||process.platform!=='linux'||process.versions.node!==provenance.node
    ||process.env.CI!=='true'||process.env.GITHUB_ACTIONS!=='true')throw Error('COMBINED_DISPOSABLE_CI_REQUIRED');
  if(['.env','.env.local'].some(p=>fs.existsSync(path.join(ROOT,p))))throw Error('COMBINED_LOCAL_ENV_REFUSED');
  const head=spawnSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8',shell:false});
  if(head.status!==0||head.stdout.trim()!==process.env.COMBINED_EXPECTED_HEAD)throw Error('COMBINED_HEAD_CHANGED');
  const expected=policy(process.env.COMBINED_EXPECTED_HEAD),out=path.join(ROOT,'diagnostics/combined-pilot-repair',phase);
  fs.mkdirSync(out,{recursive:true});
  const sqlFile=path.join(out,'sql.json'),report={schemaVersion:1,...expected,phase,passed:false,
    scope:'synthetic-actual-combined-runtime',actualPublishedRuntime:true,ready:false,applyAllowed:false,
    providerMode:'synthetic-no-send',productionActions:0,osSandboxProven:false,testFiles:TESTS[phase],tap:null,sql:null,
    limitations:['Generated data, mock transports, disposable SQL; no production correction or live call/delivery proof',
      'Single-writer/advisory/lifecycle coordination required; arbitrary noncooperating SQL writers are outside this contract']};
  try{
    const env=Object.fromEntries(['PATH','HOME','LANG','SystemRoot','TEMP','TMP','NODE_PATH'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
    Object.assign(env,{CI:'true',GITHUB_ACTIONS:'true',NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1'});
    // The focused writer suite also contains mandatory real-SQL restart and
    // rollback cases. Give it the same validated disposable service; never
    // classify its locally skipped SQL case as a clean full-gate pass.
    validateSqlTarget(process.env.DATABASE_URL,process.env);env.DATABASE_URL=process.env.DATABASE_URL;
    if(phase!=='focused'){
      if(phase==='entry')Object.assign(env,{RUN_BOUNDED_MAPPING_CONTROL_POSTGRES:'1',MAPPING_CONTROL_SQL_REPORT:sqlFile});
      else Object.assign(env,{RUN_BOUNDED_MAPPING_INTEGRATION:'1',MAPPING_INTEGRATION_REPORT:sqlFile});
    }
    const result=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-concurrency=1',...TESTS[phase]],
      {cwd:ROOT,env,encoding:'utf8',shell:false,windowsHide:true,timeout:240000,maxBuffer:32*1024*1024});
    report.tap=tapSummary(result.stdout||'');
    if(result.error||result.status!==0||!strictTap(result.stdout||'')){
      // Generated fixture diagnostics only, not provider state or ambient config.
      console.error(result.stdout||'Required test output missing');console.error(result.stderr||'');throw Error('COMBINED_REQUIRED_TEST_FAILED');
    }
    if(phase!=='focused')report.sql=JSON.parse(fs.readFileSync(sqlFile,'utf8'));
    report.passed=true;if(!valid(report,expected,phase)){report.passed=false;throw Error('COMBINED_PROOF_INCOMPLETE');}
    return report;
  }catch(error){report.passed=false;report.failureCode=/^[A-Z_]+$/.test(error.message)?error.message:'COMBINED_CHECK_FAILED';throw error;}
  finally{fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({phase,passed:report.passed,tap:report.tap,ready:false}));}
}
if(require.main===module){try{const phase=process.argv[2];
  if(process.argv[3]==='--verify'){
    if(!PHASES.includes(phase))throw Error('COMBINED_PHASE_INVALID');
    const r=JSON.parse(fs.readFileSync(path.join(ROOT,'diagnostics/combined-pilot-repair',phase,'result.json')));
    if(!valid(r,policy(process.env.COMBINED_EXPECTED_HEAD),phase))throw Error('COMBINED_EVIDENCE_REFUSED');
  }else run(phase);
}catch(e){console.error(/^[A-Z_]+$/.test(e.message)?e.message:'COMBINED_CHECK_FAILED');process.exitCode=1;}}
module.exports={policy,valid,PHASES,TESTS,SOURCES,run,tapSummary};
