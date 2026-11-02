// Design/proof seam, not a real notification transport. Only one fixed fixture
// entry point and a typed, synthetic-only payload can cross the process boundary.
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const supervisor = require('./public-demo-audio-plan');
const contract = require('./recovery-supervision-contract');
const FIXTURE = path.join(__dirname, '../tests/helpers/recovery-supervision-fixture.js');
function noLongerRunning(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return null;
  try { process.kill(pid, 0); return false; } catch (error) { return error.code === 'ESRCH' ? true : null; }
}
function runSyntheticSupervision(request) {
  const validated = contract.validateRequest(request), started = performance.now();
  const run = supervisor.runWorker(['--max-old-space-size=32', FIXTURE, JSON.stringify(validated)], {
    cwd: validated.directory, env: contract.workerEnvironment(validated.directory), stdio: ['ignore','pipe','pipe'], timeoutMs: validated.timeoutMs,
  });
  const elapsedMs = performance.now() - started;
  const receipt = { scope:'synthetic-supervision-proof-only',executionId:validated.executionId,mode:validated.mode,deadlineMs:validated.timeoutMs,elapsedMs,
    childPid:Number.isSafeInteger(run.pid)?run.pid:null,exitCode:run.status,signal:run.signal||null,errorCode:run.error?.code||null,
    readyObserved:false,exitObserved:Number.isInteger(run.status)||(typeof run.signal==='string'&&run.signal.length>0),childNoLongerRunning:noLongerRunning(run.pid),outcome:'outcome_unconfirmed',
    credentialSerialization:false,realProviderRequests:0,productionRecoveryProven:false,physicalReceiptProven:false,osSandboxProven:false,hardParentOrOSBoundProven:false,parentRestartExercised:false };
  let messages;
  try {
    if (!Buffer.isBuffer(run.stdout) || run.stdout.length > 4096 || (run.stderr && run.stderr.length)) throw Error('protocol');
    messages=run.stdout.toString('utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const ready=messages[0];
    contract.exact(ready,['type','scope','executionId','pid','mode','credentialKeysPresent']);
    if(ready.type!=='ready'||ready.scope!=='synthetic-only-no-provider-data'||ready.executionId!==validated.executionId||ready.pid!==run.pid||ready.mode!==validated.mode||!Array.isArray(ready.credentialKeysPresent)||ready.credentialKeysPresent.length)throw Error('protocol');
    receipt.readyObserved=true;
    if(run.error||run.status!==0||elapsedMs>=validated.timeoutMs||messages.length!==2) return receipt;
    const result=messages[1];
    contract.exact(result,['type','scope','executionId','mode','outcome','acceptanceId','probesRejected','unexpectedOutboundAttempts']);
    if(result.type!=='result'||result.scope!=='synthetic-only-no-provider-data'||result.executionId!==validated.executionId||result.mode!==validated.mode||result.unexpectedOutboundAttempts!==0)throw Error('protocol');
    if(validated.mode==='accept'&&result.outcome==='accepted'&&contract.uuidValue(result.acceptanceId)) receipt.outcome='accepted_not_recipient_receipt';
    else if(validated.mode==='reject'&&result.outcome==='rejected') receipt.outcome='rejected_requires_review';
    else if(validated.mode==='probes'&&result.outcome==='probe-only'&&result.probesRejected===6){receipt.outcome='synthetic-probes-only';receipt.probesRejected=6;}
    else throw Error('protocol');
  } catch { receipt.protocolError='SYNTHETIC_SUPERVISION_PROTOCOL_UNCONFIRMED'; }
  return receipt;
}
module.exports = { runSyntheticSupervision };
