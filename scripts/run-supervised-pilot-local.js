'use strict';
// One local no-provider baseline. No provider runner, deployment or writer imported.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const TESTS=['tests/supervised-pilot-checklist.test.js','tests/supervised-pilot-journey.test.js','tests/voice-route-api.test.js','tests/vapi-tool-admission-api.test.js','tests/vapi-tool-security.test.js',
 'tests/call-persistence.test.js','tests/call-notification-evidence.test.js','tests/controlled-voice-verification.test.js','tests/admin-owner-links-api.test.js',
 'tests/admin-security.test.js','tests/recovery-file-store.test.js','tests/recovery-file-key.test.js','tests/incident-alerts.test.js','tests/vapi-sms.test.js','tests/lead-handoffs.test.js'];
function summary(text){const count=k=>Number(new RegExp('^# '+k+' (\\d+)$','m').exec(text)?.[1]??NaN);return Object.fromEntries(['tests','pass','fail','skipped','cancelled'].map(k=>[k,count(k)]));}
function run(){
 if(process.versions.node!=='24.22.3')throw Error('Use approved Node 24.22.3');
 const env=Object.fromEntries(['PATH','SystemRoot','WINDIR','TEMP','TMP','NODE_PATH'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
 // Existing cleanup contracts compare native Windows paths literally. Preserve
 // the same directory, normalizing separators rather than weakening assertions.
 for(const key of ['TEMP','TMP'])if(env[key])env[key]=path.resolve(env[key]);
 Object.assign(env,{NODE_ENV:'test',CI:'true',DISABLE_LOCAL_ENV_FILES:'1',DATABASE_URL:'',VAPI_API_KEY:'',TWILIO_ACCOUNT_SID:'',TWILIO_AUTH_TOKEN:'',
  TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:'',STRIPE_SECRET_KEY:'',SMTP_HOST:'',MAKE_SIGNUP_WEBHOOK_URL:''});
 const out=path.join(ROOT,'diagnostics/supervised-pilot',new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
 fs.mkdirSync(out,{recursive:true});
 const result=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap',...TESTS],{cwd:ROOT,env,encoding:'utf8',shell:false,windowsHide:true,timeout:180000,maxBuffer:16*1024*1024});
 const text=result.stdout||'';fs.writeFileSync(path.join(out,'tests.tap'),text,{flag:'wx'});fs.writeFileSync(path.join(out,'stderr.txt'),result.stderr||'',{flag:'wx'});
 const counts=summary(text),passed=result.status===0&&counts.tests>0&&counts.pass===counts.tests&&counts.fail===0&&counts.skipped===0&&counts.cancelled===0;
 const matches=[...text.matchAll(/PILOT_JOURNEY_EVIDENCE (\{[^\n]+\})/g)];const journey=matches.length===1?JSON.parse(matches[0][1]):null;
 const report=require('./supervised-pilot-checklist').checklist({sourceHead:'8f218834361f5ec22de23c5cedd6690897d40f99',checkedAt:new Date().toISOString(),journey,regressions:{passed}});
 report.localVerification={passed,counts,exitCode:result.status,errorCode:result.error?.code||null,journey,
  qualification:'Uncommitted local patch on baseline sourceHead; source hashes identify tested bytes. Neither deployed nor SQL-verified.',
  sourceSha256:Object.fromEntries([...TESTS,'scripts/run-supervised-pilot-local.js','scripts/supervised-pilot-checklist.js','server/index.js','server/leadHandoffs.js','server/vapiSms.js','server/vapiToolSecurity.js','server/callPersistence.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex')]))};
 fs.writeFileSync(path.join(out,'pilot-checklist.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({output:out,testContractsPassed:passed,counts,journey,readyForLivePilot:false,checks:Object.fromEntries(Object.entries(report.checks).map(([k,v])=>[k,v.status]))},null,2));
 if(!passed)process.exitCode=1;return report;
}
if(require.main===module)run();module.exports={run,summary,TESTS};
