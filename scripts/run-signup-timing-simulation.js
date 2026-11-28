// Local measurement rehearsal only. Never imports server/index or starts workers,
// Prisma, an HTTP server, provider SDKs, or a production connection.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { AsyncLocalStorage } = require('node:async_hooks');
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { setTimeout: delay } = require('node:timers/promises');
const { memoryDb } = require('../tests/helpers/twilio-status-memory-db');
const jobs = require('../server/signupSetupJobs');
const contextStore = require('../server/signupProvisioningContext');
const provisioning = require('../server/signupProvisioning');
const journal = require('../server/intakeRecoveryJournal');
const make = require('../server/makeSignupWebhook');
const { readMakeSignupHandoff } = require('../server/makeSignupHandoff');
const { assertLegacyBusinessResourcesSafe } = require('../server/signupLegacyResourceSafety');
const { createFixture: createHistoryFixture } = require('../tests/helpers/call-sync-workload-fixture');
const { writeManifest } = require('./provider-hardening-evidence');

const ROOT = path.resolve(__dirname, '..');
const PROFILES = ['baseline', 'slow-model-read', 'transient-model-timeout',
  'event-loop-pause', 'lost-provider-response', 'lost-admission-ack', 'unpaced-history-control', 'paced-history'];
const INDEX = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
const SOURCE_FILES = ['scripts/run-signup-timing-simulation.js', 'server/index.js',
  'server/signupSetupJobs.js', 'server/signupProvisioningContext.js', 'server/signupProvisioning.js',
  'server/intakeRecoveryJournal.js', 'server/makeSignupWebhook.js', 'server/makeSignupHandoff.js',
  'server/signupLegacyResourceSafety.js', 'tests/helpers/twilio-status-memory-db.js',
  'server/callSyncWorkload.js', 'tests/helpers/call-sync-workload-fixture.js'];

// Instrumentation, not an OS sandbox. The extracted application function also
// receives a closed require map, synthetic env, and no native fetch reference.
async function refuseNetwork(work) {
  let attempts = 0;
  const restore = [];
  function replace(object, key) {
    const previous = object[key];
    object[key] = () => { attempts++; throw Object.assign(new Error('Synthetic transport refused'), { code: 'SIMULATION_NETWORK_REFUSED' }); };
    restore.push(() => { object[key] = previous; });
  }
  replace(globalThis, 'fetch');
  for (const name of ['node:http', 'node:https']) {
    const transport = require(name); replace(transport, 'request'); replace(transport, 'get');
  }
  replace(require('node:net').Socket.prototype, 'connect');
  replace(require('node:tls'), 'connect');
  try { return await work(() => attempts); }
  finally { for (const undo of restore.reverse()) undo(); }
}

function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = p => sorted.length ? sorted[Math.ceil(p * sorted.length) - 1] : null;
  return { samples: sorted.length, medianMs: percentile(0.5), p95Ms: percentile(0.95), maxMs: sorted.at(-1) ?? null };
}
function busyFor(ms) {
  const end = performance.now() + ms;
  while (performance.now() < end) { /* Explicit bounded local CPU fault, no IO. */ }
}
function extractHandoff(globals) {
  const start = INDEX.indexOf('async function sendMakeSignupCompleted(');
  const end = INDEX.indexOf('\nfunction requireAdmin(', start);
  assert.ok(start >= 0 && end > start, 'Exact application handoff function required');
  return vm.runInNewContext(`${INDEX.slice(start, end)}; sendMakeSignupCompleted`, globals);
}

