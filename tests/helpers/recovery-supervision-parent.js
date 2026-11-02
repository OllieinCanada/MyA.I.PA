'use strict';
// Fixed fresh-parent fixture only. No application, provider SDK or credentials.
const fs = require('node:fs');
const crypto = require('node:crypto');
const contract = require('../../scripts/recovery-supervision-contract');
const { runSyntheticSupervision } = require('../../scripts/recovery-supervision-proof');
const { openNotificationStore } = require('../../scripts/recovery-notification-store');
const { dispatchPrepared } = require('../../scripts/recovery-notification-state');
const preparationPolicy = require('../fixtures/recovery-policy.synthetic.json');
const PHASES = ['initial-exit', 'initial-crash', 'reopen', 'negative-replay'];
const MONITOR = 'synthetic-fresh-parent-monitor';

async function main() {
  const request = JSON.parse(process.argv[2] || 'null');
  contract.exact(request, ['directory', 'executionId', 'phase', 'observedAt']);
  if (!PHASES.includes(request.phase) || !Number.isSafeInteger(request.observedAt)
    || request.observedAt < 1 || request.observedAt > Date.now()) throw Error('SYNTHETIC_PARENT_REQUEST_INVALID');
  const fixture = contract.readFixture(request.directory, request.executionId);
  if (process.env.RECOVERY_SUPERVISION_SYNTHETIC_ONLY !== '1') throw Error('SYNTHETIC_PARENT_ENV_REQUIRED');
  const unexpected = Object.keys(process.env).filter(key => /^(?:TWILIO_|VAPI_|RENDER_|TELEGRAM_|SMTP_|MAKE_|STRIPE_|GOOGLE_|OPENAI_|BACKUP_|AWS_)/.test(key)
    || ['DATABASE_URL', 'NODE_OPTIONS', 'NODE_PATH', 'OPERATIONS_ENV_FILE'].includes(key));
  if (unexpected.length) throw Error('SYNTHETIC_PARENT_CREDENTIAL_ENV_REJECTED');
  const store = openNotificationStore({ directory: fixture.directory, monitorId: MONITOR });
  const initial = request.phase.startsWith('initial-');
  if (initial) store.initialize();
  const before = contract.acceptanceFiles(fixture.directory).length;
  let calls = 0;
  const proofs = [];
  const transports = Object.fromEntries(['telegram', 'email'].map(channel => [channel, async message => {
    calls++;
    const mode = initial && channel === 'telegram' ? 'accepted-then-hang' : 'accept';
    const proof = runSyntheticSupervision({ ...fixture, syntheticOnly: true, mode, timeoutMs: mode === 'accept' ? 1500 : 1000,
      message: { eventId: message.eventId, episodeId: message.episodeId, idempotencyKey: message.idempotencyKey, channel } });
    proofs.push(proof);
    if (proof.outcome === 'accepted_not_recipient_receipt') return { accepted: true };
    throw Error('SYNTHETIC_PARENT_OUTCOME_UNCONFIRMED');
  }]));
  const report = { checkedAt: new Date(request.observedAt).toISOString(), severity: 'critical',
    issues: [{ code: 'SYNTHETIC_BACKUP_FAILED', severity: 'critical' }] };
  if (request.phase === 'negative-replay') {
    // Deliberately bad fixture control: bypass the durable ledger. The unique
    // recorder must expose this extra invocation, not hide it as idempotent.
    const saved = store.readState(), event = saved.events[0];
    await transports.telegram({ eventId: event.id, episodeId: event.episodeId, idempotencyKey: event.id + ':telegram' });
  } else {
    await dispatchPrepared(report, { store, transports, approvedActivation: true, preparationPolicy });
  }
  const state = store.readState();
  fs.writeSync(process.stdout.fd, JSON.stringify({ scope: 'fresh-parent-synthetic-only', parentPid: process.pid,
    invocationId: crypto.randomUUID(), phase: request.phase, calls, acceptanceBefore: before,
    acceptanceAfter: contract.acceptanceFiles(fixture.directory).length, storeId: state.storeId,
    eventId: state.events[0].id, attempts: state.events[0].attempts, proofs, rssAtReportBytes: process.memoryUsage().rss,
    hardParentOrOSDeadlineProven: false, realProviderRequests: 0, credentialSerialization: false }) + '\n');
  // All owned transport children have already exited. This crash exercises a
  // new parent reopening persisted uncertain state without orphaning a child.
  if (request.phase === 'initial-crash') process.exit(78);
}

main().catch(() => { console.error('SYNTHETIC_FRESH_PARENT_FAILED'); process.exitCode = 79; });
