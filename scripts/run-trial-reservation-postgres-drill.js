'use strict';
// Actual webhook + actual PostgreSQL. Inject response latency, never a carrier.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {validateDrillTarget}=require('./trial-reservation-drill-safety');
const ROOT=path.resolve(__dirname,'..');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){
  const url=validateDrillTarget(process.env);
  const head=spawnSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8',shell:false});
  assert.equal(head.status,0);assert.match(process.env.TRIAL_RESERVATION_DRILL_EXPECTED_HEAD||'',/^[a-f0-9]{40}$/);
  assert.equal(head.stdout.trim(),process.env.TRIAL_RESERVATION_DRILL_EXPECTED_HEAD);
  const reportDir=path.join(ROOT,'diagnostics/trial-reservation-drill',String(Date.now()));
  fs.mkdirSync(reportDir,{recursive:true});
  const report={schemaVersion:1,commit:head.stdout.trim(),startedAt:new Date().toISOString(),realPostgreSQL:true,
    realHttpWebhook:true,injectedLatency:'Application-observed response delay around actual Prisma queries inside real transactions; not a carrier/network test',
    productionTouched:false,realCalls:0,realTexts:0,externalRequests:0,cases:[],passed:false};
  const {PrismaClient}=require('@prisma/client'),{Client}=require('pg');
  const prisma=new PrismaClient({datasources:{db:{url}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});
  const control=new Client({connectionString:url,connectionTimeoutMillis:5000,query_timeout:10000});
  let server,directory,delayMs=0,mode='',caseNumber=0,connected=false;
  const responses=new Map(),failures=new Map();
  const originalFetch=global.fetch,originalInfo=console.info,originalWarn=console.warn;
  function wrap(target,inTransaction=false){return new Proxy(target,{get(t,k){
    if(k==='$transaction')return(fn,options)=>t.$transaction(tx=>fn(wrap(tx,true)),options);
    const value=t[k];
    if(typeof value==='function')return async(...args)=>{
      if(mode==='statement-timeout'&&k==='$queryRaw'&&args[0]?.join?.('?').includes('AS "usedSeconds"'))
        return t.$queryRaw`SELECT pg_sleep(1)::text`;
      const result=await value.apply(t,args);
      const responseDelay=mode==='transaction-timeout'?(inTransaction?1100:0):delayMs;
      if(responseDelay)await sleep(responseDelay);return result;
    };
    if(value&&typeof value==='object')return wrap(value,inTransaction);
    return value;
  }});}
  try{
    await control.connect();connected=true;await prisma.$connect();
    const identity=(await control.query('SELECT current_database() AS db,current_user AS actor')).rows[0];
    assert.equal(identity.db,'myaipa_trial_reservation_drill_ci');assert.equal(identity.actor,'trial_drill');
    assert.equal(Number((await control.query("SELECT count(*) AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n),0,
      'Refuse any existing schema; the drill only owns a fresh disposable database');
    await control.query('CREATE TABLE "RuntimeStore" ("key" TEXT PRIMARY KEY,"data" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL)');
    await control.query('CREATE TABLE "Call" ("businessId" INTEGER NOT NULL,"externalProvider" TEXT,"startedAt" TIMESTAMP(3) NOT NULL,"durationSec" INTEGER)');
    await control.query(`CREATE FUNCTION reject_synthetic_index() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.data->>'callId' LIKE 'reject-index-%' AND NEW.data->>'reservationKey' IS NOT NULL THEN
        RAISE EXCEPTION 'synthetic index rejection' USING ERRCODE='23514'; END IF; RETURN NEW; END $$`);
    await control.query('CREATE TRIGGER reject_synthetic_index BEFORE INSERT OR UPDATE ON "RuntimeStore" FOR EACH ROW EXECUTE FUNCTION reject_synthetic_index()');
    directory=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-trial-reservation-drill-'));
    Object.assign(process.env,{NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1',DATABASE_URL:url,DATA_DIR:directory,
      SECURITY_STATE_FORCE_DATABASE:'false',VAPI_WEBHOOK_SECRET:'synthetic-trial-drill-secret',VAPI_API_KEY:'',
      TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:'',STRIPE_SECRET_KEY:'',TWILIO_ACCOUNT_SID:'',TWILIO_AUTH_TOKEN:'',SMTP_HOST:'',
      MAKE_SIGNUP_WEBHOOK_URL:'',TRIAL_REMINDER_DISABLE:'true',VAPI_AUTO_SYNC_ENABLED:'false',MISSED_CALL_ALERT_ENABLED:'false',
      DAILY_DIGEST_ENABLED:'false',SIGNUP_SETUP_WORKER_PAUSED:'true',TRIAL_USAGE_LIMIT_ENABLED:'true'});
    global.__myAiPaPrisma=wrap(prisma);
    global.fetch=async(input,options)=>{
      const u=new URL(String(input));if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'){
        report.externalRequests++;throw Error('trial_drill_external_request_forbidden');}
      return originalFetch(input,options);
    };
    console.info=(...args)=>{
      if(args[0]==='[voice:assistant-response]'){try{const row=JSON.parse(args[1]);responses.set(row.callId,row);}catch{}}
      originalInfo(...args);
    };
    console.warn=(...args)=>{
      if(args[0]==='[voice:assistant-failure]'){try{const row=JSON.parse(args[1]);failures.set(row.callId,row);}catch{}}
      originalWarn(...args);
    };
    const {app,__test}=require('../server/index');
    server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    const base='http://127.0.0.1:'+server.address().port;
    async function seed({used=0,expired=false}={}){
      caseNumber++;delayMs=0;mode='';
      const signup={signupAttemptId:'trial-drill-'+caseNumber,businessId:1000+caseNumber,businessName:'Synthetic Electric '+caseNumber,
        ownerEmail:'trial-'+caseNumber+'@example.invalid',ownerPhone:'+15555550100',businessPhone:'+15555550100',
        twilioPhoneNumber:'+1555555'+String(2000+caseNumber),vapiPhoneNumberId:'trial-drill-phone-'+caseNumber,
        vapiAssistantId:'trial-drill-assistant-'+caseNumber,subscriptionId:'trial-drill-sub-'+caseNumber,
        subscriptionStatus:'trialing',status:'setup_ready',trialStartAt:Date.now()-60000,trialEndAt:Date.now()+(expired?-1000:86400000)};
      __test.upsertSignupDashboardRecord(signup);
      const gate={status:'active',businessId:signup.businessId,assistantId:signup.vapiAssistantId,phoneNumberId:signup.vapiPhoneNumberId,
        phoneNumber:signup.twilioPhoneNumber,subscriptionId:signup.subscriptionId,signupAttemptId:signup.signupAttemptId,
        assistantMaxSeconds:300,fallbackPhone:signup.ownerPhone};
      for(const key of ['trial-voice-gate:phone-id:'+signup.vapiPhoneNumberId,'trial-voice-gate:number:'+signup.twilioPhoneNumber])
        await prisma.runtimeStore.create({data:{key,data:gate}});
      if(used)await control.query('INSERT INTO "Call" VALUES ($1,\'vapi\',$2,$3)',[signup.businessId,new Date(),used]);
      return signup;
    }
    async function request(signup,id){
      const started=Date.now();const r=await fetch(base+'/api/webhooks/voice',{method:'POST',
        headers:{'content-type':'application/json','x-vapi-secret':'synthetic-trial-drill-secret'},
        body:JSON.stringify({message:{type:'assistant-request',phoneNumber:{id:signup.vapiPhoneNumberId,number:signup.twilioPhoneNumber},
          call:{id,phoneNumberId:signup.vapiPhoneNumberId,customer:{number:'+15555550102'},transport:{forwardedFrom:signup.ownerPhone}}}}),
        signal:AbortSignal.timeout(7000)});
      assert.equal(r.status,200);const body=await r.json();await new Promise(resolve=>setImmediate(resolve));
      return{body,elapsedMs:Date.now()-started,diagnostic:responses.get(id),failure:failures.get(id)};
    }
    async function leases(id){return(await control.query('SELECT key,data FROM "RuntimeStore" WHERE data->\'reservations\' ? $1',[id])).rows;}
    async function indexes(id){return(await control.query('SELECT key,data FROM "RuntimeStore" WHERE data->>\'callId\'=$1 AND data ? \'reservationKey\'',[id])).rows;}
    async function check(name,fn){report.currentCase=name;const started=Date.now();const details=await fn();assert.equal(report.externalRequests,0);
      report.cases.push({name,passed:true,milliseconds:Date.now()-started,...details});console.log(JSON.stringify({case:name,passed:true}));}
    await check('slow_database_response_over_former_1800ms_cap_still_returns_assistant',async()=>{
      const s=await seed();delayMs=480;const r=await request(s,'slow-response');
      assert.deepEqual(r.body,{assistantId:s.vapiAssistantId});assert.ok(r.diagnostic.stages.trialReservation>1800);
      assert.ok(r.elapsedMs<4500);assert.equal(r.diagnostic.outcome,'assistant');assert.ok(r.diagnostic.stages.signupLookup>=0);
      assert.equal((await indexes('slow-response')).length,1);return{requestMs:r.elapsedMs,transactionMs:r.diagnostic.stages.trialReservation};
    });
    await check('simultaneous_distinct_calls_with_room_both_reserve_once',async()=>{
      const s=await seed();delayMs=40;const results=await Promise.all(['parallel-a','parallel-b'].map(id=>request(s,id)));
      for(const r of results)assert.deepEqual(r.body,{assistantId:s.vapiAssistantId});
      const rows=await leases('parallel-a');assert.equal(rows.length,1);assert.equal(Object.keys(rows[0].data.reservations).length,2);
      assert.equal(Object.values(rows[0].data.reservations).reduce((n,x)=>n+x.allowanceSeconds,0),600);
      for(const id of ['parallel-a','parallel-b'])assert.equal((await indexes(id)).length,1);
    });
    await check('simultaneous_duplicate_event_replays_one_reservation',async()=>{
      const s=await seed();delayMs=40;const results=await Promise.all([request(s,'same-call'),request(s,'same-call')]);
      for(const r of results)assert.deepEqual(r.body,{assistantId:s.vapiAssistantId});
      assert.equal(Object.keys((await leases('same-call'))[0].data.reservations).length,1);assert.equal((await indexes('same-call')).length,1);
    });
    await check('simultaneous_calls_cannot_overspend_near_cutoff',async()=>{
      const s=await seed({used:3000});delayMs=40;const ids=['quota-a','quota-b'];const results=await Promise.all(ids.map(id=>request(s,id)));
      assert.equal(results.filter(r=>r.body.assistantId===s.vapiAssistantId).length,1);assert.equal(results.filter(r=>r.body.error).length,1);
      for(let i=0;i<2;i++){assert.equal((await indexes(ids[i])).length,results[i].body.assistantId?1:0);assert.equal(results[i].body.destination,undefined);}
    });
    await check('held_advisory_lock_fails_bounded_without_new_allowance',async()=>{
      const s=await seed();await request(s,'lock-seed');const key=(await leases('lock-seed'))[0].key;
      await control.query('BEGIN');try{await control.query('SELECT pg_advisory_xact_lock(hashtext($1))::text',[key]);
        const r=await request(s,'lock-held');assert.ok(r.body.error);assert.ok(r.elapsedMs<2500);assert.equal(r.diagnostic.outcome,'application_error');
        assert.equal((await leases('lock-held')).length,0);return{requestMs:r.elapsedMs};
      }finally{await control.query('ROLLBACK');}
    });
    await check('actual_server_statement_timeout_rolls_back_and_never_answers',async()=>{
      const s=await seed();mode='statement-timeout';const r=await request(s,'statement-timeout');assert.ok(r.body.error);
      assert.equal((await indexes('statement-timeout')).length,0);assert.equal((await leases('statement-timeout')).length,0);
    });
    await check('actual_P2028_transaction_expiration_never_commits_allowance',async()=>{
      const s=await seed();mode='transaction-timeout';const r=await request(s,'transaction-expired');assert.ok(r.body.error);assert.ok(r.elapsedMs<4500);
      assert.equal(r.failure.reservation.databaseCode,'P2028');assert.equal(r.failure.reservation.category,'transaction_api_error');
      mode='';assert.equal((await indexes('transaction-expired')).length,0);assert.equal((await leases('transaction-expired')).length,0);
      return{requestMs:r.elapsedMs,databaseCode:r.failure.reservation.databaseCode};
    });
    await check('whole_answering_deadline_never_authorizes_a_late_callback',async()=>{
      const s=await seed();delayMs=1700;const r=await request(s,'answering-expired');assert.ok(r.body.error);assert.ok(r.elapsedMs<6500);
      assert.equal(r.failure.code,'VOICE_ASSISTANT_REQUEST_DEADLINE');
      delayMs=0;await sleep(1000);assert.equal((await indexes('answering-expired')).length,0);assert.equal((await leases('answering-expired')).length,0);
    });
    await check('atomic_index_failure_cannot_leave_orphan_reservation',async()=>{
      const s=await seed();const r=await request(s,'reject-index-one');assert.ok(r.body.error);
      assert.equal((await leases('reject-index-one')).length,0);assert.equal((await indexes('reject-index-one')).length,0);
    });
    await check('expired_trial_cannot_replay_a_previous_valid_call',async()=>{
      const s=await seed();assert.ok((await request(s,'expired-replay')).body.assistantId);
      __test.upsertSignupDashboardRecord({...s,trialEndAt:Date.now()-1000});const r=await request(s,'expired-replay');assert.ok(r.body.error);
      const policy=(await control.query('SELECT data FROM "RuntimeStore" WHERE key=$1',['voice-call-policy:expired-replay'])).rows[0].data;
      assert.equal(policy.reason,'trial-ended');
    });
    await check('usage_is_scoped_to_exact_business_provider_and_trial_window',async()=>{
      const s=await seed({used:3000});
      await control.query('INSERT INTO "Call" VALUES ($1,\'vapi\',$2,100000),($3,\'other\',$2,100000),($3,\'vapi\',$4,100000)',
        [s.businessId+10000,new Date(),s.businessId,new Date(s.trialStartAt-1000)]);
      assert.deepEqual((await request(s,'scoped-usage')).body,{assistantId:s.vapiAssistantId});
    });
    assert.equal(report.cases.length,11);report.passed=true;delete report.currentCase;
  }catch(error){report.failureCode=/^[A-Z0-9_]+$/.test(String(error.code||''))?error.code:'trial_drill_failed';throw error;}
  finally{
    delayMs=0;mode='';global.fetch=originalFetch;console.info=originalInfo;console.warn=originalWarn;
    if(server){server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
    if(connected)await control.end();await prisma.$disconnect();
    if(directory){assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith('myaipa-trial-reservation-drill-'));fs.rmSync(directory,{recursive:true,force:true});}
    report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(reportDir,'report.json'),JSON.stringify(report,null,2)+'\n');
  }
}
if(require.main===module)main().catch(()=>{console.error('Synthetic trial reservation drill failed; inspect its no-secret report and CI log.');process.exitCode=1;});
module.exports={main};