async function runScenario(profile, count) {
  assert.ok(PROFILES.includes(profile), 'Unknown synthetic profile');
  assert.ok(Number.isInteger(count) && count >= 2 && count <= 30, 'Count must be 2–30');
  const { prisma, rows } = memoryDb();
  const local = new AsyncLocalStorage();
  const secret = crypto.randomBytes(32).toString('hex'); // Ephemeral test key, never output.
  const measurements = [], queueWaits = [], starts = new Map(), finishes = new Map();
  const faults = new Set(), receipts = new Map(), posts = new Map(), outcomes = [], failures = [];
  let logicalNow = 1000, recoveryVisible = false, faultCount = 0, active = 0, peakActive = 0;
  async function stage(name, work) {
    const begun = performance.now(), identity = local.getStore()?.id;
    let code = '';
    try { return await local.run({ id: identity, stage: name }, work); }
    catch (error) { code = String(error.code || 'SIMULATION_STAGE_FAILED'); throw error; }
    finally { measurements.push({ id: identity, stage: name, durationMs: performance.now() - begun, outcome: code ? 'failed' : 'completed', code }); }
  }
  const transaction = prisma.$transaction.bind(prisma);
  prisma.$transaction = async work => {
    const requested = performance.now(), scope = local.getStore() || {};
    const result = await transaction(async tx => {
      queueWaits.push({ stage: scope.stage || 'worker_state', durationMs: performance.now() - requested });
      const snapshot = structuredClone([...rows]);
      const wrapped = { ...tx, runtimeStore: { ...tx.runtimeStore,
        findUnique: async args => {
          if (scope.stage === 'recovery_copy' && ['slow-model-read', 'transient-model-timeout', 'event-loop-pause'].includes(profile)
            && !faults.has(scope.id)) {
            faults.add(scope.id);
            if (profile === 'slow-model-read') { faultCount++; await delay(20); }
            if (['transient-model-timeout', 'event-loop-pause'].includes(profile)) {
              const begun = performance.now(); faultCount++;
              if (profile === 'event-loop-pause') busyFor(60); else await delay(60);
              // Deliberately scaled fault: 25 ms model budget, NOT production's
              // 5000 ms Prisma budget and NOT a measured database timeout.
              if (performance.now() - begun >= 25) throw Object.assign(new Error('Synthetic transaction expired'), { code: 'P2028' });
            }
          }
          return tx.runtimeStore.findUnique(args);
        },
      } };
      try { return await work(wrapped); }
      catch (error) { rows.clear(); for (const [key, row] of snapshot) rows.set(key, row); throw error; }
    });
    // Commit happened in the model; deliberately lose only its acknowledgement.
    if (profile === 'lost-admission-ack' && scope.stage === 'dispatch_admission' && !faults.has(scope.id)) {
      faults.add(scope.id); faultCount++;
      throw Object.assign(new Error('Synthetic commit acknowledgement lost'), { code: 'P2028' });
    }
    return result;
  };

  const reportFailure = async failure => failures.push({ id: failure.job.eventKey, code: failure.code,
    safeBeforeDispatch: jobs.isPreHandoffDatabaseRetry(failure.error),
    uncertain: failure.uncertain, exhausted: failure.exhausted });
  const handoff = extractHandoff({
    crypto, Date, AbortSignal, process: { env: {} },
    console: { error() {} },
    getMakeSignupWebhookConfig: () => ({ url: 'https://hook.us1.make.com/synthetic-timing-only', apiKey: '' }),
    getProvisioningSigningSecret: () => secret,
    validateMakeWebhookUrl: make.validateMakeWebhookUrl,
    normalizeSignupProvisioningPayload: (...args) => provisioning.normalizeSignupProvisioningPayload(...args),
    buildMakeSignupEventKey: make.buildMakeSignupEventKey,
    registerSignupProvisioningContextForAttempt: args => stage('context_register', () => contextStore.registerSignupProvisioningContextForAttempt(args)),
    assertSignupLegacyResourcesSafe: (payload, attemptId) => stage('legacy_resource_guard', () => assertLegacyBusinessResourcesSafe({
      records: [], businessKey: payload.provisioning.businessKey, attemptId,
      hasResources: () => false, inspectArchived: async () => { throw new Error('No archived fixture resources expected'); },
    })),
    buildMakeSignupHeaders: make.buildMakeSignupHeaders, parseMakeSignupTimeoutMs: make.parseMakeSignupTimeoutMs,
    createTimeoutSignal: ms => AbortSignal.timeout(ms), getMakeRequestId: make.getMakeRequestId,
    parseJsonObject: JSON.parse, prisma,
    require: name => {
      assert.equal(name, './intakeRecoveryJournal', 'No unreviewed application import');
      return {
        saveRecoveryCopy: args => stage('recovery_copy', () => journal.saveRecoveryCopy(args)),
        recordRecoveryOperation: args => stage(`handoff_journal_${args.status}`, () => journal.recordRecoveryOperation(args)),
      };
    },
    readMakeSignupHandoff: args => stage('provider_stub', () => readMakeSignupHandoff({ ...args,
      fetchImpl: async (url, options) => {
        assert.equal(url, 'https://hook.us1.make.com/synthetic-timing-only');
        assert.equal(options.method, 'POST');
        const payload = JSON.parse(options.body), id = make.buildMakeSignupEventKey(payload);
        posts.set(id, (posts.get(id) || 0) + 1);
        const result = { status: 200, body: '{"accepted":true}', data: { accepted: true }, eventKey: id };
        receipts.set(id, result);
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => {
          if (profile === 'lost-provider-response') {
            faultCount++; throw Object.assign(new Error('Synthetic lost response'), { code: 'UND_ERR_SOCKET' });
          }
          return result.body;
        } };
      },
    })),
  });
  const payloads = new Map();
  for (let i = 0; i < count; i++) {
    const payload = { submissionId: `synthetic-timing-${i}`, source: { app: 'synthetic-timing' },
      owner: { name: 'Invented owner', email: `timing-${i}@example.invalid`, phone: `+1905555${String(100 + i).padStart(4, '0')}` },
      business: { name: `Invented timing business ${i}`, phone: `+1905555${String(100 + i).padStart(4, '0')}`, address: '1 Fixture Street, Hamilton, Ontario' },
      verification: { smsVerified: true }, aiAssistant: { businessType: 'Electrical', serviceArea: 'Hamilton' } };
    const id = make.buildMakeSignupEventKey(payload); payloads.set(id, payload);
    const input = { eventKey: id, tokenHash: crypto.createHash('sha256').update(id).digest('hex'),
      businessKey: provisioning.buildProvisioningAccountKey(payload.owner.email, payload.owner.phone, payload.business.name), channel: 'sms', now: logicalNow };
    await prisma.$transaction(tx => jobs.enqueueSignupSetupJob(tx, input));
  }
  const loop = monitorEventLoopDelay({ resolution: 5 }); loop.enable();
  const elapsed = performance.now(), cpu = process.cpuUsage();
  const history = ['unpaced-history-control', 'paced-history'].includes(profile)
    ? createHistoryFixture({ count, unoptimizedControl: profile === 'unpaced-history-control', writeCpuMs: 2 }) : null;
  let historyCompleted = false, handoffsWhileHistoryPending = 0;
  // The same application sweep and synthetic records, with only pacing/cache
  // disabled in the control. This is not an older-build or PostgreSQL benchmark.
  const historyRun = history ? (async () => {
    const rounds = [];
    for (let i = 0; i < 3; i++) rounds.push(await history.run());
    historyCompleted = true;
    return rounds.map(({ fetched, synced, unchanged, rewritten }) => ({ fetched, synced, unchanged, rewritten }));
  })() : Promise.resolve(null);
  // Observe failures immediately; await below still propagates the original.
  historyRun.catch(() => {});
  try {
    await delay(15); // Let the event-loop sampler start before injecting CPU work.
    const worker = () => jobs.drainSignupSetupJobs({ prisma, secret, now: () => logicalNow, batchSize: 3,
      onFailure: reportFailure,
      processJob: (job, ctl) => local.run({ id: job.eventKey, stage: 'job' }, async () => {
        active++; peakActive = Math.max(peakActive, active);
        if (!starts.has(job.eventKey)) starts.set(job.eventKey, performance.now());
        try {
          const result = await ctl.handoff(beforeDispatch => stage('prepare_and_handoff', () => handoff(payloads.get(job.eventKey), {
            beforeDispatch: () => stage('dispatch_admission', beforeDispatch),
          })), () => stage('receipt_reconciliation', async () => recoveryVisible ? receipts.get(job.eventKey) || null : null));
          assert.equal(result.data?.accepted, true, 'Stub acceptance is not signup readiness');
          if (history && !historyCompleted) handoffsWhileHistoryPending++;
          finishes.set(job.eventKey, performance.now());
          return { ok: true };
        } finally { active--; }
      }),
    });
    // Independently invoked, overlapping workers share the same in-memory model.
    // Backoff time is advanced explicitly; it is not throughput measurement.
    for (let round = 0; round < count * 12; round++) {
      await Promise.all([worker(), worker()]);
      recoveryVisible = true;
      const pending = [...rows.values()].filter(x => x.key.startsWith(jobs.PREFIX) && ['pending', 'processing'].includes(x.data.status));
      if (!pending.length) break;
      logicalNow += 310000;
    }
    const handoffBatchWallMs = performance.now() - elapsed;
    const historyRounds = await historyRun;
    if (history) {
      assert.equal(history.counts.writes, count * (profile === 'paced-history' ? 1 : 3));
      assert.equal(history.counts.details, count * 3, 'Late artifacts still get fresh detail reads');
      assert.equal(history.counts.requestLinks, count * 3, 'Request linking is not disabled');
      assert.equal(history.counts.fileWrites, profile === 'paced-history' ? 1 : 3);
      if (profile === 'paced-history') assert.ok(handoffsWhileHistoryPending > 0, 'Signup worker progresses while history yields');
    }
    await delay(15); // Capture the scheduled sampler tick after the final pause.
    for (const id of payloads.keys()) {
      const job = rows.get(jobs.jobKey(id)).data;
      assert.ok((posts.get(id) || 0) <= 1, 'Duplicate simulated provider dispatch');
      if (profile === 'lost-admission-ack') {
        assert.equal(posts.get(id) || 0, 0); assert.equal(job.status, 'failed');
        assert.equal(job.phase, 'handoff'); assert.equal(job.completedAt, null);
        assert.equal(job.attempts, 10);
      } else {
        assert.equal(posts.get(id), 1); assert.equal(job.status, 'completed');
        assert.equal(job.phase, 'handoff');
      }
      outcomes.push({ fixtureId: id, status: job.status, phase: job.phase, attempts: job.attempts,
        simulatedHandoffs: posts.get(id) || 0, lastErrorCode: job.lastErrorCode });
    }
    const stages = [...new Set(measurements.map(x => x.stage))].map(name => ({ stage: name,
      ...summary(measurements.filter(x => x.stage === name).map(x => x.durationMs)),
      failures: measurements.filter(x => x.stage === name && x.outcome === 'failed').length }));
    const usage = process.cpuUsage(cpu);
    return { profile, fakeSignups: count, assertionsPassed: true, wallMs: performance.now() - elapsed,
      cpuMs: (usage.user + usage.system) / 1000, peakActiveJobs: peakActive, injectedFaults: faultCount,
      handoffBatchWallMs,
      backgroundHistory: history ? { mode: profile, rounds: historyRounds, counts: { ...history.counts }, handoffsWhileHistoryPending,
        syntheticCpuMsPerWrite: 2, providerReadsAreStubs: true, databaseIsInMemory: true } : null,
      simulatedHandoffs: [...posts.values()].reduce((a, b) => a + b, 0), duplicateHandoffs: [...posts.values()].filter(x => x > 1).length,
      completedHandoffJobs: outcomes.filter(x => x.status === 'completed').length,
      heldHandoffJobs: outcomes.filter(x => x.status === 'failed').length,
      preparationFailures: failures.filter(x => x.safeBeforeDispatch && ['P2028', 'P2024'].includes(x.code)).length,
      eventLoop: { resolutionMs: 5, samples: loop.count, maxMs: loop.max / 1e6, p95Ms: loop.percentile(95) / 1e6 },
      serializedModelQueueWait: summary(queueWaits.map(x => x.durationMs)),
      perJobObservedElapsed: summary([...finishes].map(([id, t]) => t - starts.get(id))), stages, outcomes,
    };
  } finally { try { await historyRun; } finally { loop.disable(); } }
}

