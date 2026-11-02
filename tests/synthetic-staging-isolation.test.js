const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {fork} = require('node:child_process');
const {REQUIRED_FILES,syntheticEnvironment,validateSyntheticTarget} = require('../scripts/recovery-isolation-contract');
for(const strictFileReads of [false,true])test(`real application webhook restarts with ${strictFileReads?'explicit strict':'default legacy'} file reads, providers denied and workers disabled`, {timeout:160000},async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-synthetic-isolation-'));const dataDir=path.join(directory,'data');fs.mkdirSync(dataDir);
  const env=syntheticEnvironment(process.env,dataDir);
  if(strictFileReads){env.RECOVERY_STRICT_FILE_READS='true';for(const name of REQUIRED_FILES)fs.writeFileSync(path.join(dataDir,name),'{}',{flag:'wx',mode:0o600});}
  validateSyntheticTarget({root:directory,dataDir,recoveryRoot:path.join(os.tmpdir(),'myaipa-sealed-production-recovery'),databaseKind:'synthetic-transactional-double',env});
  let worker;let next=0;let evidence;
  async function start(){
    const child=fork(path.join(__dirname,'helpers/synthetic-isolation-worker.js'),[],{cwd:directory,env,execArgv:[],stdio:['ignore','pipe','pipe','ipc']});let diagnostic='';child.stderr.on('data',b=>diagnostic=(diagnostic+b).slice(-1800));child.stdout.on('data',()=>{});
    const exited=new Promise(resolve=>child.once('exit',resolve)); worker={child,exited,base:null};
    const ready=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill();reject(Error('Synthetic startup timeout: '+diagnostic));},45000);child.once('message',v=>{clearTimeout(timer);resolve(v);});child.once('exit',()=>{clearTimeout(timer);reject(Error('Synthetic child stopped: '+diagnostic));});});
    return{child,exited,base:'http://127.0.0.1:'+ready.port};
  }
  async function stop(){if(worker?.child.exitCode===null){
    const owned=worker;
    // Only the owned fixture child is force-killed if graceful stop stalls.
    // This still requires a responsive parent and OS; it is not their deadline.
    const force=setTimeout(()=>owned.child.kill('SIGKILL'),4000);
    try{if(owned.child.connected)owned.child.send({action:'stop'},()=>{});else owned.child.kill('SIGKILL');await owned.exited;}
    finally{clearTimeout(force);}
  }}
  async function ipc(action){const id=String(++next);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('IPC timeout')),4000);function receive(message){if(message.id===id){worker.child.off('message',receive);clearTimeout(timer);resolve(message);}}worker.child.on('message',receive);worker.child.send({action,id});});}
  async function post(id,parameters,{secret='fixture-only-webhook-secret',assistant='fixture-isolation-assistant'}={}){
    const response=await fetch(worker.base+'/api/webhooks/voice',{method:'POST',headers:{'content-type':'application/json','x-vapi-secret':secret},body:JSON.stringify({message:{type:'tool-calls',call:{id:'fixture-call',assistantId:assistant,customer:{number:'+15555550102'}},toolCallList:[{id,type:'function',function:{name:'capture_confirmed_intake',arguments:JSON.stringify(parameters)}}]}}),signal:AbortSignal.timeout(5000)});
    const body=await response.json();return{status:response.status,result:body.results?.[0]?.result?JSON.parse(body.results[0].result):body};
  }
  try{
    worker=await start();
    const initial={expectedVersion:0,callerConfirmed:true,operations:[{field:'callbackNumber',action:'write',value:'+15555550102',confirmed:true},{field:'serviceAddress',action:'write',value:'10 Fixture Road',confirmed:true}]};
    assert.equal((await post('unauthorized',initial,{secret:'wrong'})).status,401);
    assert.equal((await post('cross-tenant',{...initial,businessId:702})).status,403);
    assert.equal((await post('wrong-assistant',initial,{assistant:'other-fixture'})).status,422);
    const captured=await post('capture',initial);assert.equal(captured.status,200,JSON.stringify(captured));assert.equal(captured.result.version,1);
    const first=await ipc('inspect');assert.equal(first.leadCount,0);assert.equal(first.dashboardFileCreated,true);assert.equal(first.strictFileReadsEnabled,strictFileReads);
    await stop();worker=await start();
    assert.equal((await post('capture',initial)).result.duplicate,true);
    assert.equal((await post('stale',{...initial,expectedVersion:0})).status,409);
    const corrected=await post('correct',{expectedVersion:1,callerConfirmed:true,operations:[{field:'serviceAddress',action:'update',value:'20 Fixture Road',confirmed:true}]});assert.equal(corrected.result.version,2);
    assert.equal((await post('finalize',{expectedVersion:2,callerConfirmed:true,operations:[],finalize:true})).result.version,3);
    const final=await ipc('inspect');assert.equal(final.leadCount,1);assert.equal(final.callCount,1);assert.equal(final.correctedSummary,true);assert.equal(final.outboxCount,1);assert.equal(final.outboxPending,true);assert.equal(final.workersEnabled,false);assert.equal(final.databaseUrlPresent,false);assert.equal(final.unexpectedOutboundAttempts,0);
    const probes=await ipc('probes');assert.equal(probes.rejected,6);assert.equal(probes.unexpectedOutboundAttempts,0);
    await stop();worker=await start();const restarted=await ipc('inspect');assert.equal(restarted.finalized,true);assert.equal(restarted.outboxPending,true);assert.equal(restarted.leadCount,1);assert.equal(restarted.unexpectedOutboundAttempts,0);
    evidence={scope:'real-application-http-with-synthetic-transactional-database-double',sourceFingerprints:Object.fromEntries(['server/index.js','server/stagingIntake.js','server/intakeLedger.js','tests/helpers/synthetic-isolation-worker.js'].map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',name))).digest('hex')])),checks:12,httpApplicationExercised:true,processRestarts:2,strictFileReadsEnabled:strictFileReads,providerDispatches:0,productionDataUsed:false,realPostgresExercised:false,osEgressSandboxProven:false,hardParentOrOSDeadlineProven:false,transportDenialProbes:6,workersActivated:false,fixtureRowsOnly:true};

  }finally{await stop();const resolved=fs.realpathSync(directory);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(resolved).startsWith('myaipa-synthetic-isolation-'));fs.rmSync(resolved,{recursive:true,force:true});}
  assert.equal(fs.existsSync(directory),false);
  if(process.env.SYNTHETIC_ISOLATION_EVIDENCE){fs.writeFileSync(process.env.SYNTHETIC_ISOLATION_EVIDENCE+(strictFileReads?'.strict.json':''),JSON.stringify({...evidence,temporaryDataRemoved:true},null,2)+String.fromCharCode(10),{flag:'wx',mode:0o600});}
});
