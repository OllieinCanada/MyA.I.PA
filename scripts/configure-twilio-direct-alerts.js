// Audit by default; activate only after the callback route has been deployed.
const {PATH}=require('../server/twilioProviderEvents');
const {getTwilioSignature}=require('../server/smsSuppression');
const callback='https://api.myaipa.ca'+PATH;
async function run({env=process.env,fetchImpl=fetch,apply=false,dailyLimit}={}) {
  const sid=env.TWILIO_ACCOUNT_SID,token=env.TWILIO_AUTH_TOKEN;
  if(!/^AC[0-9a-f]{32}$/i.test(sid||'')||!token)throw new Error('Twilio credentials missing');
  const headers={Authorization:'Basic '+Buffer.from(`${sid}:${token}`).toString('base64')};
  const base=`https://api.twilio.com/2010-04-01/Accounts/${sid}/Usage/Triggers.json`;
  async function request(url,options={}) {
    const r=await fetchImpl(url,{...options,headers:{...headers,...options.headers},signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error(`Twilio request failed (${r.status})`);
    return r.json();
  }
  const body=await request(base+'?PageSize=1000');
  if(body.next_page_uri)throw new Error('Trigger listing incomplete; refusing changes');
  const owned=(body.usage_triggers||[]).filter(x=>x.friendly_name==='My AI PA daily spending warning');
  if(owned.length>1)throw new Error('Duplicate managed triggers require review');
  const expectedLimit=Number.isFinite(dailyLimit)&&dailyLimit>0?dailyLimit:5;
  const matches=owned.length===1 && owned[0].callback_url===callback && owned[0].callback_method==='POST' && owned[0].recurring==='daily' && owned[0].usage_category==='totalprice' && owned[0].trigger_by==='price' && Number(owned[0].trigger_value)===expectedLimit;
  if(!apply)return {mode:'audit',managedTriggers:owned.length,matchesRequestedConfiguration:matches,expectedDailyWarning:expectedLimit,callback,debuggerSetup:'Configure Console Debugger webhook after deployment; preserve any existing integration.'};
  if(!Number.isFinite(dailyLimit)||dailyLimit<=0)throw new Error('Explicit positive daily spending warning required');
  const probeBody={AccountSid:sid};
  const probe=await fetchImpl(callback,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-Twilio-Signature':getTwilioSignature(callback,probeBody,token)},body:new URLSearchParams(probeBody).toString(),signal:AbortSignal.timeout(10000)});
  const probeResult=await probe.json().catch(()=>({}));
  if(probe.status!==400||probeResult.error!=='Invalid Twilio event.')throw new Error('Deployed signature-guarded callback not confirmed; no trigger created');
  const existing=owned[0];
  if(existing) {
    if(existing.callback_url!==callback||existing.callback_method!=='POST'||existing.recurring!=='daily'||existing.usage_category!=='totalprice'||existing.trigger_by!=='price'||Number(existing.trigger_value)!==dailyLimit)throw new Error('Existing trigger differs; refusing overwrite');
    return {mode:'apply',created:false,sid:existing.sid};
  }
  const result=await request(base,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({FriendlyName:'My AI PA daily spending warning',UsageCategory:'totalprice',TriggerBy:'price',TriggerValue:String(dailyLimit),Recurring:'daily',CallbackMethod:'POST',CallbackUrl:callback}).toString()});
  if(result.callback_url!==callback||result.callback_method!=='POST'||Number(result.trigger_value)!==dailyLimit)throw new Error('Created trigger readback mismatch');
  return {mode:'apply',created:true,sid:result.sid};
}
if(require.main===module)run({apply:process.argv.includes('--apply'),dailyLimit:Number(process.argv.find(x=>x.startsWith('--daily-limit='))?.split('=')[1])}).then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={run};
