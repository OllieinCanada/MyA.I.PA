'use strict';
const crypto = require('node:crypto');
const { trackerRow } = require('./adminSignupTracker');
const { safeLabel, signupContext } = require('./signupAlerts');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fail = code => Object.assign(new Error('Signup diagnostic could not bind exact saved evidence.'), { code });
const validAttempt = value => /^signup_[a-f0-9]{32}$/.test(value || '');

// Deliberately accepts readers only: no recovery, provider or customer transport.
async function inspectSignup({ approval, list, readSetup, targetFor, now = () => Date.now() }) {
  const attemptId = approval?.context?.signupAttemptId;
  if (approval?.purpose !== 'SIGNUP_CHECK' || approval.decidedAction !== 'check'
    || approval.targetType !== 'signup' || !validAttempt(attemptId)) throw fail('SIGNUP_CHECK_SCOPE_INVALID');
  const exact = () => {
    const matches = list().filter(r => r.signupAttemptId === attemptId);
    if (matches.length !== 1 || targetFor(matches[0]) !== approval.targetId) throw fail('SIGNUP_CHECK_IDENTITY_CONFLICT');
    if (trackerRow(matches[0]).mode === 'closed') throw fail('SIGNUP_CHECK_CLOSED');
    return matches[0];
  };
  const record = exact(), before = digest(record);
  const setup = await readSetup(record);
  if (digest(exact()) !== before) throw fail('SIGNUP_CHECK_EVIDENCE_CHANGED');
  if (setup?.readOnly !== true || !Array.isArray(setup.groups)) throw fail('SIGNUP_CHECK_EVIDENCE_UNAVAILABLE');
  const row = trackerRow(record, now()), context = signupContext({ record });
  const blocked = setup.groups.flatMap(g => Array.isArray(g.checks) ? g.checks : []).filter(c => c.state === 'blocked');
  const code = /^[A-Z0-9_.:-]{3,100}$/.test(record.phoneProvisioningCode || '') ? record.phoneProvisioningCode : null;
  const report = {
    version: 1, checkedAt: new Date(now()).toISOString(), scope: 'saved_signup_evidence_only',
    attemptId, currentStep: row.currentStep, failedChecks: blocked.map(c => safeLabel(c.label)),
    reasonCode: code, cause: context.providerClassification?.reason || 'Cause not confirmed by the saved evidence.',
    coverage: setup.coverage || 'unknown', areaOrder: Array.isArray(setup.number?.areaOrder)
      ? setup.number.areaOrder.filter(c => /^[2-9]\d{2}$/.test(c)) : [],
    purchaseStatus: ['completed','processing','failed','invalidated'].includes(setup.number?.stage?.status)
      ? setup.number.stage.status : 'unknown',
    numberRecorded: Boolean(record.twilioPhoneNumber),
    assistantRecorded: Boolean(record.vapiAssistantId),
    uncertainPurchase: setup.number?.stage?.uncertain === true,
    liveProviderVerified: false, resumeAllowed: false,
    nextAction: 'Verify current provider ownership and purchase receipts before a separately approved bounded recovery. Do not repeat signup or buy another number.',
  };
  return { report, text: [
    'MY AI PA — SIGNUP CHECK (read-only)',
    `Business: ${safeLabel(record.businessName, 'Name unavailable', 100)}`,
    `Saved step: ${safeLabel(report.currentStep)}`,
    `Failed checks: ${report.failedChecks.join('; ') || 'No specific failed check proven; missing checks are not passes.'}`,
    `Recorded cause: ${safeLabel(report.cause, 'Unknown', 240)}${code ? ` (${code})` : ''}`,
    `Saved number: ${report.numberRecorded ? 'present' : 'not recorded'} · Saved assistant: ${report.assistantRecorded ? 'present' : 'not recorded'}`,
    `Saved area-code order: ${report.areaOrder.join(' → ') || 'unknown'} · Purchase receipt: ${report.purchaseStatus}`,
    `Receipt coverage: ${safeLabel(report.coverage)}${report.uncertainPurchase ? ' · Purchase outcome uncertain; inspect before retry.' : ''}`,
    `Checked: ${report.checkedAt}. Saved evidence only—not a live provider verification.`,
    `Next: ${report.nextAction}`,
    'No recovery, purchase, customer text, email or billing action was run.',
  ].join('\n') };
}
module.exports = { inspectSignup };
