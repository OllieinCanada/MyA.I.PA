'use strict';
// Public status observations, not customer failures, availability guarantees or repair authority.
const crypto=require('node:crypto');
const {redactIncidentText}=require('./incidentAlerts');
const PROVIDERS=Object.freeze({
 render:{name:'Render',origin:'https://status.render.com',feed:'/api/v2/summary.json',features:'Hosting administration, deployments and database availability (see affected components)'},
 twilio:{name:'Twilio',origin:'https://status.twilio.com',feed:'/api/v2/summary.json',features:'Number provisioning, calls and messaging (region/carrier applicability requires review)'},
 make:{name:'Make',origin:'https://status.make.com',feed:'/api/v2/summary.json',features:'Signup automation and webhooks (zone applicability requires review)'},
 vapi:{name:'Vapi',origin:'https://status.vapi.ai',feed:null,features:'AI answering, assistant setup and SIP routing'},
});
const PREFIX='provider-status:v1:',HISTORY='provider-status-history:v1:',MAX_BYTES=1024*1024,STALE_MS=15*60*1000;
const digest=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Plain-text projection, not an HTML sanitizer. Remove all tag delimiters,
// including malformed/nested tags; React escapes rendered text independently.
const safe=(v,n=1600)=>redactIncidentText(typeof v==='string'?v:'',{multiline:true,maxLength:n}).replace(/[<>]/g,'');
const stamp=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))?new Date(v).toISOString():null;
const reject=()=>{throw Object.assign(Error('Public provider evidence is incomplete or invalid.'),{code:'PROVIDER_STATUS_INVALID'});};
function publicNotice(notice,provider){
 const c=PROVIDERS[provider],n=notice;
 if(!c||n?.provider!==provider||!/^[a-zA-Z0-9_-]{1,80}$/.test(n.id||'')||!['maintenance','incident'].includes(n.kind)||typeof n.title!=='string'||!n.title||!Array.isArray(n.components)||n.components.some(v=>typeof v!=='string')||typeof n.description!=='string'||!stamp(n.updatedAt))reject();
 const states=n.kind==='maintenance'?['scheduled','in_progress','verifying','completed']:['investigating','identified','monitoring','resolved','postmortem'];
 if(!states.includes(n.status)||n.kind==='maintenance'&&(!stamp(n.start)||!stamp(n.end)||n.end<n.start))reject();
 return {provider,id:n.id,kind:n.kind,title:safe(n.title,240),status:n.status,start:stamp(n.start),end:stamp(n.end),components:n.components.map(v=>safe(v,160)),description:safe(n.description),updatedAt:stamp(n.updatedAt),sourceUrl:c.origin+'/incidents/'+n.id,features:c.features,customerImpact:'Not verified for any specific signup, account, region or carrier.'};
}
function normalizeFeed(provider,body,checkedAt=Date.now()){
 const config=PROVIDERS[provider];if(!config?.feed||!body||body.page?.url?.replace(/\/$/,'')!==config.origin||!Array.isArray(body.components)||!body.components.length||!Array.isArray(body.incidents)||!Array.isArray(body.scheduled_maintenances))reject();
 if(body.components.length>1000||body.incidents.length>100||body.scheduled_maintenances.length>200||body.components.some(c=>!c||typeof c.id!=='string'||!c.id||typeof c.name!=='string'||!c.name||!['operational','under_maintenance','degraded_performance','partial_outage','major_outage'].includes(c.status)))reject();
 const statuses=['none','minor','major','critical','maintenance'];if(!statuses.includes(body.status?.indicator))reject();
 const notices=[...body.incidents.map(e=>[e,'incident']),...body.scheduled_maintenances.map(e=>[e,'maintenance'])].map(([e,kind])=>{
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(e.id||'')||!e.name||!Array.isArray(e.incident_updates)||!e.incident_updates.length||!Array.isArray(e.components))reject();
  const states=kind==='maintenance'?['scheduled','in_progress','verifying','completed']:['investigating','identified','monitoring','resolved','postmortem'];if(!states.includes(e.status))reject();
  const start=stamp(e.scheduled_for),end=stamp(e.scheduled_until);if(kind==='maintenance'&&(!start||!end||end<start))reject();
  const updates=e.incident_updates.map(u=>{const at=stamp(u.created_at);if(!at||!u.body)reject();return {at,text:safe(u.body)};}).sort((a,b)=>b.at.localeCompare(a.at));
  const components=e.components.map(c=>{if(!c.name)reject();return safe(c.name,160);});
  return {provider,id:e.id,kind,title:safe(e.name,240),status:e.status,start,end,components,description:updates[0].text,updatedAt:updates[0].at,
   sourceUrl:config.origin+'/incidents/'+e.id,features:config.features,customerImpact:'Not verified for any specific signup, account, region or carrier.'};
 });
 if(new Set(notices.map(e=>e.id)).size!==notices.length)reject();
 return {version:1,provider,checkedAt:new Date(checkedAt).toISOString(),outcome:'observed',indicator:body.status.indicator,notices};
}
async function fetchProviderStatus(provider,{fetchImpl=fetch,now=Date.now}={}){
 const c=PROVIDERS[provider];if(!c?.feed)return {version:1,provider,outcome:'unsupported',checkedAt:new Date(now()).toISOString(),failure:'Automated feed adapter is not verified. Check the official source manually.'};
 try{
  const response=await fetchImpl(c.origin+c.feed,{method:'GET',redirect:'error',headers:{Accept:'application/json'},signal:AbortSignal.timeout(7000)});
  if(!response.ok||!response.body||!String(response.headers.get('content-type')).includes('json'))reject();
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>MAX_BYTES)reject();chunks.push(Buffer.from(part.value));}}finally{await reader.cancel().catch(()=>{});}
  return normalizeFeed(provider,JSON.parse(Buffer.concat(chunks).toString('utf8')),now());
 }catch{return {version:1,provider,outcome:'unavailable',checkedAt:new Date(now()).toISOString(),failure:'Official status feed could not be verified. This is not proof of provider downtime or health.'};}
}
async function saveObservation(prisma,observation){
 if(observation.version!==1||!Object.hasOwn(PROVIDERS,observation.provider)||!stamp(observation.checkedAt)||!['observed','unavailable','unsupported'].includes(observation.outcome))reject();
 if(observation.outcome==='observed'&&(!Array.isArray(observation.notices)||!['none','minor','major','critical','maintenance'].includes(observation.indicator)))reject();
 if(observation.outcome==='observed')observation={...observation,notices:observation.notices.map(n=>publicNotice(n,observation.provider))};
 return prisma.$transaction(async tx=>{
  const key=PREFIX+observation.provider;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
  const old=await tx.runtimeStore.findUnique({where:{key}});
  if(old?.data?.checkedAt>observation.checkedAt)return {saved:false,superseded:true};
  const lastGood=observation.outcome==='observed'?observation:old?.data?.lastGood||null;
  if(observation.outcome==='observed')for(const notice of observation.notices){
   const historyKey=HISTORY+digest([observation.provider,notice.id,notice]);
   if(!await tx.runtimeStore.findUnique({where:{key:historyKey}}))await tx.runtimeStore.create({data:{key:historyKey,data:{version:1,provider:observation.provider,observedAt:observation.checkedAt,notice}}});
  }
  const data={...observation,lastGood};await tx.runtimeStore.upsert({where:{key},create:{key,data},update:{data}});return {saved:true};
 },{maxWait:2000,timeout:5000});
}
async function refreshProviderStatuses({prisma,fetchImpl=fetch,now=Date.now}){
 const results=[];for(const provider of Object.keys(PROVIDERS)){
  const observation=await fetchProviderStatus(provider,{fetchImpl,now});await saveObservation(prisma,observation);results.push({provider,outcome:observation.outcome});
 }return results;
}
async function readProviderStatuses({prisma,now=Date.now,cursor}){
 if(cursor!==undefined&&!/^[a-f0-9]{64}$/.test(cursor))throw Object.assign(Error('Invalid history cursor'),{statusCode:400});
 if(cursor&&!await prisma.runtimeStore.findUnique({where:{key:HISTORY+cursor}}))throw Object.assign(Error('Invalid history cursor'),{statusCode:400});
 const snapshots=await prisma.runtimeStore.findMany({where:{key:{startsWith:PREFIX}}});
 const rows=await prisma.runtimeStore.findMany({where:{key:{startsWith:HISTORY}},orderBy:[{createdAt:'desc'},{key:'desc'}],take:31,...(cursor?{cursor:{key:HISTORY+cursor},skip:1}:{})});
 const providers=Object.entries(PROVIDERS).map(([id,c])=>{
  const data=snapshots.find(r=>r.key===PREFIX+id)?.data;
  if(data&&(data.version!==1||data.provider!==id||!stamp(data.checkedAt)||!['observed','unavailable','unsupported'].includes(data.outcome)))reject();
  const last=data?.lastGood;const age=last?now()-Date.parse(last.checkedAt):null;
  if(last&&(last.provider!==id||last.outcome!=='observed'||!stamp(last.checkedAt)||!Array.isArray(last.notices)||!['none','minor','major','critical','maintenance'].includes(last.indicator)))reject();
  const fresh=data?.outcome==='observed'&&age>=0&&age<=STALE_MS;
  return {id,name:c.name,sourceUrl:c.origin,features:c.features,outcome:data?.outcome||'not_checked',checkedAt:data?.checkedAt||null,lastSuccessfulAt:last?.checkedAt||null,
   fresh,indicator:fresh?last.indicator:'unknown',notices:(last?.notices||[]).map(n=>publicNotice(n,id)),failure:data?.outcome==='unsupported'?'Automated feed adapter is not verified. Check the official source manually.':data?.outcome==='unavailable'?'Official status feed could not be verified. This is not proof of downtime or health.':null};
 });
 const history=rows.slice(0,30).map(r=>{if(r.data?.version!==1||!Object.hasOwn(PROVIDERS,r.data.provider)||!r.data.notice||!stamp(r.data.observedAt))reject();return {version:1,provider:r.data.provider,observedAt:r.data.observedAt,notice:publicNotice(r.data.notice,r.data.provider),ref:r.key.slice(HISTORY.length)};});
 return {readOnly:true,ready:false,providers,history,hasMore:rows.length>30,nextCursor:rows.length>30?history.at(-1).ref:null,
  limitation:'Public provider reports only—not application uptime or proof of impact on a particular signup. Missing events do not prove resolution. Private maintenance notices require separate verified evidence. This in-app poller cannot detect or announce its own complete hosting outage.'};
}
function registerProviderStatusRoutes({app,requireAdmin,prisma}){
 app.get('/api/admin/provider-status',requireAdmin,async(req,res)=>{
  res.set('Cache-Control','no-store');try{const report=await readProviderStatuses({prisma,cursor:req.query?.cursor});report.nextCursor=report.hasMore?report.history.at(-1).ref:null;res.json(report);}
  catch(e){res.status(e.statusCode===400?400:503).json({error:'Maintenance history is unavailable or its scope is invalid. Do not assume all providers are healthy.'});}
 });
}
function maintenanceMessage(notice){
 const c=PROVIDERS[notice.provider];if(!c)reject();notice=publicNotice(notice,notice.provider);
 const date=v=>v?new Date(v).toLocaleString('en-CA',{timeZone:'America/Toronto',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',timeZoneName:'short'}):'Not specified';
 return ['MY AI PA — PROVIDER '+notice.kind.toUpperCase(),c.name+': '+notice.title,'Status reported by provider: '+notice.status,
  notice.start?'Window (Toronto): '+date(notice.start)+' to '+date(notice.end):'',
  'Affected components: '+(notice.components.join(', ')||'Not specified'),notice.description,
  'This is a provider notice, not proof of a My AI PA outage. No customer action, retry or purchase was triggered.',notice.sourceUrl].filter(Boolean).join('\n\n');
}
module.exports={PROVIDERS,PREFIX,HISTORY,STALE_MS,normalizeFeed,fetchProviderStatus,saveObservation,refreshProviderStatuses,readProviderStatuses,registerProviderStatusRoutes,maintenanceMessage};
