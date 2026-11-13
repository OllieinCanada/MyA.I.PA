const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createAssociationFence } = require('../server/signupAssociationRepair');
const { hashOperationalTarget, removeSignupTargetsFromStore } = require('../server/signupDecommission');

// Execute the actual index.js functions with inert dependencies, never a server,
// provider credential, database connection or external mutation.
const source = fs.readFileSync(require.resolve('../server/index'), 'utf8');
function load(name, nextName, dependencies) {
  const start = source.indexOf(`async function ${name}(`);
  const boundary = new RegExp(`\\n(?:async )?function ${nextName}\\(`).exec(source.slice(start));
  const end = boundary ? start + boundary.index : -1;
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(`(${source.slice(start, end)})`, dependencies);
}
const paths = [
  ['decommissionSignupSetAndRebuild', 'inspectFailedSuperdavesRebuildRollback'],
  ['rollbackFailedSuperdavesRebuild', 'getSignupProviderRecoveryDiagnostics'],
];
function fixture() {
  const fence = createAssociationFence(), actions = [];
  const row = { signupAttemptId: 'signup_' + 'a'.repeat(32), ownerEmail: 'fixture@example.invalid',
    ownerPhone: '+19055550123', businessName: 'Synthetic', vapiPhoneNumberId: 'phone',
    vapiAssistantId: 'assistant', twilioPhoneNumber: '+13655550123' };
  const targetId = hashOperationalTarget(row);
  let store = { target: structuredClone(row), other: { note: 'preserve' } };
  const inspection = { target: row, targets: [row], targetId, targetIds: [targetId], summary: {},
    subscriptionIds: new Set(['sub']), checkoutSessionIds: new Set(['checkout']), stripeCustomers: [{ id: 'customer' }],
    vapiPhoneTargets: [{ id: 'phone', number: row.twilioPhoneNumber }], vapiAssistantTargets: [{ id: 'assistant' }],
    twilioTargets: [{ sid: 'PNfixture' }], cleanupEmails: new Set([row.ownerEmail]), identity: { ownerPhone: row.ownerPhone }, pendingStore: {} };
  const effect = label => async () => { actions.push(label); };
  const deps = { signupAssociationFence: fence, signupDashboardPath: 'synthetic',
    fs: { readFileSync: () => JSON.stringify(store) },
    inspectSignupSetForDecommission: async () => inspection, inspectFailedSuperdavesRebuildRollback: async () => inspection,
    cancelStripeSubscriptionIfPresent: effect('cancel'), expireStripeCheckoutIfOpen: effect('expire'), deleteStripeCustomerIfPresent: effect('customer'),
    deleteVapiResourceIfPresent: effect('vapi'), releaseTwilioNumberIfPresent: effect('twilio'),
    applyTwilioDecommissionPolicy: async ({ targets, release }) => Promise.all(targets.map(release)),
    getVapiPhoneNumber: r => r.number, getVapiAssistantId: r => r.assistantId,
    prisma: { vapiBusinessMapping: { deleteMany: effect('mapping') }, runtimeStore: { deleteMany: effect('receipts') } },
    buildProvisioningAccountKey: () => 'account', provisioningStateKey: k => k, contextStoreKey: k => k,
    readSignupDashboardStore: () => structuredClone(store), removeSignupTargetsFromStore,
    writeSignupDashboardStore: next => { fence.check(store, next); actions.push('dashboard'); store = next; },
    readTrialReminderStore: () => ({}), writeTrialReminderStore: effect('reminders'),
    readPendingStripeSignupStore: () => ({}), writePendingStripeSignupStore: effect('pending-stripe'),
    pendingSignupVerifications: { removeHash: effect('pending') }, signupAttempts: null,
  };
  return { fence, actions, row, targetId, inspection, deps, get store() { return store; },
    protect() { store.target.resourceAssociationRepair = { id: 'repair', sourceId: row.signupAttemptId,
      values: { twilioPhoneNumber: row.twilioPhoneNumber, vapiAssistantId: row.vapiAssistantId, vapiPhoneNumberId: row.vapiPhoneNumberId }, history: { keep: true } }; },
  };
}

