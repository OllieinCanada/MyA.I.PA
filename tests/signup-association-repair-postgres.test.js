const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeSignupProvisioningPayload, buildProvisioningResourceName } = require('../server/signupProvisioning');
const { buildMakeSignupEventKey } = require('../server/makeSignupWebhook');
const { PREFIX, createAssociationFence, createAssociationRepairService, atomicCommitAssociationFile } = require('../server/signupAssociationRepair');

test('real PostgreSQL serializes one journal, conditionally updates only association fields, and replays without writes',
  { skip: process.env.RUN_SIGNUP_ASSOCIATION_POSTGRES !== '1', timeout: 60000 }, async () => {
    const url = new URL(process.env.DATABASE_URL);
    assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    assert.ok(/^\/myaipa_recovery_drill_[a-z0-9_]+$/.test(url.pathname)
      || process.env.GITHUB_ACTIONS === 'true' && url.pathname === '/ci');
    const { PrismaClient } = require('@prisma/client'), prisma = new PrismaClient();
    const raw = { event: 'signup.completed', business: { name: 'Synthetic ' + crypto.randomUUID() },
      owner: { email: 'fixture@example.invalid', phone: '+19055550123' }, verification: { smsVerified: true, emailVerified: false } };
    const payload = normalizeSignupProvisioningPayload(raw, { signingSecret: 'isolated-postgres-association-only-secret' });
    const scope = { sourceId: buildMakeSignupEventKey(raw), phantomId: buildMakeSignupEventKey(payload), number: '+13655550123',
      twilioSid: 'PN' + 'a'.repeat(32), assistantId: 'fixture-assistant', phoneId: 'fixture-phone' };
    const source = { signupAttemptId: scope.sourceId, businessName: raw.business.name, ownerEmail: raw.owner.email,
      ownerPhone: raw.owner.phone, smsVerified: true, emailVerified: false, status: 'setup_error', agentTestStatus: 'failed' };
    const phantom = { signupAttemptId: scope.phantomId, ownerEmail: raw.owner.email, status: 'setup_started',
      twilioPhoneNumber: scope.number, vapiAssistantId: scope.assistantId, vapiPhoneNumberId: scope.phoneId, historyField: 'preserve exactly' };
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'association-postgres-')), file = path.join(directory, 'store.json');
    fs.writeFileSync(file, JSON.stringify({ source, phantom, other: { note: 'untouched' } }));
    let repairKey, fileWrites = 0;
    try {
      await prisma.signupAttempt.create({ data: { eventKey: scope.sourceId, publicId: crypto.randomUUID(), statusTokenHash: crypto.randomUUID(),
        businessName: raw.business.name, ownerEmail: raw.owner.email, ownerPhone: raw.owner.phone, payload: raw,
        status: 'setup_error', lastErrorCode: 'SYNTHETIC_OLD_ERROR', expiresAt: new Date(Date.now() + 60000) } });
      const readEvidence = async () => ({ sourceAttempt: await prisma.signupAttempt.findUnique({ where: { eventKey: scope.sourceId } }),
        phantomAttempt: null, otherAttempts: [], signatureVerified: true,
        context: { payload, signupEventKey: scope.sourceId, idempotencyKey: payload.provisioning.idempotencyKey, contextHash: payload.provisioning.contextHash },
        receipts: Object.fromEntries([['twilio-number', { twilioPhoneNumber: scope.number, sid: scope.twilioSid }], ['vapi-assistant', { assistantId: scope.assistantId }],
          ['vapi-import', { id: scope.phoneId, number: scope.number, assistantId: scope.assistantId }]]
          .map(([kind, result]) => [kind, { status: 'completed', contextHash: payload.provisioning.contextHash, result }])),
        provider: { twilio: { sid: scope.twilioSid, number: scope.number, name: buildProvisioningResourceName('twilio-number', payload.provisioning.idempotencyKey) },
          phone: { id: scope.phoneId, number: scope.number, assistantId: scope.assistantId }, assistant: { id: scope.assistantId } },
        reserveNumbers: ['+13655550101', '+13655550102', '+13655550103', '+13655550104', '+13655550105'] });
      const makeService = () => createAssociationRepairService({ prisma, readStore: () => JSON.parse(fs.readFileSync(file)),
        commitStore: project => { atomicCommitAssociationFile(file, project); fileWrites++; }, fence: createAssociationFence(),
        readEvidence, readDatabaseEvidence: async () => readEvidence(), enabled: () => true, singleWriter: () => true });
      const one = makeService(), two = makeService(), { plan } = await one.inspect(scope); repairKey = PREFIX + plan.repairId;
      const results = await Promise.allSettled([one.apply(scope, plan.planDigest, 'a'.repeat(64)), two.apply(scope, plan.planDigest, 'b'.repeat(64))]);
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(fileWrites, 1);
      const attempt = await prisma.signupAttempt.findUnique({ where: { eventKey: scope.sourceId } });
      assert.equal(attempt.assignedPhone, scope.number); assert.equal(attempt.vapiAssistantId, scope.assistantId);
      assert.equal(attempt.status, 'setup_error'); assert.equal(attempt.lastErrorCode, 'SYNTHETIC_OLD_ERROR'); assert.equal(attempt.completedAt, null);
      const saved = JSON.parse(fs.readFileSync(file)); assert.deepEqual(saved.phantom.resourceAssociationRepair.history, phantom);
      assert.deepEqual(saved.other, { note: 'untouched' }); assert.equal(saved.source.agentTestStatus, 'failed');
      assert.equal((await prisma.runtimeStore.findUnique({ where: { key: repairKey } })).data.phase, 'completed');
      assert.equal((await one.apply(scope, plan.planDigest, 'a'.repeat(64))).replayed, true); assert.equal(fileWrites, 1);
    } finally {
      // Exact synthetic keys only, on the explicitly isolated loopback database.
      if (repairKey) await prisma.runtimeStore.deleteMany({ where: { key: repairKey } });
      await prisma.signupAttempt.deleteMany({ where: { eventKey: scope.sourceId } });
      await prisma.$disconnect();
    }
  });
