// Defaults to proof-only. This endpoint cannot send messages or change billing.
const {readRenderCredentials,fetchRenderEnv}=require('./run-with-render-env');
const {totpCode}=require('../server/adminSecurity');
async function main(){
 const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3)||'';
 if(process.argv.includes('--help')){console.log('Usage: node scripts/reconcile-signup-completion-sms.js --signup=signup_<32 hex> --message=SM<32 hex> [--apply --confirm=RECONCILE_DELIVERED_SETUP_SMS]');return;}
 const signupAttemptId=arg('signup'),expectedMessageSid=arg('message'),apply=process.argv.includes('--apply');
 if(!/^signup_[a-f0-9]{32}$/.test(signupAttemptId)||!/^SM[a-f0-9]{32}$/i.test(expectedMessageSid))throw Error('Exact signup attempt and message SID required');
 if(apply&&arg('confirm')!=='RECONCILE_DELIVERED_SETUP_SMS')throw Error('Exact apply confirmation required');
 const e=await fetchRenderEnv({serviceId:'srv-d92503a8qa3s73crdpog',credentials:readRenderCredentials(),keys:['ADMIN_PASSWORD'],optionalKeys:['ADMIN_TOTP_SECRET']});
 const login=await fetch('https://api.myaipa.ca/api/admin/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:e.ADMIN_PASSWORD,mfaCode:e.ADMIN_TOTP_SECRET?totpCode(e.ADMIN_TOTP_SECRET):undefined}),signal:AbortSignal.timeout(20000)});
 const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!login.ok||!cookie)throw Error('Admin authentication failed');
 const r=await fetch('https://api.myaipa.ca/api/admin/signups/reconcile-completion-sms',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({signupAttemptId,expectedMessageSid,confirmation:'RECONCILE_DELIVERED_SETUP_SMS',apply}),signal:AbortSignal.timeout(30000)});
 const data=await r.json().catch(()=>({}));if(!r.ok)throw Error('Reconciliation HTTP '+r.status+' '+String(data.code||data.error||'request rejected'));
 console.log(JSON.stringify(data,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
