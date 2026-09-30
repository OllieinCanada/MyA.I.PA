const {deliverDurably,validateEvent}=require('./providerNotifications');
const {collectProviderNotifications}=require('./providerNotificationSources');
function registerProviderNotificationRoutes(app,{requireMonitorKey,prisma,env=process.env}={}) {
  let polling=false;
  const options={prisma,token:env.TELEGRAM_BOT_TOKEN,chatId:env.TELEGRAM_CHAT_ID};
  app.post('/api/internal/operations/provider-notifications/event',requireMonitorKey,async(req,res,next)=>{
    try{
      // Only an authenticated receipt relay or trusted internal adapter may publish.
      let event;try{event=validateEvent(req.body);}catch{ return res.status(400).json({error:'Invalid provider notification or missing payment evidence.'});}
      return res.json(await deliverDurably(event,options));
    }catch(e){next(e);}
  });
  app.post('/api/internal/operations/provider-notifications/poll',requireMonitorKey,async(req,res,next)=>{
    if(req.body?.confirmation!=='POLL_PROVIDER_NOTIFICATIONS')return res.status(400).json({error:'Explicit poll confirmation is required.'});
    if(polling)return res.status(409).json({error:'A provider poll is already running.'});
    polling=true;
    const lockKey='provider-notifications:poll-lock';let locked=false;
    try{
      locked=await prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))::text AS lock_result`;
        const row=await tx.runtimeStore.findUnique({where:{key:lockKey}});
        if(Number(row?.data?.leaseUntil)>Date.now())return false;
        const data={leaseUntil:Date.now()+600000};await tx.runtimeStore.upsert({where:{key:lockKey},create:{key:lockKey,data},update:{data}});return true;
      });
      if(!locked)return res.status(409).json({error:'A provider poll is already running.'});
      const key='provider-notifications:poll-state',row=await prisma.runtimeStore.findUnique({where:{key}});
      const report=await collectProviderNotifications({env,previous:row?.data?.snapshots||{}});
      const events=[...new Map([...(row?.data?.pending||[]),...report.events].map(event=>[`${event.provider}:${event.id}`,event])).values()];
      if(events.length>5000)throw new Error('Provider notification backlog needs attention; no queued events were discarded.');
      const pending=[];let delivered=0,duplicates=0;
      for(const event of events.slice(0,10)){
        try{const r=await deliverDurably(event,options);if(r.delivered)delivered++;else duplicates++;}catch{pending.push(event);}
      }
      pending.push(...events.slice(10));
      const data={snapshots:report.snapshots,pending,updatedAt:new Date().toISOString()};
      await prisma.runtimeStore.upsert({where:{key},create:{key,data},update:{data}});
      return res.json({ok:pending.length===0,coverageComplete:Object.values(report.readiness).every(item=>item.status==='checked'),delivered,duplicates,pending:pending.length,readiness:report.readiness,receiptNotifications:report.receiptNotifications});
    }catch(e){next(e);}finally{if(locked)await prisma.runtimeStore.update({where:{key:lockKey},data:{data:{leaseUntil:0}}}).catch(()=>{});polling=false;}
  });
}
module.exports={registerProviderNotificationRoutes};
