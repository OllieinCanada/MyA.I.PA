// Repair only the saved, exclusively owned pairing. Never purchase a number,
// create an assistant, replay intake, start billing, or place calls.
const {clients, inventory, ownership} = require('./rollout-signup-assistant-policy');
const {loadProjectEnv} = require('./_helpers');
const {isDeepStrictEqual}=require('node:util');
const {provisionIsolatedSmsRouting,isolatedToolName} = require('../server/vapiIsolatedSmsProvisioning');
const {redactIncidentText} = require('../server/incidentAlerts');
async function main() {
  const attempt = process.argv.find(x=>x.startsWith('--attempt='))?.slice(10);
  if (!/^signup_[a-f0-9]{32}$/.test(attempt || '')) throw Error('Exact saved signup attempt required.');
  const env=loadProjectEnv(), io=await clients(env), data=await inventory(io);
  const s=data.signups.find(x=>x.signupAttemptId===attempt);
  if (!s || ownership(data,s)) throw Error('Exclusive verified ownership not established.');
  const assistant=await io.api(`/assistant/${s.vapiAssistantId}`);
  const context=(assistant.model?.messages||[]).filter(x=>x.role==='system').map(x=>x.content).join('\n');
  if (!assistant.name?.startsWith('myaipa-vapi-assistant-') || !context.includes(`- Business name: ${s.businessName}`)) throw Error('Business context mismatch.');
  console.log(JSON.stringify({business:s.businessName,number:s.twilioPhoneNumber,ownershipVerified:true,mode:process.argv.includes('--apply')?'repair':'audit',numbersCreated:0,assistantsCreated:0}));
  if (!process.argv.includes('--apply')) return;
  const since=new Date(Date.now()-86400000).toISOString();
  const calls=await io.api(`/call?assistantId=${assistant.id}&createdAtGe=${encodeURIComponent(since)}&limit=100`);
  if (!Array.isArray(calls) || calls.length>=100 || calls.some(c=>['queued','ringing','in-progress','forwarding'].includes(c.status))) throw Error('Active or uncertain calls; defer.');
  const fresh=await inventory(io), current=fresh.signups.find(x=>x.signupAttemptId===attempt);
  if (!current || ownership(fresh,current) || current.vapiAssistantId!==s.vapiAssistantId || current.twilioPhoneNumber!==s.twilioPhoneNumber) throw Error('Ownership changed; defer.');
  const latest=await io.api(`/assistant/${assistant.id}`);
  if(!isDeepStrictEqual(assistant,latest)) throw Error('Assistant changed concurrently; defer.');
  const named=fresh.tools.filter(t=>t.function?.name===isolatedToolName(s.twilioPhoneNumber,s.ownerPhone||s.businessPhone));
  if(named.length>1 || named.some(t=>fresh.assistants.some(a=>a.id!==assistant.id&&(a.model?.toolIds||[]).includes(t.id)))) throw Error('SMS tool has ambiguous/shared ownership; defer.');
  async function api(resource,method='GET',body) {
    const r=await fetch(`https://api.vapi.ai/${resource}`,{method,headers:{Authorization:`Bearer ${env.VAPI_API_KEY}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
    const d=await r.json();
    if(!r.ok) {
      // Replace every request secret before applying general redaction.
      let detail=JSON.stringify(d.message || d.error || d);
      for(const value of Object.values(env)) if(typeof value==='string'&&value.length>=8) detail=detail.split(value).join('[removed]');
      throw Error(`Vapi ${method} ${resource.split('/')[0]} HTTP ${r.status}: ${redactIncidentText(detail,{maxLength:1500})}`);
    }
    return d;
  }
  const result=await provisionIsolatedSmsRouting({assistant,tools:fresh.tools,aiNumber:s.twilioPhoneNumber,ownerNumber:s.ownerPhone||s.businessPhone,
    twilioAccountSid:env.TWILIO_ACCOUNT_SID,twilioAuthToken:env.TWILIO_AUTH_TOKEN,twilioApiKeySid:env.TWILIO_API_KEY_SID,twilioApiKeySecret:env.TWILIO_API_KEY_SECRET,
    statusCallbackUrl:env.TWILIO_STATUS_CALLBACK_URL||'https://api.myaipa.ca/api/webhooks/twilio/sms-status',suppressionCheckUrl:env.SMS_SUPPRESSION_CHECK_URL||'https://api.myaipa.ca/api/integrations/sms/suppression/check',suppressionApiKey:env.SMS_SUPPRESSION_API_KEY,
    createTool:p=>api('tool','POST',p),patchTool:(id,p)=>api(`tool/${id}`,'PATCH',p),patchAssistant:(id,p)=>api(`assistant/${id}`,'PATCH',p),fetchAssistant:id=>api(`assistant/${id}`),fetchTool:id=>api(`tool/${id}`),deleteTool:id=>api(`tool/${id}`,'DELETE')});
  const after=await inventory(io), final=after.signups.find(x=>x.signupAttemptId===attempt);
  if(!final||ownership(after,final)||after.phones.length!==fresh.phones.length||after.assistants.length!==fresh.assistants.length) throw Error('Final ownership/count verification failed.');
  console.log(JSON.stringify({healthy:result.audit.healthy,checks:result.audit.checks,toolId:result.tool.id,numbersCreated:0,assistantsCreated:0,billingChanged:false,callsPlaced:0}));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
