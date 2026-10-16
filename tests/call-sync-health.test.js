const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCallSyncMonitor, completeSync, failureContext, WORKFLOW } = require('../server/callSyncHealth');
const { buildRuntimeIncident } = require('../server/runtimeAlerts');
const { createAttentionItem, applyRuntimeIncidentTransition, recordRuntimeIncident, listRuntimeIncidents } = require('../server/runtimeIncidentStore');
const { buildProductionIncidentAlert } = require('../scripts/monitor-production');
const good = () => ({ fetched: 2, synced: 1, detailErrors: [], routingErrors: [{ reason: 'unmapped historical call' }] });
const at = Date.parse('2026-10-16T14:00:00Z');
const failure = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });
function harness() {
  let clock = at;
  let items = [];
  const notices = [];
  const transitions = [];
  const run = createCallSyncMonitor({
    now: () => clock,
    listIncidents: async () => structuredClone(items),
    notifyFailure: async (error, context) => {
      notices.push(context);
      const incident = buildRuntimeIncident(error, { ...context, detectedAt: new Date(clock).toISOString() });
      incident.remediation = { action: 'none', status: 'verifying', automatic: false, requiresUser: false };
      const next = createAttentionItem(incident, items.find(i => i.id === incident.incidentId));
      items = [next, ...items.filter(i => i.id !== next.id)];
      return { recorded: true };
    },
    recoverIncident: async (id, transition) => {
      transitions.push(transition);
      const index = items.findIndex(i => i.id === id);
      const applied = applyRuntimeIncidentTransition(items[index], transition);
      if (applied.updated) items[index] = applied.item;
      return applied;
    },
  });
  return { run, notices, transitions, items: () => items, advance: ms => { clock += ms; } };
}

test('a timeout is a precise warning, escalates after 30 minutes, and survives runner recreation', async () => {
  const h = harness();
  await assert.rejects(h.run(async () => { throw failure(); }));
  assert.equal(h.notices[0].severity, 'warning');
  assert.match(buildRuntimeIncident(failure(), h.notices[0]).nextAction, /do not resend/);
  h.advance(30 * 60_000);
  await assert.rejects(h.run(async () => { throw failure(); }));
  assert.equal(h.notices[1].severity, 'critical');
  assert.equal(failureContext(h.items(), at + 31 * 60_000, failure()).severity, 'critical');
  assert.equal(h.items().length, 1, 'stable incident identity across repeated failures');
});

test('only a complete scheduled sync recovers; partial details and simple provider responses do not', async () => {
  const h = harness();
  await assert.rejects(h.run(async () => { throw failure(); }));
  h.advance(1000);
  await h.run(async () => ({ ...good(), detailErrors: [{ message: 'timeout' }] }));
  assert.equal(h.transitions.length, 0);
  await h.run(async () => ({ ok: true }));
  assert.equal(h.transitions.length, 0);
  h.advance(1000);
  await h.run(async () => good());
  assert.equal(h.items()[0].remediation.status, 'recovered');
  assert.equal(h.items()[0].syncRecovery.synced, 1);
});

test('new failures reopen immediately after recovery and restart the escalation clock', async () => {
  const h = harness();
  await assert.rejects(h.run(async () => { throw failure(); }));
  h.advance(40 * 60_000);
  await h.run(async () => good());
  h.advance(1000);
  await assert.rejects(h.run(async () => { throw failure(); }));
  assert.equal(h.items()[0].remediation.status, 'verifying');
  assert.equal(h.items()[0].remediation.generation, 2);
  assert.equal(h.notices.at(-1).severity, 'warning');
});

test('stale success cannot clear a newer failure or a different workflow', async () => {
  const h = harness();
  await assert.rejects(h.run(async () => { throw failure(); }));
  h.advance(1000);
  await h.run(async () => good());
  const item = h.items()[0];
  const transition = h.transitions[0];
  assert.equal(applyRuntimeIncidentTransition({ ...item, diagnostics: { ...item.diagnostics, occurrences: 99 } }, transition).updated, false);
  assert.equal(applyRuntimeIncidentTransition({ ...item, snapshot: { Workflow: 'signup' } }, transition).updated, false);
  assert.equal(applyRuntimeIncidentTransition(item, { ...transition, syncRecovery: { ...transition.syncRecovery, startedAt: new Date(at - 1).toISOString() } }).updated, false);
});

test('overlapping scheduled runs share one task, not duplicate mutations', async () => {
  const h = harness();
  let finish;
  let calls = 0;
  const task = () => { calls++; return new Promise(resolve => { finish = resolve; }); };
  const one = h.run(task);
  const two = h.run(task);
  await new Promise(resolve => setImmediate(resolve));
  finish(good());
  await Promise.all([one, two]);
  assert.equal(calls, 1);
});

test('incomplete result accounting does not count as recovery; intentionally unmapped calls can', () => {
  assert.equal(completeSync(good()), true);
  assert.equal(completeSync({ ...good(), fetched: 3 }), false);
  assert.equal(completeSync({ ...good(), detailErrors: [{}] }), false);
  assert.equal(completeSync({ fetched: 0, synced: 0, detailErrors: [], routingErrors: [] }), true);
});

test('credential, database, and implementation failures are never downgraded as temporary Vapi slowness', () => {
  for (const code of ['P1001', 'DATABASE_QUERY_IMPLEMENTATION_FAILED', 'VAPI_API_KEY_MISSING']) {
    assert.equal(failureContext([], at, Object.assign(new Error(code), { code })).severity, 'critical');
  }
  const access = failureContext([], at, Object.assign(new Error('Vapi rejected credentials'), { providerStatus: 401 }));
  assert.equal(access.severity, 'critical');
  assert.notEqual(access.reasonCode, 'VAPI_CALL_SYNC_DELAYED');
});

test('unresolved sync incidents do not silently expire without successful sync evidence', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'call-sync-health-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'incidents.json');
  recordRuntimeIncident(file, buildRuntimeIncident(failure(), { ...failureContext([], at, failure()), detectedAt: new Date(at).toISOString() }));
  const items = listRuntimeIncidents(file, { now: new Date(at + 10 * 24 * 60 * 60_000) });
  assert.equal(items.length, 1);
  assert.equal(items[0].snapshot.Workflow, WORKFLOW);
});

test('provider-independent operations health contract and limited-sync boundary are wired', () => {
  const source = fs.readFileSync(path.join(__dirname, '../server/index.js'), 'utf8');
  const route = source.slice(source.indexOf('"/api/internal/operations/health"'), source.indexOf('function exactGitHubIncidentUrl'));
  assert.doesNotMatch(route, /inspectSignupRecoveryState|fetchVapi|fetchTwilio/);
  assert.match(route, /liveLookups: false/);
  assert.match(source, /if \(Object.keys\(options\).length\) return performVapiCallSync\(options\)/);
});

test('operational-check timeout is a warning, while website failure stays critical', () => {
  const alert = name => buildProductionIncidentAlert({ checkedAt: new Date(at).toISOString(), checks: [{ name, healthy: false, error: 'timeout', durationMs: 10000 }] });
  assert.match(alert('operational_health'), /WARNING/);
  assert.match(alert('operational_health'), /does not confirm a website outage/);
  assert.match(alert('public_site'), /CRITICAL/);
});
