const crypto = require('node:crypto');
const PREFIX = 'signup-setup-job:v1:';
const LEASE_MS = 120000;
const fail = code => Object.assign(new Error(code), { code });
function jobKey(eventKey) {
  if (!/^signup_[a-f0-9]{32}$/.test(eventKey)) throw fail('SIGNUP_JOB_ID_INVALID');
  return PREFIX + eventKey;
}
function encryptionKey(secret) {
  if (String(secret || '').length < 24) throw fail('SIGNUP_JOB_SECRET_REQUIRED');
  return crypto.createHmac('sha256', secret).update('signup-setup-job:checkpoint:v1').digest();
}
function seal(value, secret, key) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  cipher.setAAD(Buffer.from(key));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return { iv:iv.toString('base64url'), tag:cipher.getAuthTag().toString('base64url'), bytes:bytes.toString('base64url') };
}
function unseal(value, secret, key) {
  if (!value) return {};
  const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(value.iv,'base64url'));
  cipher.setAAD(Buffer.from(key)); cipher.setAuthTag(Buffer.from(value.tag,'base64url'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(value.bytes,'base64url')),cipher.final()]).toString());
}
async function put(tx,key,data) {
  await tx.runtimeStore.upsert({where:{key},create:{key,data},update:{data}});
}
async function locked(prisma,key,work) {
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    return work(tx,(await tx.runtimeStore.findUnique({where:{key}}))?.data);
  },{maxWait:5000,timeout:10000});
}
// Called INSIDE the verification-claim transaction. No provider calls or timers.
async function enqueueSignupSetupJob(tx,{eventKey,tokenHash,channel,businessKey,now=Date.now()}) {
  const key=jobKey(eventKey);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
  if (!/^[a-f0-9]{64}$/.test(tokenHash)||!/^[a-f0-9]{64}$/.test(businessKey)||!['sms','email'].includes(channel)) throw fail('SIGNUP_JOB_INPUT_INVALID');
  const previous=(await tx.runtimeStore.findUnique({where:{key}}))?.data;
  if(previous) {
    if(previous.tokenHash!==tokenHash||previous.channel!==channel||previous.businessKey!==businessKey) throw fail('SIGNUP_JOB_BINDING_CONFLICT');
    return {key,duplicate:true};
  }
  await put(tx,key,{eventKey,tokenHash,channel,businessKey,status:'pending',phase:'queued',attempts:0,nextAttemptAt:now,createdAt:now});
  return {key,duplicate:false};
}
async function drainSignupSetupJobs({prisma,secret,processJob,onFailure=async()=>{},now=Date.now,leaseMs=LEASE_MS,batchSize=3,heartbeatMs=20000}) {
  encryptionKey(secret);
  const rows=await prisma.runtimeStore.findMany({where:{key:{startsWith:PREFIX},OR:[
    {AND:[{data:{path:['status'],equals:'pending'}},{data:{path:['nextAttemptAt'],lte:now()}}]},
    {AND:[{data:{path:['status'],equals:'processing'}},{data:{path:['leaseExpiresAt'],lte:now()}}]},
  ]},orderBy:{updatedAt:'asc'},take:Math.max(1,Math.min(10,batchSize))});
  let processed=0;
  await Promise.all(rows.map(async row=>{
    const token=crypto.randomUUID();
    let job=await locked(prisma,row.key,async(tx,data)=>{
      if(!data||!['pending','processing'].includes(data.status)||(data.status==='pending'?data.nextAttemptAt:data.leaseExpiresAt)>now())return null;
      const next={...data,status:'processing',leaseExpiresAt:now()+leaseMs,token,attempts:data.attempts+1};
      await put(tx,row.key,next);return next;
    });
    if(!job)return;
    let lost=false,heartbeat=Promise.resolve();
    async function change(update) {
      return locked(prisma,row.key,async(tx,current)=>{
        if(lost||current?.token!==token||current.leaseExpiresAt<=now()) {lost=true;throw fail('SIGNUP_JOB_LEASE_LOST');}
        const next=await update(current);
        await put(tx,row.key,next);job=next;return next;
      });
    }
    const timer=setInterval(()=>{heartbeat=heartbeat.then(()=>change(current=>({...current,leaseExpiresAt:now()+leaseMs}))).catch(()=>{lost=true;});},heartbeatMs);
    timer.unref?.();
    const ctl={
      assertLease:()=>change(current=>current),
      async memoize(name,work) {
        await ctl.assertLease();
        const cache=unseal(job.checkpoints,secret,row.key);
        if(Object.hasOwn(cache,name))return cache[name];
        const value=await work();
        await change(current=>({...current,checkpoints:seal({...unseal(current.checkpoints,secret,row.key),[name]:value},secret,row.key)}));
        return value;
      },
      async handoff(dispatch,reconcile) {
        return ctl.memoize('handoff',async()=>{
          if(job.phase==='handoff') {
            const recovered=await reconcile();
            if(!recovered)throw fail('SIGNUP_HANDOFF_OUTCOME_UNCERTAIN');
            return recovered;
          }
          try {
            return await dispatch(async()=>{await change(current=>({...current,phase:'handoff',dispatchStartedAt:now()}));});
          }catch(error){
            if(error.code==='SIGNUP_JOB_LEASE_LOST')throw error;
            if(job.phase==='handoff') {
              const recovered=await reconcile().catch(()=>null);if(recovered)return recovered;
              error.signupHandoffUncertain=['MAKE_SIGNUP_TIMEOUT','MAKE_SIGNUP_UNREACHABLE'].includes(error.code);
            }
            throw error;
          }
        });
      },
    };
    let failure;
    try {await processJob(job,ctl);}catch(error){failure=error;}
    clearInterval(timer);await heartbeat;
    if(!lost) {
      const originalCode=failure?.providerCode||failure?.code||'SIGNUP_JOB_FAILED';
      const code=String(originalCode==='SIGNUP_HANDOFF_OUTCOME_UNCERTAIN'&&job.lastErrorCode?job.lastErrorCode:originalCode).replace(/[^A-Z0-9_]/gi,'_').slice(0,100);
      const uncertain=job.phase==='handoff'&&!unseal(job.checkpoints,secret,row.key).handoff;
      // A lost response permits only read-only reconciliation, not another
      // POST. Allow delayed Make modules to save their result before holding.
      const exhausted=job.attempts>=(uncertain?10:5);
      try {
        let reportingFailed=false;
        if(failure)try{await onFailure({job,code,uncertain,exhausted});}catch(_){reportingFailed=true;}
        await change(current=>({...current,status:failure?(exhausted&&!reportingFailed?'failed':'pending'):'completed',token:null,leaseExpiresAt:0,
          nextAttemptAt:failure?now()+Math.min(300000,5000*2**(job.attempts-1)):0,lastErrorCode:failure?code:'',completedAt:failure?null:now()}));
      }catch(error){if(error.code!=='SIGNUP_JOB_LEASE_LOST')throw error;}
    }
    processed++;
  }));
  return {processed};
}
module.exports={enqueueSignupSetupJob,drainSignupSetupJobs,jobKey,PREFIX};
