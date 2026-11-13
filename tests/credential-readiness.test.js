const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {spawnSync}=require('node:child_process');
const {MAX_AGE_MS,PRESENCE_KEYS,evaluateCredentialReadiness:evaluate,credentialConfigurationPassed:passes}=require('../scripts/audit-credential-readiness');
const {credentialReportDigest}=require('../scripts/launch-evidence');
const {configuredCaptchaProvider,verifySignupCaptcha}=require('../server/signupCaptcha');
const root=path.resolve(__dirname,'..'),now=1900000000000;
function fixture(provider='turnstile+recaptcha'){
  const expected={releaseCommit:'a'.repeat(40),serviceId:'srv-syntheticfixture123',frontendOrigin:'https://app.example.invalid',publicArtifactSha256:'b'.repeat(64)};
  return {now,expected,runtimeEvidence:{schemaVersion:1,source:{kind:'server-runtime-presence',serviceId:expected.serviceId,releaseCommit:expected.releaseCommit,checkedAt:new Date(now).toISOString()},
    presence:Object.fromEntries(PRESENCE_KEYS.map(k=>[k,true])),settings:{CAPTCHA_PROVIDER:provider,configuredCaptchaProvider:provider,SIGNUP_REQUIRE_VERIFICATION:true,SIGNUP_REQUIRE_MANUAL_APPROVAL:null},
    effective:{recaptchaSecretPresent:true,smtpFromPresent:true}},
    publicEvidence:{schemaVersion:1,source:{kind:'deployed-public-configuration',origin:expected.frontendOrigin,releaseCommit:expected.releaseCommit,checkedAt:new Date(now).toISOString(),
      artifactSha256:expected.publicArtifactSha256,artifactUrl:expected.frontendOrigin+'/static/js/main.abcdef1234.js',method:'verified-deployed-bundle'},
      selection:{provider,turnstileSiteKeyPresent:true,recaptchaSiteKeyPresent:true}}};
}
function receipt(r){r.auditAttemptId='11111111-1111-4111-8111-111111111111';const current={schemaVersion:1,kind:'credential-audit-attempt',attemptId:r.auditAttemptId,state:'started',checkedAt:r.checkedAt,reportSha256:null};
  return{current,completed:{...current,state:'completed',reportSha256:credentialReportDigest(r)}};}
