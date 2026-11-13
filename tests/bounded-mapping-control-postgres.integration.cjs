const test=require('node:test'),assert=require('node:assert/strict');
test('disabled maintenance entry point with actual reader/writer/fence and disposable PostgreSQL',{
  skip:process.env.RUN_BOUNDED_MAPPING_CONTROL_POSTGRES!=='1',timeout:120000,
},async t=>{
  const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
  const {Client}=require('pg'),{PrismaClient}=require('@prisma/client');
  const {validateSqlTarget}=require('../scripts/compose-bounded-mapping-integration');
  const {createFixture,instrument,digest}=require('./helpers/boundedMappingIntegrationFixture');
  const {createBoundedMappingControl}=require('../server/boundedMappingControl');
  const url=validateSqlTarget(process.env.DATABASE_URL,process.env),name='myaipa_control_drill_'+crypto.randomBytes(10).toString('hex');
  assert.match(name,/^myaipa_control_drill_[a-f0-9]{20}$/);
  const admin=new Client({connectionString:url.toString()}),directory=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-control-sql-'));
  let db,created=false,removed=false;const outcomes=[];await admin.connect();
  try{
    await admin.query(`CREATE DATABASE "${name}"`);created=true;url.pathname='/'+name;url.search='?connection_limit=4';
    const pushed=spawnSync(process.execPath,[path.join(path.dirname(require.resolve('prisma/package.json')),'build','index.js'),'db','push','--skip-generate','--schema',path.resolve(__dirname,'../prisma/schema.prisma')],{
      cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:60000,env:{PATH:process.env.PATH,HOME:process.env.HOME,DATABASE_URL:url.toString(),DISABLE_LOCAL_ENV_FILES:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1'},
    });assert.equal(pushed.status,0,'disposable schema only');
    db=new PrismaClient({datasources:{db:{url:url.toString()}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});
    async function run(id,fn){await t.test(id,async()=>{
      try{
        assert.equal((await db.$queryRaw`SELECT current_database() AS db`)[0].db,name);
        await db.runtimeStore.deleteMany();await db.signupAttempt.deleteMany();await db.vapiBusinessMapping.deleteMany();await db.settings.deleteMany();await db.business.deleteMany();
        const dir=path.join(directory,id);fs.mkdirSync(dir);const f=createFixture(dir);
        await db.business.create({data:{id:7,name:f.source.businessName,phone:f.source.ownerPhone,timezone:'UTC',settings:{create:{ownerPhone:f.source.ownerPhone}}}});
        await db.signupAttempt.create({data:f.attemptData});await db.vapiBusinessMapping.createMany({data:f.policy.preservedMappings});
        for(const[key,data]of f.records)await db.runtimeStore.create({data:{key,data}});
        const actor='2'.repeat(64),state={enabled:true,apply:false,auth:true,probes:0};
        const doc={schemaVersion:1,policyId:'1'.repeat(64),operatorSessionHash:actor,target:structuredClone(f.policy),expiresAt:new Date(Date.now()+600000).toISOString()};
        const config={prisma:db,fence:f.fence,readStore:f.readStore,getSigningSecret:()=> 'synthetic-integration-signing-secret',getRelease:()=>f.policy.release,
          getOperatorPolicy:()=>doc,probe:async()=>{state.probes++;return{...structuredClone(f.snapshot),checkedAt:new Date().toISOString()};},readOverrides:()=>'',
          enabled:()=>state.enabled,applyEnabled:()=>state.apply,singleWriter:()=>true};
        const service=createBoundedMappingControl(config),auth={actorHash:actor,reauthorize:()=>state.auth?actor:''};
        const dry=()=>service.execute({action:'dry_run',policyId:doc.policyId},auth);
        const body=p=>({action:'apply',policyId:doc.policyId,planDigest:p.planDigest,confirmation:'APPLY_EXISTING_BUSINESS_MAPPINGS_ONLY'});
        const approve=async()=>{const p=await dry();doc.approvedPlanDigest=p.planDigest;state.apply=true;return p;};
        await fn({f,state,doc,config,service,auth,dry,body,approve});outcomes.push({id,status:'passed'});
      }catch(error){outcomes.push({id,status:'failed',code:error.code||'ASSERTION'});throw error;}
    });}
    await run('default_refusal',async x=>{x.state.enabled=false;await assert.rejects(x.dry(),{code:'MAPPING_CONTROL_DISABLED'});assert.equal(x.state.probes,0);assert.equal(await db.vapiBusinessMapping.count(),3);});
    await run('dry_run_zero_writes',async x=>{const before=digest({rows:await db.vapiBusinessMapping.findMany(),records:await db.runtimeStore.findMany(),store:x.f.readStore()});
      assert.equal((await x.dry()).databaseWrites,0);assert.equal(digest({rows:await db.vapiBusinessMapping.findMany(),records:await db.runtimeStore.findMany(),store:x.f.readStore()}),before);});
    await run('explicit_guarded_admission',async x=>{const before=digest(x.f.readStore()),p=await x.approve();const r=await x.service.execute(x.body(p),x.auth);assert.equal(r.applied,true);assert.equal(r.readinessGranted,false);
      assert.equal(await db.vapiBusinessMapping.count(),6);assert.equal(digest(x.f.readStore()),before);});
    await run('fresh_receipt_refusal',async x=>{const p=await x.approve(),data=structuredClone(x.f.records.get(x.f.receiptKey));data.status='uncertain';await db.runtimeStore.update({where:{key:x.f.receiptKey},data:{data}});
      await assert.rejects(x.service.execute(x.body(p),x.auth),{code:'MAPPING_RECEIPTS_UNPROVEN'});assert.equal(await db.vapiBusinessMapping.count(),3);});
    await run('atomicity_uncertainty',async x=>{x.config.prisma=instrument(db,{onCreate:async({index})=>{if(index===2)throw Error('synthetic rollback');}});const s=createBoundedMappingControl(x.config);
      const p=await s.execute({action:'dry_run',policyId:x.doc.policyId},x.auth);x.doc.approvedPlanDigest=p.planDigest;x.state.apply=true;
      await assert.rejects(s.execute(x.body(p),x.auth),{code:'MAPPING_UNCERTAIN_INSPECT_FIRST'});assert.equal(await db.vapiBusinessMapping.count(),3);
      assert.equal((await s.execute({action:'inspect',policyId:x.doc.policyId},x.auth)).state,'attempt_started_unresolved');
      const restarted=createBoundedMappingControl({...x.config,prisma:db});
      await assert.rejects(restarted.execute({action:'dry_run',policyId:x.doc.policyId},x.auth),{code:'MAPPING_UNCERTAIN_INSPECT_FIRST'});
      assert.equal(await db.vapiBusinessMapping.count(),3);});
    await run('lost_commit_acknowledgement',async x=>{let lost=false;x.config.prisma=instrument(db,{afterCommit:async({creates})=>{if(creates&&!lost){lost=true;throw Error('synthetic acknowledgement loss');}}});const s=createBoundedMappingControl(x.config);
      const p=await s.execute({action:'dry_run',policyId:x.doc.policyId},x.auth);x.doc.approvedPlanDigest=p.planDigest;x.state.apply=true;
      await assert.rejects(s.execute(x.body(p),x.auth),{code:'MAPPING_UNCERTAIN_INSPECT_FIRST'});assert.equal((await s.execute({action:'inspect',policyId:x.doc.policyId},x.auth)).state,'committed_exact');assert.equal(await db.vapiBusinessMapping.count(),6);});
    await run('shared_running_fence',async x=>{let excluded=false;x.config.prisma=instrument(db,{onCreate:async({index})=>{if(index===1){assert.throws(()=>x.f.fence.hold([x.f.policy.sourceId,x.f.policy.phantomId]),{code:'ASSOCIATION_REPAIR_BUSY'});excluded=true;}}});const s=createBoundedMappingControl(x.config);
      const p=await s.execute({action:'dry_run',policyId:x.doc.policyId},x.auth);x.doc.approvedPlanDigest=p.planDigest;x.state.apply=true;await s.execute(x.body(p),x.auth);assert.equal(excluded,true);});
    await run('actual_signed_session_http',async x=>{
      // Load the real patched app and auth middleware, not a replacement auth
      // callback. No startServer/background jobs; provider fetch is intercepted
      // in-process and only exact GET fixture reads are accepted.
      const nativeFetch=global.fetch,dir=path.dirname(x.f.file),policyFile=path.join(dir,'bounded-mapping-operator-policy.json');
      fs.copyFileSync(x.f.file,path.join(dir,'signup-dashboard.json'));
      Object.assign(process.env,{NODE_ENV:'test',DATA_DIR:dir,ADMIN_PASSWORD:'synthetic-entry-admin',ADMIN_SESSION_SECRET:'synthetic-entry-session-secret',
        ADMIN_TOTP_SECRET:'',ADMIN_SIGNUP_REPAIR_MAX_REQUESTS:'200',PROVISIONING_SIGNING_SECRET:'synthetic-integration-signing-secret',
        RENDER_GIT_COMMIT:x.f.policy.release,TWILIO_ACCOUNT_SID:'AC'+'a'.repeat(32),TWILIO_AUTH_TOKEN:'synthetic-no-send',VAPI_API_KEY:'synthetic-no-send',
        SIGNUP_ASSOCIATION_REPAIR_SINGLE_WRITER_CONFIRMED:'true',WEB_CONCURRENCY:'1',TRIAL_REMINDER_DISABLE:'true',VAPI_AUTO_SYNC_ENABLED:'false'});
      delete process.env.BOUNDED_MAPPING_CONTROL_ENABLED;delete process.env.BOUNDED_MAPPING_APPLY_ENABLED;
      const repair=require('../server/signupAssociationRepair'),makeFence=repair.createAssociationFence;
      let runningFence,fenceCreations=0,actualExclusions=0;
      repair.createAssociationFence=(...args)=>{fenceCreations++;return runningFence=makeFence(...args);};
      global.__myAiPaPrisma=instrument(db,{onCreate:async()=>{
        assert.throws(()=>runningFence.hold([x.f.policy.sourceId,x.f.policy.phantomId]),{code:'ASSOCIATION_REPAIR_BUSY'});actualExclusions++;
      }});let providerReads=0,forbidden=0,server;
      global.fetch=async(input,options={})=>{
        const u=new URL(String(input));
        if(u.hostname==='127.0.0.1')return nativeFetch(input,options);
        if(String(options.method||'GET').toUpperCase()!=='GET'){forbidden++;throw Error('External mutation forbidden');}
        let body;
        if(u.hostname==='api.twilio.com'&&u.pathname.endsWith('/IncomingPhoneNumbers.json'))body={incoming_phone_numbers:[
          {sid:x.f.policy.twilioSid,phone_number:x.f.policy.number,friendly_name:x.f.snapshot.provider.twilio.name},
          ...x.f.snapshot.reserveNumbers.map((n,i)=>({sid:'PN'+String(i+1).repeat(32),phone_number:n,friendly_name:`myaipa-reserve-held-20261110-${i+1}`}))],next_page_uri:null};
        else if(u.hostname==='api.vapi.ai'&&u.pathname===`/phone-number/${x.f.policy.phoneId}`)body={...x.f.snapshot.provider.phone};
        else if(u.hostname==='api.vapi.ai'&&u.pathname===`/assistant/${x.f.policy.assistantId}`)body={id:x.f.policy.assistantId,model:{messages:[]}};
        else {forbidden++;throw Error('Non-fixture network refused');}
        providerReads++;return new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
      };
      try{
        const {app}=require('../server/index');assert.equal(fenceCreations,1,'actual app creates precisely one shared fence');
        repair.createAssociationFence=makeFence;
        server=app.listen(0,'127.0.0.1');await require('node:events').once(server,'listening');
        const base=`http://127.0.0.1:${server.address().port}`,route='/api/admin/signups/bounded-business-mapping';
        const headers={origin:'https://www.myaipa.ca','content-type':'application/json','x-myaipa-mapping-correction':'1'};
        const post=async(url,body,cookie='',extra={})=>{const r=await nativeFetch(base+url,{method:'POST',headers:{...headers,...(cookie?{cookie}:{}),...extra},body:JSON.stringify(body)});return{status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};};
        assert.equal((await post(route,{action:'identify'})).status,401);
        const login=await post('/api/admin/login',{password:'synthetic-entry-admin'});assert.equal(login.status,200);
        const cookie=login.cookie.split(';')[0];
        assert.equal((await post(route,{action:'identify'},cookie)).body.code,'MAPPING_CONTROL_DISABLED');
        assert.equal(providerReads,0);process.env.BOUNDED_MAPPING_CONTROL_ENABLED='true';
        // A bare admin password is not the exact operator-bound signed session.
        assert.equal((await post(route,{action:'identify'},'',{'x-admin-password':'synthetic-entry-admin'})).status,401);
        const identified=await post(route,{action:'identify'},cookie);assert.equal(identified.status,200);
        const token=decodeURIComponent(cookie.slice(cookie.indexOf('=')+1));
        assert.equal(identified.body.operatorSessionHash,crypto.createHash('sha256').update('bounded-mapping-session:v1\0').update(token).digest('hex'));
        const policy={...x.doc,operatorSessionHash:identified.body.operatorSessionHash};fs.writeFileSync(policyFile,JSON.stringify(policy));
        const dryBody={action:'dry_run',policyId:policy.policyId};
        assert.equal((await post(route,dryBody,cookie+'tampered')).status,401);
        const payload=Buffer.from(JSON.stringify({exp:Date.now()-1000})).toString('base64url');
        const expired=payload+'.'+crypto.createHmac('sha256',process.env.ADMIN_SESSION_SECRET).update(payload).digest('hex');
        assert.equal((await post(route,dryBody,'myaipa_admin_session='+expired)).status,401);
        assert.equal((await post(route,dryBody,cookie,{origin:'https://foreign.invalid'})).status,403);
        assert.equal((await post(route,{...dryBody,target:{businessId:8}},cookie)).status,400);
        fs.writeFileSync(policyFile,JSON.stringify({...policy,operatorSessionHash:'3'.repeat(64)}));
        assert.equal((await post(route,dryBody,cookie)).status,403);assert.equal(providerReads,0);
        fs.writeFileSync(policyFile,JSON.stringify(policy));
        runningFence.hold([x.f.policy.sourceId,x.f.policy.phantomId]);
        try{assert.equal((await post(route,dryBody,cookie)).status,503);assert.equal(await db.vapiBusinessMapping.count(),3);}
        finally{runningFence.release([x.f.policy.sourceId,x.f.policy.phantomId]);}
        const before=digest({rows:await db.vapiBusinessMapping.findMany(),records:await db.runtimeStore.findMany(),source:await db.signupAttempt.findMany(),store:x.f.readStore()});
        const dry=await post(route,dryBody,cookie);assert.equal(dry.status,200,JSON.stringify(dry.body));assert.equal(dry.body.databaseWrites,0);
        assert.equal(digest({rows:await db.vapiBusinessMapping.findMany(),records:await db.runtimeStore.findMany(),source:await db.signupAttempt.findMany(),store:x.f.readStore()}),before);
        const apply={action:'apply',policyId:policy.policyId,planDigest:dry.body.planDigest,confirmation:'APPLY_EXISTING_BUSINESS_MAPPINGS_ONLY'};
        assert.equal((await post(route,apply,cookie)).status,403);assert.equal(await db.vapiBusinessMapping.count(),3);
        policy.approvedPlanDigest=dry.body.planDigest;fs.writeFileSync(policyFile,JSON.stringify(policy));process.env.BOUNDED_MAPPING_APPLY_ENABLED='true';
        const applied=await post(route,apply,cookie);assert.equal(applied.status,200,JSON.stringify(applied.body));assert.equal(applied.body.applied,true);assert.equal(await db.vapiBusinessMapping.count(),6);
        assert.equal((await post(route,apply,cookie)).body.code,'MAPPING_CONTROL_INSPECT_FIRST');
        assert.equal((await post(route,{action:'inspect',policyId:policy.policyId},cookie)).body.state,'committed_exact');
        assert.equal(forbidden,0);assert.equal(providerReads,9);assert.equal(actualExclusions,3,'actual HTTP apply holds the actual running fence throughout all mapping inserts');
      }finally{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}global.fetch=nativeFetch;delete global.__myAiPaPrisma;
        repair.createAssociationFence=makeFence;
        delete process.env.BOUNDED_MAPPING_CONTROL_ENABLED;delete process.env.BOUNDED_MAPPING_APPLY_ENABLED;}
    });
    assert.equal(outcomes.length,8);assert.ok(outcomes.every(x=>x.status==='passed'));
  }finally{if(db)await db.$disconnect();try{if(created){await admin.query(`DROP DATABASE "${name}"`);removed=true;}}finally{await admin.end();
    if(process.env.MAPPING_CONTROL_SQL_REPORT)fs.writeFileSync(process.env.MAPPING_CONTROL_SQL_REPORT,JSON.stringify({sqlMode:'real-postgresql',providerMode:'synthetic-no-send',disposableDatabaseRemoved:removed,outcomes},null,2));}}
});
