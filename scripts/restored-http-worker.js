// Fixed synthetic CI child. No generic target, route, module or archive execution.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
async function main(){
 const input=process.env,mode=input.RESTORED_HTTP_MODE;assert.ok(['success','refusal'].includes(mode));
 assert.equal(input.DISABLE_LOCAL_ENV_FILES,'1');assert.match(input.SYNTHETIC_BACKUP_HEAD||'',/^[a-f0-9]{40}$/);
 const ticket=JSON.parse(fs.readFileSync(input.RESTORED_HTTP_TICKET,'utf8')),url=new URL(input.DATABASE_URL);
 assert.equal(url.hostname,'127.0.0.1');assert.match(url.pathname,/^\/myaipa_restore_drill_[a-f0-9]{12}$/);assert.match(url.username,/^http_fixture_[a-f0-9]{12}$/);
 assert.equal(ticket.syntheticOnly,true);assert.equal(ticket.head,input.SYNTHETIC_BACKUP_HEAD);assert.equal(ticket.database,url.pathname.slice(1));assert.equal(ticket.role,url.username);assert.equal(String(ticket.port),url.port);
 assert.ok(Date.now()-Date.parse(ticket.createdAt)>=0&&Date.now()-Date.parse(ticket.createdAt)<120000);
 const root=fs.realpathSync(ticket.dataDirectory);assert.equal(path.basename(root),'restored-files');
 assert.match(path.basename(path.dirname(root)),/^myaipa-backup-drill-/);assert.ok(Array.isArray(ticket.context)&&ticket.context.length===2);
 const selected=Object.fromEntries(['PATH','HOME','TMPDIR','DATABASE_URL'].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
 for(const key of Object.keys(process.env))delete process.env[key];
 Object.assign(process.env,selected,{NODE_ENV:'test',DISABLE_LOCAL_ENV_FILES:'1',DATA_DIR:root,RECOVERY_STRICT_FILE_READS:'true',CHECKPOINT_DISABLE:'1',
  ADMIN_SESSION_SECRET:crypto.randomBytes(32).toString('hex'),VAPI_AUTO_SYNC_ENABLED:'false',SIGNUP_SETUP_WORKER_PAUSED:'true',TRIAL_REMINDER_DISABLE:'true'});
 const {PrismaClient}=require('@prisma/client');const db=new PrismaClient({datasources:{db:{url:url.href}},log:[{emit:'event',level:'query'}],__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});
 await db.$connect();
 const row=(await db.$queryRawUnsafe('SELECT current_database() AS db,current_user AS role')).at(0);assert.equal(row.db,ticket.database);assert.equal(row.role,ticket.role);
 const role=(await db.$queryRawUnsafe('SELECT rolsuper,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).at(0);assert.deepEqual(role,{rolsuper:false,rolcreatedb:false,rolcreaterole:false});
 // ACL proof: SELECT-only role has no table write privileges, independent of JS instrumentation.
 const privileges=await db.$queryRawUnsafe("SELECT tablename,has_table_privilege(current_user,quote_ident(schemaname)||'.'||quote_ident(tablename),'INSERT,UPDATE,DELETE,TRUNCATE') AS writes FROM pg_tables WHERE schemaname='public'");
 assert.equal(privileges.length,36);assert.ok(privileges.every(r=>!r.writes));
 let databaseMutationAttempts=0,receiptReads=0;
 db.$on('query',e=>{if(/^\s*(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|COPY|GRANT|REVOKE)\b/i.test(e.query))databaseMutationAttempts++;});
 const guarded=db.$extends({query:{$allModels:{$allOperations:async({model,operation,args,query})=>{
  if(!['findUnique','findUniqueOrThrow','findFirst','findFirstOrThrow','findMany','count','aggregate','groupBy'].includes(operation)){databaseMutationAttempts++;throw Error('HTTP_DATABASE_WRITE_REFUSED');}
  if(model==='RuntimeStore'&&operation==='findMany'&&args?.where?.key?.in?.some(k=>k.startsWith('twilio-status-inbox:')))receiptReads++;
  if(mode==='refusal'&&model==='Business'&&operation==='findUnique')throw Error('SYNTHETIC_READ_FAILURE');
  return query(args);
 }}}});
 global.__myAiPaPrisma=guarded;
 const guard=require('./local-staging-egress').install({ports:[Number(url.port)]});
 const writes=[];const deny=(op)=>{writes.push(op);throw Object.assign(Error('HTTP_FILE_WRITE_REFUSED'),{code:'HTTP_FILE_WRITE_REFUSED'});};
 for(const name of ['writeFile','appendFile','rename','unlink','mkdir','rm','rmdir','truncate','copyFile','chmod','chown','link','symlink','utimes','write','writev','ftruncate']){
  if(fs[name])fs[name]=()=>deny(name);if(fs[name+'Sync'])fs[name+'Sync']=()=>deny(name+'Sync');if(fs.promises[name])fs.promises[name]=async()=>deny('promise:'+name);
 }
 const nativeOpen=fs.openSync;fs.openSync=(file,flags,...args)=>{
  if(typeof flags==='number'?(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND))!==0:flags!=='r')return deny('openSync-write');return nativeOpen(file,flags,...args);
 };
 const open=fs.open;fs.open=(file,flags,...args)=>{if(flags!=='r')return deny('open-write');return open(file,flags,...args);};
 const promiseOpen=fs.promises.open;fs.promises.open=async(file,flags,...args)=>{if(flags!=='r')return deny('promise:open-write');return promiseOpen.call(fs.promises,file,flags,...args);};
 fs.createWriteStream=()=>deny('createWriteStream');
 const intervals=[],nativeInterval=global.setInterval;
 global.setInterval=(...args)=>{const caller=new Error().stack.split('\n')[2]||'';if(!/at MemoryStore\.init .*express-rate-limit[\\/]dist[\\/]index\.cjs:/.test(caller))throw Error('HTTP_BACKGROUND_WORKER_REFUSED');const h=Reflect.apply(nativeInterval,global,args);intervals.push(h);return h;};
 // Logs can contain error internals: never publish them or query parameters.
 console.log=()=>{};console.error=()=>{};console.warn=()=>{};
 const {app,__test}=require('../server/index');const server=app.listen(0,'127.0.0.1');await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});guard.allowPort(server.address().port);
 const endpoint=`http://127.0.0.1:${server.address().port}/api/customer/dashboard`;
 let authenticatedTenants=0,authRefusals=0,receiptDelivered=false,suppressionPreserved=false,forcedReadFailure=false;
 try{
  const get=token=>fetch(endpoint,{headers:token?{cookie:'myaipa_customer_dashboard_session='+token}:{}});
  assert.equal((await get()).status,401);authRefusals++;
  assert.equal((await get('bad.bad')).status,401);authRefusals++;
  const [a,b]=ticket.context,token=__test.createCustomerDashboardSessionToken({email:a.ownerEmail,phone:a.ownerPhone});
  const payloadObject=JSON.parse(Buffer.from(token.split('.')[0],'base64url'));payloadObject.exp=Date.now()-1;const payload=Buffer.from(JSON.stringify(payloadObject)).toString('base64url');
  const signature=crypto.createHmac('sha256',process.env.ADMIN_SESSION_SECRET).update('customer-dashboard:'+payload).digest('hex');assert.equal((await get(payload+'.'+signature)).status,401);authRefusals++;
  assert.equal((await get(__test.createCustomerDashboardSessionToken({email:'absent@example.invalid',phone:'+15555550999'}))).status,404);authRefusals++;
  if(mode==='success'){
   for(const target of [a,b]){const response=await get(__test.createCustomerDashboardSessionToken({email:target.ownerEmail,phone:target.ownerPhone}));assert.equal(response.status,200);
    const data=(await response.json()).dashboard;assert.equal(data.businessId,target.businessId);assert.equal(data.signup.ownerEmail,target.ownerEmail);authenticatedTenants++;
    const calls=Object.values(data).find(v=>Array.isArray(v)&&v.some(c=>c?.id===ticket.callId&&c.notificationEvidence));
    if(target.businessId===a.businessId){assert.equal(data.messaging.status,'PAUSED');suppressionPreserved=true;assert.ok(calls);assert.equal(calls.find(c=>c.id===ticket.callId).notificationEvidence.customer.state,'delivered');receiptDelivered=true;}
    else{assert.ok(!JSON.stringify(data).includes(a.ownerEmail));assert.ok(!JSON.stringify(data).includes('synthetic-http-completed'));assert.ok(!calls);}
   }
   assert.ok(receiptReads>0);assert.equal(writes.length,0);
  }else{assert.equal((await get(token)).status,500);forcedReadFailure=true;assert.ok(writes.length>0,'Error-path incident write must be detected');}
  await new Promise(resolve=>setTimeout(resolve,100));assert.equal(databaseMutationAttempts,0);assert.equal(guard.status().unexpectedOutboundAttempts,0);
  const probes=await guard.probes();assert.equal(probes.rejected,6);
  return {mode,passed:true,authenticatedTenants,authRefusals,receiptDelivered,suppressionPreserved,forcedReadFailure,databaseMutationAttempts,fileMutationAttempts:writes.length,fileWritesPrevented:true,receiptReads};
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const timer of intervals)clearInterval(timer);await db.$disconnect();}
}
main().then(r=>process.stdout.write(JSON.stringify(r))).catch(()=>{process.stderr.write('RESTORED_HTTP_CHILD_REFUSED\n');process.exitCode=1;});
