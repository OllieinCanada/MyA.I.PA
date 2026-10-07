// Ownership-gated content rollout. Default read-only; no resource creation/deletion.
const { loadProjectEnv } = require('./_helpers');
const { totpCode } = require('../server/adminSecurity');
const { isClosedSignup } = require('../server/signupBusinessIdentity');
const { listFrom, validateInventory, assistantReferences, isManagedSummaryTool, shortHash } = require('./audit-vapi-sms-tool-pinning');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {isDeepStrictEqual}=require('node:util');
const {toolPatch}=require('./refresh-vapi-job-type');
const {repairPayload,speechSnapshot}=require('./repair-signup-speech');
const {updateMessages}=require('../server/vapiIsolatedSmsProvisioning');
const {inspectSignupSpeech}=require('../server/signupSpeechPolicy');
const {definitionMatches}=require('./vapi-release-evidence');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const norm=v=>String(v||'').replace(/\D/g,'');
const CLOSED=s=>isClosedSignup(s)||['subscription_canceled','subscription_cancelled'].includes(s.status);
const POLICY=`## MYAIPA LIVE PRICING POLICY 2026-10-07
This policy overrides older repair-pricing and safety wording, but never changes business facts or approved rates.
Use only the verified service/repair rates and offers-service-calls choice already in Business context. Never invent missing rates. If rates are absent, the team must confirm them.
For repairs and maintenance with verified rates, describe the visit fee as the minimum service-visit fee and hourly rate as hourly labour. Say: "Parts are extra. The technician will assess the work and confirm the final price before starting." These rates are not a fixed total quote.
Ask "Would you like to continue?" and wait. Do not collect routine intake before the answer. For installations, retain the owner's installation estimate/free-quote choice, not repair rates.
Set pricingDiscussed true only when verified repair/service rates were actually explained; false for installations, messages, hazards or missing rates.
Give necessary hazard guidance once, repeating only for confusion or new danger. Never suggest approaching or shutting off power near downed/sparking wires. Never promise dispatch or diagnose.
Set safetyConcern to reported_hazard only for a caller-reported current hazard; none for absent, denied or resolved danger. Keep job type in spoken confirmation and both summaries.
## END MYAIPA LIVE PRICING POLICY`;
function assistantPatch(a,t) {
  const patch=repairPayload(a);
  patch.model.messages=updateMessages(patch.model.messages,t.function.name).map(m=>m.role==='system'?{...m,content:String(m.content).replace(/\n*## MYAIPA LIVE PRICING POLICY 2026-10-07[\s\S]*?## END MYAIPA LIVE PRICING POLICY/g,'').trimEnd()+'\n\n'+POLICY}:m);
  return patch;
}
function toolSnapshot(t){return {function:t.function,code:t.code};}
function toolGuard(t){return {function:t.function,code:t.code,environmentVariables:t.environmentVariables,messages:t.messages,timeoutSeconds:t.timeoutSeconds,rejectionPlan:t.rejectionPlan};}
function ownership(data,s) {
  if(CLOSED(s)||!s.signupAttemptId||!s.businessName||!s.businessId||!s.provisioningBusinessKey||!s.identityVerified) return 'missing_active_verified_business_identity';
  if(!s.twilioPhoneNumber||!s.vapiAssistantId||!s.vapiPhoneNumberId) return 'no_complete_pairing';
  const related=x=>x.vapiAssistantId===s.vapiAssistantId||x.vapiPhoneNumberId===s.vapiPhoneNumberId||norm(x.twilioPhoneNumber||x.assignedPhone)===norm(s.twilioPhoneNumber);
  if(data.signups.some(x=>!CLOSED(x)&&related(x)&&x.signupAttemptId!==s.signupAttemptId)) return 'shared_active_signup_resource';
  const matches=data.mappings.filter(m=>((m.matchType==='assistantId'&&m.matchValue===s.vapiAssistantId)||(m.matchType==='phoneNumber'&&norm(m.matchValue)===norm(s.twilioPhoneNumber))));
  if(!matches.some(m=>m.matchType==='assistantId'&&m.businessId===s.businessId)||!matches.some(m=>m.matchType==='phoneNumber'&&m.businessId===s.businessId)||matches.some(m=>m.businessId!==s.businessId)) return 'crm_ownership_mismatch';
  if(data.customers.some(x=>!CLOSED(x)&&related(x)&&x.businessId!==s.businessId)) return 'customer_ownership_mismatch';
  const phone=data.phones.find(p=>p.id===s.vapiPhoneNumberId);
  if(!phone||phone.number!==s.twilioPhoneNumber) return 'phone_number_mismatch';
  if(phone.assistantId?phone.assistantId!==s.vapiAssistantId:(s.agentRouteBindingMode!=='trial-gate'||(phone.server?.url||phone.serverUrl)!=='https://api.myaipa.ca/api/webhooks/voice')) return 'phone_route_mismatch';
  if(data.phones.some(p=>p.id!==phone.id&&(p.assistantId===s.vapiAssistantId||p.assistant?.id===s.vapiAssistantId))) return 'multiple_phone_bindings';
  return '';
}
async function plansFor(data,api) {
  const plans=[],skipped=[];
  for(const s of data.signups.filter(s=>!CLOSED(s)&&s.vapiAssistantId)) {
    let reason=ownership(data,s);
    if(reason){skipped.push({business:s.businessName,reason});continue;}
    const assistant=await api(`/assistant/${s.vapiAssistantId}`);
    if(!assistant.name?.startsWith('myaipa-vapi-assistant-')) {skipped.push({business:s.businessName,reason:'custom_assistant_requires_separate_review'});continue;}
    const refs=assistantReferences(assistant).filter(r=>data.tools.some(t=>t.id===r.toolId&&isManagedSummaryTool(t)));
    if(refs.length!==1||refs[0].kind!=='latest'){skipped.push({business:s.businessName,reason:'ambiguous_or_pinned_tool'});continue;}
    const tool=await api(`/tool/${refs[0].toolId}`);
    const consumers=data.assistants.filter(a=>assistantReferences(a).some(r=>r.toolId===tool.id));
    const env=Object.fromEntries((tool.environmentVariables||[]).map(e=>[e.name,e.value]));
    if(consumers.length!==1||consumers[0].id!==assistant.id||!isManagedSummaryTool(tool)||norm(env.DEFAULT_FROM_NUMBER)!==norm(s.twilioPhoneNumber)||norm(env.DEFAULT_OWNER_TO_NUMBER)!==norm(s.ownerPhone||s.businessPhone)) {skipped.push({business:s.businessName,reason:'tool_not_exclusive_or_routing_mismatch'});continue;}
    const context=(assistant.model?.messages||[]).filter(m=>m.role==='system').map(m=>String(m.content)).join('\n');
    if(!context.includes(`- Business name: ${s.businessName}`)||!context.includes('MYAIPA_AGENT_VERSION:')) {skipped.push({business:s.businessName,reason:'business_context_mismatch'});continue;}
    const payload=assistantPatch(assistant,tool), nextTool=toolPatch(tool);
    plans.push({signup:s,assistant,tool,phone:data.phones.find(p=>p.id===s.vapiPhoneNumberId),payload,nextTool});
  }
  return {plans,skipped};
}
function planDigest(plans){return hash(plans.map(p=>({attempt:p.signup.signupAttemptId,business:p.signup.businessId,phone:p.phone,assistant:speechSnapshot(p.assistant),tool:toolGuard(p.tool),payload:p.payload,nextTool:p.nextTool})));}
function encryptedBackup(plans,key,destination) {
  // Backups contain private routing context; encrypt them, never print secrets.
  const nonce=crypto.randomBytes(12),secret=crypto.hkdfSync('sha256',key,'myaipa-policy-rollout','backup-v1',32),cipher=crypto.createCipheriv('aes-256-gcm',secret,nonce);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(plans.map(p=>({assistantId:p.assistant.id,toolId:p.tool.id,assistant:speechSnapshot(p.assistant),tool:toolSnapshot(p.tool)}))),'utf8'),cipher.final()]);
  fs.mkdirSync(path.dirname(destination),{recursive:true});
  fs.writeFileSync(destination,JSON.stringify({format:'aes-256-gcm-v1',nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:encrypted.toString('base64')}),{flag:'wx'});
}
async function applyPlans({io,plans,recheck,backup}) {
  await backup(); // Fail closed if durable rollback snapshot cannot be saved.
  const results=[];
  for(const p of plans) {
    const touched=[];
    try {
      await recheck(p);
      const a=await io.api(`/assistant/${p.assistant.id}`),t=await io.api(`/tool/${p.tool.id}`);
      if(!isDeepStrictEqual(speechSnapshot(a),speechSnapshot(p.assistant))||!isDeepStrictEqual(toolGuard(t),toolGuard(p.tool))) throw new Error('Concurrent provider edit; no changes allowed.');
      touched.push({endpoint:`/tool/${t.id}`,original:toolSnapshot(t),patch:p.nextTool,type:'tool'});
      await io.api(`/tool/${t.id}`,{method:'PATCH',body:p.nextTool});
      touched.push({endpoint:`/assistant/${a.id}`,original:speechSnapshot(a),patch:p.payload,type:'assistant'});
      await io.api(`/assistant/${a.id}`,{method:'PATCH',body:p.payload});
      const [after,tool]=await Promise.all([io.api(`/assistant/${a.id}`),io.api(`/tool/${t.id}`)]);
      if(!definitionMatches(p.payload,speechSnapshot(after))||!definitionMatches(p.nextTool,toolSnapshot(tool))||!Object.values(inspectSignupSpeech(after)).every(Boolean)||!isDeepStrictEqual(tool.environmentVariables,t.environmentVariables)) throw new Error('Read-back failed.');
      if(a.latestVersion&&after.latestVersion===a.latestVersion) throw new Error('Published assistant version did not advance.');
      if(t.latestVersion&&tool.latestVersion===t.latestVersion) throw new Error('Published tool version did not advance.');
      await recheck(p);
      results.push({business:p.signup.businessName,numberLast4:p.signup.twilioPhoneNumber.slice(-4),verified:true,assistantVersion:after.latestVersion,toolVersion:tool.latestVersion});
    }catch(error){
      const rollback=[];
      for(const change of touched.reverse()) {
        const now=await io.api(change.endpoint).catch(()=>null),snapshot=change.type==='assistant'?speechSnapshot:toolSnapshot;
        if(now&&isDeepStrictEqual(snapshot(now),change.original)){rollback.push('already_original');continue;}
        if(!now||!definitionMatches(change.patch,snapshot(now))){rollback.push('concurrent_edit_or_uncertain_keep');continue;}
        try{await io.api(change.endpoint,{method:'PATCH',body:change.original});const restored=await io.api(change.endpoint);rollback.push(definitionMatches(change.original,snapshot(restored))?'restored':'restore_unconfirmed');}catch{rollback.push('restore_failed');}
      }
      results.push({business:p.signup.businessName,verified:false,error:error.message,rollback});
      break; // No further businesses are changed after any uncertain failure.
    }
  }
  return results;
}

