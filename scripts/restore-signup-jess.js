// Voice-only restoration. Reuse the ownership audit; never update scripts,
// SMS tools, phone routing, billing, or historical/ambiguous assistants.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {isDeepStrictEqual} = require('node:util');
const {clients, inventory, ownership} = require('./rollout-signup-assistant-policy');
const {loadProjectEnv} = require('./_helpers');
const {speechSnapshot} = require('./repair-signup-speech');
const {signupSpeechPatch, inspectSignupSpeech} = require('../server/signupSpeechPolicy');
const {definitionMatches} = require('./vapi-release-evidence');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Admin reads can generate fresh links/derived metadata. Guard the durable
// identity, lifecycle and routing fields instead of volatile display fields.
function signupIdentity(s) {
  return ['signupAttemptId','businessId','businessName','provisioningBusinessKey','identityVerified','vapiAssistantId','vapiPhoneNumberId','twilioPhoneNumber','ownerPhone','businessPhone','status','archivedAt','agentRouteBindingMode']
    .map(k=>[k,s[k] ?? null]);
}
function desiredVoice(a) { return signupSpeechPatch(a).voice; }
function safeCandidate(data, s, a) {
  const reason = ownership(data, s);
  if (reason) return reason;
  if (a.id !== s.vapiAssistantId || !a.name?.startsWith('myaipa-vapi-assistant-')) return 'custom_or_changed_assistant';
  const checks = inspectSignupSpeech(a);
  if (Object.entries(checks).some(([k,v]) => k !== 'speechVoicePinned' && !v)) return 'opening_requires_separate_review';
  const context = (a.model?.messages || []).filter(m=>m.role==='system').map(m=>m.content).join('\n');
  if (!context.includes(`- Business name: ${s.businessName}`)) return 'business_context_mismatch';
  if (a.voice?.provider !== 'openai' || a.voice?.voiceId !== 'alloy') return 'not_the_replacement_voice';
  return '';
}
async function restore({io, data, plans, backup}) {
  await backup(plans); // No provider writes unless durable rollback exists.
  const results = [];
  for (const p of plans) {
    let touched = false;
    try {
      const freshData = await inventory(io);
      const s = freshData.signups.find(x=>x.signupAttemptId===p.signup.signupAttemptId);
      const a = await io.api(`/assistant/${p.assistant.id}`);
      if (!s || !isDeepStrictEqual(signupIdentity(s), signupIdentity(p.signup)) || safeCandidate(freshData,s,a)
          || !isDeepStrictEqual(speechSnapshot(a),speechSnapshot(p.assistant))
          || !isDeepStrictEqual(freshData.phones.find(x=>x.id===p.signup.vapiPhoneNumberId), data.phones.find(x=>x.id===p.signup.vapiPhoneNumberId))) throw Error('Ownership, route, or configuration changed; defer.');
      // Bound the active-call scan to the last 24 hours; completed historical
      // recordings make unbounded per-assistant call reads unnecessarily large.
      const since=new Date(Date.now()-24*60*60*1000).toISOString();
      const calls = await io.api(`/call?assistantId=${a.id}&createdAtGe=${encodeURIComponent(since)}&limit=100`);
      if (!Array.isArray(calls) || calls.length>=100) throw Error('Call inventory incomplete; defer.');
      if (calls.some(c=>['queued','ringing','in-progress','forwarding'].includes(c.status))) throw Error('An active call exists; defer.');
      touched = true;
      await io.api(`/assistant/${a.id}`,{method:'PATCH',body:{voice:p.voice}});
      const after = await io.api(`/assistant/${a.id}`);
      const expected = {...speechSnapshot(a),voice:p.voice};
      if (!definitionMatches(expected,speechSnapshot(after)) || !Object.values(inspectSignupSpeech(after)).every(Boolean)
          || (a.latestVersion && a.latestVersion===after.latestVersion)) throw Error('Voice readback or preserved-script check failed.');
      const finalData=await inventory(io),finalSignup=finalData.signups.find(x=>x.signupAttemptId===s.signupAttemptId);
      if(!finalSignup||!isDeepStrictEqual(signupIdentity(finalSignup),signupIdentity(s))||ownership(finalData,finalSignup)
          || !isDeepStrictEqual(finalData.phones.find(x=>x.id===s.vapiPhoneNumberId),freshData.phones.find(x=>x.id===s.vapiPhoneNumberId))) throw Error('Ownership or phone route changed after update.');
      results.push({business:s.businessName,numberLast4:s.twilioPhoneNumber.slice(-4),voice:'Jess',version:after.latestVersion,verified:true,scriptAndToolsPreserved:true});
    } catch(error) {
      let rollback='not_needed';
      if(touched) {
        const now=await io.api(`/assistant/${p.assistant.id}`).catch(()=>null);
        const expected={...speechSnapshot(p.assistant),voice:p.voice};
        if(now&&definitionMatches(expected,speechSnapshot(now))) {
          try {
            await io.api(`/assistant/${p.assistant.id}`,{method:'PATCH',body:{voice:p.assistant.voice}});
            const restored=await io.api(`/assistant/${p.assistant.id}`);
            rollback=definitionMatches(p.assistant.voice,restored.voice)?'restored':'unconfirmed';
          }catch{rollback='failed';}
        } else rollback='concurrent_edit_or_uncertain_keep';
      }
      results.push({business:p.signup.businessName,verified:false,error:error.message,rollback});
      break;
    }
  }
  return results;
}
async function main() {
  const io=await clients(loadProjectEnv()),data=await inventory(io),plans=[],skipped=[];
  for(const s of data.signups.filter(x=>x.vapiAssistantId)) {
    const reason=ownership(data,s);
    if(reason) {skipped.push({business:s.businessName,reason});continue;}
    const assistant=await io.api(`/assistant/${s.vapiAssistantId}`),failure=safeCandidate(data,s,assistant);
    if(failure){skipped.push({business:s.businessName,reason:failure});continue;}
    plans.push({signup:s,assistant,voice:desiredVoice(assistant)});
  }
  const planDigest=digest(plans.map(p=>({signup:signupIdentity(p.signup),assistant:speechSnapshot(p.assistant),voice:p.voice}))),apply=process.argv.includes('--apply');
  const report={mode:apply?'apply':'read-only',digest:planDigest,eligible:plans.map(p=>({business:p.signup.businessName,numberLast4:p.signup.twilioPhoneNumber.slice(-4),voice:p.voice})),skipped,results:[],callsPlaced:0,toolsChanged:0,billingChanged:false,audioVerified:false};
  if(apply) {
    if(!plans.length||!process.argv.includes(`--digest=${planDigest}`)) throw Error('Exact current dry-run digest required.');
    report.results=await restore({io,data,plans,backup:async candidates=>{
      const destination=path.resolve('diagnostics',`jess-voice-backup-${Date.now()}.json`);
      fs.mkdirSync(path.dirname(destination),{recursive:true});
      // Voice-only backups contain no prompts, tokens or customer contact data.
      fs.writeFileSync(destination,JSON.stringify(candidates.map(p=>({assistantId:p.assistant.id,voice:p.assistant.voice})),null,2),{flag:'wx'});
      report.backup=destination;
    }});
    if(report.results.length!==plans.length||report.results.some(r=>!r.verified))process.exitCode=2;
  }
  const out=process.argv.find(a=>a.startsWith('--out='))?.slice(6);
  if(out){fs.mkdirSync(path.dirname(path.resolve(out)),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));}
  console.log(JSON.stringify(report,null,2));
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={safeCandidate,desiredVoice,restore};
