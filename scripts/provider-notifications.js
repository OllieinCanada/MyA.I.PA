const fs=require('fs');
const path=require('path');
const {loadProjectEnv,rootPath}=require('./_helpers');
const {card,presentation,sendProviderNotification}=require('../server/providerNotifications');
async function main(){
  const env=loadProjectEnv(),preview=process.argv.includes('--preview'),demo=process.argv.includes('--send-demo');
  if(process.argv.includes('--audit')){
    try{const c=require('./run-with-render-env').readRenderCredentials();env.RENDER_API_KEY=env.RENDER_API_KEY||c.key;}catch{}
    env.RENDER_SERVICE_ID=env.RENDER_SERVICE_ID||'srv-d92503a8qa3s73crdpog';
    env.PROVIDER_HEALTH_URL='https://api.myaipa.ca/api/health/ready';
    const report=await require('../server/providerNotificationSources').collectProviderNotifications({env});
    const safe={generatedAt:new Date().toISOString(),readiness:report.readiness,eventCandidates:report.events.length,receiptNotifications:report.receiptNotifications,
      makeCredits:report.readiness.makeCredits||{status:'billing_usage_source_required'},
      vapiSpending:env.PROVIDER_VAPI_WINDOW_SPEND_USD?'configured':'threshold_required'};
    const directory=rootPath('diagnostics','provider-notifications');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'readiness.json'),JSON.stringify(safe,null,2));
    console.log(JSON.stringify(safe,null,2));return;
  }
  if(preview||demo){
    const directory=rootPath('diagnostics','provider-notifications');fs.mkdirSync(directory,{recursive:true});
    for(const provider of ['twilio','make','vapi','render']){
      const event={provider,type:provider==='twilio'?'low_balance':provider==='make'?'workflow_failed':provider==='vapi'?'call_failed':'deploy_succeeded',id:`demo:${provider}:${Date.now()}`,occurredAt:new Date().toISOString()};
      const view=presentation(event);fs.writeFileSync(path.join(directory,`${provider}.png`),card(provider,view.severity));
      if(demo)await sendProviderNotification(event,{token:env.TELEGRAM_BOT_TOKEN,chatId:env.TELEGRAM_CHAT_ID,demo:true});
    }
    console.log(JSON.stringify({previewDirectory:directory,demoCardsSent:demo?4:0}));return;
  }
  if(!env.MONITOR_API_KEY)throw new Error('MONITOR_API_KEY is required.');
  const response=await fetch('https://api.myaipa.ca/api/internal/operations/provider-notifications/poll',{method:'POST',headers:{'Content-Type':'application/json','x-monitor-api-key':env.MONITOR_API_KEY},body:JSON.stringify({confirmation:'POLL_PROVIDER_NOTIFICATIONS'}),signal:AbortSignal.timeout(150000)});
  if(!response.ok)throw new Error(`Provider poll failed (${response.status}).`);
  const report=await response.json();console.log(JSON.stringify(report,null,2));
  if(report.ok!==true||report.coverageComplete!==true)process.exitCode=1;
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
