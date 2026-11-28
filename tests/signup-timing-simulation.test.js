const test = require('node:test');
const assert = require('node:assert/strict');
const { runSimulation, refuseNetwork, summary, PROFILES } = require('../scripts/run-signup-timing-simulation');

test('timing simulation exercises all profiles and never promotes mocked handoff proof into live readiness', async () => {
  const report = await runSimulation({ count: 3 });
  assert.equal(report.scenarios.length, PROFILES.length);
  assert.equal(report.assertionsPassed, true);
  assert.equal(report.ready, false); assert.equal(report.applyAllowed, false);
  assert.equal(report.productionRootCauseProven, false); assert.equal(report.fullSignupCompletionProven, false);
  assert.equal(report.protections.liveProviderCalls, 0);
  assert.equal(report.protections.blockedUnexpectedTransportAttempts, 0);
  for (const scenario of report.scenarios) {
    assert.equal(scenario.fakeSignups, 3); assert.equal(scenario.duplicateHandoffs, 0);
    assert.ok(scenario.stages.some(x => x.stage === 'context_register'));
    assert.ok(scenario.stages.some(x => x.stage === 'recovery_copy'));
    assert.ok(scenario.eventLoop.samples > 0);
    if (scenario.profile === 'lost-admission-ack') {
      assert.equal(scenario.simulatedHandoffs, 0); assert.equal(scenario.heldHandoffJobs, 3);
    } else {
      assert.equal(scenario.simulatedHandoffs, 3); assert.equal(scenario.completedHandoffJobs, 3);
    }
    if (['event-loop-pause', 'transient-model-timeout'].includes(scenario.profile)) {
      assert.equal(scenario.injectedFaults, 3);
      assert.equal(scenario.preparationFailures, 3);
      assert.ok(scenario.stages.some(x => x.stage === 'recovery_copy' && x.failures === 3));
    }
    if (scenario.backgroundHistory) {
      assert.equal(scenario.backgroundHistory.counts.details, 9);
      assert.equal(scenario.backgroundHistory.counts.requestLinks, 9);
      assert.equal(scenario.backgroundHistory.counts.writes, scenario.profile === 'paced-history' ? 3 : 9);
      if (scenario.profile === 'paced-history') {
        assert.equal(scenario.backgroundHistory.rounds[1].unchanged, 3);
        assert.ok(scenario.backgroundHistory.handoffsWhileHistoryPending > 0);
      }
    }
  }
});

test('instrumented network refusal blocks fetch, SDK-style HTTP and sockets and restores originals on failure', async () => {
  const fetch = global.fetch, http = require('node:http'), net = require('node:net');
  const originalRequest = http.request, originalConnect = net.Socket.prototype.connect;
  await assert.rejects(refuseNetwork(async count => {
    assert.throws(() => global.fetch('https://example.invalid'), { code: 'SIMULATION_NETWORK_REFUSED' });
    assert.throws(() => http.request('https://example.invalid'), { code: 'SIMULATION_NETWORK_REFUSED' });
    assert.throws(() => new net.Socket().connect(1, '127.0.0.1'), { code: 'SIMULATION_NETWORK_REFUSED' });
    assert.equal(count(), 3); throw new Error('synthetic body failure');
  }), /synthetic body failure/);
  assert.equal(global.fetch, fetch); assert.equal(http.request, originalRequest);
  assert.equal(net.Socket.prototype.connect, originalConnect);
});

test('invalid counts, profiles and duplicate profile requests refuse before starting a rehearsal', async () => {
  for (const count of [0, 1, 31, 2.5, NaN]) await assert.rejects(runSimulation({ count }));
  for (const profiles of [[], ['live'], ['baseline', 'baseline']]) await assert.rejects(runSimulation({ count: 2, profiles }));
});

test('timing summaries do not invent samples or percentile precision from empty evidence', () => {
  assert.deepEqual(summary([]), { samples: 0, medianMs: null, p95Ms: null, maxMs: null });
  assert.deepEqual(summary([4, 1, 3, 2]), { samples: 4, medianMs: 2, p95Ms: 4, maxMs: 4 });
});
