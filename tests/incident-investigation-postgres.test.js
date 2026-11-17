'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {notifyInvestigationStage,REASON,PREFIX}=require('../server/incidentInvestigationBridge');
const enabled=process.env.RUN_INVESTIGATION_POSTGRES==='1';
function clients(){
 const url=new URL(process.env.DATABASE_URL);
 assert.ok(['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Disposable loopback only');
 assert.ok(process.env.GITHUB_ACTIONS==='true'&&url.pathname==='/ci'||/^\/myaipa_investigation_[a-z0-9_]+$/.test(url.pathname),'Execution-owned synthetic database required');
 const {PrismaClient}=require('@prisma/client');
 return [0,1].map(()=>new PrismaClient({datasources:{db:{url:url.href}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}}));
}
async function rehearsal(body){
 const dbs=clients(),id=crypto.randomBytes(12).toString('hex'),key=PREFIX+id+':1';
 const input={incident_id:id,generation:1,run_id:'1234',base_sha:'b'.repeat(40),phase:'start'};
 const options={input,enabled:true,incident:{id,incident:{reasonCode:REASON},snapshot:{Route:'/background/public-provider-status'},remediation:{generation:1,status:'repair_dispatched'}},verifyRun:async()=>{}};
 try{
   assert.equal(await dbs[0].runtimeStore.findUnique({where:{key}}),null);
   await body({dbs,key,options});
 }finally{
   try{await dbs[0].runtimeStore.deleteMany({where:{key}});assert.equal(await dbs[0].runtimeStore.count({where:{key}}),0);}
   finally{await Promise.all(dbs.map(db=>db.$disconnect()));}
 }
}
test('disposable SQL: two independent notice workers race once, accepted receipt survives restart, unrelated stages preserved',{skip:!enabled,timeout:30000},()=>rehearsal(async({dbs,key,options})=>{
 let sends=0;const send=async()=>{sends++;return {accepted:true,messageId:11};};
 await Promise.allSettled(dbs.map(prisma=>notifyInvestigationStage({...options,prisma,send})));
 assert.equal(sends,1);const row=await dbs[0].runtimeStore.findUnique({where:{key}});assert.equal(row.data.stages.start.status,'accepted');
 assert.equal((await notifyInvestigationStage({...options,prisma:dbs[1],send})).duplicate,true);assert.equal(sends,1);
 await notifyInvestigationStage({...options,input:{...options.input,phase:'before_edit'},prisma:dbs[1],send});
 const after=await dbs[0].runtimeStore.findUnique({where:{key}});assert.deepEqual(after.data.stages.start,row.data.stages.start);assert.equal(after.data.stages.before_edit.status,'accepted');
}));
test('disposable SQL: lost provider acknowledgement persists uncertainty across clients; no resend',{skip:!enabled,timeout:30000},()=>rehearsal(async({dbs,key,options})=>{
 let sends=0;const send=async()=>{sends++;throw Error('synthetic lost acknowledgement');};
 await assert.rejects(notifyInvestigationStage({...options,prisma:dbs[0],send}),{code:'INVESTIGATION_NOTICE_UNKNOWN'});
 await assert.rejects(notifyInvestigationStage({...options,prisma:dbs[1],send}),{code:'INVESTIGATION_NOTICE_UNKNOWN'});
 assert.equal(sends,1);assert.equal((await dbs[0].runtimeStore.findUnique({where:{key}})).data.stages.start.status,'pending');
}));
test('disposable SQL: run conflicts and disabled admission leave accepted proof unchanged',{skip:!enabled,timeout:30000},()=>rehearsal(async({dbs,key,options})=>{
 let sends=0;const send=async()=>{sends++;return {accepted:true,messageId:12};};
 await notifyInvestigationStage({...options,prisma:dbs[0],send});const before=await dbs[0].runtimeStore.findUnique({where:{key}});
 await assert.rejects(notifyInvestigationStage({...options,input:{...options.input,run_id:'999'},prisma:dbs[1],send}),{code:'INVESTIGATION_BINDING_CONFLICT'});
 await assert.rejects(notifyInvestigationStage({...options,enabled:false,prisma:dbs[1],send}),{code:'INVESTIGATION_DISABLED'});
 assert.deepEqual(await dbs[0].runtimeStore.findUnique({where:{key}}),before);assert.equal(sends,1);
}));
