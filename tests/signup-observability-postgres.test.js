'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {recordSignupBug,listSignupBugs,safelyRecordSignupBug,PREFIX}=require('../server/signupBugHistory');
const {normalizeFeed,saveObservation,readProviderStatuses,PREFIX:STATUS,HISTORY}=require('../server/providerMaintenance');
const enabled=process.env.RUN_OBSERVABILITY_POSTGRES==='1';
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function clients(){const url=new URL(process.env.DATABASE_URL);assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname));
 assert.ok(process.env.GITHUB_ACTIONS==='true'&&url.pathname==='/ci'||/^\/myaipa_observability_[a-z0-9_]+$/.test(url.pathname),'Only disposable CI/test database');
 const {PrismaClient}=require('@prisma/client');const make=()=>new PrismaClient({datasources:{db:{url:url.href}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});return [make(),make()];}
async function waitFor(check){const end=Date.now()+3000;while(Date.now()<end){const value=await check();if(value)return value;await new Promise(r=>setTimeout(r,20));}assert.fail('Expected synthetic database state was not observed');}
test('real SQL bug journal: concurrent clients deduplicate, exact attribution is rechecked, reads preserve history and cleanup is scoped',{skip:!enabled,timeout:30000},async()=>{
 const [db,other]=clients(),marker=crypto.randomUUID(),attemptId='signup_'+hash(marker).slice(0,32),eventId=crypto.randomUUID(),key=PREFIX+hash(eventId);let ownsAttempt=false;
 const payload={business:{name:'Synthetic '+marker},owner:{email:'fake@example.invalid',phone:'+19055550123'}},record={signupAttemptId:attemptId,businessName:payload.business.name,ownerEmail:payload.owner.email,ownerPhone:payload.owner.phone};
 try{
  assert.equal(await db.signupAttempt.findUnique({where:{eventKey:attemptId}}),null);assert.equal(await db.runtimeStore.findUnique({where:{key}}),null);
  await db.signupAttempt.create({data:{eventKey:attemptId,publicId:'attempt_'+hash(marker).slice(0,20),statusTokenHash:hash(marker+'status'),businessName:payload.business.name,ownerEmail:payload.owner.email,ownerPhone:payload.owner.phone,payload,status:'provisioning',expiresAt:new Date(Date.now()+3600000)}});ownsAttempt=true;
  const input={listSignups:()=>[record],attemptId,eventId,stage:'purchase',error:{code:'P2028',message:'private synthetic raw error'},release:'a'.repeat(40)};
  const results=await Promise.all([recordSignupBug({...input,prisma:db}),recordSignupBug({...input,prisma:other})]);assert.equal(results.filter(r=>r.replayed).length,1);assert.equal(await db.runtimeStore.count({where:{key}}),1);
  const before=await db.runtimeStore.findUnique({where:{key}}),report=await listSignupBugs({prisma:db,listSignups:()=>[record],attemptId});assert.equal(report.events[0].signupAttemptId,attemptId);assert.doesNotMatch(JSON.stringify(report),/fake@example|5550123|private synthetic raw/);
  assert.equal((await listSignupBugs({prisma:other,listSignups:()=>[],attemptId})).events[0].association,'historical_unverified');assert.deepEqual(await db.runtimeStore.findUnique({where:{key}}),before);
  await assert.rejects(recordSignupBug({...input,prisma:db,error:{code:'ETIMEDOUT'}}),{code:'BUG_HISTORY_EVENT_CONFLICT'});assert.deepEqual(await db.runtimeStore.findUnique({where:{key}}),before);
 }finally{try{const row=await db.runtimeStore.findUnique({where:{key}});if(row){assert.equal(row.data.target.attemptId,attemptId);await db.runtimeStore.deleteMany({where:{key}});}if(ownsAttempt)await db.signupAttempt.deleteMany({where:{eventKey:attemptId,publicId:'attempt_'+hash(marker).slice(0,20)}});assert.equal(await db.runtimeStore.count({where:{key}}),0);}finally{await Promise.all([db.$disconnect(),other.$disconnect()]);}}
});
test('real SQL capture budget: an admitted blocked journal write can complete late, never automatically repeats',{skip:!enabled,timeout:30000},async()=>{
 const [db,locker]=clients(),eventId=crypto.randomUUID(),key=PREFIX+hash(eventId);let release,held;
 const acquired=new Promise(resolve=>{held=resolve;}),unlock=new Promise(resolve=>{release=resolve;});
 const lock=locker.$transaction(async tx=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;held();await unlock;},{timeout:10000});
 try{await acquired;const result=await safelyRecordSignupBug({prisma:db,listSignups:()=>[],eventId,error:{code:'ETIMEDOUT'}},{budgetMs:30});assert.equal(result.recorded,false);
  assert.equal(await db.runtimeStore.findUnique({where:{key}}),null);release();await lock;await waitFor(()=>db.runtimeStore.findUnique({where:{key}}));assert.equal(await db.runtimeStore.count({where:{key}}),1);
 }finally{release();await lock;try{await db.runtimeStore.deleteMany({where:{key}});assert.equal(await db.runtimeStore.count({where:{key}}),0);}finally{await Promise.all([db.$disconnect(),locker.$disconnect()]);}}
});
test('real SQL provider history: concurrent snapshots, rollback, stale failures, absence is not resolution and owned cleanup',{skip:!enabled,timeout:30000},async()=>{
 const [db,other]=clients(),marker=crypto.randomUUID(),key=STATUS+'render',eventId='fixture-'+marker;let owns=false;
 const body={page:{url:'https://status.render.com'},status:{indicator:'none'},components:[{id:'component',name:'Administration',status:'operational'}],incidents:[],scheduled_maintenances:[{id:eventId,name:'Synthetic maintenance',status:'scheduled',scheduled_for:'2026-11-18T02:00:00Z',scheduled_until:'2026-11-18T03:00:00Z',components:[{name:'Administration'}],incident_updates:[{created_at:'2026-11-16T12:00:00Z',body:'Fake maintenance; no provider contact'}]}]};
 const now=Date.now(),observation={...normalizeFeed('render',body,now),fixtureOwner:marker};
 const historyKey=HISTORY+hash(['render',eventId,observation.notices[0]]);
 try{assert.equal(await db.runtimeStore.findUnique({where:{key}}),null,'Never overwrite another fixture');assert.equal(await db.runtimeStore.findUnique({where:{key:historyKey}}),null);owns=true;
  await Promise.all([saveObservation(db,observation),saveObservation(other,observation)]);assert.equal(await db.runtimeStore.count({where:{key:historyKey}}),1);
  const previous=await db.runtimeStore.findUnique({where:{key}}),fault={$transaction:(fn,options)=>db.$transaction(async tx=>{await fn(tx);throw Error('injected rollback');},options)};
  await assert.rejects(saveObservation(fault,{...observation,checkedAt:new Date(now+1000).toISOString()}),/injected rollback/);assert.deepEqual(await db.runtimeStore.findUnique({where:{key}}),previous);
  await saveObservation(other,{version:1,provider:'render',outcome:'unavailable',checkedAt:new Date(now+2000).toISOString(),fixtureOwner:marker});let report=await readProviderStatuses({prisma:db,now:()=>now+2000});assert.equal(report.providers[0].fresh,false);assert.equal(report.providers[0].notices[0].status,'scheduled');
  await saveObservation(db,{...observation,checkedAt:new Date(now+3000).toISOString(),notices:[]});report=await readProviderStatuses({prisma:db,now:()=>now+3000});assert.equal(report.providers[0].notices.length,0);assert.equal(report.history.find(r=>r.notice.id===eventId).notice.status,'scheduled');
 }finally{try{if(owns){const row=await db.runtimeStore.findUnique({where:{key}});if(row)assert.equal(row.data.fixtureOwner,marker);await db.runtimeStore.deleteMany({where:{key:{in:[key,historyKey]}}});assert.equal(await db.runtimeStore.count({where:{key:{in:[key,historyKey]}}}),0);}}finally{await Promise.all([db.$disconnect(),other.$disconnect()]);}}
});