async function clients(env) {
  const login = await fetch('https://api.myaipa.ca/api/admin/login', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({password:env.ADMIN_PASSWORD,mfaCode:env.ADMIN_TOTP_SECRET?totpCode(env.ADMIN_TOTP_SECRET):undefined}),signal:AbortSignal.timeout(20000) });
  if (!login.ok) throw new Error(`Admin login HTTP ${login.status}.`);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('Admin session not established.');
  async function request(base, endpoint, headers, {method='GET',body}={}) {
    const r=await fetch(base+endpoint,{method,headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});
    if(!r.ok) throw new Error(`${method} ${endpoint.split('/')[1]} HTTP ${r.status}.`);
    return r.json();
  }
  return { admin:p=>request('https://api.myaipa.ca',p,{cookie}), api:(p,o)=>request('https://api.vapi.ai',p,{Authorization:`Bearer ${env.VAPI_API_KEY}`},o) };
}
async function inventory({admin,api}) {
  const [s,m,c,p,a,t]=await Promise.all([admin('/api/admin/signups'),admin('/api/admin/vapi/mappings'),admin('/api/admin/customer-setup'),api('/phone-number?limit=1000'),api('/assistant?limit=1000'),api('/tool?limit=1000')]);
  const phones=listFrom(p,['phoneNumbers']), assistants=listFrom(a,['assistants']),tools=listFrom(t,['tools']);
  for(const [items,label] of [[phones,'phones'],[assistants,'assistants'],[tools,'tools']]) validateInventory(items,label);
  if(!Array.isArray(s.signups)||!Array.isArray(m.mappings)||!Array.isArray(c.customers)) throw new Error('Incomplete ownership inventory.');
  return {signups:s.signups,mappings:m.mappings,customers:c.customers,phones,assistants,tools};
}
async function main() {
  const env=loadProjectEnv();
  if(!env.ADMIN_PASSWORD||!env.VAPI_API_KEY) throw new Error('Admin and Vapi credentials required.');
  const io=await clients(env), data=await inventory(io);
  const {plans,skipped}=await plansFor(data,io.api),digest=planDigest(plans),apply=process.argv.includes('--apply');
  const report={mode:apply?'apply':'read-only',digest,counts:Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v.length])),eligible:plans.map(p=>({business:p.signup.businessName,numberLast4:p.signup.twilioPhoneNumber.slice(-4),assistantVersion:p.assistant.latestVersion,toolVersion:p.tool.latestVersion})),skipped,numbersCreated:0,billingChanged:false,routingChanged:false,liveAudioTest:'not performed',results:[]};
  if(apply){
    if(!plans.length||!process.argv.includes(`--digest=${digest}`)) throw new Error('Exact dry-run digest required; inventory/configuration changed or no eligible assistants.');
    const recheck=async p=>{
      const fresh=await inventory(io),reason=ownership(fresh,p.signup),live=fresh.signups.find(s=>s.signupAttemptId===p.signup.signupAttemptId);
      const identity=x=>[x.signupAttemptId,x.businessId,x.provisioningBusinessKey,x.vapiAssistantId,x.vapiPhoneNumberId,x.twilioPhoneNumber,x.ownerPhone||x.businessPhone];
      if(reason||!live||ownership(fresh,live)||!isDeepStrictEqual(identity(live),identity(p.signup))||!isDeepStrictEqual(fresh.phones.find(x=>x.id===p.phone.id),p.phone)) throw new Error('Fresh ownership/phone guard failed.');
      const consumers=fresh.assistants.filter(a=>assistantReferences(a).some(r=>r.toolId===p.tool.id));
      if(consumers.length!==1||consumers[0].id!==p.assistant.id) throw new Error('Tool became shared.');
      const calls=listFrom(await io.api(`/call?assistantId=${p.assistant.id}&limit=100`),['calls']);
      if(calls.some(c=>['queued','ringing','in-progress','forwarding'].includes(c.status))) throw new Error('Assistant has an active call; defer update.');
    };
    const backupPath=path.resolve('diagnostics',`vapi-policy-backup-${Date.now()}.encrypted.json`);
    report.backup=backupPath;
    report.results=await applyPlans({io,plans,recheck,backup:()=>encryptedBackup(plans,env.VAPI_API_KEY,backupPath)});
    if(report.results.length!==plans.length||report.results.some(r=>!r.verified)) process.exitCode=2;
  }
  const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
  if(out){fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={clients,inventory,ownership,assistantPatch,plansFor,planDigest,applyPlans,POLICY};
