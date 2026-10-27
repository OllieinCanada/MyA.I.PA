const fs = require('node:fs');
const path = require('node:path');
const { assertFreshHealth, recordGate, fingerprintFiles, writeManifest } = require('./provider-hardening-evidence');
const root = path.resolve(__dirname, '..');
function recordChain() {
  const directory = path.join(root, 'diagnostics/provider-hardening');
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'execution.json'), 'utf8'));
  assertFreshHealth(manifest);
  if (manifest.gates.restore?.status !== 'PASS') throw Error('Passing restore evidence is required');
  const sources = ['server/index.js', 'server/provisioningState.js', 'server/twilioStatusInbox.js', 'server/signupSmsDispatch.js',
    'server/intakeLedger.js', 'server/stagingIntake.js', 'server/stagingIntakeWorker.js', 'server/leadHandoffs.js'].filter(file => fs.existsSync(path.join(root, file)));
  // A previous success cannot stand in for the chain rerun required after a
  // new restore check, even when application source files did not change.
  const changedAt = Math.max(Date.parse(manifest.gates.restore.checkedAt), ...sources.map(file => fs.statSync(path.join(root, file)).mtimeMs));
  if (!Number.isFinite(changedAt)) throw Error('Dated restore evidence is required');
  const reports = ['postgres-restart.json', 'verified-setup-chain.json'].map(name => {
    const file = path.join(root, 'diagnostics/signup-failure-recovery-audit', name);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (fs.statSync(file).mtimeMs < changedAt || !data.passed || data.productionTouched !== false || data.externalProvidersMocked !== true) throw Error('Missing, stale or non-isolated chain evidence');
    return { file, checkedAt: fs.statSync(file).mtime.toISOString(), cases: data.cases };
  });
  if (reports[0].cases.length < 28 || reports[1].cases.length !== 5 || reports[1].cases.some(c => !c.passed || c.numbers !== 1 || c.assistants !== 1 || c.imports !== 1 || c.makePosts !== 1 || c.texts !== 3 || c.subscriptions !== 1)) throw Error('Chain duplicate/resource invariant failed');
  const evidence = path.join(directory, 'chain.json');
  writeManifest(evidence, { checkedAt: new Date().toISOString(), passed: true, reports, productionWrites: 0, providerRequests: 0,
    limitations: ['Provider APIs are fakes. Real voice, carrier forwarding and delivery require a separate canary.'] });
  recordGate(manifest, 'chain', { status: 'PASS', evidence, prerequisites: ['health', 'restore'], codeIdentity: fingerprintFiles(sources) });
  writeManifest(path.join(directory, 'execution.json'), manifest);
  console.log(JSON.stringify({ chainGate: 'PASS', restartCases: reports[0].cases.length, signupCases: reports[1].cases.length, liveProviders: false }));
}
if (require.main === module) { try { recordChain(); } catch (error) { console.error(error.message); process.exitCode = 1; } }
module.exports = { recordChain };
