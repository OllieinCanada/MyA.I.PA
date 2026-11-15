const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const BASE_HEAD='81a50f70214e28d6d8579d4c028375e1d7620606';
const SID='SM'+'a'.repeat(32);
async function seedHttp(client,records){
 const first=records.get('Business');
 await client.business.update({where:{id:first.id},data:{name:'Synthetic HTTP tenant A',phone:'+15555550701',timezone:'America/Toronto'}});
 const second=await client.business.create({data:{name:'Synthetic HTTP tenant B',phone:'+15555550702',timezone:'America/Toronto'}});
 await client.settings.update({where:{businessId:first.id},data:{ownerPhone:'+15555550701'}});
 const receipt={MessageSid:SID,MessageStatus:'delivered'},key=require('../server/twilioStatusInbox').receiptKey(receipt);
 await client.runtimeStore.create({data:{key,data:{receipt,status:'completed',receivedAt:1767225600000,syntheticOnly:true}}});
 await client.smsSuppression.upsert({where:{phoneNumber:'+15555550701'},create:{phoneNumber:'+15555550701',source:'synthetic-fixture',suppressed:true},update:{suppressed:true}});
 await client.call.update({where:{id:records.get('Call').id},data:{businessId:first.id,status:'COMPLETED',externalProvider:'vapi',externalId:'synthetic-http-completed',
  toolCallSummary:{count:1,countIsExact:true,results:[{name:'send_call_summaries_synthetic',owner:{attempted:true,sent:true,status:'sent',messageId:SID,messageIdSet:true},customer:{attempted:true,sent:true,status:'sent',messageId:SID,messageIdSet:true}}]}}});
 const context=[first.id,second.id].map((businessId,i)=>({businessId,signupAttemptId:'synthetic-http-'+i,ownerEmail:`http${i}@example.invalid`,ownerPhone:`+1555555070${i+1}`,
  businessName:'Synthetic HTTP tenant '+(i?'B':'A'),status:'signup_received',signedUpAt:'2026-01-01T00:00:00.000Z'}));
 return {context,receiptKey:key,callId:records.get('Call').id};
}
function verifyHttp(value){return value?.scope==='restored-disposable-http-read-only'&&value.passed===true&&value.realSql===true&&value.sourceDependency===BASE_HEAD
 &&value.success?.authenticatedTenants===2&&value.success.receiptDelivered===true&&value.success.suppressionPreserved===true
 &&value.success.authRefusals===4&&value.success.databaseMutationAttempts===0&&value.success.fileMutationAttempts===0
 &&value.success.receiptReads>0&&value.success.fileProbeRefusals===4&&value.success.sqlWritePrivilegeProbeRefused===true
 &&value.refusal?.forcedReadFailure===true&&value.refusal.databaseMutationAttempts===0&&value.refusal.fileMutationAttempts>0
 &&value.refusal.fileWritesPrevented===true&&value.databaseFingerprintsUnchanged===true&&value.filesUnchanged===true&&value.roleRemoved===true
 &&value.refusal.fileProbeRefusals===4&&value.refusal.sqlWritePrivilegeProbeRefused===true
 &&value.providerCallsOrMessages===0&&value.liveRecoveryProven===false&&value.osSandboxProven===false&&value.allPathsNaturallyReadOnly===false;}
async function exerciseHttp({nativeSpawn,admin,use,config,target,restoredFiles,root,clean,identity,httpContext,head,fingerprints,before}){
 const role='http_fixture_'+crypto.randomBytes(6).toString('hex'),password=crypto.randomBytes(24).toString('hex');
 const ident='"'+role+'"';assert.match(target,/^myaipa_restore_drill_[a-f0-9]{12}$/);
 const filesBefore=Object.fromEntries(fs.readdirSync(restoredFiles).sort().map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(restoredFiles,n))).digest('hex')]));
 const out={scope:'restored-disposable-http-read-only',sourceDependency:BASE_HEAD,passed:false,realSql:true,providerCallsOrMessages:0,liveRecoveryProven:false,osSandboxProven:false,allPathsNaturallyReadOnly:false};
 await admin.query('CREATE ROLE '+ident+' LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD \''+password+'\'');
 try{
  await admin.query('GRANT CONNECT ON DATABASE "'+target+'" TO '+ident);
  await use(target,async c=>{await c.query('GRANT USAGE ON SCHEMA public TO '+ident);await c.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO '+ident);});
  const ticket={syntheticOnly:true,head,createdAt:new Date().toISOString(),database:target,port:config.port,role,systemIdentifier:identity.identifier,
   context:httpContext.context,callId:httpContext.callId,dataDirectory:restoredFiles};
  const ticketPath=path.join(root,'http-target.json');fs.writeFileSync(ticketPath,JSON.stringify(ticket),{flag:'wx',mode:0o600});
  for(const mode of ['success','refusal']){
   const child=nativeSpawn(process.execPath,[path.join(__dirname,'restored-http-worker.js')],{cwd:path.resolve(__dirname,'..'),timeout:60000,maxBuffer:1024*1024,encoding:'utf8',
    env:{...clean,NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1',RESTORED_HTTP_TICKET:ticketPath,RESTORED_HTTP_MODE:mode,
     DATABASE_URL:`postgresql://${role}:${password}@127.0.0.1:${config.port}/${target}?connection_limit=1`,SYNTHETIC_BACKUP_HEAD:head}});
   assert.equal(child.status,0,'HTTP_WORKER_'+mode+'_REFUSED');let result;try{result=JSON.parse(child.stdout);}catch{throw Error('HTTP_WORKER_RESULT_REQUIRED');}
   assert.equal(result.mode,mode);assert.equal(result.passed,true);out[mode]=result;
   assert.deepEqual(await use(target,fingerprints),before);
   const after=Object.fromEntries(fs.readdirSync(restoredFiles).sort().map(n=>[n,crypto.createHash('sha256').update(fs.readFileSync(path.join(restoredFiles,n))).digest('hex')]));assert.deepEqual(after,filesBefore);
  }
  out.databaseFingerprintsUnchanged=true;out.filesUnchanged=true;
 }finally{
  await use(target,c=>c.query('DROP OWNED BY '+ident));await admin.query('DROP ROLE '+ident);
  assert.equal((await admin.query('SELECT COUNT(*)::int AS n FROM pg_roles WHERE rolname=$1',[role])).rows[0].n,0);out.roleRemoved=true;
 }
 out.passed=true;assert.equal(verifyHttp(out),true);return out;
}
module.exports={BASE_HEAD,seedHttp,verifyHttp,exerciseHttp};
