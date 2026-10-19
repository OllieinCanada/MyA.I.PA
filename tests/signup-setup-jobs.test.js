const { test } = require('node:test');
const assert = require('node:assert/strict');
const { memoryDb } = require('./helpers/twilio-status-memory-db');
const { enqueueSignupSetupJob, drainSignupSetupJobs, jobKey } = require('../server/signupSetupJobs');
const { readMakeSignupHandoff } = require('../server/makeSignupHandoff');
const secret = 'synthetic-checkpoint-secret-at-least-32-characters';
const input = {eventKey:`signup_${'a'.repeat(32)}`,tokenHash:'b'.repeat(64),businessKey:'d'.repeat(64),channel:'sms',now:1000};
const enqueue = prisma => prisma.$transaction(tx=>enqueueSignupSetupJob(tx,input));
const state = rows => rows.get(jobKey(input.eventKey)).data;

test('verification enqueues once; overlapping workers dispatch only once',async()=>{
  const {prisma,rows}=memoryDb();
  assert.equal((await enqueue(prisma)).duplicate,false);
  assert.equal((await enqueue(prisma)).duplicate,true);
  let posts=0;
  const worker=()=>drainSignupSetupJobs({prisma,secret,now:()=>1001,processJob:async(job,ctl)=>{
    await ctl.handoff(async before=>{await before();posts++;return {ok:true};},async()=>null);
  }});
  await Promise.all([worker(),worker()]);
  assert.equal(posts,1);assert.equal(state(rows).status,'completed');
  assert.equal((await enqueue(prisma)).duplicate,true);
  await worker();assert.equal(posts,1);
});

test('a response-body socket failure preserves its cause and records uncertainty without retry',async()=>{
  let posts=0,uncertain=0;
  const cause=Object.assign(new Error('other side closed'),{code:'UND_ERR_SOCKET'});
  await assert.rejects(readMakeSignupHandoff({url:'https://make.invalid',options:{method:'POST'},
    fetchImpl:async()=>{posts++;return {text:async()=>{throw cause;}};},
    onUncertain:async({code})=>{uncertain++;assert.equal(code,'UND_ERR_SOCKET');},
  }),error=>error.cause===cause&&error.providerCode==='UND_ERR_SOCKET'&&error.provider==='MAKE');
  assert.equal(posts,1);assert.equal(uncertain,1);
});

test('network failure remains the original cause even if saving uncertainty also fails',async()=>{
  const cause=Object.assign(new Error('fetch failed'),{cause:{code:'UND_ERR_SOCKET'}});
  await assert.rejects(readMakeSignupHandoff({fetchImpl:async()=>{throw cause;},onUncertain:async()=>{throw new Error('database unavailable');}}),
    error=>error.cause===cause&&error.providerCode==='UND_ERR_SOCKET');
});

test('restart before dispatch resumes; restart after dispatch reconciles instead of repeating Make',async()=>{
  const {prisma,rows}=memoryDb();await enqueue(prisma);
  Object.assign(state(rows),{status:'processing',phase:'queued',token:'dead-worker',leaseExpiresAt:1000});
  let posts=0;
  await drainSignupSetupJobs({prisma,secret,now:()=>1001,processJob:async(job,ctl)=>{
    await ctl.handoff(async before=>{await before();posts++;return {number:'synthetic'};},async()=>null);
  }});
  assert.equal(posts,1);
  // Model a killed process whose response/checkpoint was never saved.
  Object.assign(state(rows),{status:'processing',phase:'handoff',checkpoints:null,token:'dead-worker',leaseExpiresAt:1001});
  let reads=0;
  await drainSignupSetupJobs({prisma,secret,now:()=>1002,processJob:async(job,ctl)=>{
    const result=await ctl.handoff(async()=>{posts++;},async()=>{reads++;return {number:'synthetic'};});
    assert.equal(result.number,'synthetic');
  }});
  assert.equal(posts,1);assert.equal(reads,1);assert.equal(state(rows).status,'completed');
});

test('unknown dispatched outcome stops for reconciliation and never sends a second POST',async()=>{
  const {prisma,rows}=memoryDb();await enqueue(prisma);
  Object.assign(state(rows),{status:'processing',phase:'handoff',token:'dead-worker',leaseExpiresAt:1000});
  let posts=0,failures=[],t=1001;
  const worker=()=>drainSignupSetupJobs({prisma,secret,now:()=>t,onFailure:async f=>failures.push(f),
    processJob:async(job,ctl)=>ctl.handoff(async()=>{posts++;},async()=>null)});
  for(let attempt=0;attempt<10;attempt++){await worker();t+=310000;}
  await worker();
  assert.equal(posts,0);assert.equal(state(rows).status,'failed');
  assert.equal(failures[0].code,'SIGNUP_HANDOFF_OUTCOME_UNCERTAIN');assert.equal(failures[0].uncertain,true);
});