for (const [name, nextName] of paths) {
  test(`${name} rejects a freshly repaired target before any external or local mutation`, async () => {
    const f = fixture(); f.protect(); const before = structuredClone(f.store);
    const operation = load(name, nextName, f.deps);
    await assert.rejects(operation({ targetIds: [f.targetId], targetId: f.targetId, apply: true, cleanupOnly: true }),
      { code: 'ASSOCIATION_HISTORY_PROTECTED' });
    assert.deepEqual(f.actions, []); assert.deepEqual(f.store, before);
  });
  test(`${name} reserves targets across provider awaits and releases reservation on failure`, async () => {
    const f = fixture(); let entered, resume;
    const started = new Promise(resolve => { entered = resolve; });
    const blocked = new Promise(resolve => { resume = resolve; });
    f.deps.cancelStripeSubscriptionIfPresent = async () => { entered(); await blocked; throw Error('inert provider failure'); };
    const operation = load(name, nextName, f.deps);
    const running = operation({ targetIds: [f.targetId], targetId: f.targetId, apply: true, cleanupOnly: true });
    await started;
    assert.throws(() => f.fence.hold([f.row.signupAttemptId]), { code: 'ASSOCIATION_REPAIR_BUSY' });
    await assert.rejects(operation({ targetIds: [f.targetId], targetId: f.targetId, apply: true, cleanupOnly: true }),
      { code: 'ASSOCIATION_REPAIR_BUSY' });
    resume(); await assert.rejects(running, /inert provider failure/);
    f.fence.hold([f.row.signupAttemptId]); f.fence.release([f.row.signupAttemptId]);
    assert.deepEqual(f.actions, []);
  });
  test(`${name} still permits an unprotected lifecycle and preserves unrelated rows`, async () => {
    const f = fixture(), operation = load(name, nextName, f.deps);
    await operation({ targetIds: [f.targetId], targetId: f.targetId, apply: true, cleanupOnly: true });
    assert.ok(f.actions.includes('cancel')); assert.ok(f.actions.includes('twilio')); assert.ok(f.actions.includes('dashboard'));
    assert.equal(f.store.target, undefined); assert.deepEqual(f.store.other, { note: 'preserve' });
    f.fence.hold([f.row.signupAttemptId]); f.fence.release([f.row.signupAttemptId]);
  });
}

for (const [name, nextName, plural] of [
  ['inspectSignupSetForDecommission', 'decommissionSignupSetAndRebuild', true],
  ['inspectFailedSuperdavesRebuildRollback', 'rollbackFailedSuperdavesRebuild', false],
]) test(`${name} rejects protected source or phantom during preflight, before provider reads`, async () => {
  for (const status of ['setup_error', 'superseded_duplicate']) {
    const f = fixture(); f.protect(); f.store.target.status = status;
    const inspect = load(name, nextName, { ...f.deps, listSignupDashboardRecords: () => [f.store.target],
      findSignupByOperationalTarget: () => f.store.target });
    await assert.rejects(inspect(plural ? { targetIds: [f.targetId] } : { targetId: f.targetId }),
      { code: 'ASSOCIATION_HISTORY_PROTECTED' });
    assert.deepEqual(f.actions, []);
  }
});

test('removal preflight refuses in-flight repairs and a mixed set without relaxing history protection', async () => {
  const f = fixture(); f.fence.hold([f.row.signupAttemptId]);
  await assert.rejects(f.fence.withRemovalGuard(() => f.store, [f.targetId], async () => { f.actions.push('must not run'); }),
    { code: 'ASSOCIATION_REPAIR_BUSY' });
  f.fence.release([f.row.signupAttemptId]); f.protect();
  assert.throws(() => f.fence.assertRemovalAllowed(f.store, [f.targetId, hashOperationalTarget(f.store.other)]),
    { code: 'ASSOCIATION_HISTORY_PROTECTED' });
  assert.throws(() => f.fence.check(f.store, {}), { code: 'ASSOCIATION_HISTORY_PROTECTED' });
  assert.deepEqual(f.actions, []);
});