async function runSimulation({ count = 20, profiles = PROFILES } = {}) {
  assert.ok(Number.isInteger(count) && count >= 2 && count <= 30, 'Count must be 2–30');
  assert.ok(Array.isArray(profiles) && profiles.length && profiles.every(x => PROFILES.includes(x))
    && new Set(profiles).size === profiles.length, 'Unique known profiles required');
  return refuseNetwork(async networkAttempts => {
    const scenarios = [];
    for (const profile of profiles) scenarios.push(await runScenario(profile, count));
    assert.equal(networkAttempts(), 0, 'Unexpected transport attempt');
    return { schemaVersion: 1, checkedAt: new Date().toISOString(), mode: 'synthetic-in-memory-handoff-timing',
      nodeVersion: process.versions.node, requestedPerProfile: count, assertionsPassed: scenarios.every(x => x.assertionsPassed),
      ready: false, applyAllowed: false, fullSignupCompletionProven: false, productionRootCauseProven: false,
      database: 'transactionally rolled-back serialized in-memory model; not PostgreSQL',
      controlledFaults: { asynchronousModelDelayMs: 20, timeoutDelayMs: 60, synchronousPauseMs: 60, scaledModelBudgetMs: 25,
        historyRounds: 3, syntheticCpuMsPerHistoryWrite: 2, backgroundPauseMs: 100,
        workerBackoffClock: 'advanced between rounds, not real elapsed wait' },
      protections: { applicationStartupImported: false, workersStarted: false, productionConnections: 0,
        liveProviderCalls: 0, realMessages: 0, paidActions: 0, blockedUnexpectedTransportAttempts: networkAttempts(),
        networkBoundary: 'instrumented fetch/HTTP(S)/socket/TLS refusal; not an OS sandbox' },
      sourceHashes: Object.fromEntries(SOURCE_FILES.map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, file))).digest('hex')])),
      limitations: ['Selected direct source hashes, not a complete transitive dependency attestation.',
        'No HTTP authentication, real PostgreSQL locks/pools, verification delivery, phone purchase, Vapi setup, billing or final notification path exercised.',
        'Archived/shared-resource discovery is not exercised: fixtures have no prior resources.',
        'Event-loop and stage timings describe this local process only. Model queue wait is not measured production pool/lock wait.',
        'Artificial delays and scaled timeouts demonstrate mechanisms; they do not reproduce or prove the cause of a historical production incident.',
        'History control disables the new pacing/cache in the same application sweep; it is not a historical-build comparison or production capacity test.',
        'Stub handoff acceptance/job completion is not full signup readiness or live delivery proof.'], scenarios };
  });
}
async function main(argv = process.argv.slice(2)) {
  if (argv.some(a => !/^--count=\d+$/.test(a))) throw new Error('Only --count=2..30 is supported; no URLs, credentials, output overrides or live mode');
  if (argv.length > 1) throw new Error('At most one count argument');
  const count = argv.length ? Number(argv[0].slice(8)) : 20;
  const report = await runSimulation({ count });
  const parent = path.join(ROOT, 'diagnostics'); fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'signup-timing-simulation-'));
  const output = path.join(directory, 'report.json'); writeManifest(output, report);
  console.log(JSON.stringify({ output, assertionsPassed: report.assertionsPassed, ready: false,
    scenarios: report.scenarios.map(({ profile, fakeSignups, wallMs, handoffBatchWallMs, backgroundHistory, eventLoop, simulatedHandoffs, heldHandoffJobs, duplicateHandoffs, stages }) =>
      ({ profile, fakeSignups, wallMs, handoffBatchWallMs, backgroundHistory, eventLoop, simulatedHandoffs, heldHandoffJobs, duplicateHandoffs, stages })),
    limitations: report.limitations }, null, 2));
}
if (require.main === module) main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
module.exports = { runSimulation, refuseNetwork, summary, PROFILES };
