const {loadProjectEnv}=require('./_helpers');
async function main(){
 const env=loadProjectEnv();
 if(process.argv.includes('--save-make-feed')){
  const token=env.MAKE_AUDIT_API_TOKEN||env.MAKE_API_TOKEN;
  const headers={Authorization:`Token ${token}`};
  const response=await fetch('https://us2.make.com/api/v2/teams/1609349/usage?organizationTimezone=true',{headers});
  if(!response.ok)throw new Error(`Make usage verification failed ${response.status}`);
  const usage=await response.json();
  if(!Array.isArray(usage.data))throw new Error('Make usage shape is invalid');
  const credentials=require('./run-with-render-env').readRenderCredentials();
  for(const [key,value] of Object.entries({MAKE_AUDIT_API_TOKEN:token,PROVIDER_MAKE_TEAM_ID:'1609349',PROVIDER_MAKE_30DAY_CREDIT_WARNING:'8000'})){
   const endpoint=`${credentials.host}/services/srv-d92503a8qa3s73crdpog/env-vars/${key}`;
   const auth={Authorization:`Bearer ${credentials.key}`,'Content-Type':'application/json'};
   const r=await fetch(endpoint,{method:'PUT',headers:auth,body:JSON.stringify({value})});
   if(!r.ok)throw new Error(`Render save failed for ${key}: ${r.status}`);
   const check=await fetch(endpoint,{headers:auth});const b=await check.json();
   if(!check.ok||String(b.value||b.envVar?.value)!==value)throw new Error(`Readback failed for ${key}`);
  }
  console.log(JSON.stringify({savedToRender:true,source:'Make team usage API',warningRolling30DayCredits:8000,currentRolling30DayCredits:usage.data.reduce((sum,row)=>sum+Number(row.centicredits)/100,0),deploymentTriggered:false}));return;
 }
 if(process.argv.includes('--save-threshold')){
  const credentials=require('./run-with-render-env').readRenderCredentials();
  const endpoint=`${credentials.host}/services/srv-d92503a8qa3s73crdpog/env-vars/PROVIDER_VAPI_WINDOW_SPEND_USD`;
  const headers={Authorization:`Bearer ${credentials.key}`,'Content-Type':'application/json'};
  const existing=await fetch(endpoint,{headers});
  const before=existing.ok?await existing.json():null;
  const value=String(before?.value||before?.envVar?.value||'5');
  if(!(Number(value)>0))throw new Error('Existing threshold is invalid; refusing to overwrite.');
  if(existing.status!==404&&!existing.ok)throw new Error(`Render read failed ${existing.status}`);
  const saved=await fetch(endpoint,{method:'PUT',headers,body:JSON.stringify({value})});
  if(!saved.ok)throw new Error(`Render setting failed ${saved.status}`);
  const check=await fetch(endpoint,{headers});const result=await check.json();
  if(String(result.value||result.envVar?.value)!==value)throw new Error('Threshold readback failed');
  console.log(JSON.stringify({vapiWindowMinutes:15,warningUSD:Number(value),savedToRender:true,deploymentTriggered:false}));return;
 }
 const headers={Authorization:`Token ${env.MAKE_API_TOKEN||env.MAKE_AUDIT_API_TOKEN}`};
 for(const suffix of ['organizations?cols[]=id&cols[]=license&cols[]=serviceName', 'teams/1609349', 'teams/1609349/usage?organizationTimezone=true', 'organizations/5814892/usage?organizationTimezone=true']){
  const r=await fetch(`https://us2.make.com/api/v2/${suffix}`,{headers});
  const b=await r.json();
  if(!r.ok){console.log(JSON.stringify({endpoint:suffix,status:r.status}));continue;}
  if(suffix.startsWith('organizations?'))console.log(JSON.stringify({organizations:b.organizations?.map(o=>({id:o.id,license:o.license,serviceName:o.serviceName,centicreditsConsumed:o.centicreditsConsumed,nextReset:o.nextReset}))}));
  else if(suffix==='teams/1609349'){const t=b.team||b;console.log(JSON.stringify({keys:Object.keys(t),operationsLimit:t.operationsLimit,operations:t.operations,consumedCenticredits:t.consumedCenticredits,consumedOperations:t.consumedOperations,organizationId:t.organizationId}));}
  else if(suffix.startsWith('scenarios'))console.log(JSON.stringify({teamId:b.scenario?.teamId}));
  else if(suffix.includes('/usage'))console.log(JSON.stringify({usageSample:b.data?.slice(-2)}));
  else {const o=b.organization||b;console.log(JSON.stringify({keys:Object.keys(o),license:o.license,usage:o.usage,centicredits:o.centicredits,operations:o.operations,reset:o.reset}));}
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
