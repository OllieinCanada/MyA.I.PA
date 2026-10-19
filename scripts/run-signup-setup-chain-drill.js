const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {fork}=require('node:child_process');
const {PrismaClient}=require('@prisma/client');
const url=process.env.SIGNUP_RECOVERY_DRILL_DATABASE_URL;
async function main(){
  const target=new URL(url);
  if(!['localhost','127.0.0.1','[::1]'].includes(target.hostname)||!/^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(target.pathname))throw Error('Isolated loopback database required');
  const prisma=new PrismaClient({datasources:{db:{url}},__internal:{configOverride:c=>({...c,relativeEnvPaths:{}})}});
  const children=new Set(),directories=[],cases=[];
  async function start(caseId,cwd){
    const child=fork(path.resolve('tests/helpers/signup-setup-chain-worker.js'),['--case='+caseId],{
      cwd,execArgv:['--max-old-space-size=128'],stdio:['ignore','ignore','pipe','ipc'],
      env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot,DATABASE_URL:url,DATA_DIR:path.join(cwd,'data')},
    });
    children.add(child);let errorText='';
    child.stderr.on('data',chunk=>{errorText=(errorText+chunk).slice(-2000);});
    const exited=new Promise(resolve=>child.once('exit',code=>{children.delete(child);resolve(code);}));
    const port=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>{child.kill();reject(Error('Chain app startup timed out'));},30000);
      child.once('message',message=>{clearTimeout(timeout);resolve(message.port);});
      child.once('exit',()=>{clearTimeout(timeout);reject(Error('Chain app exited: '+errorText));});
    });
    const base=`http://127.0.0.1:${port}`;
    return {child,exited,base,call:async body=>{
      const response=await fetch(base+'/__local-chain',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
      const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
    }};
  }
  async function stop(worker){if(worker.child.exitCode===null&&worker.child.signalCode===null)worker.child.kill();await worker.exited;}
  try{
    for(const [index,fault] of ['normal','drop-body','after-make','late-result','queue-write-failure'].entries()){
      const caseId=String(index+1),cwd=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-chain-drill-'));directories.push(cwd);
      let worker=await start(caseId,cwd);
      const fixture=await worker.call({action:'fixture',fault});
      const endpoint='/api/integrations/verify-signup-contact?'+fixture.query;
      const preview=await(await fetch(worker.base+endpoint)).text();
      const form=new URLSearchParams([...preview.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)].map(m=>[m[1],m[2]]));
      if(fault==='queue-write-failure'){
        assert.match(fixture.eventKey,/^signup_[a-f0-9]{32}$/);
        await prisma.$executeRawUnsafe(`CREATE FUNCTION drill_reject_signup_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key = TG_ARGV[0] THEN RAISE EXCEPTION 'isolated queue write failure'; END IF; RETURN NEW; END $$`);
        await prisma.$executeRawUnsafe(`CREATE TRIGGER drill_reject_signup_job BEFORE INSERT ON "RuntimeStore" FOR EACH ROW EXECUTE FUNCTION drill_reject_signup_job('signup-setup-job:v1:${fixture.eventKey}')`);
        try{
          const rejected=await fetch(worker.base+'/api/integrations/verify-signup-contact',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form.toString()});
          assert.ok(rejected.status>=500);await rejected.text();
          const pending=await prisma.pendingSignupVerification.findUnique({where:{tokenHash:crypto.createHash('sha256').update(fixture.token).digest('hex')}});
          assert.equal(pending.claimedAt,null);assert.equal(pending.verifiedAt,null);
          assert.equal((await worker.call({action:'inspect'})).counts.make,undefined);
        }finally{
          await prisma.$executeRawUnsafe('DROP TRIGGER drill_reject_signup_job ON "RuntimeStore"');
          await prisma.$executeRawUnsafe('DROP FUNCTION drill_reject_signup_job()');
        }
      }
      const acknowledge=await fetch(worker.base+'/api/integrations/verify-signup-contact',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:form.toString()});
      assert.equal(acknowledge.status,200,await acknowledge.clone().text());await acknowledge.text();
      let before=await worker.call({action:'inspect'});
      assert.equal(before.counts.make,undefined,'Acknowledgment must not wait for or dispatch Make');
      assert.equal(before.jobs.find(j=>j.data.eventKey===fixture.eventKey).data.status,'pending');
      // Real application process stops after the verification transaction.
      await stop(worker);worker=await start(caseId,cwd);
      if(fault==='after-make'){
        await worker.call({action:'drain'}).catch(()=>{});assert.equal(await worker.exited,86);
        const key='signup-setup-job:v1:'+fixture.eventKey;
        const row=await prisma.runtimeStore.findUnique({where:{key}});
        assert.equal(row.data.phase,'handoff');
        // Advance only this fixture's stale lease, not a customer lease.
        await prisma.runtimeStore.update({where:{key},data:{data:{...row.data,leaseExpiresAt:0}}});
        worker=await start(caseId,cwd);
      }
      if(fault==='late-result'){
        await worker.call({action:'drain'});
        const key='signup-setup-job:v1:'+fixture.eventKey;
        const row=await prisma.runtimeStore.findUnique({where:{key}});
        assert.equal(row.data.status,'pending');assert.equal(row.data.lastErrorCode,'UND_ERR_SOCKET');
        assert.equal((await worker.call({action:'inspect'})).counts.make,1);
        await worker.call({action:'release-late-result'});
        await prisma.runtimeStore.update({where:{key},data:{data:{...row.data,nextAttemptAt:0}}});
      }
      const competitor=await start(caseId,cwd);
      try{
        await Promise.all([worker.call({action:'drain'}),competitor.call({action:'drain'})]);
        await worker.call({action:'callbacks'});
        const evidence=await worker.call({action:'inspect'});
        if(['drop-body','late-result'].includes(fault)){
          const {journalKey}=require('../server/intakeRecoveryJournal');
          const operations=await prisma.runtimeStore.findMany({where:{key:{startsWith:journalKey(fixture.eventKey)+':handoff:'}}});
          assert.ok(operations.some(row=>row.data.status==='uncertain'&&row.data.failureCode==='UND_ERR_SOCKET'),'Original socket explanation must survive successful recovery');
        }
        const job=evidence.jobs.find(j=>j.data.eventKey===fixture.eventKey);
        assert.equal(job.data.status,'completed',JSON.stringify({job,counts:evidence.counts,attempts:evidence.attempts}));
        const attempt=evidence.attempts.find(a=>a.eventKey===fixture.eventKey);
        assert.equal(attempt.status,'setup_ready',JSON.stringify({counts:evidence.counts,attempt,dashboard:evidence.dashboard}));
        const record=Object.values(evidence.dashboard).find(r=>r.signupAttemptId===fixture.eventKey);
        assert.ok(record,'Exact dashboard record required');
        assert.equal(record.subscriptionStatus,'trialing',JSON.stringify(record));
        assert.equal(record.agentTestOwnerProviderStatus,'delivered',JSON.stringify(record));
        assert.equal(record.agentTestCustomerProviderStatus,'delivered',JSON.stringify(record));
        assert.equal(record.setupFollowupStatus,'sent',JSON.stringify(record));
        assert.equal(evidence.counts.make,1);assert.equal(evidence.counts['twilio-number'],1);
        assert.equal(evidence.counts.assistant,1);assert.equal(evidence.counts['phone-number'],1);
        assert.equal(evidence.counts.subscriptions,1);assert.equal(evidence.counts.texts,3);
        for(let n=0;n<2;n++){
          await(await fetch(worker.base+endpoint)).text();await worker.call({action:'drain'});
        }
        assert.deepEqual((await worker.call({action:'inspect'})).counts,evidence.counts);
        cases.push({fault,passed:true,realDatabase:true,fullAppRestart:true,makePosts:1,numbers:1,assistants:1,imports:1,texts:3,subscriptions:1});
        console.log(JSON.stringify(cases.at(-1)));
      }finally{await stop(worker);await stop(competitor);}
    }
    return {passed:true,productionTouched:false,externalProvidersMocked:true,cases};
  }finally{
    await Promise.all([...children].map(child=>new Promise(resolve=>{child.once('exit',resolve);child.kill();})));
    await prisma.$disconnect();
    for(const dir of directories){if(path.dirname(dir)!==os.tmpdir()||!path.basename(dir).startsWith('myaipa-chain-drill-'))throw Error('Unsafe temp cleanup');fs.rmSync(dir,{recursive:true,force:true});}
  }
}
if(require.main===module)main().then(report=>{
  const reportPath=path.resolve('diagnostics/signup-failure-recovery-audit/verified-setup-chain.json');fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
}).catch(error=>{console.error(error.message);process.exitCode=1;});
