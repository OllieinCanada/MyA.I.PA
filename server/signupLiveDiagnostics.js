'use strict';
const crypto = require('node:crypto');
const { buildProvisioningAccountKey, buildProvisioningResourceName } = require('./signupProvisioning');
const { contextStoreKey, registeredSignupEventKey } = require('./signupProvisioningContext');
const { provisioningStateKey } = require('./provisioningState');
const { buildAgentTestFingerprint } = require('./signupAgentTesting');
const { fingerprintAssistantContent } = require('./signupAssistantVerification');
const { purchaseEvidence } = require('./signupPurchaseEvidence');
const { sanitizeMakeFailureEnvelope } = require('./makeSignupWebhook');
const { createProviderReader, PN, SM, UUID, problem } = require('./signupDiagnosticProviders');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validAttempt = id => /^signup_[a-f0-9]{32}$/.test(id || '');
const validNumber = n => /^\+1\d{10}$/.test(n || '');
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const check = (id, state, detail, source = 'Live provider GET', evidenceAt = null) => ({ id, state, detail, source, evidenceAt });
const UNKNOWN_CODES = new Set(['READ_BUDGET_EXHAUSTED','READ_TIMEOUT','RESOURCE_NOT_FOUND','PROVIDER_ACCESS_DENIED',
  'PROVIDER_RATE_LIMITED','PROVIDER_READ_FAILED','PROVIDER_REDIRECT_REFUSED','PROVIDER_RESPONSE_INVALID',
  'PROVIDER_RESPONSE_TOO_LARGE','PROVIDER_CONFIGURATION_MISSING','RESOURCE_REFERENCE_MISSING',
  'PROVIDER_ORIGIN_REFUSED','EXECUTION_LINK_MISSING','PROVIDER_IDENTITY_CONFLICT','INVENTORY_RESPONSE_INCOMPLETE','MULTIPLE_MARKER_MATCHES']);

async function readSource(prisma, record) {
  let key; try { key = buildProvisioningAccountKey(record.ownerEmail, record.ownerPhone, record.businessName); }
  catch { throw problem('EXACT_CONTEXT_UNAVAILABLE'); }
  const context = (await prisma.runtimeStore.findUnique({ where: { key: contextStoreKey(key) } }))?.data;
  let attempt; try { attempt = registeredSignupEventKey(context); } catch { throw problem('EXACT_CONTEXT_UNAVAILABLE'); }
  if (attempt !== record.signupAttemptId || context?.payload?.provisioning?.idempotencyKey !== key
    || !/^[a-f0-9]{64}$/.test(context?.contextHash || '')
    || context.contextHash !== context.payload.provisioning.contextHash) throw problem('EXACT_CONTEXT_UNAVAILABLE');
  const receipts = {};
  for (const kind of ['twilio-number','vapi-assistant','vapi-import']) {
    const data = (await prisma.runtimeStore.findUnique({ where: { key: provisioningStateKey(kind, key) } }))?.data;
    if (data && data.contextHash !== context.contextHash) throw problem('RECEIPT_CONTEXT_MISMATCH');
    receipts[kind] = data || null;
  }
  return { context, receipts };
}

function assertOwnership(value, businessId) {
  const claims = [value?.businessId, value?.metadata?.businessId].filter(x => x !== null && x !== undefined);
  if (claims.some(x => !Number.isSafeInteger(businessId) || String(x) !== String(businessId))) throw problem('PROVIDER_IDENTITY_CONFLICT');
}
function references(record, receipts) {
  const result = kind => receipts[kind]?.status === 'completed' ? receipts[kind].result || {} : {};
  const numberResult = result('twilio-number'), assistantResult = result('vapi-assistant'), phoneResult = result('vapi-import');
  const choose = values => {
    const ids = [...new Set(values.filter(x => x !== undefined && x !== null && x !== ''))];
    if (ids.some(x => typeof x !== 'string') || ids.length > 1) throw problem('SAVED_RESOURCE_CONFLICT');
    return ids[0] || '';
  };
  return { number: choose([record.twilioPhoneNumber, numberResult.phoneNumber, numberResult.twilioPhoneNumber, numberResult.phone_number]),
    sid: choose([numberResult.twilioSid, numberResult.sid]),
    assistantId: choose([record.vapiAssistantId, assistantResult.id, assistantResult.assistantId]),
    phoneId: choose([record.vapiPhoneNumberId, phoneResult.id, phoneResult.phoneNumberId]) };
}

