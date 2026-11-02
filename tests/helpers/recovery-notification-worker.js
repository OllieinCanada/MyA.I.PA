// Disposable cross-process fixture only. No provider client or production path.
const fs = require('node:fs'), path = require('node:path');
const { dispatchPrepared } = require('../../scripts/recovery-notification-state');
const preparationPolicy = require('../fixtures/recovery-policy.synthetic.json');
const { openNotificationStore } = require('../../scripts/recovery-notification-store');
const [directory, mode, encodedReport] = process.argv.slice(2);
if (!path.basename(directory || '').startsWith('recovery-notice-fixture-')) throw Error('Synthetic fixture directory required');
const store = openNotificationStore({ directory, monitorId: 'synthetic-monitor' });
const report = JSON.parse(encodedReport);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function accepted(channel, message) {
  const fd = fs.openSync(path.join(directory, 'synthetic-accepted.jsonl'), 'a', 0o600);
  try { fs.writeSync(fd, JSON.stringify({ channel, key: message.idempotencyKey }) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
(async () => {
  if (mode === 'crash-with-lock') store.transaction(() => process.exit(79));
  if (mode === 'race') {
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(path.join(directory, 'start-barrier'))) { if (Date.now() > deadline) throw Error('Synthetic start barrier expired'); await delay(5); }
  }
  const transports = Object.fromEntries(['telegram','email'].map(channel => [channel, async message => {
    if (channel === 'telegram' && mode === 'crash-before-acceptance') process.exit(77);
    accepted(channel, message);
    if (channel === 'telegram' && mode === 'crash-after-acceptance') process.exit(78);
    await delay(20);
    return { accepted: true };
  }]));
  await dispatchPrepared(report, { store, approvedActivation: true, preparationPolicy, transports });
})().catch(error => {
  console.error(error.code || error.message);
  process.exitCode = error.code === 'RECOVERY_NOTIFICATION_LOCKED_REQUIRES_REVIEW_OR_LATER_SAMPLE' ? 75 : 1;
});
