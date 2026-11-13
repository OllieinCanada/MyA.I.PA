// Presence-only, offline audit. Never loads .env, CLI profiles, credentials,
// provider clients or private runtime values; no automatic collection or sends.
const fs=require('node:fs'),path=require('node:path');
const {configuredCaptchaProvider}=require('../server/signupCaptcha');
const {CREDENTIAL_MAX_AGE_MS:MAX_AGE_MS,credentialExpectedScopeValid:validExpected,credentialReportDigest,credentialConfigurationPassed}=require('./launch-evidence');
const MODES=['turnstile','recaptcha','turnstile+recaptcha'];
const PRESENCE_KEYS=['TURNSTILE_SECRET_KEY','RECAPTCHA_SECRET_KEY','GOOGLE_RECAPTCHA_SECRET_KEY',
  'SMTP_HOST','SMTP_USER','SMTP_PASS','EMAIL_FROM','SMTP_FROM','ADMIN_TOTP_SECRET','BACKUP_ENCRYPTION_KEY'];
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&[Object.prototype,null].includes(Object.getPrototypeOf(x));
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const sha=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const release=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const stamp=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)&&Number.isFinite(Date.parse(x));
const fresh=(x,now)=>stamp(x)&&now-Date.parse(x)>=0&&now-Date.parse(x)<=MAX_AGE_MS;
function origin(x){try{const u=new URL(x);return u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/'?u.origin:null;}catch{return null;}}
const mode=x=>MODES.includes(x)||x==='unsupported';
function validRuntime(r){return exact(r,['schemaVersion','source','presence','settings','effective'])&&r.schemaVersion===1
  &&exact(r.source,['kind','serviceId','releaseCommit','checkedAt'])&&r.source.kind==='server-runtime-presence'
  &&/^srv-[a-z0-9]{10,64}$/.test(r.source.serviceId)&&release(r.source.releaseCommit)&&stamp(r.source.checkedAt)
  &&exact(r.presence,PRESENCE_KEYS)&&PRESENCE_KEYS.every(k=>typeof r.presence[k]==='boolean')
  &&exact(r.settings,['CAPTCHA_PROVIDER','configuredCaptchaProvider','SIGNUP_REQUIRE_VERIFICATION','SIGNUP_REQUIRE_MANUAL_APPROVAL'])
  &&(r.settings.CAPTCHA_PROVIDER===null||mode(r.settings.CAPTCHA_PROVIDER))&&mode(r.settings.configuredCaptchaProvider)
  &&['SIGNUP_REQUIRE_VERIFICATION','SIGNUP_REQUIRE_MANUAL_APPROVAL'].every(k=>r.settings[k]===null||typeof r.settings[k]==='boolean')
  &&exact(r.effective,['recaptchaSecretPresent','smtpFromPresent'])&&Object.values(r.effective).every(x=>typeof x==='boolean');}
function validPublic(p){
  if(!exact(p,['schemaVersion','source','selection'])||p.schemaVersion!==1
    ||!exact(p.source,['kind','origin','releaseCommit','checkedAt','artifactSha256','artifactUrl','method'])
    ||p.source.kind!=='deployed-public-configuration'||p.source.method!=='verified-deployed-bundle'
    ||origin(p.source.origin)!==p.source.origin||!release(p.source.releaseCommit)||!stamp(p.source.checkedAt)||!sha(p.source.artifactSha256)
    ||!exact(p.selection,['provider','turnstileSiteKeyPresent','recaptchaSiteKeyPresent'])||!mode(p.selection.provider)
    ||typeof p.selection.turnstileSiteKeyPresent!=='boolean'||typeof p.selection.recaptchaSiteKeyPresent!=='boolean')return false;
  try{const u=new URL(p.source.artifactUrl);return u.origin===p.source.origin&&!u.username&&!u.password&&!u.search&&!u.hash
    &&/^\/static\/js\/main\.[a-f0-9]{6,128}\.js$/.test(u.pathname);}catch{return false;}
}
function evaluateCredentialReadiness({runtimeEvidence:r,publicEvidence:p,expected:e,now=Date.now()}={}){
  const report={schemaVersion:2,scope:'configuration-presence-only',checkedAt:new Date(now).toISOString(),releaseCommit:null,
    secretValuesCollected:false,secretValuesPrinted:false,evidenceStatus:'unverified',issues:[],
    signupControls:{configurationReady:false,publicSelfServiceReady:false},
    functionalProof:{captchaChallenge:'not_run',smsDelivery:'not_run',emailDelivery:'not_run',adminMfaChallenge:'not_run',backupRestore:'not_run'},
    limitations:['Inputs are explicitly sourced operator-supplied sanitized attestations, not authenticated by this offline evaluator.',
      'Presence does not establish credential validity, key type/hostname alignment, challenge success, delivery or recovery.',
      'Local frontend environment variables and repository defaults are not evidence of deployed public selection.',
      'General signup verification is not email-only; the web path requires SMS and optionally sends email when configured.']};
  const issue=c=>{if(!report.issues.includes(c))report.issues.push(c);};
  if(!validExpected(e)){issue('EXPECTED_SCOPE_REQUIRED');return report;}
  report.releaseCommit=e.releaseCommit;
  if(!validRuntime(r))issue('RUNTIME_PRESENCE_EVIDENCE_INVALID');
  if(!validPublic(p))issue('DEPLOYED_PUBLIC_EVIDENCE_INVALID');
  if(report.issues.length)return report;
  if(r.source.releaseCommit!==e.releaseCommit||r.source.serviceId!==e.serviceId)issue('RUNTIME_SCOPE_MISMATCH');
  if(p.source.releaseCommit!==e.releaseCommit||p.source.origin!==e.frontendOrigin||p.source.artifactSha256!==e.publicArtifactSha256)issue('DEPLOYED_PUBLIC_SCOPE_MISMATCH');
  if(!fresh(r.source.checkedAt,now))issue('RUNTIME_EVIDENCE_STALE_OR_FUTURE');
  if(!fresh(p.source.checkedAt,now))issue('DEPLOYED_PUBLIC_EVIDENCE_STALE_OR_FUTURE');
  report.evidence={runtime:{...r.source},deployedPublic:{...p.source},expected:{...e}};
  const bindingValid=report.issues.length===0;
  if(bindingValid)report.evidenceStatus='source-bound-presence-attestation';
  const presence=r.presence,s=r.settings,effective=r.effective;
  const provider=configuredCaptchaProvider({CAPTCHA_PROVIDER:s.CAPTCHA_PROVIDER===null?'':s.CAPTCHA_PROVIDER});
  if(provider!==s.configuredCaptchaProvider)issue('CAPTCHA_RUNTIME_RESOLUTION_MISMATCH');
  // Effective fallback selection must be observed, not guessed with boolean OR:
  // a truthy whitespace primary value can suppress the runtime fallback.
  if((presence.RECAPTCHA_SECRET_KEY&&!effective.recaptchaSecretPresent)
    ||(!presence.RECAPTCHA_SECRET_KEY&&!presence.GOOGLE_RECAPTCHA_SECRET_KEY&&effective.recaptchaSecretPresent)
    ||(presence.EMAIL_FROM&&!effective.smtpFromPresent)
    ||(!presence.EMAIL_FROM&&!presence.SMTP_FROM&&effective.smtpFromPresent))issue('EFFECTIVE_PRESENCE_INCONSISTENT');
  const supported=MODES.includes(provider)&&MODES.includes(p.selection.provider);
  if(!supported)issue('CAPTCHA_MODE_UNSUPPORTED');
  if(provider!==p.selection.provider)issue('CAPTCHA_DEPLOYED_RUNTIME_MISMATCH');
  const needTurnstile=provider==='turnstile'||provider==='turnstile+recaptcha',needRecaptcha=provider==='recaptcha'||provider==='turnstile+recaptcha';
  const secrets=supported&&(!needTurnstile||presence.TURNSTILE_SECRET_KEY)&&(!needRecaptcha||effective.recaptchaSecretPresent);
  const siteKeys=supported&&(!needTurnstile||p.selection.turnstileSiteKeyPresent)&&(!needRecaptcha||p.selection.recaptchaSiteKeyPresent);
  if(!secrets)issue('CAPTCHA_SERVER_SECRET_ABSENT');if(!siteKeys)issue('CAPTCHA_DEPLOYED_SITE_KEY_ABSENT');
  const smtpTransport=presence.SMTP_HOST&&effective.smtpFromPresent;
  const smtpAuth=presence.SMTP_USER&&presence.SMTP_PASS?'authenticated':!presence.SMTP_USER&&!presence.SMTP_PASS?'anonymous':'incomplete';
  const smtpConfigured=smtpTransport&&smtpAuth!=='incomplete';
  if(!smtpConfigured)issue('SMTP_NOT_CONFIGURED');
  const verification=s.SIGNUP_REQUIRE_VERIFICATION===true,manual=s.SIGNUP_REQUIRE_MANUAL_APPROVAL===true;
  if(!verification)issue('SIGNUP_CONTACT_VERIFICATION_DISABLED');if(manual)issue('MANUAL_APPROVAL_ENABLED');
  if(!presence.ADMIN_TOTP_SECRET)issue('ADMIN_MFA_NOT_CONFIGURED');if(!presence.BACKUP_ENCRYPTION_KEY)issue('BACKUP_KEY_NOT_CONFIGURED');
  report.signupControls={runtimeCaptchaProvider:provider,deployedCaptchaProvider:p.selection.provider,
    captchaProviderSelected:bindingValid&&supported&&provider===p.selection.provider&&provider===s.configuredCaptchaProvider,
    captchaConfigured:bindingValid&&supported&&provider===p.selection.provider&&secrets&&siteKeys&&!report.issues.includes('CAPTCHA_RUNTIME_RESOLUTION_MISMATCH')&&!report.issues.includes('EFFECTIVE_PRESENCE_INCONSISTENT'),
    smtpTransportConfigured:smtpTransport,smtpAuthentication:smtpAuth,smtpConfigured,
    signupVerificationEnabled:verification,manualApprovalEnabled:manual,adminTotpConfigured:presence.ADMIN_TOTP_SECRET,
    adminMfaEnabled:presence.ADMIN_TOTP_SECRET,backupEncryptionConfigured:presence.BACKUP_ENCRYPTION_KEY,
    configurationReady:report.issues.length===0,publicSelfServiceReady:false};
  report.defaultsApplied=Object.entries(s).filter(([k,v])=>k!=='configuredCaptchaProvider'&&v===null).map(([k])=>k);
  return report;
}
function readEvidenceFile(file){
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>65536)throw Error('CREDENTIAL_EVIDENCE_FILE_INVALID');
  try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('CREDENTIAL_EVIDENCE_JSON_INVALID');}
}
function main(argv=process.argv.slice(2)){
  if(argv.length===1&&argv[0]==='--help'){console.log('Offline presence-only audit: --runtime-presence=FILE --deployed-public=FILE --release=SHA --service=ID --origin=HTTPS_ORIGIN --public-artifact-sha256=SHA256 [--out=FILE]. No collection or provider validation.');return;}
  // This receipt is independently consumed from the canonical location by the
  // shipping gate. Start BEFORE argument validation; early failures must fence
  // out a prior green report without destroying its historical contents.
  const attemptPath=path.resolve(__dirname,'../diagnostics/security/credential-readiness-status.json');
  const attempt={schemaVersion:1,kind:'credential-audit-attempt',attemptId:require('node:crypto').randomUUID(),state:'started',checkedAt:new Date().toISOString(),reportSha256:null};
  fs.mkdirSync(path.dirname(attemptPath),{recursive:true});
  if(fs.existsSync(attemptPath)){const stat=fs.lstatSync(attemptPath);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1)throw Error('CREDENTIAL_AUDIT_STATUS_INVALID');}
  fs.writeFileSync(attemptPath,JSON.stringify(attempt,null,2)+'\n');
  const keys=['runtime-presence','deployed-public','release','service','origin','public-artifact-sha256','out'],options={};
  for(const arg of argv){const m=/^--([a-z0-9-]+)=(.+)$/.exec(arg);if(!m||!keys.includes(m[1])||Object.hasOwn(options,m[1]))throw Error('CREDENTIAL_AUDIT_ARGUMENTS_INVALID');options[m[1]]=m[2];}
  if(keys.slice(0,6).some(k=>!options[k]))throw Error('CREDENTIAL_AUDIT_EVIDENCE_REQUIRED');
  const out=path.resolve(options.out||path.join(__dirname,'../diagnostics/security/credential-readiness-latest.json'));
  const canonical=file=>{const resolved=fs.existsSync(file)?fs.realpathSync(file):path.resolve(file);return process.platform==='win32'?resolved.toLowerCase():resolved;};
  if(!/^credential-readiness(?:-[a-z0-9]+)*\.json$/i.test(path.basename(out))
    ||canonical(out)===canonical(attemptPath)||[options['runtime-presence'],options['deployed-public']].some(input=>canonical(input)===canonical(out)))throw Error('CREDENTIAL_AUDIT_OUTPUT_INVALID');
  if(fs.existsSync(out)){const stat=fs.lstatSync(out);if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink>1)throw Error('CREDENTIAL_AUDIT_OUTPUT_INVALID');}
  const expected={releaseCommit:options.release,serviceId:options.service,frontendOrigin:options.origin,publicArtifactSha256:options['public-artifact-sha256']};
  const report=evaluateCredentialReadiness({runtimeEvidence:readEvidenceFile(options['runtime-presence']),publicEvidence:readEvidenceFile(options['deployed-public']),expected});
  report.auditAttemptId=attempt.attemptId;fs.mkdirSync(path.dirname(out),{recursive:true});
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  // Complete only this immutable attempt, never replace the selected-current
  // pointer. A late earlier process cannot resurrect success after a later fail.
  const completedPath=path.join(path.dirname(attemptPath),`credential-readiness-attempt-${attempt.attemptId}.json`);
  fs.writeFileSync(completedPath,JSON.stringify({...attempt,state:'completed',checkedAt:new Date().toISOString(),reportSha256:credentialReportDigest(report)},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));if(!report.signupControls.configurationReady)process.exitCode=2;
}
if(require.main===module){try{main();}catch(error){console.error(/^CREDENTIAL_[A-Z_]+$/.test(error.message||'')?error.message:'CREDENTIAL_AUDIT_INPUT_UNAVAILABLE');process.exitCode=1;}}
module.exports={MAX_AGE_MS,PRESENCE_KEYS,evaluateCredentialReadiness,credentialConfigurationPassed,readEvidenceFile,main};