// Only in-memory diagnostic throttling. No cache is a receipt, and this module
// has no write, provisioning, recovery, billing or sending capability.
function createSignupLiveDiagnostics({ prisma, list, env = process.env, fetchImpl = fetch, now = Date.now,
  cooldownMs = 30000, providerOptions = {} }) {
  const active = new Set(), recent = new Map();
  return async function inspect(attemptId) {
    if (!validAttempt(attemptId)) throw problem('SIGNUP_REFERENCE_INVALID');
    if (active.has(attemptId) || active.size >= 3 || now() - (recent.get(attemptId) ?? -Infinity) < cooldownMs) throw problem('DIAGNOSTIC_RATE_LIMITED');
    active.add(attemptId); recent.set(attemptId, now());
    if (recent.size > 500) recent.delete(recent.keys().next().value);
    try {
      const exact = () => {
        const rows = list(), matches = rows.filter(r => r.signupAttemptId === attemptId);
        if (matches.length !== 1 || /^(archived|deleted|decommissioned)$/.test(matches[0].status || '')) throw problem('SIGNUP_IDENTITY_CONFLICT');
        return JSON.parse(JSON.stringify(matches[0]));
      };
      const record = exact(), source = await readSource(prisma, record), before = digest({ record, source });
      const refs = references(record, source.receipts);
      const resourceFields = ['twilioPhoneNumber','vapiAssistantId','vapiPhoneNumberId',
        'smsVerificationMessageSid','agentTestOwnerMessageSid','agentTestCustomerMessageSid','setupFollowupSmsSid'];
      const messageFields = resourceFields.slice(3), messageIds = messageFields.map(f=>record[f]).filter(Boolean);
      if (new Set(messageIds).size !== messageIds.length) throw problem('SAVED_RESOURCE_CONFLICT');
      let markerNumber = '';
      // Historical/archived duplicates are not silently ignored: they may own
      // the same receipt. Diagnose the identity conflict before provider reads.
      const shared = () => list().some(r => r.signupAttemptId !== attemptId && (resourceFields.some(f => record[f] && r[f] === record[f])
        || (refs.number && r.twilioPhoneNumber === refs.number) || (refs.assistantId && r.vapiAssistantId === refs.assistantId)
        || (refs.phoneId && r.vapiPhoneNumberId === refs.phoneId) || (markerNumber && r.twilioPhoneNumber === markerNumber)
        || messageFields.some(f=>r[f] && messageIds.includes(r[f]))));
      if (shared()) throw problem('SIGNUP_RESOURCE_SHARED');
      const provider = createProviderReader({ env, fetchImpl, now, ...providerOptions });
      const observed = () => new Date(now()).toISOString();
      async function safe(id, fn) {
        try { const value = await fn(); return { ...value, checkedAt: observed() }; }
        catch (e) { return { ...check(id, 'unknown', UNKNOWN_CODES.has(e.code) ? e.code : 'EVIDENCE_UNAVAILABLE'), checkedAt: observed() }; }
      }
      const saved = purchaseEvidence(record, source.receipts, 'exact_context_and_saved_receipts');
      const groups = [{ id: 'saved', title: '1. Saved request and purchase outcome', checks: [
        check('context', 'verified', 'Exact signup attempt, registered context and receipt hashes match.', 'Saved records', stamp(source.context.updatedAt || source.context.registeredAt)),
        check('purchase', saved.receiptStatus === 'failed' ? 'failed' : saved.outcome === 'purchase_recorded' ? 'observed' : 'unknown',
          `${saved.recordedError}. ${saved.outcomeLabel}.`, 'Exact-context durable receipt', saved.evidenceAt),
      ] }];
      const number = await safe('number', async () => {
        if (!PN.test(refs.sid) || !validNumber(refs.number)) {
          if (refs.sid) throw problem('RESOURCE_REFERENCE_MISSING');
          const marker = buildProvisioningResourceName('twilio-number',source.context.payload.provisioning.idempotencyKey);
          if (source.context.payload.provisioning.resources?.twilioNumber !== marker) throw problem('RESOURCE_REFERENCE_MISSING');
          const inventory = await provider.twilio('number-marker',marker);
          if (!Array.isArray(inventory.incoming_phone_numbers) || !Object.hasOwn(inventory,'next_page_uri')
            || inventory.next_page_uri !== null || inventory.incoming_phone_numbers.length >= 50) throw problem('INVENTORY_RESPONSE_INCOMPLETE');
          const matches = inventory.incoming_phone_numbers.filter(x=>x.friendly_name===marker);
          if (matches.length>1) throw problem('MULTIPLE_MARKER_MATCHES');
          if (!matches.length) return check('number','unknown','No current number matched this setup’s deterministic provisioning marker. This is not proof that no historical purchase occurred.','Twilio filtered number GET');
          const match=matches[0];
          if (match.account_sid!==env.TWILIO_ACCOUNT_SID || !PN.test(match.sid || '') || !validNumber(match.phone_number)
            || (refs.number && refs.number!==match.phone_number)) throw problem('PROVIDER_IDENTITY_CONFLICT');
          if (list().some(r=>r.signupAttemptId!==attemptId && r.twilioPhoneNumber===match.phone_number)) throw problem('PROVIDER_IDENTITY_CONFLICT');
          markerNumber = match.phone_number;
          return check('number','observed',`A current number matches the exact server-generated provisioning marker (area ${match.phone_number.slice(2,5)}, ending ${match.phone_number.slice(-4)}). Saved purchase/assignment is incomplete; no association was changed.`,
            'Twilio filtered number GET',stamp(match.date_updated));
        }
        const value = await provider.twilio('number', refs.sid);
        if (value.sid !== refs.sid || value.account_sid !== env.TWILIO_ACCOUNT_SID || value.phone_number !== refs.number) throw problem('PROVIDER_IDENTITY_CONFLICT');
        return check('number', 'verified', 'Exact receipt number is currently owned by the configured Twilio account. This is not a new purchase or call test.', 'Twilio IncomingPhoneNumber GET', stamp(value.date_updated));
      });
      groups.push({ id: 'twilio', title: '2. Live Twilio number ownership', checks: [number] });
      const make = await safe('make', async () => {
        // No current webhook request ID (which may be a CDN trace) is promoted
        // into an execution ID. A server-saved exact attempt binding is needed.
        const link = source.context.makeExecution;
        if (link?.signupAttemptId !== attemptId || link.contextHash !== source.context.contextHash) throw problem('EXECUTION_LINK_MISSING');
        const value = (await provider.make(link.scenarioId, link.executionId)).scenarioLog;
        if (!value || value.id !== link.executionId || !stamp(value.timestamp)) throw problem('PROVIDER_IDENTITY_CONFLICT');
        return check('make', value.status === 3 ? 'failed' : value.status === 1 ? 'observed' : 'unknown',
          value.status === 3 ? 'The exactly linked Make execution reports an error. Saved failed-stage evidence is shown separately.'
            : value.status === 1 ? 'Make reports successful execution; this alone does not prove purchase, assistant readiness or delivery.' : 'Execution is active, waiting, warning or has an unknown status.',
          'Make exact execution GET', stamp(value.timestamp));
      });
      const envelope = sanitizeMakeFailureEnvelope({ failedStage: record.makeFailedStage, provider: record.makeFailureProvider, providerCode: record.makeProviderCode, providerStatus: record.makeProviderStatus });
      groups.push({ id: 'make', title: '3. Make execution and failed step', checks: [make,
        check('make-saved', envelope.failedStage ? 'observed' : 'unknown', envelope.failedStage ? `${envelope.failedStage}${/^\d{5}$/.test(envelope.providerCode || '') ? ' · provider code ' + envelope.providerCode : ''}${envelope.providerStatus ? ' · HTTP ' + envelope.providerStatus : ''}`
          : 'No exact failed-module reference saved. A Make request ID or timestamp is not an execution binding.', 'Saved signup response') ] });
      let liveAssistant;
      const assistant = await safe('assistant', async () => {
        if (!UUID.test(refs.assistantId)) throw problem('RESOURCE_REFERENCE_MISSING');
        liveAssistant = await provider.vapi('assistant', refs.assistantId);
        if (liveAssistant.id !== refs.assistantId) throw problem('PROVIDER_IDENTITY_CONFLICT');
        assertOwnership(liveAssistant, record.businessId);
        if (!record.agentContentFingerprint) return check('assistant', 'unknown', 'Referenced assistant exists; no saved script fingerprint is available for comparison.', 'Vapi assistant GET');
        const matches = fingerprintAssistantContent(liveAssistant) === record.agentContentFingerprint;
        return check('assistant', matches ? 'verified' : 'failed', matches ? 'Referenced assistant exists and its script fingerprint matches the saved setup.' : 'Live script differs from the saved verified script.', 'Vapi assistant GET', stamp(liveAssistant.updatedAt));
      });
      const route = await safe('route', async () => {
        if (!UUID.test(refs.phoneId) || !UUID.test(refs.assistantId) || !validNumber(refs.number)) throw problem('RESOURCE_REFERENCE_MISSING');
        const phone = await provider.vapi('phone-number', refs.phoneId);
        assertOwnership(phone, record.businessId);
        if (phone.id !== refs.phoneId || phone.number !== refs.number) throw problem('PROVIDER_IDENTITY_CONFLICT');
        if (!liveAssistant || liveAssistant.id !== refs.assistantId || assistant.state === 'unknown') return check('route', 'unknown', 'Phone found, but assistant ownership/content evidence is incomplete.');
        if (!phone.assistantId) return check('route', 'unknown', 'No direct assistant binding. Dynamic server routing requires a separate mapping check; not certified here.');
        return check('route', phone.assistantId === refs.assistantId ? 'verified' : 'failed', phone.assistantId === refs.assistantId
          ? 'The exact Vapi phone points directly to the saved assistant. This is not proof that a real call answers.' : 'The Vapi phone points to a different assistant.', 'Vapi phone-number GET', stamp(phone.updatedAt));
      });
      groups.push({ id: 'vapi', title: '4. Live Vapi assistant, script and route', checks: [assistant, route] });
      const expectedTest = buildAgentTestFingerprint({ assistantId: refs.assistantId, aiNumber: refs.number,
        ownerPhone: record.ownerPhone || record.businessPhone, contentFingerprint: record.agentContentFingerprint });
      const legs = [['verification','smsVerificationMessageSid', false],['owner-practice','agentTestOwnerMessageSid',true],
        ['customer-copy-practice','agentTestCustomerMessageSid',true],['completion','setupFollowupSmsSid',false]];
      const messages = [];
      for (const [id, field, practice] of legs) messages.push(await safe(id, async () => {
        const sid = record[field], to = record.ownerPhone || record.businessPhone;
        if (!SM.test(sid || '') || !validNumber(to)) throw problem('RESOURCE_REFERENCE_MISSING');
        if (practice && (!record.agentContentFingerprint || !expectedTest || record.agentTestFingerprint !== expectedTest)) return check(id, 'unknown', 'Practice receipt belongs to a missing or stale setup fingerprint.', 'Saved practice receipt');
        const value = await provider.twilio('message', sid);
        if (value.sid !== sid || value.account_sid !== env.TWILIO_ACCOUNT_SID || value.to !== to
          || (practice && value.from !== refs.number)) throw problem('PROVIDER_IDENTITY_CONFLICT');
        const status = value.status;
        const delivered = ['delivered','read'].includes(status), failed = ['failed','undelivered','canceled'].includes(status);
        const accepted = ['accepted','queued','sending','sent','scheduled'].includes(status);
        return check(id, delivered ? 'verified' : failed ? 'failed' : accepted ? 'observed' : 'unknown',
          delivered ? 'Provider reports delivered; not proof the person read it.' : failed ? `Provider reports failed/undelivered/canceled.${/^\d{5}$/.test(String(value.error_code || '')) ? ' Error code '+value.error_code+'.' : ''} No resend was attempted.`
            : accepted ? 'Provider accepted the message; delivery is not confirmed.' : 'Provider status is unrecognized; outcome remains unknown.',
          'Twilio exact message GET', stamp(value.date_updated));
      }));
      groups.push({ id: 'delivery', title: '5. Existing message delivery receipts', checks: messages });
      if (digest({ record: exact(), source: await readSource(prisma, exact()) }) !== before) throw problem('DIAGNOSTIC_EVIDENCE_CHANGED');
      if (shared()) throw problem('SIGNUP_RESOURCE_SHARED');
      const all = groups.flatMap(g => g.checks);
      return { version: 1, attemptId, readOnly: true, checkedAt: observed(), staleAfterMs: 60000,
        groups, providerReads: provider.count(), ready: false, resumeAllowed: false,
        state: all.some(c => c.state === 'failed') ? 'failed' : 'unknown',
        nextAction: all.some(c => c.state === 'failed') ? 'Review failed evidence before a separately approved bounded repair. Do not replay signup.'
          : 'Resolve unknown evidence. No overall readiness or recovery permission is implied.',
        limitations: 'Point-in-time GET results only. No inventory-wide absence claim, Make execution guessing, email delivery certification, live call proof or recovery. Practice copies go to the owner. No changes, purchases or sends.' };
    } finally { active.delete(attemptId); }
  };
}
module.exports = { createSignupLiveDiagnostics, readSource, references };
