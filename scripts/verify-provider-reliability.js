// GET-only collector. It does not acknowledge incidents, dispatch alerts, retry
// customer work, or change provider/service settings.
const path = require('node:path');
const fs = require('node:fs');
const { readRenderCredentials, fetchRenderEnv } = require('./run-with-render-env');
const { verifyRelease } = require('./verify-backend-security-release');
const { newManifest, recordGate, writeManifest, invalidateGates } = require('./provider-hardening-evidence');
const SERVICE = 'srv-d92503a8qa3s73crdpog';
const API = 'https://api.myaipa.ca';
function assessSamples(samples, commit) {
  const timestamps = samples.map(s => Date.parse(s.worker?.lastSuccessfulRunAt));
  return samples.length >= 3 && samples.every(s => s.httpStatus === 200 && s.releaseCommit === commit
    && s.ready === true && s.worker?.status === 'healthy' && Number.isFinite(s.worker.workerAgeSeconds) && s.worker.workerAgeSeconds < 120
    && (s.worker.oldestPendingAgeSeconds == null || s.worker.oldestPendingAgeSeconds < 120)
    && (s.worker.counts?.pending === 0 || Number.isFinite(s.worker.oldestPendingAgeSeconds))
    && s.worker.counts?.failed === 0 && s.worker.counts?.expiredLeases === 0)
    && timestamps.every((at, i) => Number.isFinite(at) && (i === 0 || at > timestamps[i - 1]));
}
async function collectReliability({ credentials, token, commit, fetchImpl = fetch, wait = ms => new Promise(r => setTimeout(r, ms)), intervalMs = 60000, onSample = () => {} }) {
  async function get(url, headers = {}) {
    const response = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw Error(`READ_ONLY_HTTP_${response.status}`);
    return { status: response.status, body: await response.json() };
  }
  const auth = { Authorization: `Bearer ${credentials.key}` };
  const [serviceResult, deployResult, security] = await Promise.all([
    get(`${credentials.host}/services/${SERVICE}`, auth),
    get(`${credentials.host}/services/${SERVICE}/deploys?limit=10`, auth),
    verifyRelease({ commit, token, fetchImpl, renderCredentials: credentials }),
  ]);
  const service = serviceResult.body.service || serviceResult.body;
  const live = deployResult.body.map(x => x.deploy || x).find(d => d.status === 'live');
  if (live?.commit?.id !== commit || !live.finishedAt || !service.ownerId) throw Error('LIVE_RELEASE_IDENTITY_UNCONFIRMED');
  const samples = [];
  let incidents = [];
  for (let index = 0; index < 3; index++) {
    if (index) await wait(intervalMs);
    const [ready, operations] = await Promise.all([
      get(`${API}/api/health/ready`),
      get(`${API}/api/internal/operations/health`, { 'x-monitor-api-key': token }),
    ]);
    const sample = { checkedAt: new Date().toISOString(), httpStatus: operations.status,
      ready: ready.body.ok, releaseCommit: ready.body.releaseCommit, worker: operations.body.twilioReceipts,
      attention: operations.body.attention };
    samples.push(sample); onSample(sample);
    incidents = (operations.body.issues || []).filter(i => i.kind === 'runtime_incident').map(i => ({
      id: i.id, severity: i.severity, reasonCode: i.incident?.reasonCode,
      detectedAt: i.detectedAt, lastDetectedAt: i.diagnostics?.lastDetectedAt || i.detectedAt,
      occurrences: i.diagnostics?.occurrences ?? null,
      classification: Date.parse(i.diagnostics?.lastDetectedAt || i.detectedAt) < Date.parse(live.finishedAt)
        ? 'predates_deployment_not_acknowledged' : 'post_deployment_requires_investigation',
    }));
  }
  const logEvidence = [];
  for (const text of ['saved Twilio delivery reports', 'Transaction API error']) {
    let startTime = live.finishedAt, endTime = new Date().toISOString(), complete = false, pages = 0;
    const seen = new Set(), matches = [];
    while (pages++ < 100) {
      const query = new URLSearchParams({ ownerId: service.ownerId, resource: SERVICE, limit: '100', direction: 'forward', startTime, endTime, text });
      const result = await get(`${credentials.host}/logs?${query}`, auth);
      if (!Array.isArray(result.body.logs) || typeof result.body.hasMore !== 'boolean') throw Error('LOG_COVERAGE_UNCONFIRMED');
      for (const log of result.body.logs) if (!seen.has(log.id)) {
        seen.add(log.id); matches.push({ timestamp: log.timestamp });
      }
      if (!result.body.hasMore) { complete = true; break; }
      if (!result.body.nextStartTime || !result.body.nextEndTime
        || (startTime === result.body.nextStartTime && endTime === result.body.nextEndTime)) break;
      startTime = result.body.nextStartTime; endTime = result.body.nextEndTime;
    }
    logEvidence.push({ filter: text, from: live.finishedAt, complete, pages, matches });
  }
  const currentHealthPassed = security.ok && assessSamples(samples, commit)
    && logEvidence.every(x => x.complete && x.matches.length === 0)
    && !incidents.some(i => i.severity === 'critical' && i.classification !== 'predates_deployment_not_acknowledged');
  return { checkedAt: new Date().toISOString(), commit, deployedAt: live.finishedAt, security,
    samples, incidents, logEvidence, currentHealthPassed,
    observation: { status: 'PENDING_OBSERVATION', elapsedSinceDeploySeconds: Math.floor((Date.now() - Date.parse(live.finishedAt)) / 1000),
      continuousSampleWindowSeconds: Math.floor((Date.parse(samples.at(-1).checkedAt) - Date.parse(samples[0].checkedAt)) / 1000),
      reason: 'Three current samples and filtered failure logs do not prove continuous 24-hour health.' }, productionWrites: 0 };
}
async function main() {
  const commit = process.argv.find(a => a.startsWith('--commit='))?.slice(9);
  if (!/^[a-f0-9]{40}$/.test(commit || '')) throw Error('Exact --commit is required');
  const credentials = readRenderCredentials();
  const env = await fetchRenderEnv({ credentials, serviceId: SERVICE, keys: ['MONITOR_API_KEY'] });
  const report = await collectReliability({ credentials, token: env.MONITOR_API_KEY, commit,
    onSample: s => console.log(JSON.stringify({ sampleAt: s.checkedAt, workerStatus: s.worker?.status, failed: s.worker?.counts?.failed, pending: s.worker?.counts?.pending })) });
  const directory = path.resolve(process.argv.find(arg => arg.startsWith('--directory='))?.slice(12) || path.resolve(__dirname, '../diagnostics/provider-hardening'));
  const evidence = path.join(directory, 'reliability.json');
  writeManifest(evidence, report);
  const manifestPath = path.join(directory, 'execution.json');
  const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : newManifest(commit);
  if (manifest.releaseCommit !== commit || !report.currentHealthPassed) invalidateGates(manifest, ['health', 'observation'], 'Live release changed or current health is not passing');
  manifest.releaseCommit = commit;
  recordGate(manifest, 'health', { status: report.currentHealthPassed ? 'PASS' : 'BLOCKED', evidence, codeIdentity: commit });
  recordGate(manifest, 'observation', { status: 'PENDING_OBSERVATION', evidence, codeIdentity: commit });
  writeManifest(manifestPath, manifest);
  console.log(JSON.stringify(report, null, 2));
  if (!report.currentHealthPassed) process.exitCode = 2;
}
if (require.main === module) main().catch(error => {
  const directory = path.resolve(process.argv.find(arg => arg.startsWith('--directory='))?.slice(12) || path.resolve(__dirname, '../diagnostics/provider-hardening'));
  const manifestPath = path.join(directory, 'execution.json');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    invalidateGates(manifest, ['health'], 'Latest live health verification could not complete');
    const evidence = path.join(directory, 'reliability-failure.json');
    writeManifest(evidence, { checkedAt: new Date().toISOString(), status: 'BLOCKED', reason: 'Live health verification incomplete; no production actions performed.' });
    recordGate(manifest, 'health', { status: 'BLOCKED', evidence });
    writeManifest(manifestPath, manifest);
  }
  console.error(`Reliability check stopped safely: ${error.message}`); process.exitCode = 1;
});
module.exports = { assessSamples, collectReliability };
