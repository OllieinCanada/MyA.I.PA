'use strict';
// Fixed disposable GitHub PostgreSQL18 service, generated data only. Never
// imports a live backup, provider profile, production URL or server writer.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawnSync,fork}=require('node:child_process');
const ROOT=path.resolve(__dirname,'..');
const SOURCES=['server/index.js','server/leadHandoffs.js','server/vapiSms.js','server/vapiToolSecurity.js','server/callPersistence.js','scripts/local-staging-egress.js',
 'scripts/run-pilot-safety-sql.js','scripts/pilot-safety-sql-worker.js','tests/supervised-pilot-journey.test.js','tests/pilot-safety-sql-contract.test.js','.github/workflows/pilot-safety.yml','prisma/schema.prisma','package-lock.json'];
const CHECKS=['owned-pg18-target','same-tenant-automatic-owner-and-call-capture','cross-process-tool-duplicate',
 'conflicting-route-zero-writes','missing-assistant-routes-phone','missing-phone-routes-assistant','known-plus-unknown-refuses',
 'no-match-refuses','both-ids-absent-called-number-fallback','ambiguous-called-number-refuses','override-db-conflict-refuses',
 'receipt-write-failure-holds','accepted-write-ack-loss-holds','permanent-receipt-failure-holds','late-receipt-preserves-hold',
 'cross-process-owner-backup-cas','held-row-lock-stale-binding-refuses','crash-restart-no-replay','legacy-optional-no-match-refuses',
 'malformed-provider-identifiers-refuse','transport-and-live-gate-limits'];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function policy(head){return{head,sourceSha256:Object.fromEntries(SOURCES.map(p=>[p,sha(fs.readFileSync(path.join(ROOT,p)))]))};}
function validate(env){
 if(process.platform!=='linux'||process.versions.node!=='24.22.3'||env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||env.RUN_PILOT_SAFETY_SQL!=='1'||!/^[a-f0-9]{40}$/.test(env.PILOT_EXPECTED_HEAD||''))throw Error('PILOT_SQL_CI_CONTEXT_REQUIRED');
 if(Object.keys(env).some(k=>env[k]&&(/^(DATABASE_URL|PGHOST|PGPORT|PGUSER|PGPASSWORD|PGDATABASE|NODE_OPTIONS)$/.test(k)||/^(VAPI_|TWILIO_|STRIPE_|MAKE_|TELEGRAM_|SMTP_|RENDER_|BACKUP_|RESTORE_|OPENAI_)/.test(k))))throw Error('PILOT_SQL_FOREIGN_CONFIGURATION');
 if(['.env','.env.local'].some(n=>fs.existsSync(path.join(ROOT,n))))throw Error('PILOT_SQL_LOCAL_ENV_REFUSED');
}
function verify(r,p,abort=false){const names=abort?CHECKS.slice(0,1):CHECKS;return !!(r?.head===p?.head&&/^[a-f0-9]{40}$/.test(p?.head||'')&&r.scope==='synthetic-actual-http-postgresql-pilot-safety'&&r.passed===!abort
 &&(!abort||r.failureCode==='PILOT_SQL_EXPECTED_ABORT')&&Object.keys(r.sourceSha256||{}).length===SOURCES.length&&SOURCES.every(f=>r.sourceSha256[f]===p.sourceSha256[f])
 &&Array.isArray(r.checks)&&r.checks.length===names.length&&new Set(r.checks.map(c=>c.name)).size===names.length&&names.every(n=>r.checks.some(c=>c.name===n&&c.passed===true))
 &&r.realPostgres===true&&r.actualHttp===!abort&&r.realProviderActions===0&&r.livePilotProven===false&&r.osSandboxProven===false
 &&r.cleanup?.databaseRemoved===true&&r.cleanup.filesRemoved===true&&r.cleanup.workersStopped===true&&r.cleanup.unrelatedDatabasesUnchanged===true);}
