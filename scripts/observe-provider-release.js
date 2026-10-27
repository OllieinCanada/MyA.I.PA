// Read-only, release-bound sampling. Never acknowledges incidents, sends alerts,
// retries customer work, changes providers or activates the staging intake pilot.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { readRenderCredentials, fetchRenderEnv } = require('./run-with-render-env');
const { writeManifest } = require('./provider-hardening-evidence');
const SERVICE = 'srv-d92503a8qa3s73crdpog';
const API = 'https://api.myaipa.ca';
const WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_GAP_MS = 20 * 60 * 1000;
const DEFAULT_FILE = path.resolve(__dirname, '../diagnostics/operations-review/observation.json');

function assessWindow(state) {
  const samples = state.samples || [];
  if (!samples.length) return { status: 'NOT_STARTED', complete: false, passed: false };
  const times = samples.map(s => Date.parse(s.checkedAt));
  const gaps = times.slice(1).map((time, i) => time - times[i]);
  const complete = times.at(-1) - times[0] >= WINDOW_MS;
  const issues = samples.filter(s => !s.healthy).length;
  const releaseChanged = samples.some(s => s.releaseCommit !== state.releaseCommit);
  const gapDetected = gaps.some(gap => gap > MAX_GAP_MS || gap <= 0);
  const passed = complete && !issues && !releaseChanged && !gapDetected;
  return { status: releaseChanged ? 'RELEASE_CHANGED' : !complete ? issues || gapDetected ? 'OBSERVING_WITH_ISSUES' : 'OBSERVING'
    : passed ? 'PASS' : gapDetected ? 'INCOMPLETE_COVERAGE' : 'ISSUES_FOUND', complete, passed,
    sampleCount: samples.length, unhealthySamples: issues, largestGapSeconds: Math.max(0, ...gaps) / 1000,
    elapsedSeconds: (times.at(-1) - times[0]) / 1000, cadenceSeconds: 900, maximumGapSeconds: MAX_GAP_MS / 1000,
    scope: '24-hour sampled observation plus bounded error-log reads; not a guarantee of continuous uptime or real call/SMS delivery.' };
}

function recordSample(state, sample, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit || '') || !Number.isFinite(Date.parse(sample.checkedAt))) throw Error('Exact release and valid sample timestamp required.');
  if (state && (state.schemaVersion !== 1 || state.releaseCommit !== commit || !Array.isArray(state.samples))) throw Error('Do not replace an observation window for another release.');
  if (state?.samples.length && Date.parse(sample.checkedAt) <= Date.parse(state.samples.at(-1).checkedAt)) throw Error('Duplicate or backwards observation timestamp.');
  if (state && assessWindow(state).complete) return state;
  const next = state || { schemaVersion: 1, observationId: crypto.randomUUID(), releaseCommit: commit,
    startedAt: sample.checkedAt, deadlineAt: new Date(Date.parse(sample.checkedAt) + WINDOW_MS).toISOString(), samples: [] };
  const result = { ...next, samples: [...next.samples, sample], updatedAt: sample.checkedAt, productionWrites: 0 };
  result.assessment = assessWindow(result);
  return result;
}

