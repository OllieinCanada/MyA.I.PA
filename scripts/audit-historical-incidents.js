const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readRenderCredentials, fetchRenderEnv } = require('./run-with-render-env');
const { writeManifest } = require('./provider-hardening-evidence');
const { assessSamples } = require('./verify-provider-reliability');

function reviewIncidents(operations, reliability) {
  const proofFresh = Boolean(reliability?.commit) && reliability.commit === reliability?.security?.commit && reliability?.security?.ok === true
    && Date.now() - Date.parse(reliability.checkedAt) < 600000;
  const workerLog=reliability?.logEvidence?.find(l=>l.filter==='saved Twilio delivery reports');
  const workerRecovered = proofFresh && assessSamples(reliability.samples || [],reliability.commit)
    && workerLog?.complete===true && workerLog.matches.length===0;
  return (operations.issues || []).filter(i => i.kind === 'runtime_incident').map(i => {
    const last = i.diagnostics?.lastDetectedAt || i.detectedAt;
    const receiptIssue = i.snapshot?.Workflow === 'saved Twilio delivery reports background job';
    const postDeployment = Date.parse(last) >= Date.parse(reliability.deployedAt);
    return { id: i.id, title: i.title, originalReasonCode: i.incident?.reasonCode, providerCode: i.snapshot?.['Provider code'] || '',
      firstDetectedAt: i.diagnostics?.firstDetectedAt || i.detectedAt, lastDetectedAt: last, occurrences: i.diagnostics?.occurrences || 1,
      assessment: receiptIssue && workerRecovered && !postDeployment ? 'CURRENT_WORKER_RECOVERY_VERIFIED_HISTORY_PRESERVED'
        : postDeployment ? 'RECURRED_AFTER_DEPLOYMENT_UNRESOLVED' : i.snapshot?.Route === '/api/webhooks/voice'
          ? 'PRIOR_CALL_FAILURE_REPAIR_DEPLOYED_MANUAL_RETEST_REQUIRED' : 'UNRESOLVED_EVIDENCE_REQUIRED',
      correction: receiptIssue && i.snapshot?.['Provider code'] === 'P2028'
        ? 'P2028 is a transaction failure signal; the old alert alone does not establish an unsupported PostgreSQL value or provider provisioning failure.' : '',
      acknowledged: false, deleted: false };
  });
}

async function main() {
  const credentials = readRenderCredentials();
  const env = await fetchRenderEnv({ credentials, serviceId: 'srv-d92503a8qa3s73crdpog', keys: ['MONITOR_API_KEY'] });
  const response = await fetch('https://api.myaipa.ca/api/internal/operations/health', {
    headers: { 'x-monitor-api-key': env.MONITOR_API_KEY }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw Error(`Read-only operations HTTP ${response.status}`);
  const operations = await response.json();
  const reliability = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../diagnostics/provider-hardening/reliability.json'), 'utf8'));
  const audio = await fetch('https://www.myaipa.ca/tims-electrical-2.wav?v=20260817-original-tims', {
    headers: { Range: 'bytes=0-127' }, signal: AbortSignal.timeout(20000) });
  const buffer = Buffer.from(await audio.arrayBuffer());
  const runs = JSON.parse(execFileSync('gh', ['run','list','--repo','OllieinCanada/MyA.I.PA','--workflow','production-monitor.yml','--limit','20',
    '--json','databaseId,status,conclusion,createdAt,headSha,event'], { encoding:'utf8', windowsHide:true, timeout:30000 }));
  const schedule = runs.filter(r => r.event === 'schedule').sort((a,b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const gaps = schedule.slice(1).map((r,i) => ({ from:schedule[i].createdAt, until:r.createdAt, seconds:(Date.parse(r.createdAt)-Date.parse(schedule[i].createdAt))/1000 }));
  const report = { checkedAt:new Date().toISOString(), releaseCommit:reliability.commit, attention:operations.attention,
    incidents:reviewIncidents(operations,reliability), currentReceiptWorker:operations.twilioReceipts,
    audioProbe:{ status:audio.status, contentType:audio.headers.get('content-type'), contentRange:audio.headers.get('content-range'),
      riff:buffer.toString('ascii',0,4), wave:buffer.toString('ascii',8,12), browserPlaybackProven:false,
      conclusion:'File availability and a valid WAV header do not resolve the recurrent browser playback error.' },
    monitorEvidence:{ runs, gapsOverTwentyMinutes:gaps.filter(g=>g.seconds>1200),
      currentGapSeconds:schedule.length ? (Date.now()-Date.parse(schedule.at(-1).createdAt))/1000 : null,
      continuousDayProven:false },
    productionWrites:0, incidentAcknowledgements:0, textsSent:0, callsPlaced:0,
    pending:['Affected-phone audio reproduction; do not close the recurrent warning.',
      'User-initiated call and actual notification delivery verification.', 'Billing and paused-trial decisions remain separate.'] };
  writeManifest(path.resolve(__dirname,'../diagnostics/operations-review/incident-audit.json'),report);
  console.log(JSON.stringify({ ...report, monitorEvidence:{ ...report.monitorEvidence, runs:runs.length } },null,2));
}
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={reviewIncidents};
