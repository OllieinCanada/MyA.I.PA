const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {validatePostCallDrill}=require('../scripts/postcall-drill-safety');
const enabled=process.env.RUN_POSTCALL_PERSISTENCE_DRILL==='1';

test('isolated PostgreSQL terminal-call save and no-send webhook drill', {skip:!enabled,timeout:120000}, async t=>{
  const url=validatePostCallDrill(process.env);
  const {PrismaClient}=require('@prisma/client');
  const {persistCall,mergeCallData}=require('../server/callPersistence');
  const prisma=new PrismaClient({datasources:{db:{url}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});
  const originalFetch=global.fetch;let externalRequests=0,server,directory;
  global.fetch=async(u,o)=>{const p=new URL(String(u));if(p.protocol!=='http:'||p.hostname!=='127.0.0.1'){externalRequests++;throw Error('external_requests_forbidden');}return originalFetch(u,o);};
  const diagnostics=[];let fixture=0;
  async function seed(){const suffix=crypto.randomUUID();
    const business=await prisma.business.create({data:{name:'Synthetic post-call '+suffix,phone:'synthetic-'+suffix,timezone:'America/Toronto'}});
    const caller=await prisma.caller.create({data:{phone:'synthetic-caller-'+suffix}});
    const identity={businessId:business.id,callerId:caller.id,externalProvider:'vapi',externalId:suffix,twilioCallSid:'CA'+suffix.replaceAll('-','')};
    const data={...identity,startedAt:new Date(Date.now()-60000),endedAt:new Date(),status:'COMPLETED',durationSec:60,endedReason:'assistant-ended-call',aiSummary:'Synthetic final report'};
    fixture++;return {identity,data,business,caller};
  }
  function wrapped({responseDelay=0,expireBeforeWrite=false,loseCommitAck=false,expireEveryTime=false}={}){
    let attempts=0,creates=0;const errors=[];
    return {get attempts(){return attempts;},get creates(){return creates;},errors,db:{$transaction:async(fn,options)=>{
      const attempt=++attempts;
      try {const result=await prisma.$transaction(tx=>fn({$queryRaw:async(...args)=>{
        const result=await tx.$queryRaw(...args);
        const text=(args[0].strings||args[0]).join('');
        if(text.includes('FOR UPDATE')&&(expireEveryTime||expireBeforeWrite&&attempt===1))await delay(8250);
        else if(responseDelay)await delay(responseDelay);return result;
      },call:{create:async(...args)=>{creates++;const r=await tx.call.create(...args);if(responseDelay)await delay(responseDelay);return r;},
        update:async(...args)=>{const r=await tx.call.update(...args);if(responseDelay)await delay(responseDelay);return r;}}}),options);
        if(loseCommitAck&&attempt===1)throw Object.assign(Error('Transaction already closed: simulated lost commit acknowledgement'),{code:'P2028'});
        return result;
      }catch(error){errors.push(error.code);throw error;}
    }}};
  }
  const save=(db,s,data=s.data)=>persistCall({db,identity:s.identity,createData:data,postCall:true,
    updateData:row=>mergeCallData(row,data),onDiagnostic:d=>diagnostics.push(d)});
  try{
    const dbIdentity=await prisma.$queryRaw`SELECT current_database() AS db,current_user AS actor`;
    assert.deepEqual(dbIdentity,[{db:'myaipa_postcall_drill_ci',actor:'postcall_drill'}]);
    assert.equal(await prisma.business.count(),0,'refuse a populated target');
    await t.test('roughly six-second application-observed database responses save inside bounded post-call budget',async()=>{
      const s=await seed(),w=wrapped({responseDelay:1950}),start=Date.now();
      assert.equal((await save(w.db,s)).status,'COMPLETED');assert.ok(Date.now()-start>5700);assert.equal(w.attempts,1);
      assert.equal(await prisma.call.count({where:{externalId:s.identity.externalId}}),1);
    });
    await t.test('simultaneous terminal and final-report saves produce one row and retain final details',async()=>{
      const s=await seed(),w=wrapped({responseDelay:40});
      const sparse={...s.data,aiSummary:'',toolCallSummary:undefined,durationSec:0};
      const records=await Promise.all([save(w.db,s,sparse),save(w.db,s)]);
      assert.equal(records[0].id,records[1].id);assert.equal(await prisma.call.count({where:{externalId:s.identity.externalId}}),1);
      const row=await prisma.call.findUnique({where:{id:records[0].id}});assert.equal(row.aiSummary,s.data.aiSummary);assert.equal(row.durationSec,60);
    });
    await t.test('actual P2028 after identity read retries database work and creates once',async()=>{
      const s=await seed(),w=wrapped({expireBeforeWrite:true});const row=await save(w.db,s);
      assert.equal(row.status,'COMPLETED');assert.equal(w.attempts,2);assert.ok(w.errors.includes('P2028'));
      assert.equal(await prisma.call.count({where:{externalId:s.identity.externalId}}),1);
    });
    await t.test('committed write with lost acknowledgement is reconciled without a second insert',async()=>{
      const s=await seed(),w=wrapped({loseCommitAck:true});assert.equal((await save(w.db,s)).status,'COMPLETED');
      assert.equal(w.attempts,2);assert.equal(w.creates,1);assert.equal(await prisma.call.count({where:{externalId:s.identity.externalId}}),1);
    });
    await t.test('two actual expiries stop without claiming success or leaving a Call row',async()=>{
      const s=await seed(),w=wrapped({expireEveryTime:true});await assert.rejects(save(w.db,s),e=>e.code==='P2028'&&e.callPersistenceFailure===true);
      assert.equal(w.attempts,2);assert.equal(await prisma.call.count({where:{externalId:s.identity.externalId}}),0);
    });
    await t.test('fresh recovery cannot move a committed call to another business or caller',async()=>{
      const s=await seed();await save(prisma,s);const changed={...s,identity:{...s.identity,callerId:s.caller.id+100000}};
      await assert.rejects(save(prisma,changed),{code:'CALL_RECORD_IDENTITY_CONFLICT'});
      assert.equal((await prisma.call.findFirst({where:{externalId:s.identity.externalId}})).callerId,s.caller.id);
    });
    // Exercise the real authenticated HTTP ingestion branches, not just a helper.
    const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
    directory=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-postcall-drill-'));
    Object.assign(process.env,{NODE_ENV:'test',DATA_DIR:directory,SECURITY_STATE_FORCE_DATABASE:'false',
      VAPI_WEBHOOK_SECRET:'synthetic-postcall-drill-secret',VAPI_AUTO_SYNC_ENABLED:'false',TRIAL_USAGE_LIMIT_ENABLED:'false',
      TRIAL_REMINDER_DISABLE:'true',MISSED_CALL_ALERT_ENABLED:'false',DAILY_DIGEST_ENABLED:'false',SIGNUP_SETUP_WORKER_PAUSED:'true'});
    const httpDb=wrapped({responseDelay:80});global.__myAiPaPrisma=new Proxy(prisma,{get(target,key){if(key==='$transaction')return httpDb.db.$transaction;const value=target[key];return typeof value==='function'?value.bind(target):value;}});
    const {app}=require('../server/index');server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    await t.test('real status-update and end-of-call-report webhook requests persist once without provider traffic',async()=>{
      const s=await seed(),assistant='synthetic-assistant-'+fixture;
      await prisma.vapiBusinessMapping.create({data:{businessId:s.business.id,matchType:'assistantId',matchValue:assistant}});
      const call={id:s.identity.externalId,assistantId:assistant,customer:{number:s.caller.phone},status:'ended',
        startedAt:s.data.startedAt.toISOString(),endedAt:s.data.endedAt.toISOString(),endedReason:'assistant-ended-call'};
      const send=async type=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/webhooks/voice',{
        method:'POST',headers:{'content-type':'application/json','x-vapi-secret':'synthetic-postcall-drill-secret'},
        body:JSON.stringify({message:{type,status:'ended',call:type==='status-update'?{...call,endedAt:undefined,endedReason:undefined}:call,
          ...(type==='end-of-call-report'?{analysis:{summary:'Synthetic final report'}}:{})}}),signal:AbortSignal.timeout(20000)});
        const body=await r.json();assert.ok([200,201].includes(r.status),JSON.stringify(body));return body;};
      const responses=await Promise.all([send('status-update'),send('end-of-call-report')]);assert.equal(responses[0].localCallId,responses[1].localCallId);
      const rows=await prisma.call.findMany({where:{externalId:s.identity.externalId}});assert.equal(rows.length,1);assert.equal(rows[0].status,'COMPLETED');
      assert.equal(rows[0].aiSummary,'Synthetic final report');assert.equal(rows[0].endedAt.toISOString(),s.data.endedAt.toISOString());
      assert.equal(rows[0].durationSec,60);assert.equal(await prisma.vapiToolExecution.count(),0);
    });
    assert.equal(externalRequests,0);assert.ok(diagnostics.some(d=>d.outcome==='database_retry'));t.diagnostic(JSON.stringify({externalRequests,realCalls:0,realTexts:0,syntheticFixtures:fixture}));
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve));global.fetch=originalFetch;await prisma.$disconnect();
    // Only the newly generated, named test directory belongs to this drill.
    if(directory){const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
      assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep+'myaipa-postcall-drill-'));fs.rmSync(directory,{recursive:true,force:true});}
  }
});