async function readFailureLogs({ credentials, ownerId, from, until, fetchImpl = fetch }) {
  const results = [];
  for (const filter of ['saved Twilio delivery reports', 'Transaction API error', 'voice:assistant-failure']) {
    let startTime = from, endTime = until, complete = false, pages = 0;
    const matches = new Map();
    while (pages++ < 10) {
      const query = new URLSearchParams({ ownerId, resource: SERVICE, limit: '100', direction: 'forward', startTime, endTime, text: filter });
      const response = await fetchImpl(`${credentials.host}/logs?${query}`, { method: 'GET', redirect: 'error',
        headers: { authorization: `Bearer ${credentials.key}` }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw Error(`LOG_HTTP_${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.logs) || typeof data.hasMore !== 'boolean') throw Error('LOG_COVERAGE_UNCONFIRMED');
      for (const log of data.logs) matches.set(log.id, { id: log.id, at: log.timestamp });
      if (!data.hasMore) { complete = true; break; }
      if (!data.nextStartTime || !data.nextEndTime || (data.nextStartTime === startTime && data.nextEndTime === endTime)) break;
      startTime = data.nextStartTime; endTime = data.nextEndTime;
    }
    results.push({ filter, from, until, complete, matches: [...matches.values()] });
  }
  return results;
}

async function collectSample({ commit, token, credentials, previous, fetchImpl = fetch, now = () => new Date().toISOString() }) {
  const sampledAt = now();
  try {
    async function get(url, headers = {}) {
      const r = await fetchImpl(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw Error(`READ_HTTP_${r.status}`);
      return r.json();
    }
    const auth = { authorization: `Bearer ${credentials.key}` };
    const [ready, operations, service, deploys, website] = await Promise.all([
      get(`${API}/api/health/ready`), get(`${API}/api/internal/operations/health`, { 'x-monitor-api-key': token }),
      get(`${credentials.host}/services/${SERVICE}`, auth), get(`${credentials.host}/services/${SERVICE}/deploys?limit=10`, auth),
      fetchImpl('https://www.myaipa.ca/', { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(20000) }),
    ]);
    const live = deploys.map(d => d.deploy || d).find(d => d.status === 'live');
    const owner = (service.service || service).ownerId;
    if (owner !== 'tea-d9247q1o3t8c73avjscg' || !live?.finishedAt) throw Error('DEPLOY_WORKSPACE_UNCONFIRMED');
    const lastCovered = [...(previous?.samples || [])].reverse().find(s => s.logsComplete)?.logUntil || live.finishedAt;
    const from = new Date(Math.max(Date.parse(live.finishedAt), Date.parse(lastCovered) - 2000)).toISOString();
    const logs = await readFailureLogs({ credentials, ownerId: owner, from, until: sampledAt, fetchImpl });
    const incidents = (operations.issues || []).filter(i => i.kind === 'runtime_incident').map(i => ({ id: i.id,
      severity: i.severity, code: i.incident?.reasonCode || '', occurrences: i.diagnostics?.occurrences || 1,
      lastDetectedAt: i.diagnostics?.lastDetectedAt || i.detectedAt,
      postDeployment: Date.parse(i.diagnostics?.lastDetectedAt || i.detectedAt) >= Date.parse(live.finishedAt) }));
    const worker = operations.twilioReceipts;
    const previousWorker = previous?.samples.at(-1)?.worker?.lastSuccessfulRunAt;
    const healthy = ready.ok === true && ready.releaseCommit === commit && live.commit?.id === commit && website.status === 200
      && worker?.status === 'healthy' && Number.isFinite(worker.workerAgeSeconds) && worker.workerAgeSeconds < 120
      && worker.counts?.failed === 0 && worker.counts?.expiredLeases === 0
      && (worker.counts?.pending === 0 || Number.isFinite(worker.oldestPendingAgeSeconds) && worker.oldestPendingAgeSeconds < 120)
      && (!previousWorker || Date.parse(worker.lastSuccessfulRunAt) > Date.parse(previousWorker))
      && logs.every(l => l.complete && l.matches.length === 0)
      && !incidents.some(i => i.postDeployment || i.code === 'CLIENT_RESOURCE_ERROR');
    return { checkedAt: sampledAt, releaseCommit: ready.releaseCommit, deployedAt: live.finishedAt, healthy,
      websiteStatus: website.status, ready: ready.ok === true, worker, attention: operations.attention, incidents,
      logs, logsComplete: logs.every(l => l.complete), logUntil: sampledAt };
  } catch (error) {
    return { checkedAt: sampledAt, releaseCommit: commit, healthy: false, logsComplete: false,
      errorCode: /^(?:READ_HTTP_|LOG_HTTP_|LOG_COVERAGE_|DEPLOY_WORKSPACE_)/.test(error.message) ? error.message : 'OBSERVATION_READ_FAILED' };
  }
}

async function run({ argv = process.argv.slice(2), fetchImpl = fetch } = {}) {
  const options = {};
  for (const arg of argv) {
    const match = /^--(commit|file)=(.+)$/.exec(arg);
    if (!match) throw Error('Only read-only --commit and local --file arguments are supported.');
    options[match[1]] = match[2];
  }
  if (!/^[a-f0-9]{40}$/.test(options.commit || '')) throw Error('Exact --commit required.');
  const file = options.file ? path.resolve(options.file) : DEFAULT_FILE;
  const evidenceRoot=path.dirname(DEFAULT_FILE);
  if (!file.startsWith(evidenceRoot+path.sep) || path.extname(file)!=='.json') throw Error('Observation evidence must remain in diagnostics/operations-review.');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const lockFile=file+'.lock';let lock;
  try { lock=fs.openSync(lockFile,'wx'); } catch { throw Error('An observation writer is active or its interrupted lock needs inspection.'); }
  try {
  const previous = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (previous && previous.releaseCommit !== options.commit) throw Error('Existing window belongs to another release.');
  if (previous && assessWindow(previous).complete) return previous.assessment;
  let sample;
  try {
    const credentials = readRenderCredentials();
    const env = await fetchRenderEnv({ credentials, serviceId: SERVICE, keys: ['MONITOR_API_KEY'], fetchImpl });
    sample = await collectSample({ commit: options.commit, token: env.MONITOR_API_KEY, credentials, previous, fetchImpl });
  } catch { sample = { checkedAt: new Date().toISOString(), releaseCommit: options.commit, healthy: false, logsComplete: false, errorCode: 'OBSERVATION_CREDENTIAL_UNAVAILABLE' }; }
  const state = recordSample(previous, sample, options.commit);
  writeManifest(file, state);
  return { ...state.assessment, file, startedAt: state.startedAt, deadlineAt: state.deadlineAt,
    currentAttention: sample.attention || null, productionWrites: 0 };
  } finally { fs.closeSync(lock);fs.unlinkSync(lockFile); }
}
if (require.main === module) run().then(r => console.log(JSON.stringify(r, null, 2)))
  .catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { assessWindow, recordSample, collectSample, readFailureLogs, run };
