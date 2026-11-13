// GET-only inspection. Never invoke the alerting monitor or remediation routes.
const fs = require('node:fs');
const path = require('node:path');
const { readRenderCredentials, fetchRenderEnv } = require('./run-with-render-env');
const { redactIncidentText } = require('../server/incidentAlerts');
const SERVICE = 'srv-d92503a8qa3s73crdpog', WORKSPACE = 'tea-d9247q1o3t8c73avjscg';
const text = value => redactIncidentText(String(value || ''), { maxLength: 300 });
async function getJson(url, headers = {}) {
  const response = await fetch(url, { method: 'GET', headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw Error(`Read-only request failed with HTTP ${response.status}`);
  return response.json();
}
function projectIssue(item) {
  const first = item.diagnostics?.firstDetectedAt || item.detectedAt;
  const last = item.diagnostics?.lastDetectedAt || item.detectedAt;
  const labels = [item.title, item.businessName, item.incident?.reasonCode, item.snapshot?.Workflow].join(' ');
  return { id: item.id, kind: item.kind, severity: item.severity, title: text(item.title),
    business: text(item.businessName), reasonCode: text(item.incident?.reasonCode),
    firstDetectedAt: first, lastDetectedAt: last, occurrences: item.diagnostics?.occurrences ?? null,
    remediationStatus: item.remediation?.status || null,
    snapshot: Object.fromEntries(['Route', 'Workflow', 'Provider code', 'Operation'].filter(k => item.snapshot?.[k])
      .map(k => [k, text(item.snapshot[k])])),
    syntheticLabelPresent: /synthetic|fixture|isolated[- ]test|controlled.*test|test.*canary/i.test(labels),
    qualification: item.kind === 'runtime_incident'
      ? 'Stored unresolved incident; last-detection time is not a fresh reproduction.'
      : 'Current database attention projection; inspect its underlying state before treating it as an outage.',
  };
}
function classifyIssue(item, deployedAt) {
  if (item.syntheticLabelPresent) return 'synthetic_label_present_origin_unverified_not_excluded';
  if (item.kind === 'subscription_paused') return 'paused_account_state_not_a_new_runtime_failure';
  if (item.kind === 'signup_duplicate') return 'current_duplicate_projection_not_a_stored_new_occurrence';
  if (item.kind !== 'runtime_incident') return 'current_signup_state_underlying_record_needs_verification';
  const detected = Date.parse(item.lastDetectedAt), deployed = Date.parse(deployedAt);
  if (!Number.isFinite(detected) || !Number.isFinite(deployed)) return 'unresolved_incident_age_unverified';
  return detected < deployed ? 'historical_occurrence_unresolved_not_reproduced_now' : 'recorded_since_deploy_not_reproduced_now';
}
async function main() {
  const output = process.argv.find(a => a.startsWith('--out='))?.slice(6);
  if (!output) throw Error('Explicit private evidence output required');
  const savedPath = process.argv.find(a => a.startsWith('--saved='))?.slice(8);
  if (savedPath) {
    const saved = JSON.parse(fs.readFileSync(savedPath, 'utf8'));
    const deployedAt = process.argv.find(a => a.startsWith('--deployed-at='))?.slice(14);
    if (!Number.isFinite(Date.parse(deployedAt))) throw Error('Verified deployment timestamp required');
    const analysis = { sourceSnapshot: path.resolve(savedPath), observedAt: saved.checkedAt, analyzedAt: new Date().toISOString(),
      releaseCommit: saved.releaseCommit, deployedAt,
      issues: saved.issues.map(item => ({ ...item, classification: classifyIssue(item, deployedAt) })),
      noProductionWrites: true, noFreshReproduction: true, noAutomaticExclusions: true };
    fs.writeFileSync(output, JSON.stringify(analysis, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ observedAt: analysis.observedAt, deployedAt, critical: analysis.issues.filter(i => i.severity === 'critical')
      .map(({id,reasonCode,lastDetectedAt,classification}) => ({id,reasonCode,lastDetectedAt,classification})) }, null, 2));
    return;
  }
  const credentials = readRenderCredentials();
  if (new URL(credentials.host).origin !== 'https://api.render.com') throw Error('Unexpected Render API origin');
  const service = await getJson(`${credentials.host}/services/${SERVICE}`, { authorization: `Bearer ${credentials.key}` });
  if (service.id !== SERVICE || service.ownerId !== WORKSPACE) throw Error('Render service/workspace mismatch');
  if (process.argv.includes('--origin-policy-only')) {
    const config = await fetchRenderEnv({ credentials, serviceId: SERVICE, keys: [], optionalKeys: ['ALLOWED_ORIGINS', 'CORS_ORIGINS'] });
    const origins = String(config.ALLOWED_ORIGINS || config.CORS_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const report = { checkedAt: new Date().toISOString(), source: 'Render GET environment presence/origin policy; no application mutation',
      customPolicyConfigured: origins.length > 0, originCount: origins.length,
      configuredLoopbackOrigin: origins.some(value => { try { return ['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname); } catch {return false;} }),
      sourceGuard: 'Exact origin whitelist is checked before form-observation service.create/observe',
      historicalRequestsOrStoredWritesProven: false };
    fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify(report, null, 2)); return;
  }
  const env = await fetchRenderEnv({ credentials, serviceId: SERVICE, keys: ['MONITOR_API_KEY'] });
  const ready = await getJson('https://api.myaipa.ca/api/health/ready');
  const operational = await getJson('https://api.myaipa.ca/api/internal/operations/health', { 'x-monitor-api-key': env.MONITOR_API_KEY });
  const issues = (operational.issues || []).map(projectIssue);
  const report = { checkedAt: new Date().toISOString(), generatedAt: operational.generatedAt,
    releaseCommit: ready.releaseCommit, serviceId: SERVICE, workspaceId: WORKSPACE,
    source: 'GET /api/internal/operations/health; database/file-backed attention, no provider lookup',
    operationalOk: operational.ok, attention: operational.attention, issues,
    countsByKind: issues.reduce((counts, i) => ({ ...counts, [i.kind]: (counts[i.kind] || 0) + 1 }), {}),
    receiptWorker: { status: operational.twilioReceipts?.status, pending: operational.twilioReceipts?.pending,
      processing: operational.twilioReceipts?.processing, failed: operational.twilioReceipts?.failed },
    productionWrites: false, alertsSent: false, incidentsAcknowledgedOrClosed: false, providerLookups: false };
  fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ checkedAt: report.checkedAt, generatedAt: report.generatedAt, releaseCommit: report.releaseCommit,
    operationalOk: report.operationalOk, countsByKind: report.countsByKind,
    critical: issues.filter(i => i.severity === 'critical').map(({id,kind,reasonCode,firstDetectedAt,lastDetectedAt,occurrences,syntheticLabelPresent}) =>
      ({id,kind,reasonCode,firstDetectedAt,lastDetectedAt,occurrences,syntheticLabelPresent})) }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(text(error.message)); process.exitCode = 1; });
module.exports = { projectIssue, classifyIssue };
