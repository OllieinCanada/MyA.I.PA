const crypto=require('crypto');
const fingerprint=value=>crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,24);
const list=(body,key)=>Array.isArray(body)?body:Array.isArray(body?.[key])?body[key]:[];
async function collectProviderNotifications({env=process.env,fetchImpl=fetch,previous={},now=Date.now()}={}) {
  const events=[],snapshots={...previous},readiness={};
  const occurredAt=new Date(now).toISOString();
  const recent=value=>{const time=Date.parse(value);return Number.isFinite(time)&&time>=now-75*60000&&time<=now+300000;};
  async function get(url,headers={}) {
    const r=await fetchImpl(url,{headers,signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw new Error(`provider_http_${r.status}`);
    return r.json();
  }
  function transition(provider,key,condition,type,extra={}) {
    const name=`${provider}:${key}`,old=previous[name];
    snapshots[name]=condition;
    if(condition&&!old)events.push({provider,type,id:`${key}:${now}`,occurredAt,...extra});
  }
  async function source(provider,configured,fn) {
    if(!configured){readiness[provider]={status:'configuration_missing'};return;}
    try{await fn();readiness[provider]={status:'checked'};}catch(e){readiness[provider]={status:/^provider_http_\d+$/.test(e.message)?e.message:'check_failed'};}
  }
  await source('twilio',env.TWILIO_ACCOUNT_SID&&env.TWILIO_AUTH_TOKEN,async()=>{
    const headers={Authorization:'Basic '+Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')};
    const result=await get(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Balance.json`,headers);
    const balance=Number(result.balance),currency=String(result.currency||'').toUpperCase();
    if(!Number.isFinite(balance)||!/^[A-Z]{3}$/.test(currency))throw new Error('balance_unavailable');
    transition('twilio','low_balance',balance<=Number(env.PROVIDER_TWILIO_LOW_BALANCE||10),'low_balance',{amount:balance,currency});
    // A balance increase is never interpreted as a payment or automatic recharge.
  });
  await source('make',env.MAKE_API_TOKEN||env.MAKE_AUDIT_API_TOKEN,async()=>{
    const headers={Authorization:`Token ${env.MAKE_AUDIT_API_TOKEN||env.MAKE_API_TOKEN}`};
    const base=String(env.MAKE_API_BASE_URL||'https://us2.make.com/api/v2').replace(/\/$/,'');
    const ids=String(env.PROVIDER_MAKE_SCENARIO_IDS||env.MAKE_SCENARIO_ID||'3530157').split(',').map(x=>x.trim()).filter(x=>/^\d+$/.test(x));
    for(const id of ids){
      const info=await get(`${base}/scenarios/${id}`,headers),scenario=info.scenario||info;
      transition('make',`disabled:${id}`,scenario.isActive===false,'scenario_disabled');
      const logs=list(await get(`${base}/scenarios/${id}/logs`,headers),'scenarioLogs');
      for(const log of logs)if(Number(log.status)===3&&recent(log.timestamp))events.push({provider:'make',type:'workflow_failed',id:`execution:${fingerprint(log.id)}`,occurredAt:log.timestamp});
    }
    // Never substitute a manually entered consumption figure for a live feed.
    // This feed is rolling 30 days, not necessarily the customer's billing cycle.
    if(env.PROVIDER_MAKE_ORGANIZATION_ID||env.PROVIDER_MAKE_TEAM_ID){
      try{
        const resource=env.PROVIDER_MAKE_TEAM_ID?`teams/${encodeURIComponent(env.PROVIDER_MAKE_TEAM_ID)}`:`organizations/${encodeURIComponent(env.PROVIDER_MAKE_ORGANIZATION_ID)}`;
        const usage=await get(`${base}/${resource}/usage?organizationTimezone=true`,headers);
        if(!Array.isArray(usage.data)||usage.data.some(row=>!Number.isFinite(Number(row.centicredits))||Number(row.centicredits)<0))throw new Error('invalid_usage');
        const used=usage.data.reduce((sum,row)=>sum+Number(row.centicredits)/100,0);
        const warning=Number(env.PROVIDER_MAKE_30DAY_CREDIT_WARNING);
        readiness.makeCredits={status:warning>0?'checked':'threshold_required',rolling30DayCredits:used};
        if(warning>0)transition('make','credits_low',used>=warning,'usage_warning');
      }catch(e){readiness.makeCredits={status:/^provider_http_\d+$/.test(e.message)?e.message:'check_failed'};}
    }else readiness.makeCredits={status:'organization_configuration_required'};
  });
  await source('vapi',env.VAPI_API_KEY,async()=>{
    const calls=list(await get('https://api.vapi.ai/call?limit=100&createdAtGe='+encodeURIComponent(new Date(now-75*60000).toISOString()),{Authorization:`Bearer ${env.VAPI_API_KEY}`}), 'data');
    if(calls.length>=100)throw new Error('call_history_incomplete');
    let cost=0;
    for(const call of calls){
      const reason=String(call.endedReason||'');
      if(call.status==='ended'&&recent(call.endedAt||call.updatedAt)&&/(?:error|failed|worker-died|worker-shutdown|transport-never-connected|assistant-not-found|closed-websocket)/i.test(reason))events.push({provider:'vapi',type:'call_failed',id:`call:${fingerprint(call.id)}`,occurredAt:call.endedAt||call.updatedAt});
      if(Date.parse(call.createdAt)>=now-15*60000&&Number.isFinite(Number(call.cost)))cost+=Number(call.cost);
    }
    const threshold=Number(env.PROVIDER_VAPI_WINDOW_SPEND_USD);
    if(threshold>0)transition('vapi','window_spend',cost>=threshold,'spending_alert',{amount:cost,currency:'USD'});
  });
  await source('render',env.RENDER_API_KEY&&env.RENDER_SERVICE_ID,async()=>{
    const headers={Authorization:`Bearer ${env.RENDER_API_KEY}`};
    const deploys=list(await get(`https://api.render.com/v1/services/${encodeURIComponent(env.RENDER_SERVICE_ID)}/deploys?limit=20`,headers));
    for(const record of deploys){const deploy=record.deploy||record;
      if(!recent(deploy.finishedAt))continue;
      const failed=['build_failed','update_failed','pre_deploy_failed'].includes(deploy.status);
      if(deploy.status==='live'||failed)events.push({provider:'render',type:failed?'deploy_failed':'deploy_succeeded',id:`deploy:${fingerprint(deploy.id)}`,occurredAt:deploy.finishedAt});
    }
  });
  // Reachability is independent of Render account API access.
  if(env.PROVIDER_HEALTH_URL){
    const url=new URL(env.PROVIDER_HEALTH_URL);
    if(url.origin!=='https://api.myaipa.ca')throw new TypeError('Only the project API may be probed.');
    let healthy=false;
    for(let i=0;i<2;i++){try{const r=await fetchImpl(url,{signal:AbortSignal.timeout(7000)});healthy=r.ok;}catch{healthy=false;}if(healthy)break;}
    transition('render','service_down',!healthy,'service_down');
    if(healthy&&previous['render:service_down'])events.push({provider:'render',type:'service_recovered',id:`recovered:${now}`,occurredAt});
  }
  return {events,snapshots,readiness,receiptNotifications:'receipt_bridge_required'};
}
module.exports={collectProviderNotifications};
