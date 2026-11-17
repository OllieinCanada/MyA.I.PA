'use strict';
const fs=require('node:fs');
const {validateStageInput}=require('../server/incidentInvestigationBridge');
function remainingMinutes(deadline,now=Date.now()){
  if(!/^\d{13}$/.test(String(deadline||'')))throw Error('Investigation deadline is absent.');
  // Reserve one minute for action startup; never round a partial minute up.
  const remaining=Math.min(15,Math.floor((Number(deadline)-now)/60000)-1);
  if(remaining<1)throw Error('Investigation admission window exhausted.');
  return remaining;
}
function validateAnalysis(value){
  const keys=Object.keys(value||{}).sort();
  if(JSON.stringify(keys)!==JSON.stringify(['proposal','requires_human','scope_confirmed'])
    ||value.scope_confirmed!==true||value.requires_human!==false||value.proposal!=='batch_history_writes')
    throw Error('Read-only analysis did not select the supported isolated proposal. Human review required.');
  return {proposal:'batch_history_writes'};
}
async function notifyFromEnvironment(env=process.env,fetchImpl=fetch){
  const input={incident_id:env.INCIDENT_ID,generation:Number(env.GENERATION),run_id:env.RUN_ID,base_sha:env.BASE_SHA,phase:env.NOTICE_PHASE};
  validateStageInput(input);
  if(!env.MONITOR_API_KEY)throw Error('Notification callback credential is unavailable.');
  // No user-supplied URL, no redirects, no automatic retry on unknown outcome.
  const response=await fetchImpl('https://api.myaipa.ca/api/internal/operations/incident-investigation-notice',{
    method:'POST',redirect:'error',headers:{Authorization:`Bearer ${env.MONITOR_API_KEY}`,'Content-Type':'application/json'},
    body:JSON.stringify(input),signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`Notification gate refused (HTTP ${response.status}).`);
  const body=await response.json();if(body.accepted!==true)throw Error('Notification acceptance is unverified.');
  return {accepted:true};
}
if(require.main===module){
  Promise.resolve().then(()=>{
    if(process.argv[2]==='validate-analysis')return validateAnalysis(JSON.parse(fs.readFileSync(process.argv[3],'utf8')));
    if(process.argv[2]==='notify')return notifyFromEnvironment();
    if(process.argv[2]==='admit'){
      const minutes=remainingMinutes(process.env.INVESTIGATION_DEADLINE);
      if(!process.env.GITHUB_OUTPUT)throw Error('Workflow output is absent.');
      fs.appendFileSync(process.env.GITHUB_OUTPUT,`remaining_minutes=${minutes}\n`);
      return {admitted:true};
    }
    throw Error('Unknown investigation stage.');
  }).then(()=>console.log('Investigation stage verified.')).catch(()=>{
    // Never serialize transport errors, headers, URLs with credentials or model prose.
    console.error('Investigation stage did not verify; inspect the sealed run.');process.exitCode=1;
  });
}
module.exports={validateAnalysis,notifyFromEnvironment,remainingMinutes};