async function run(){
 const input={...process.env};validate(input);const expected=policy(input.PILOT_EXPECTED_HEAD);
 const head=spawnSync('git',['rev-parse','HEAD'],{cwd:ROOT,encoding:'utf8',shell:false});assert.equal(head.status,0);assert.equal(head.stdout.trim(),expected.head);
 const abort=input.PILOT_SQL_EXPECTED_ABORT==='1';if(input.PILOT_SQL_EXPECTED_ABORT!==undefined&&!abort)throw Error('PILOT_SQL_ABORT_MODE');
 const keep=Object.fromEntries(['PATH','HOME','TMPDIR'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
 for(const k of Object.keys(process.env))delete process.env[k];Object.assign(process.env,keep,{NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1'});
 const {Client}=require('pg'),{PrismaClient}=require('@prisma/client');
 const service={host:'127.0.0.1',port:5432,user:'pilot_fixture',password:'synthetic-ci-only',database:'myaipa_pilot_control_ci',connectionTimeoutMillis:5000,query_timeout:15000};
 const report={...expected,baseRelease:'8f218834361f5ec22de23c5cedd6690897d40f99',scope:'synthetic-actual-http-postgresql-pilot-safety',passed:false,checks:[],realPostgres:true,actualHttp:false,realProviderActions:0,livePilotProven:false,osSandboxProven:false,
  limitations:['Generated fixtures only; no PSTN, AI speech, handset receipt, production data or privacy/recovery proof','Transport instrumentation is not an OS sandbox'],cleanup:{databaseRemoved:false,filesRemoved:false,workersStopped:false,unrelatedDatabasesUnchanged:false}};
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-pilot-sql-')),workers=[];let admin,prisma,dbName,created=false,initial,provider,success=false,providerMode='accept',posts=[],entered,release;
 const check=async(name,fn)=>{try{await fn();report.checks.push({name,passed:true});}catch(error){report.checks.push({name,passed:false});throw error;}};
 const inventory=async()=>((await admin.query('SELECT datname FROM pg_database ORDER BY datname')).rows.map(r=>r.datname));
 let requestId=0;
 async function boot(required=true){const dir=path.join(root,'worker-'+workers.length);fs.mkdirSync(dir);const pending=new Map();
  const child=fork(path.join(__dirname,'pilot-safety-sql-worker.js'),[],{cwd:ROOT,execArgv:[],silent:true,env:{...keep,CI:'true',GITHUB_ACTIONS:'true',RUN_PILOT_SAFETY_SQL:'1',PILOT_SQL_DATABASE:dbName,PILOT_MOCK_PORT:String(provider.address().port),PILOT_REQUIRE_MAPPING:String(required),DATA_DIR:dir}});
  const w={child,dir,stopped:false};workers.push(w);let output='';child.stdout.on('data',b=>{output=(output+String(b)).slice(-16000);});child.stderr.on('data',b=>{output=(output+String(b)).slice(-16000);});
  const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('PILOT_WORKER_READY_TIMEOUT')),25000);child.on('message',m=>{if(m.type==='ready'){clearTimeout(timer);w.port=m.port;resolve();}else if(m.type==='startup-error'){clearTimeout(timer);reject(Error('PILOT_WORKER_STARTUP'));}else if(pending.has(m.id)){const task=pending.get(m.id);pending.delete(m.id);clearTimeout(task.timer);m.error?task.reject(Error(m.error.code)):task.resolve(m.result);}});child.once('exit',()=>{for(const t of pending.values()){clearTimeout(t.timer);t.reject(Error('PILOT_WORKER_EXIT'));}pending.clear();});});
  w.command=payload=>new Promise((resolve,reject)=>{const id=++requestId,timer=setTimeout(()=>{pending.delete(id);reject(Error('PILOT_COMMAND_TIMEOUT'));},20000);pending.set(id,{resolve,reject,timer});child.send({...payload,id});});
  w.stop=async()=>{if(w.stopped)return;if(child.exitCode!==null||child.signalCode!==null){w.stopped=true;return;}const exited=new Promise(resolve=>child.once('exit',resolve));
   const r=await w.command({type:'stop'});assert.equal(r.guard.unexpectedOutboundAttempts,0);await exited;w.stopped=true;};
  await ready;return w;
 }
 const inputArgs={name:'Fictitious Tester',rawPhoneNumber:'+15555550102',jobDetails:'Replace a fictitious lamp',intent:'QUOTE',businessId:38,ownerNumber:'+15555550199'};
 const call=(id=crypto.randomUUID())=>({id,assistantId:'fixture-sql-assistant',phoneNumberId:'fixture-sql-phone',customer:{number:'+15555550102'},transport:{forwardedFrom:'+15555550100'}});
 async function http(w,message){const r=await fetch('http://127.0.0.1:'+w.port+'/api/webhooks/voice',{method:'POST',headers:{'content-type':'application/json','x-vapi-secret':'fixture-only-webhook'},body:JSON.stringify({message}),signal:AbortSignal.timeout(20000)});return{status:r.status,body:await r.json()};}
 const tool=(w,c,id=crypto.randomUUID())=>http(w,{type:'tool-calls',call:c,toolCallList:[{id,function:{name:'record_lead_and_notify_owner',arguments:JSON.stringify(inputArgs)}}]});
 const result=r=>JSON.parse(r.body.results[0].result);
 const counts=async()=>({leads:await prisma.lead.count(),claims:await prisma.vapiToolExecution.count(),attempts:await prisma.leadNotificationAttempt.count(),posts:posts.length});
 async function held(w,mode){providerMode='accept';await w.command({type:'mode',mode});const c=call(),id=crypto.randomUUID(),r=await tool(w,c,id);await w.command({type:'mode',mode:''});
  const execution=await prisma.vapiToolExecution.findFirst({where:{toolCallId:id}});assert.ok(execution);
  const h=await prisma.leadHandoff.findUnique({where:{sourceEventId:'vapi-tool:'+execution.idempotencyKey},include:{attempts:true}});assert.ok(h);assert.equal(h.nextActionAt,null);
  if(mode==='permanent')assert.equal(r.status,500);else{assert.equal(result(r).ok,false);assert.equal(result(r).executionState,'uncertain');}
  const before=posts.length;assert.equal((await w.command({type:'dispatch',handoffId:h.id})).requiresInspection,true);assert.equal(posts.length,before);return h;
 }
 try{
  admin=new Client(service);await admin.connect();initial=await inventory();
  const identity=(await admin.query("SELECT current_database() AS db,current_user AS actor,current_setting('server_version_num')::int AS version")).rows[0];assert.equal(identity.db,service.database);assert.equal(identity.actor,service.user);assert.ok(identity.version>=180000&&identity.version<190000);
  dbName='myaipa_pilot_'+crypto.randomBytes(6).toString('hex');await admin.query('CREATE DATABASE "'+dbName+'"');created=true;
  const url='postgresql://pilot_fixture:synthetic-ci-only@127.0.0.1:5432/'+dbName+'?connection_limit=4';
  const pushed=spawnSync(process.execPath,[path.join(ROOT,'node_modules/prisma/build/index.js'),'db','push','--skip-generate'],{cwd:ROOT,encoding:'utf8',shell:false,timeout:120000,env:{...keep,DATABASE_URL:url,DISABLE_LOCAL_ENV_FILES:'1'}});assert.equal(pushed.status,0);
  prisma=new PrismaClient({datasources:{db:{url}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});await prisma.$connect();
  assert.equal(await prisma.business.count(),0);await prisma.business.createMany({data:[{id:37,name:'Fictitious SQL A',phone:'+15555550101',timezone:'America/Toronto'},{id:38,name:'Fictitious SQL B',phone:'+15555550199',timezone:'America/Toronto'}]});
  await prisma.settings.createMany({data:[{businessId:37,ownerPhone:'+15555550100'},{businessId:38,ownerPhone:'+15555550199'}]});
  await prisma.vapiBusinessMapping.createMany({data:[{businessId:37,matchType:'assistantId',matchValue:'fixture-sql-assistant'},{businessId:37,matchType:'phoneNumberId',matchValue:'fixture-sql-phone'}]});
  const gate={status:'active',businessId:37,assistantId:'fixture-sql-assistant',phoneNumberId:'fixture-sql-phone',phoneNumber:'+15555550101',subscriptionId:'fixture-subscription',signupAttemptId:'fixture-sql-signup',assistantMaxSeconds:300,fallbackPhone:'+15555550100'};
  for(const key of ['trial-voice-gate:phone-id:fixture-sql-phone','trial-voice-gate:number:+15555550101'])await prisma.runtimeStore.create({data:{key,data:gate}});
  await check(CHECKS[0],async()=>{const r=await prisma.$queryRawUnsafe('SELECT current_database() AS db,current_user AS actor');assert.equal(r[0].db,dbName);assert.equal(r[0].actor,service.user);});
  if(abort)throw Object.assign(Error('PILOT_SQL_EXPECTED_ABORT'),{code:'PILOT_SQL_EXPECTED_ABORT'});
  provider=require('node:http').createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;assert.equal(req.url,'/chat');posts.push(JSON.parse(raw));
   if(providerMode==='wait')await new Promise(resolve=>{release=resolve;entered?.();});
   res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({id:'fixture-request-'+posts.length,messageId:'fixture-message-'+posts.length}));});
  provider.listen(0,'127.0.0.1');await new Promise(r=>provider.once('listening',r));const a=await boot(),b=await boot();report.actualHttp=true;
  await check(CHECKS[1],async()=>{const c=call();assert.deepEqual((await http(a,{type:'assistant-request',call:c})).body,{assistantId:'fixture-sql-assistant'});const r=await tool(a,c);assert.equal(result(r).ok,true);assert.equal(posts.at(-1).transport.customer.number,'+15555550100');
   const claim=await prisma.vapiToolExecution.findFirst({where:{callExternalId:c.id}});const lead=await prisma.lead.findUnique({where:{id:claim.result.leadId}});assert.equal(lead.businessId,37);
   const ended={...c,status:'ended',startedAt:new Date(Date.now()-60000).toISOString(),endedAt:new Date().toISOString(),endedReason:'customer-ended-call'};
   const send=()=>http(a,{type:'end-of-call-report',call:ended,analysis:{summary:'Fictitious lamp request'}});assert.ok([200,201].includes((await send()).status));await send();
   const saved=await prisma.call.findMany({where:{externalId:c.id}});assert.equal(saved.length,1);assert.equal(saved[0].businessId,37);assert.equal(saved[0].callerId,lead.callerId);
  });
  await check(CHECKS[2],async()=>{const c=call(),id=crypto.randomUUID(),before=await counts();providerMode='wait';const waiting=new Promise(r=>entered=r),first=tool(a,c,id);await waiting;const overlap=await tool(b,c,id);assert.equal(result(overlap).duplicate,true);assert.equal(result(overlap).status,'PROCESSING');release();await first;providerMode='accept';assert.equal(result(await tool(b,c,id)).duplicate,true);const after=await counts();assert.equal(after.leads-before.leads,1);assert.equal(after.posts-before.posts,1);});
  async function refuse(c){const before=await counts(),r=await tool(a,c);assert.equal(r.status,422);assert.deepEqual(await counts(),before);}
  await check(CHECKS[3],async()=>{await prisma.vapiBusinessMapping.update({where:{matchValue:'fixture-sql-phone'},data:{businessId:38}});try{await refuse(call());}finally{await prisma.vapiBusinessMapping.update({where:{matchValue:'fixture-sql-phone'},data:{businessId:37}});}});
  for(const [index,change]of [[4,c=>delete c.assistantId],[5,c=>delete c.phoneNumberId]])await check(CHECKS[index],async()=>{const c=call();change(c);assert.equal(result(await tool(a,c)).ok,true);});
  await check(CHECKS[6],async()=>{await refuse({...call(),phoneNumberId:'unknown-phone'});await refuse({...call(),assistantId:'unknown-assistant'});});
  await check(CHECKS[7],()=>refuse({id:crypto.randomUUID(),assistantId:'unknown-assistant',phoneNumberId:'unknown-phone',customer:call().customer}));
  await check(CHECKS[8],async()=>{assert.equal(result(await tool(a,{id:crypto.randomUUID(),to:'+15555550101',customer:call().customer})).ok,true);});
  await check(CHECKS[9],async()=>{await prisma.business.update({where:{id:38},data:{phone:'+15555550101'}});try{await refuse({id:crypto.randomUUID(),to:'+15555550101',customer:call().customer});}finally{await prisma.business.update({where:{id:38},data:{phone:'+15555550199'}});}});
  await check(CHECKS[10],async()=>{await a.command({type:'override',value:{'fixture-sql-assistant':38}});try{await refuse(call());}finally{await a.command({type:'override',value:{}});}});
  let heldHandoff;
  await check(CHECKS[11],async()=>{heldHandoff=await held(a,'once');assert.ok(heldHandoff.attempts[0].providerRequestId);});
  await check(CHECKS[12],()=>held(a,'ack-lost'));
  await check(CHECKS[13],()=>held(a,'permanent'));
  await check(CHECKS[14],async()=>{await a.command({type:'receipt',payload:{eventId:'fixture-late-failed',attemptId:heldHandoff.attempts[0].id,status:'FAILED'}});const h=await prisma.leadHandoff.findUnique({where:{id:heldHandoff.id}});assert.equal(h.nextActionAt,null);assert.equal(h.lastErrorCode,'OWNER_NOTIFICATION_UNCERTAIN');assert.equal((await b.command({type:'dispatch',handoffId:h.id})).requiresInspection,true);});
  async function freshHandoff(){const caller=await prisma.caller.upsert({where:{phone:'+15555550102'},create:{phone:'+15555550102'},update:{}});const lead=await prisma.lead.create({data:{businessId:37,callerId:caller.id,intent:'QUOTE',urgency:'LOW',summary:'Fictitious request',callbackNumber:caller.phone,name:'Fictitious Tester'}});return prisma.leadHandoff.create({data:{businessId:37,leadId:lead.id,ownerPhone:'+15555550100',backupPhone:'+15555550199',acknowledgementKey:crypto.randomUUID(),acknowledgementExpiresAt:new Date(Date.now()+60000)}});}
  await check(CHECKS[15],async()=>{const h=await freshHandoff(),before=posts.length,locker=new Client({...service,database:dbName});await locker.connect();const commands=[];try{
   await locker.query('BEGIN');await locker.query('SELECT id FROM "LeadHandoff" WHERE id=$1 FOR UPDATE',[h.id]);
   commands.push(a.command({type:'dispatch',handoffId:h.id,role:'OWNER'}),b.command({type:'dispatch',handoffId:h.id,role:'BACKUP'}));
   let waiting=false;for(let i=0;i<250;i++){const rows=(await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE datname=$1 AND query LIKE 'UPDATE%LeadHandoff%'",[dbName])).rows;if(rows.filter(r=>r.wait_event_type==='Lock').length>=2){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert.equal(waiting,true);
   await locker.query('COMMIT');const results=await Promise.all(commands);assert.equal(results.filter(r=>r.accepted).length,1);assert.equal(posts.length-before,1);assert.equal(await prisma.leadNotificationAttempt.count({where:{handoffId:h.id}}),1);
  }finally{await locker.query('ROLLBACK').catch(()=>{});await locker.end();await Promise.allSettled(commands);}});
  await check(CHECKS[16],async()=>{const h=await freshHandoff(),locker=new Client({...service,database:dbName});await locker.connect();let sending;try{
   await locker.query('BEGIN');await locker.query('SELECT id FROM "LeadHandoff" WHERE id=$1 FOR UPDATE',[h.id]);const before=posts.length;sending=a.command({type:'dispatch',handoffId:h.id});
   // Wait for the actual application UPDATE to be blocked by our row lock.
   let waiting=false;for(let i=0;i<100;i++){const rows=(await admin.query("SELECT wait_event_type FROM pg_stat_activity WHERE datname=$1 AND query LIKE 'UPDATE%LeadHandoff%'",[dbName])).rows;if(rows.some(r=>r.wait_event_type==='Lock')){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}assert.equal(waiting,true);
   await locker.query('UPDATE "LeadHandoff" SET "ownerPhone"=$2,"updatedAt"="updatedAt"+interval \'1 second\' WHERE id=$1',[h.id,'+15555550199']);await locker.query('COMMIT');const r=await sending;assert.equal(r.requiresInspection,true);assert.equal(posts.length,before);
  }finally{await locker.query('ROLLBACK').catch(()=>{});await locker.end();if(sending)await sending.catch(()=>{});}});
  await check(CHECKS[17],async()=>{const c=call(),id=crypto.randomUUID(),before=posts.length;providerMode='wait';const waiting=new Promise(r=>entered=r),sending=tool(a,c,id).catch(()=>null);await waiting;
   const exited=new Promise(r=>a.child.once('exit',r));a.child.kill('SIGKILL');await exited;a.stopped=true;await sending;release();providerMode='accept';
   const restarted=await boot();const replay=result(await tool(restarted,c,id));assert.equal(replay.duplicate,true);assert.equal(replay.status,'PROCESSING');const claim=await prisma.vapiToolExecution.findFirst({where:{toolCallId:id}});const h=await prisma.leadHandoff.findUnique({where:{sourceEventId:'vapi-tool:'+claim.idempotencyKey}});assert.equal(h.status,'SEND_REQUESTED');assert.equal((await restarted.command({type:'dispatch',handoffId:h.id})).requiresInspection,true);assert.equal(posts.length-before,1);
  });
  await check(CHECKS[18],async()=>{const optional=await boot(false),before=await counts();for(const c of [{id:crypto.randomUUID(),customer:call().customer},{...call(),assistantId:'unknown-assistant',phoneNumberId:'unknown-phone'}])assert.equal((await tool(optional,c)).status,422);assert.deepEqual(await counts(),before);await optional.stop();});
  await check(CHECKS[19],async()=>{for(const field of ['assistantId','phoneNumberId'])for(const value of [0,false,[],{},42])await refuse({...call(),[field]:value});});
  await check(CHECKS[20],async()=>{assert.ok(posts.every(p=>p.transport.customer.number==='+15555550100'||p.transport.customer.number==='+15555550199'));for(const name of ['privacyApplicationPassed','logicalRestorePassed','fullRecoveryPassed'])assert.equal(require('./launch-evidence')[name](report,expected.head),false);});
  success=true;
 }catch(error){report.failureCode=error.code==='PILOT_SQL_EXPECTED_ABORT'?error.code:'PILOT_SQL_CHECK_FAILED';report.failedCheck=report.checks.find(c=>!c.passed)?.name||null;}
 finally{
  release?.();let stopped=true;for(const w of workers){try{await w.stop();}catch{stopped=false;w.child.kill('SIGKILL');}}report.cleanup.workersStopped=stopped;
  if(provider){provider.closeAllConnections?.();await new Promise(r=>provider.close(r));}
  if(prisma)await prisma.$disconnect().catch(()=>{success=false;});
  if(admin){try{if(created){assert.match(dbName,/^myaipa_pilot_[a-f0-9]{12}$/);const owner=(await admin.query('SELECT pg_get_userbyid(datdba) AS owner FROM pg_database WHERE datname=$1',[dbName])).rows[0];assert.equal(owner.owner,service.user);await admin.query('DROP DATABASE "'+dbName+'"');report.cleanup.databaseRemoved=true;}assert.deepEqual(await inventory(),initial);report.cleanup.unrelatedDatabasesUnchanged=true;}catch{success=false;}await admin.end();}
  try{const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.match(path.basename(resolved),/^myaipa-pilot-sql-/);fs.rmSync(resolved,{recursive:true});report.cleanup.filesRemoved=!fs.existsSync(resolved);}catch{success=false;}
  report.passed=success&&Object.values(report.cleanup).every(v=>v===true);report.finishedAt=new Date().toISOString();
  const out=path.join(ROOT,'diagnostics/pilot-safety-sql');fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,abort?'expected-abort.json':'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 }
 return report;
}
if(require.main===module){if(process.argv[2]==='--verify'){try{const abort=process.argv[3]==='--aborted';const p=policy(process.env.PILOT_EXPECTED_HEAD),r=JSON.parse(fs.readFileSync(path.join(ROOT,'diagnostics/pilot-safety-sql',abort?'expected-abort.json':'result.json')));if(!verify(r,p,abort))throw Error();}catch{console.error('PILOT_SQL_EVIDENCE_REFUSED');process.exitCode=1;}}
 else run().then(r=>{console.log(JSON.stringify(r,null,2));if(!r.passed)process.exitCode=1;}).catch(()=>{console.error('PILOT_SQL_ADMISSION_REFUSED');process.exitCode=1;});}
module.exports={validate,verify,policy,CHECKS,SOURCES};