test('a late saved result completes automatically after a dropped response without a second POST',async()=>{
  const {prisma,rows}=memoryDb();await enqueue(prisma);
  let posts=0,t=1001,available=false;
  const worker=()=>drainSignupSetupJobs({prisma,secret,now:()=>t,processJob:async(job,ctl)=>ctl.handoff(async before=>{
    await before();posts++;throw Object.assign(new Error('other side closed'),{code:'MAKE_SIGNUP_UNREACHABLE',providerCode:'UND_ERR_SOCKET'});
  },async()=>available?{number:'same-number'}:null)});
  await worker();assert.equal(state(rows).status,'pending');assert.equal(state(rows).lastErrorCode,'UND_ERR_SOCKET');
  available=true;t=7000;await worker();
  assert.equal(posts,1);assert.equal(state(rows).status,'completed');
});

test('finalization restart reuses encrypted handoff and stable forwarding link',async()=>{
  const {prisma,rows}=memoryDb();await enqueue(prisma);
  let posts=0,links=0,texts=0,t=1001;
  const processJob=async(job,ctl)=>{
    await ctl.handoff(async before=>{await before();posts++;return {ownerEmail:'private@example.invalid'};},async()=>null);
    const link=await ctl.memoize('forwarding',async()=>{links++;return 'https://example.invalid/private-forwarding-token';});
    assert.match(link,/private-forwarding-token/);
    if(job.attempts===1)throw Object.assign(new Error('restart before text'),{code:'LOCAL_RESTART'});
    texts++;
  };
  const worker=()=>drainSignupSetupJobs({prisma,secret,now:()=>t,processJob});
  await worker();assert.equal(state(rows).status,'pending');
  assert.doesNotMatch(JSON.stringify(state(rows)),/private@example|private-forwarding-token/);
  t=7000;await worker();await worker();
  assert.equal(posts,1);assert.equal(links,1);assert.equal(texts,1);assert.equal(state(rows).status,'completed');
});

test('expired worker cannot overwrite a successor or checkpoint side effects',async()=>{
  const {prisma,rows}=memoryDb();await enqueue(prisma);let t=1001;
  await drainSignupSetupJobs({prisma,secret,now:()=>t,leaseMs:10,processJob:async(job,ctl)=>{
    t=1020;
    Object.assign(state(rows),{token:'successor',status:'processing',leaseExpiresAt:2000});
    await assert.rejects(ctl.assertLease(),{code:'SIGNUP_JOB_LEASE_LOST'});
  }});
  assert.equal(state(rows).token,'successor');assert.equal(state(rows).status,'processing');
});

test('enqueue rejects a different authorization binding and weak encryption secrets',async()=>{
  const {prisma}=memoryDb();await enqueue(prisma);
  await assert.rejects(prisma.$transaction(tx=>enqueueSignupSetupJob(tx,{...input,tokenHash:'c'.repeat(64)})),{code:'SIGNUP_JOB_BINDING_CONFLICT'});
  await assert.rejects(drainSignupSetupJobs({prisma,secret:'short',processJob:async()=>{}}),{code:'SIGNUP_JOB_SECRET_REQUIRED'});
});

test('a failed terminal-state notification stays durable and retries without another Make POST',async()=>{
  const {prisma,rows}=memoryDb();await enqueue(prisma);
  Object.assign(state(rows),{status:'processing',phase:'handoff',attempts:9,token:'dead-worker',leaseExpiresAt:1000,lastErrorCode:'UND_ERR_SOCKET'});
  let reports=0,posts=0,t=1001;
  const worker=()=>drainSignupSetupJobs({prisma,secret,now:()=>t,
    processJob:async(job,ctl)=>ctl.handoff(async()=>{posts++;},async()=>null),
    onFailure:async()=>{if(++reports===1)throw Error('temporary notification storage failure');},
  });
  await worker();assert.equal(state(rows).status,'pending');assert.equal(state(rows).lastErrorCode,'UND_ERR_SOCKET');
  t+=310000;await worker();assert.equal(state(rows).status,'failed');assert.equal(posts,0);assert.equal(reports,2);
});