test('real SQL large provider history: bulk save preserves all rows, duplicate clients, rollback and owned cleanup',{skip:!enabled,timeout:30000},async()=>{
 const [db,other]=clients(),marker=crypto.randomUUID(),key=STATUS+'make',now=Date.now();let owns=false;
 const body={page:{url:'https://status.make.com'},status:{indicator:'none'},components:[{id:'fixture',name:'Synthetic component',status:'operational'}],incidents:[],scheduled_maintenances:Array.from({length:120},(_,i)=>({id:'fixture-'+marker+'-'+i,name:'Synthetic maintenance',status:'scheduled',scheduled_for:'2026-11-18T02:00:00Z',scheduled_until:'2026-11-18T03:00:00Z',components:[{name:'Synthetic component'}],incident_updates:[{created_at:'2026-11-16T12:00:00Z',body:'Fake notice, no provider requests.'}]}))};
 const observation={...normalizeFeed('make',body,now),fixtureOwner:marker};
 const revisedNotice={...observation.notices[0],title:'Synthetic revised notice'};
 const revised={...observation,checkedAt:new Date(now+1000).toISOString(),notices:[revisedNotice,...observation.notices.slice(1)]};
 const revisedKey=HISTORY+hash(['make',revisedNotice.id,revisedNotice]);
 const keys=[key,...observation.notices.map(n=>HISTORY+hash(['make',n.id,n])),revisedKey];
 try{
  assert.equal(await db.runtimeStore.count({where:{key:{in:keys}}}),0,'Never overwrite another test or real target');owns=true;
  await Promise.all([saveObservation(db,observation),saveObservation(other,observation)]);
  assert.equal(await db.runtimeStore.count({where:{key:{in:keys}}}),121);
  const previous=await db.runtimeStore.findUnique({where:{key}});
  const fault={$transaction:(fn,options)=>db.$transaction(async tx=>{await fn(tx);throw Error('synthetic post-bulk rollback');},options)};
  await assert.rejects(saveObservation(fault,revised),/synthetic post-bulk rollback/);
  assert.equal(await db.runtimeStore.findUnique({where:{key:revisedKey}}),null);
  assert.deepEqual(await db.runtimeStore.findUnique({where:{key}}),previous);
  assert.equal(await db.runtimeStore.count({where:{key:{in:keys}}}),121);
 }finally{try{if(owns){const row=await db.runtimeStore.findUnique({where:{key}});if(row)assert.equal(row.data.fixtureOwner,marker);await db.runtimeStore.deleteMany({where:{key:{in:keys}}});assert.equal(await db.runtimeStore.count({where:{key:{in:keys}}}),0);}}finally{await Promise.all([db.$disconnect(),other.$disconnect()]);}}
});