test('unchanged legacy formula reproduces dual false green; fixed audit refuses it',()=>{
  // Exact legacy signupControls formula, isolated from its old network collector.
  const legacy=(remote,local)=>Boolean(remote.TURNSTILE_SECRET_KEY&&local.REACT_APP_TURNSTILE_SITE_KEY);
  assert.equal(legacy({TURNSTILE_SECRET_KEY:true,RECAPTCHA_SECRET_KEY:false},{REACT_APP_TURNSTILE_SITE_KEY:true}),true);
  const f=fixture();f.runtimeEvidence.presence.RECAPTCHA_SECRET_KEY=false;f.runtimeEvidence.presence.GOOGLE_RECAPTCHA_SECRET_KEY=false;f.runtimeEvidence.effective.recaptchaSecretPresent=false;
  const r=evaluate(f);assert.equal(r.signupControls.configurationReady,false);assert.equal(r.signupControls.captchaConfigured,false);assert.ok(r.issues.includes('CAPTCHA_SERVER_SECRET_ABSENT'));
});
for(const provider of ['turnstile','recaptcha','turnstile+recaptcha'])test(provider+' requires only its selected server and deployed public prerequisites',()=>{
  const f=fixture(provider);
  if(provider==='turnstile'){f.runtimeEvidence.presence.RECAPTCHA_SECRET_KEY=false;f.runtimeEvidence.presence.GOOGLE_RECAPTCHA_SECRET_KEY=false;f.runtimeEvidence.effective.recaptchaSecretPresent=false;f.publicEvidence.selection.recaptchaSiteKeyPresent=false;}
  if(provider==='recaptcha'){f.runtimeEvidence.presence.TURNSTILE_SECRET_KEY=false;f.publicEvidence.selection.turnstileSiteKeyPresent=false;}
  const r=evaluate(f);assert.equal(r.signupControls.configurationReady,true);assert.equal(passes(r,f.expected,receipt(r),now),true);
  assert.equal(r.signupControls.publicSelfServiceReady,false);assert.ok(Object.values(r.functionalProof).every(x=>x==='not_run'));
});
for(const provider of ['recaptcha','turnstile+recaptcha'])test(provider+' supports effective Google fallback but never guesses whitespace-shadowed fallback',()=>{
  const f=fixture(provider);f.runtimeEvidence.presence.RECAPTCHA_SECRET_KEY=false;
  assert.equal(evaluate(f).signupControls.captchaConfigured,true);
  f.runtimeEvidence.effective.recaptchaSecretPresent=false;assert.equal(evaluate(f).signupControls.captchaConfigured,false);
  f.runtimeEvidence.presence.GOOGLE_RECAPTCHA_SECRET_KEY=false;f.runtimeEvidence.effective.recaptchaSecretPresent=true;
  assert.ok(evaluate(f).issues.includes('EFFECTIVE_PRESENCE_INCONSISTENT'));
});
test('runtime verifier itself agrees on dual missing/fallback/whitespace outcomes without network',async()=>{
  const proofs={captchaProvider:'turnstile+recaptcha',turnstileToken:'synthetic-independent-ts-proof',recaptchaToken:'synthetic-independent-google-proof'};
  for(const [primary,fallback,ok,calls]of [[undefined,undefined,false,0],[undefined,'synthetic-fallback',true,2],['   ','synthetic-fallback',false,0]]){
    let count=0;const env={NODE_ENV:'production',CAPTCHA_PROVIDER:'turnstile+recaptcha',CAPTCHA_ALLOWED_HOSTNAMES:'captcha.example.invalid',TURNSTILE_SECRET_KEY:'synthetic-turnstile',RECAPTCHA_SECRET_KEY:primary,GOOGLE_RECAPTCHA_SECRET_KEY:fallback};
    const result=await verifySignupCaptcha(proofs,'unknown',{env,fetchImpl:async()=>{count++;return{ok:true,json:async()=>({success:true,hostname:'captcha.example.invalid'})};}});
    assert.equal(result.ok,ok);assert.equal(count,calls);
  }
});
test('missing deployed site keys and mismatched deployed/runtime selections fail closed',()=>{
  for(const key of ['turnstileSiteKeyPresent','recaptchaSiteKeyPresent']){const f=fixture();f.publicEvidence.selection[key]=false;assert.equal(evaluate(f).signupControls.configurationReady,false);}
  const f=fixture();f.publicEvidence.selection.provider='turnstile';assert.ok(evaluate(f).issues.includes('CAPTCHA_DEPLOYED_RUNTIME_MISMATCH'));
});
test('local frontend variables cannot override explicit deployed selection or supply missing evidence',()=>{
  const old=process.env.REACT_APP_CAPTCHA_PROVIDER;process.env.REACT_APP_CAPTCHA_PROVIDER='turnstile+recaptcha';
  try{const f=fixture();f.publicEvidence.selection.provider='turnstile';assert.equal(evaluate(f).signupControls.configurationReady,false);
    delete f.publicEvidence;assert.equal(evaluate(f).signupControls.configurationReady,false);
    const g=fixture();g.publicEvidence.source.kind='local-env';assert.equal(evaluate(g).signupControls.configurationReady,false);
  }finally{if(old===undefined)delete process.env.REACT_APP_CAPTCHA_PROVIDER;else process.env.REACT_APP_CAPTCHA_PROVIDER=old;}
});
test('backend provider defaults use actual configuredCaptchaProvider; resolution mismatch/unsupported deny',()=>{
  const f=fixture('turnstile');f.runtimeEvidence.settings.CAPTCHA_PROVIDER=null;
  assert.equal(configuredCaptchaProvider({}), 'turnstile');assert.equal(evaluate(f).signupControls.configurationReady,true);
  f.runtimeEvidence.settings.configuredCaptchaProvider='recaptcha';assert.ok(evaluate(f).issues.includes('CAPTCHA_RUNTIME_RESOLUTION_MISMATCH'));
  f.runtimeEvidence.settings.CAPTCHA_PROVIDER='unsupported';f.runtimeEvidence.settings.configuredCaptchaProvider='unsupported';
  assert.ok(evaluate(f).issues.includes('CAPTCHA_MODE_UNSUPPORTED'));
});
test('verification and manual approval default false exactly as runtime, never email-only',()=>{
  const source=fs.readFileSync(path.join(root,'server/index.js'),'utf8'),body=source.match(/function isEnabled\(value\) \{[^}]+\}/)[0];
  const enabled=vm.runInNewContext('('+body+')');assert.equal(enabled(undefined),false);assert.equal(enabled(''),false);assert.equal(enabled('true'),true);
  const f=fixture();f.runtimeEvidence.settings.SIGNUP_REQUIRE_VERIFICATION=null;const r=evaluate(f);
  assert.equal(r.signupControls.signupVerificationEnabled,false);assert.equal(r.signupControls.manualApprovalEnabled,false);
  assert.equal(Object.hasOwn(r.signupControls,'emailVerificationEnabled'),false);assert.ok(r.issues.includes('SIGNUP_CONTACT_VERIFICATION_DISABLED'));
  f.runtimeEvidence.settings.SIGNUP_REQUIRE_VERIFICATION=true;f.runtimeEvidence.settings.SIGNUP_REQUIRE_MANUAL_APPROVAL=true;
  assert.ok(evaluate(f).issues.includes('MANUAL_APPROVAL_ENABLED'));
});
test('MFA uses only secret presence; missing synthetic settings cannot pass',()=>{
  const f=fixture();f.runtimeEvidence.presence.ADMIN_TOTP_SECRET=false;f.runtimeEvidence.presence.SMTP_HOST=false;
  const r=evaluate(f);assert.equal(r.signupControls.adminMfaEnabled,false);assert.equal(r.signupControls.smtpConfigured,false);
  assert.ok(r.issues.includes('ADMIN_MFA_NOT_CONFIGURED'));assert.ok(r.issues.includes('SMTP_NOT_CONFIGURED'));assert.equal(r.signupControls.configurationReady,false);
  f.runtimeEvidence.settings.ADMIN_MFA_ENABLED=true;assert.ok(evaluate(f).issues.includes('RUNTIME_PRESENCE_EVIDENCE_INVALID'));
});
test('SMTP runtime sender fallback, anonymous transport and partial auth are distinguished from delivery',()=>{
  const f=fixture();f.runtimeEvidence.presence.EMAIL_FROM=false;assert.equal(evaluate(f).signupControls.smtpConfigured,true);
  f.runtimeEvidence.effective.smtpFromPresent=false;assert.equal(evaluate(f).signupControls.smtpConfigured,false);
  f.runtimeEvidence.effective.smtpFromPresent=true;f.runtimeEvidence.presence.SMTP_USER=false;f.runtimeEvidence.presence.SMTP_PASS=false;
  assert.equal(evaluate(f).signupControls.smtpAuthentication,'anonymous');assert.equal(evaluate(f).signupControls.smtpConfigured,true);
  f.runtimeEvidence.presence.SMTP_USER=true;const r=evaluate(f);assert.equal(r.signupControls.smtpAuthentication,'incomplete');assert.equal(r.signupControls.configurationReady,false);
});
for(const kind of ['runtimeEvidence','publicEvidence'])test(kind+' missing/stale/future provenance cannot be laundered with a new report timestamp',()=>{
  const f=fixture();delete f[kind];assert.equal(evaluate(f).signupControls.configurationReady,false);
  for(const delta of [-MAX_AGE_MS-1,1]){const g=fixture();g[kind].source.checkedAt=new Date(now+delta).toISOString();const r=evaluate(g);
    assert.equal(r.signupControls.configurationReady,false);assert.equal(passes(r,g.expected,receipt(r),now),false);}
});
test('release, service, public artifact and origin mismatches fail closed',()=>{
  for(const [kind,key,value]of [['runtimeEvidence','releaseCommit','c'.repeat(40)],['runtimeEvidence','serviceId','srv-differentfixture123'],
    ['publicEvidence','releaseCommit','c'.repeat(40)],['publicEvidence','origin','https://other.example.invalid'],['publicEvidence','artifactSha256','c'.repeat(64)]]){
    const f=fixture();f[kind].source[key]=value;assert.equal(evaluate(f).signupControls.configurationReady,false);
  }
  const f=fixture();f.publicEvidence.source.artifactUrl+='?credential=synthetic-private';assert.equal(evaluate(f).signupControls.configurationReady,false);
});
test('unknown fields, secret strings, incomplete booleans, unbound selection and invalid types never echo',()=>{
  for(const mutate of [f=>{f.runtimeEvidence.presence.RECAPTCHA_SECRET_KEY='SYNTHETIC_PRIVATE_DO_NOT_ECHO';},
    f=>{f.runtimeEvidence.secret='SYNTHETIC_PRIVATE_DO_NOT_ECHO';},f=>{f.publicEvidence.source.verified=true;},
    f=>{delete f.runtimeEvidence.presence.ADMIN_TOTP_SECRET;},f=>{f.runtimeEvidence.settings.SIGNUP_REQUIRE_MANUAL_APPROVAL='false';},
    f=>{delete f.runtimeEvidence.effective;},f=>{delete f.expected.publicArtifactSha256;}]){
    const f=fixture();mutate(f);const r=evaluate(f);assert.equal(r.signupControls.configurationReady,false);assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_PRIVATE_DO_NOT_ECHO/);
  }
});
test('shipping predicate rejects legacy boolean-only green, wrong release and source/report expiry',()=>{
  const f=fixture(),r=evaluate(f);assert.equal(passes({schemaVersion:1,signupControls:{publicSelfServiceReady:true}},f.expected,null,now),false);
  const attempt=receipt(r);assert.equal(passes(r,{...f.expected,releaseCommit:'c'.repeat(40)},attempt,now),false);assert.equal(passes(r,f.expected,attempt,now+MAX_AGE_MS+1),false);
  const g=structuredClone(r);g.evidence.runtime.checkedAt=new Date(now-MAX_AGE_MS-1).toISOString();g.checkedAt=new Date(now).toISOString();
  assert.equal(passes(g,f.expected,receipt(g),now),false);
});
test('consumer requires independent full target scope and a matching completed digest-bound attempt',()=>{
  const f=fixture(),r=evaluate(f),a=receipt(r);assert.equal(passes(r,f.expected,a,now),true);
  for(const expected of [f.expected.releaseCommit,{...f.expected,serviceId:'srv-unrelatedfixture123'},
    {...f.expected,frontendOrigin:'https://staging.example.invalid'},{...f.expected,publicArtifactSha256:'c'.repeat(64)}])assert.equal(passes(r,expected,a,now),false);
  for(const attempt of [null,{...a,completed:null},{...a,current:{...a.current,attemptId:'22222222-2222-4222-8222-222222222222'}},
    {...a,completed:{...a.completed,reportSha256:'c'.repeat(64)}}])assert.equal(passes(r,f.expected,attempt,now),false);
});
test('actual shipping reporter preserves24 gates and uses configuration predicate, not self-service/delivery claims',()=>{
  const source=fs.readFileSync(path.join(root,'scripts/report-shipping-readiness.js'),'utf8'),f=fixture(),good=evaluate(f);
  function run(report,expected=f.expected,attempt=receipt(report)){let saved;const fakeFs={existsSync:p=>p.endsWith('credential-readiness-latest.json')||(attempt&&(p.endsWith('credential-readiness-status.json')||p.includes('credential-readiness-attempt-'))),
    readFileSync:p=>JSON.stringify(p.endsWith('credential-readiness-status.json')?attempt.current:p.includes('credential-readiness-attempt-')?attempt.completed:report),mkdirSync:()=>{},writeFileSync:(_p,value)=>{saved=JSON.parse(value);}};
    vm.runInNewContext(source,{JSON,require:n=>n==='fs'?fakeFs:n==='path'?path:n==='./launch-evidence'?{...require('../scripts/launch-evidence'),credentialConfigurationPassed:(value,scope,status)=>passes(value,scope,status,now)}:n==='./_helpers'?{rootPath:(...parts)=>path.join('/synthetic-only',...parts)}:
      n==='node:child_process'?{spawnSync:()=>{throw Error('No subprocess allowed');}}:require(path.join(root,'scripts',n)),
      process:{env:{READINESS_RELEASE_COMMIT:expected.releaseCommit,READINESS_CREDENTIAL_SERVICE_ID:expected.serviceId,
        READINESS_FRONTEND_ORIGIN:expected.frontendOrigin,READINESS_PUBLIC_ARTIFACT_SHA256:expected.publicArtifactSha256},argv:[]},console:{log:()=>{}},Date:class extends Date{static now(){return now;}}});return saved;}
  const yes=run(good);assert.equal(yes.gates.length,24);assert.equal(yes.gates.find(g=>g.id==='signup_security').status,'passed');
  assert.equal(good.signupControls.publicSelfServiceReady,false);
  const no=run({checkedAt:new Date(now).toISOString(),signupControls:{publicSelfServiceReady:true}});
  assert.equal(no.gates.length,24);assert.equal(no.gates.find(g=>g.id==='signup_security').status,'failed');
  const staging=fixture();staging.expected.serviceId=staging.runtimeEvidence.source.serviceId='srv-unrelatedfixture123';
  staging.expected.frontendOrigin=staging.publicEvidence.source.origin='https://staging.example.invalid';
  staging.publicEvidence.source.artifactUrl=staging.expected.frontendOrigin+'/static/js/main.abcdef1234.js';
  const wrong=evaluate(staging);assert.equal(wrong.signupControls.configurationReady,true);
  assert.equal(run(wrong).gates.find(g=>g.id==='signup_security').status,'failed','same release SHA cannot authorize unrelated service/origin');
  for(const field of ['serviceId','frontendOrigin','publicArtifactSha256']){
    const g=fixture();g.expected[field]=field==='serviceId'?'srv-anotherfixture123':field==='frontendOrigin'?'https://staging.example.invalid':'c'.repeat(64);
    if(field==='serviceId')g.runtimeEvidence.source.serviceId=g.expected.serviceId;
    if(field==='frontendOrigin'){g.publicEvidence.source.origin=g.expected.frontendOrigin;g.publicEvidence.source.artifactUrl=g.expected.frontendOrigin+'/static/js/main.abcdef1234.js';}
    if(field==='publicArtifactSha256')g.publicEvidence.source.artifactSha256=g.expected.publicArtifactSha256;
    const selfConsistent=evaluate(g);assert.equal(selfConsistent.signupControls.configurationReady,true);
    assert.equal(run(selfConsistent).gates.find(x=>x.id==='signup_security').status,'failed',field+' must be bound outside report');
  }
  assert.equal(run(good,{releaseCommit:f.expected.releaseCommit}).gates.find(g=>g.id==='signup_security').status,'failed');
  assert.equal(run(good,f.expected,null).gates.find(g=>g.id==='signup_security').status,'failed');
});
test('CLI is offline, import is side-effect free, raw input/JSON errors never leak, and artifacts stay synthetic',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'credential-audit-synthetic-')),f=fixture();
  // CLI uses actual current clock; no private runtime input is read.
  f.runtimeEvidence.source.checkedAt=f.publicEvidence.source.checkedAt=new Date().toISOString();
  const app=path.join(dir,'app');fs.mkdirSync(path.join(app,'scripts'),{recursive:true});fs.mkdirSync(path.join(app,'server'));
  for(const name of ['audit-credential-readiness.js','report-shipping-readiness.js','launch-evidence.js','browser-quality-coverage.js'])
    fs.copyFileSync(path.join(root,'scripts',name),path.join(app,'scripts',name));
  fs.copyFileSync(path.join(root,'server/signupCaptcha.js'),path.join(app,'server/signupCaptcha.js'));
  fs.writeFileSync(path.join(app,'scripts/_helpers.js'),"const path=require('node:path');exports.rootPath=(...p)=>path.join(__dirname,'..',...p);");
  const runtime=path.join(dir,'credential-readiness-runtime.json'),pub=path.join(dir,'public.json'),out=path.join(app,'diagnostics/security/credential-readiness-latest.json');
  fs.writeFileSync(runtime,JSON.stringify(f.runtimeEvidence));fs.writeFileSync(pub,JSON.stringify(f.publicEvidence));
  const cli=path.join(app,'scripts/audit-credential-readiness.js'),args=[cli,'--runtime-presence='+runtime,'--deployed-public='+pub,'--release='+f.expected.releaseCommit,
    '--service='+f.expected.serviceId,'--origin='+f.expected.frontendOrigin,'--public-artifact-sha256='+f.expected.publicArtifactSha256,'--out='+out];
  const env=Object.fromEntries(['PATH','SystemRoot','TEMP','TMP','NODE_PATH'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  Object.assign(env,{DISABLE_LOCAL_ENV_FILES:'1',ADMIN_PASSWORD:'SYNTHETIC_PRIVATE_DO_NOT_ECHO',TURNSTILE_SECRET_KEY:'SYNTHETIC_PRIVATE_DO_NOT_ECHO'});
  const result=spawnSync(process.execPath,args,{encoding:'utf8',env,timeout:10000});assert.equal(result.status,0,result.stderr);
  assert.equal(JSON.parse(fs.readFileSync(out)).scope,'configuration-presence-only');assert.doesNotMatch(result.stdout+result.stderr,/SYNTHETIC_PRIVATE_DO_NOT_ECHO/);
  const statusFile=path.join(app,'diagnostics/security/credential-readiness-status.json');
  const gate=()=>{const r=spawnSync(process.execPath,[path.join(app,'scripts/report-shipping-readiness.js')],{encoding:'utf8',timeout:10000,
    env:{...env,READINESS_RELEASE_COMMIT:f.expected.releaseCommit,READINESS_CREDENTIAL_SERVICE_ID:f.expected.serviceId,
      READINESS_FRONTEND_ORIGIN:f.expected.frontendOrigin,READINESS_PUBLIC_ARTIFACT_SHA256:f.expected.publicArtifactSha256}});
    assert.equal(r.status,0,r.stderr);return JSON.parse(fs.readFileSync(path.join(app,'diagnostics/shipping-readiness/shipping-readiness.json'))).gates.find(g=>g.id==='signup_security').status;};
  assert.equal(gate(),'passed');
  for(const invalid of [[],['--unknown=SYNTHETIC_PRIVATE_DO_NOT_ECHO'],['--out='+out]]){
    const failed=spawnSync(process.execPath,[cli,...invalid],{encoding:'utf8',env,timeout:10000});assert.equal(failed.status,1);
    assert.doesNotMatch(failed.stdout+failed.stderr,/SYNTHETIC_PRIVATE_DO_NOT_ECHO/);
    assert.equal(JSON.parse(fs.readFileSync(out)).signupControls.configurationReady,true,'prior report preserved as history');
    assert.equal(JSON.parse(fs.readFileSync(statusFile)).state,'started');assert.equal(gate(),'failed','early CLI failure fences prior green at actual reporter');
  }
  fs.writeFileSync(runtime,'{"secret":"SYNTHETIC_PRIVATE_DO_NOT_ECHO",broken');
  const bad=spawnSync(process.execPath,args,{encoding:'utf8',env,timeout:10000});assert.equal(bad.status,1);assert.match(bad.stderr,/CREDENTIAL_EVIDENCE_JSON_INVALID/);assert.doesNotMatch(bad.stdout+bad.stderr,/SYNTHETIC_PRIVATE_DO_NOT_ECHO/);
  assert.equal(JSON.parse(fs.readFileSync(statusFile)).state,'started');assert.equal(gate(),'failed');
  const original=fs.readFileSync(runtime,'utf8');
  const same=spawnSync(process.execPath,args.map(x=>x.startsWith('--out=')?'--out='+runtime:x),{encoding:'utf8',env,timeout:10000});
  assert.equal(same.status,1);assert.equal(fs.readFileSync(runtime,'utf8'),original,'audit cannot overwrite an input');
  const script=fs.readFileSync(cli,'utf8');assert.doesNotMatch(script,/loadProjectEnv|readRenderCredentials|fetch\(|validateTwilio|cli\.yaml/);
  const imported=spawnSync(process.execPath,['-e',`global.fetch=()=>{throw Error('network forbidden')};require(${JSON.stringify(cli)});`],{encoding:'utf8',env,timeout:10000});
  assert.equal(imported.status,0,imported.stderr);assert.equal(imported.stdout,'');
});
