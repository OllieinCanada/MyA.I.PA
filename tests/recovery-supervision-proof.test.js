const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {runSyntheticSupervision}=require('../scripts/recovery-supervision-proof');
const contract=require('../scripts/recovery-supervision-contract');
const {dispatchPrepared:dispatchWithExplicitPolicy}=require('../scripts/recovery-notification-state');
const preparationPolicy=require('./fixtures/recovery-policy.synthetic.json');
const dispatchPrepared=(report,options)=>dispatchWithExplicitPolicy(report,{...options,preparationPolicy});
const {openNotificationStore}=require('../scripts/recovery-notification-store');
function fixture(t){
  const parent=path.resolve(os.tmpdir()),directory=fs.mkdtempSync(path.join(parent,'recovery-supervision-fixture-')),executionId=crypto.randomUUID(),identity=crypto.randomUUID();
  fs.writeFileSync(path.join(directory,'synthetic-supervision.json'),JSON.stringify({schemaVersion:1,scope:'synthetic-only-no-provider-data',executionId,realTransportsAllowed:false}),{flag:'wx',mode:0o600});
  const message={eventId:`${identity}:event:1`,episodeId:`${identity}:episode:1`,channel:'telegram',idempotencyKey:`${identity}:event:1:telegram`};
  t.after(()=>{const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(parent));assert.ok(path.basename(resolved).startsWith('recovery-supervision-fixture-'));fs.rmSync(resolved,{recursive:true,force:true});});
  return {directory,executionId,message,syntheticOnly:true};
}
const request=(value,mode,timeoutMs=1500)=>({...value,mode,timeoutMs});
const evidence=[];
const record=proof=>{evidence.push(proof);return proof;};
test('typed proof seam rejects real/extra fields, arbitrary worker choices and unbounded deadlines',t=>{
  const value=fixture(t);
  for(const patch of [{syntheticOnly:false},{mode:'real-provider'},{worker:'arbitrary.js'},{env:{TWILIO_AUTH_TOKEN:'synthetic-do-not-forward'}},{credentials:'not-permitted'},{timeoutMs:0},{timeoutMs:5001},{timeoutMs:'1500'},{message:{...value.message,phone:'+15555550123'}},{message:{...value.message,eventId:[value.message.eventId]}}])assert.throws(()=>runSyntheticSupervision({...request(value,'accept'),...patch}),/SYNTHETIC_SUPERVISION_/);
});
test('fixture execution identity and directory marker must match before any child starts',t=>{
  const value=fixture(t);assert.throws(()=>runSyntheticSupervision({...request(value,'accept'),executionId:crypto.randomUUID()}),/MARKER_INVALID/);
});
test('worker environment strips provider, session, module injection and cloud configuration',t=>{
  const value=fixture(t),env=contract.workerEnvironment(value.directory,{SystemRoot:process.env.SystemRoot,TWILIO_AUTH_TOKEN:'synthetic',VAPI_API_KEY:'synthetic',AWS_SECRET_ACCESS_KEY:'synthetic',DATABASE_URL:'synthetic',NODE_OPTIONS:'--require=not-allowed',NODE_PATH:'not-allowed',USERPROFILE:'not-forwarded'});
  for(const key of ['TWILIO_AUTH_TOKEN','VAPI_API_KEY','AWS_SECRET_ACCESS_KEY','DATABASE_URL','NODE_OPTIONS','NODE_PATH','USERPROFILE'])assert.equal(env[key],undefined);
  assert.equal(env.RECOVERY_SUPERVISION_SYNTHETIC_ONLY,'1');
});
test('normal child acceptance proves only synthetic acceptance and actual child exit',t=>{
  const value=fixture(t),proof=record(runSyntheticSupervision(request(value,'accept')));
  assert.equal(proof.readyObserved,true);assert.equal(proof.outcome,'accepted_not_recipient_receipt');assert.equal(proof.exitCode,0);assert.equal(proof.childNoLongerRunning,true);assert.equal(proof.physicalReceiptProven,false);assert.equal(contract.acceptanceFiles(value.directory).length,1);
});
test('synthetic rejection never claims an accepted or physically received notice',t=>{
  const value=fixture(t),proof=record(runSyntheticSupervision(request(value,'reject')));
  assert.equal(proof.outcome,'rejected_requires_review');assert.equal(proof.childNoLongerRunning,true);assert.equal(contract.acceptanceFiles(value.directory).length,0);
});
for(const mode of ['hang','block'])test(`native supervisor terminates an actually ready ${mode} worker independently of its JS loop`,t=>{
  const value=fixture(t),proof=record(runSyntheticSupervision(request(value,mode,1000)));
  assert.equal(proof.readyObserved,true,'a startup timeout is not proof of terminating a stuck transport');
  assert.equal(proof.errorCode,'ETIMEDOUT');assert.equal(proof.outcome,'outcome_unconfirmed');assert.equal(proof.childNoLongerRunning,true);assert.equal(proof.exitObserved,true);
  assert.ok(proof.elapsedMs>=1000&&proof.elapsedMs<3500,'measured supervisor+OS cleanup exceeds this fixture budget');assert.equal(proof.hardParentOrOSBoundProven,false);
});
for(const mode of ['crash','malformed'])test(`${mode} worker output remains unconfirmed, not accepted`,t=>{
  const value=fixture(t),proof=record(runSyntheticSupervision(request(value,mode)));
  assert.equal(proof.outcome,'outcome_unconfirmed');assert.equal(proof.childNoLongerRunning,true);
});
test('fixed worker denies all six application transport/subprocess probes without real network traffic',t=>{
  const value=fixture(t),proof=record(runSyntheticSupervision(request(value,'probes')));
  assert.equal(proof.outcome,'synthetic-probes-only');assert.equal(proof.probesRejected,6);assert.equal(proof.realProviderRequests,0);assert.equal(proof.osSandboxProven,false);
});
test('synthetic recorder does not manufacture provider idempotency by hiding repeated caller invocations',t=>{
  const value=fixture(t);for(let index=0;index<2;index++)assert.equal(record(runSyntheticSupervision(request(value,'accept'))).outcome,'accepted_not_recipient_receipt');
  const rows=contract.acceptanceFiles(value.directory).map(name=>JSON.parse(fs.readFileSync(path.join(value.directory,name),'utf8')));assert.equal(rows.length,2);assert.equal(new Set(rows.map(row=>row.idempotencyKey)).size,1);
});
test('accepted-before-hang remains held uncertain after child termination and reopening its store cannot resend it',async t=>{
  const value=fixture(t),store=openNotificationStore({directory:value.directory,monitorId:'synthetic-supervised-monitor'});store.initialize();
  const health=at=>({checkedAt:new Date(at).toISOString(),severity:'critical',issues:[{code:'SYNTHETIC_BACKUP_FAILED',severity:'critical'}]});const at=Date.now()-2000;
  let calls=0;
  const transports=Object.fromEntries(['telegram','email'].map(channel=>[channel,async message=>{
    calls++;
    const proof=record(runSyntheticSupervision(request({...value,message:{eventId:message.eventId,episodeId:message.episodeId,idempotencyKey:message.idempotencyKey,channel}},channel==='telegram'?'accepted-then-hang':'accept',channel==='telegram'?1000:1500)));
    if(proof.outcome==='accepted_not_recipient_receipt')return{accepted:true};throw Error('Synthetic supervised outcome unconfirmed');
  }]));
  await dispatchPrepared(health(at),{store,transports,approvedActivation:true});
  assert.equal(calls,2);assert.equal(contract.acceptanceFiles(value.directory).length,2);
  const reopened=openNotificationStore({directory:value.directory,monitorId:'synthetic-supervised-monitor'});
  await dispatchPrepared(health(at+1000),{store:reopened,transports,approvedActivation:true});
  assert.equal(calls,2);assert.equal(contract.acceptanceFiles(value.directory).length,2);
  assert.equal(reopened.readState().events[0].attempts.telegram.status,'outcome_unconfirmed');assert.equal(reopened.readState().events[0].attempts.email.status,'accepted_not_recipient_receipt');
});
test.after(()=>{if(process.env.RECOVERY_SUPERVISION_EVIDENCE)fs.writeFileSync(process.env.RECOVERY_SUPERVISION_EVIDENCE,JSON.stringify({scope:'fixed-synthetic-subprocess-proof-only',proofs:evidence,realProviderRequests:0,credentialSerialization:false,liveAdapterImplemented:false,parentOrOSHardBoundProven:false},null,2)+'\n',{flag:'wx'});});
