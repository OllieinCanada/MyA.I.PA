const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const selected=Object.fromEntries(['PATH','SystemRoot','LOCALAPPDATA','USERDOMAIN','USERNAME','TEMP','TMP','NODE_PATH','DATABASE_URL','DATA_DIR','SYNTHETIC_TARGET_TICKET','STAGING_INTAKE_BUSINESS_ID','STAGING_INTAKE_ASSISTANT_ID'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
const target=new URL(selected.DATABASE_URL||'invalid:');
if(target.hostname!=='127.0.0.1'||!/^\/myaipa_synthetic_stage_[a-f0-9]{12}$/.test(target.pathname)||!target.port||target.username!=='drill')throw Error('SYNTHETIC_LOOPBACK_DATABASE_REQUIRED');
const ticket=JSON.parse(fs.readFileSync(selected.SYNTHETIC_TARGET_TICKET,'utf8'));
if(ticket.database!==target.pathname.slice(1)||String(ticket.port)!==target.port||ticket.syntheticOnly!==true||Date.now()-Date.parse(ticket.createdAt)>3600000||Date.parse(ticket.createdAt)>Date.now()+5000)throw Error('SYNTHETIC_TARGET_TICKET_MISMATCH');
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,selected,{NODE_ENV:'test',APP_ENV:'staging',DISABLE_LOCAL_ENV_FILES:'1',INTAKE_LEDGER_MODE:'staging',STAGING_INTAKE_WORKER_ENABLED:'false',JWT_SECRET:'fixture-only-jwt-secret-at-least-32',ADMIN_SESSION_SECRET:'fixture-only-admin-secret-at-least-32',VAPI_WEBHOOK_SECRET:'fixture-real-postgres-webhook',VAPI_REQUIRE_BUSINESS_MAPPING:'true',VAPI_AUTO_SYNC_ENABLED:'false',TRIAL_REMINDER_DISABLE:'true',TRIAL_USAGE_LIMIT_ENABLED:'false',MISSED_CALL_ALERT_ENABLED:'false',DAILY_DIGEST_ENABLED:'false',SIGNUP_SETUP_WORKER_PAUSED:'true',CHECKPOINT_DISABLE:'1'});
const guard=require('../../scripts/local-staging-egress').install({ports:[Number(target.port)]});
async function main(){
  const{Client}=require('pg');const verifier=new Client({connectionString:target.href,ssl:false,connectionTimeoutMillis:5000,query_timeout:5000});
  try{await verifier.connect();const row=(await verifier.query("SELECT current_database() AS database, current_setting('data_directory') AS directory, system_identifier::text AS identifier FROM pg_control_system()")).rows[0];if(row.database!==ticket.database||row.identifier!==ticket.systemIdentifier||fs.realpathSync(row.directory).toLowerCase()!==fs.realpathSync(ticket.dataDirectory).toLowerCase())throw Error('SYNTHETIC_CLUSTER_IDENTITY_MISMATCH');}finally{await verifier.end();}
  const{PrismaClient}=require('@prisma/client');const prisma=new PrismaClient({datasources:{db:{url:target.href}},__internal:{configOverride:config=>({...config,relativeEnvPaths:{}})}});global.__myAiPaPrisma=prisma;
  const marker=await prisma.runtimeStore.findUnique({where:{key:'synthetic:owned-target:'+ticket.executionId}});if(marker?.data?.syntheticOnly!==true)throw Error('SYNTHETIC_MARKER_REQUIRED');
  const{app,__test}=require('../../server/index');__test.upsertSignupDashboardRecord({signupAttemptId:'fixture-postgres-dashboard',businessId:Number(selected.STAGING_INTAKE_BUSINESS_ID),businessName:'Synthetic PostgreSQL business',ownerEmail:'fixture@example.invalid',ownerPhone:'+15555550101',status:'setup_ready'});
  const server=app.listen(0,'127.0.0.1',()=>{assert.equal(server.address().address,'127.0.0.1');guard.allowPort(server.address().port);process.send({kind:'ready',port:server.address().port});});
  process.on('message',async message=>{try{
    if(message.action==='inspect'){
      const businessId=Number(selected.STAGING_INTAKE_BUSINESS_ID),leads=await prisma.lead.findMany({where:{businessId}}),calls=await prisma.call.count({where:{businessId}});
      const outbox=await prisma.runtimeStore.findMany({where:{key:{startsWith:'staging:intake-outbox:v1:'},data:{path:['businessId'],equals:businessId}}});
      process.send({id:message.id,leadCount:leads.length,callCount:calls,outboxCount:outbox.length,outboxPending:outbox.every(v=>v.data.status==='pending'),correctedSummary:leads.length===1&&leads[0].summary.includes('20 Fixture Road')&&!leads[0].summary.includes('10 Fixture Road'),workersEnabled:false,realPostgres:true,...guard.status()});
    }
    if(message.action==='probes')process.send({id:message.id,...await guard.probes()});
    if(message.action==='stop'){server.closeAllConnections?.();server.close(async()=>{await prisma.$disconnect();process.exit(0);});}
  }catch{process.send({id:message.id,error:'SYNTHETIC_INSPECTION_FAILED'});}});
}
main().catch(()=>{console.error('REAL_POSTGRES_SYNTHETIC_CHILD_FAILED');process.exitCode=1;});
