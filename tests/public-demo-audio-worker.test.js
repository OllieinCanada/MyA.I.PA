const test = require('node:test');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { runWorker } = require('../scripts/public-demo-audio-plan');

function timedWorker(source) {
  const started = performance.now();
  // A fixture-only escape keeps a regressed SIGTERM supervisor from hanging
  // the test runner. It is not the expected result: the assertions below still
  // require ETIMEDOUT/SIGKILL at the one-second supervisor cutoff.
  const run = runWorker(['-e', source + '\nsetTimeout(() => process.exit(99), 3000);'], { stdio: 'pipe', timeoutMs: 1000 });
  assert.equal(run.error?.code, 'ETIMEDOUT');
  assert.equal(run.signal, 'SIGKILL');
  assert.equal(run.status, null);
  assert.match(run.stdout.toString(), /WORKER_READY/);
  assert.ok(performance.now() - started < 4000, 'The final cutoff must return without cooperative worker exit');
  return run;
}

test('final worker cutoff kills a ready child instead of trusting graceful exit', { timeout: 6000 }, () => {
  timedWorker(`process.on('SIGTERM', () => {}); process.stdout.write('WORKER_READY\\n'); setInterval(() => {}, 100);`);
});

test('POSIX final cutoff stops a worker that has demonstrably intercepted SIGTERM', {
  timeout: 6000, skip: process.platform === 'win32' ? 'Windows terminates SIGTERM directly; interception behavior requires POSIX CI.' : false,
}, () => {
  const run = timedWorker(`
    process.on('SIGTERM', () => process.stdout.write('SIGTERM_INTERCEPTED\\n'));
    process.stdout.write('WORKER_READY\\n');
    setInterval(() => {}, 100);
    setTimeout(() => process.kill(process.pid, 'SIGTERM'), 50);
  `);
  assert.match(run.stdout.toString(), /SIGTERM_INTERCEPTED/);
});

test('normal worker completion is preserved without a forced signal', () => {
  const run = runWorker(['-e', `process.stdout.write('completed');`], { stdio: 'pipe', timeoutMs: 1000 });
  assert.equal(run.status, 0); assert.equal(run.signal, null); assert.equal(run.error, undefined);
  assert.equal(run.stdout.toString(), 'completed');
});

test('invalid cutoff values fail before creating a child', () => {
  for (const timeoutMs of [0, -1, 1.2, NaN, Infinity]) assert.throws(() => runWorker([], { timeoutMs }), /positive worker timeout/);
});
