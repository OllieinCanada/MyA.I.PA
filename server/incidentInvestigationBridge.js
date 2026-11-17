'use strict';
const crypto=require('node:crypto');
const REASON='PROVIDER_STATUS_SAVE_TIMEOUT';
const PREFIX='incident-investigation-bridge:v1:';
const MESSAGES=Object.freeze({
  start:'My AI PA investigation starting: saving public maintenance information timed out. Read-only code investigation only; no customer actions or production changes.',
  before_edit:'My AI PA proposed fix: reduce repeated database work when saving public maintenance history. The read-only agent selected this proposal; it is not yet proven. Next: an isolated code patch and regression tests. No merge, deployment or customer actions are authorized.',
});
function fail(code,statusCode=409){throw Object.assign(new Error(code),{code,statusCode});}
function providerStatusFailureContext(error){
  if(error?.code!=='P2028')return {};
  return {reasonCode:REASON,route:'/background/public-provider-status',severity:'warning',
    reason:'The database transaction saving public status observations exceeded its time budget.',
    impact:'Saved provider maintenance information may be stale. No customer failure is established.',
    nextAction:'Investigate public-status persistence in isolation. Do not replay signups, calls, purchases or messages.',
    dedupeFingerprint:'public-provider-status-save-timeout-v1'};
}
function validateStageInput(input){
  const {incident_id:incidentId,generation,run_id:runId,base_sha:baseSha,phase}=input||{};
  if(typeof incidentId!=='string'||typeof runId!=='string'||typeof baseSha!=='string'
    ||!/^[a-f0-9]{24}$/.test(incidentId||'')||!Number.isInteger(generation)||generation<1||generation>999
    ||!/^\d{1,20}$/.test(runId||'')||!/^[a-f0-9]{40}$/.test(baseSha||'')||!Object.hasOwn(MESSAGES,phase))fail('INVESTIGATION_INPUT_INVALID',400);
  return {incidentId,generation,runId,baseSha,phase};
}
async function verifyInvestigationRun({input,repository,token,fetchImpl=fetch}){
  const v=validateStageInput(input);
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository||'')||!token)fail('INVESTIGATION_READER_UNAVAILABLE',503);
  const get=async suffix=>{
    const response=await fetchImpl(`https://api.github.com/repos/${repository}/actions/runs/${v.runId}${suffix}`,{
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},
      redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok)fail('INVESTIGATION_RUN_UNVERIFIED',503);return response.json();
  };
  const run=await get('');
  if(run.event!=='workflow_dispatch'||run.head_branch!=='main'||run.head_sha!==v.baseSha||run.run_attempt!==1
    ||run.path!=='.github/workflows/codex-incident-repair.yml'||run.status!=='in_progress'
    ||run.display_title!==`Incident ${v.incidentId} generation ${v.generation}`)fail('INVESTIGATION_RUN_MISMATCH');
  const started=Date.parse(run.run_started_at);
  if(!Number.isFinite(started)||Date.now()<started||Date.now()-started>=30*60000)fail('INVESTIGATION_BUDGET_EXHAUSTED');
  const page=await get('/jobs?per_page=100');
  if(!Array.isArray(page.jobs)||page.total_count!==page.jobs.length||page.jobs.length>100)fail('INVESTIGATION_JOBS_INCOMPLETE');
  const gate=page.jobs.filter(j=>j.name==='Authenticate the one-use repair envelope');
  if(gate.length!==1||gate[0].conclusion!=='success')fail('INVESTIGATION_GATE_UNVERIFIED');
  if(v.phase==='before_edit'){
    const analysis=page.jobs.filter(j=>j.name==='Read-only provider-status investigation');
    if(analysis.length!==1||analysis[0].conclusion!=='success')fail('INVESTIGATION_ANALYSIS_UNVERIFIED');
  }
  return v;
}
async function notifyInvestigationStage({prisma,input,enabled,incident,readIncident,verifyRun,send,now=Date.now}){
  if(enabled!==true)fail('INVESTIGATION_DISABLED',403);
  const v=validateStageInput(input);
  const checkIncident=current=>{
    if(current?.id!==v.incidentId||current.incident?.reasonCode!==REASON
      ||current.snapshot?.Route!=='/background/public-provider-status'
      ||Number(current.remediation?.generation)!==v.generation||current.remediation?.status!=='repair_dispatched')fail('INVESTIGATION_INCIDENT_MISMATCH');
  };
  checkIncident(incident);
  await verifyRun(input);
  if(readIncident)checkIncident(await readIncident());
  // A generation is bound to one exact run and sealed base, independently of
  // message stage. No lost Telegram acknowledgement is automatically retried.
  const key=PREFIX+v.incidentId+':'+v.generation;
  const binding=crypto.createHash('sha256').update(JSON.stringify([v.runId,v.baseSha])).digest('hex');
  await prisma.runtimeStore.createMany({data:[{key,data:{version:1,binding,stages:{}}}],skipDuplicates:true});
  let row=(await prisma.runtimeStore.findUnique({where:{key}}))?.data;
  if(row?.version!==1||row.binding!==binding)fail('INVESTIGATION_BINDING_CONFLICT');
  if(row.stages?.[v.phase]?.status==='accepted')return {accepted:true,duplicate:true};
  if(row.stages?.[v.phase])fail('INVESTIGATION_NOTICE_UNKNOWN');
  const token=crypto.randomUUID(),intent={status:'pending',token,startedAt:now()};
  // JSON path CAS leaves the other stage intact. Read-only analysis may proceed
  // even when the initial notice is unknown; editing requires before_edit.
  const changed=await prisma.runtimeStore.updateMany({where:{key,data:{equals:row}},data:{data:{...row,stages:{...row.stages,[v.phase]:intent}}}});
  if(changed.count!==1)fail('INVESTIGATION_STAGE_BUSY');
  let receipt;
  try{receipt=await send(MESSAGES[v.phase]);}catch{fail('INVESTIGATION_NOTICE_UNKNOWN',503);}
  if(receipt?.accepted!==true||!Number.isSafeInteger(receipt.messageId)||receipt.messageId<=0)fail('INVESTIGATION_NOTICE_UNKNOWN',503);
  // Re-read after external dispatch; on any persistence uncertainty stop. Never
  // resend. A later accepted read can acknowledge the exact same callback.
  row=(await prisma.runtimeStore.findUnique({where:{key}}))?.data;
  if(row?.binding!==binding||row.stages?.[v.phase]?.token!==token)fail('INVESTIGATION_RECEIPT_CONFLICT');
  const saved=await prisma.runtimeStore.updateMany({where:{key,data:{equals:row}},data:{data:{...row,stages:{...row.stages,[v.phase]:{...intent,status:'accepted',messageId:receipt.messageId,acceptedAt:now()}}}}});
  if(saved.count!==1)fail('INVESTIGATION_RECEIPT_UNKNOWN',503);
  return {accepted:true};
}
function registerInvestigationNoticeRoute({app,requireMonitorKey,prisma,listIncidents,getEnabled,getGitHubCredentials,getTelegramCredentials,fetchImpl=fetch}){
  const express=require('express');
  app.post('/api/internal/operations/incident-investigation-notice',requireMonitorKey,express.json({limit:'1kb'}),async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    try{
      if(getEnabled()!==true)fail('INVESTIGATION_DISABLED',403);
      const credentials=getTelegramCredentials();
      if(!credentials.token||!credentials.chatId)fail('INVESTIGATION_NOTICE_UNCONFIGURED',503);
      const incident=(await listIncidents()).find(item=>item.id===req.body?.incident_id);
      const result=await notifyInvestigationStage({prisma,input:req.body,enabled:true,incident,
        readIncident:async()=>(await listIncidents()).find(item=>item.id===req.body?.incident_id),
        verifyRun:async input=>verifyInvestigationRun({input,...await getGitHubCredentials(),fetchImpl}),
        send:async text=>{
          const response=await fetchImpl(`https://api.telegram.org/bot${credentials.token}/sendMessage`,{
            method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({chat_id:credentials.chatId,text}),signal:AbortSignal.timeout(10000)});
          if(!response.ok)return {accepted:false};
          const body=await response.json();return {accepted:body.ok===true,messageId:body.result?.message_id};
        }});
      return res.json(result);
    }catch(error){
      // Do not send raw database, transport or credential-bearing errors to a
      // caller or recursively create an incident from this failure path.
      const code=/^INVESTIGATION_[A-Z_]+$/.test(error?.code||'')?error.code:'INVESTIGATION_STAGE_UNAVAILABLE';
      return res.status(error.statusCode||503).json({accepted:false,code});
    }
  });
}
module.exports={REASON,PREFIX,MESSAGES,providerStatusFailureContext,validateStageInput,verifyInvestigationRun,notifyInvestigationStage,registerInvestigationNoticeRoute};
