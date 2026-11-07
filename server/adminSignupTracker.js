const crypto = require('node:crypto');
const { isClosedSignup } = require('./signupBusinessIdentity');
const { buildSignupProgress } = require('./signupProgress');
const { redactIncidentText } = require('./incidentAlerts');
const { isContactVerified } = require('./signupVerificationChannel');

const STALL_MS = 10 * 60 * 1000;
const EDIT_FIELDS = Object.freeze({ serviceSummary: 400, serviceArea: 160, businessWebsite: 300, businessAddress: 400, specializationNotes: 2000 });
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validAttempt = value => /^signup_[a-f0-9]{32}$/.test(String(value || ''));
const iso = value => { const n = Date.parse(value); return Number.isFinite(n) ? new Date(n).toISOString() : null; };
const fail = (message, code, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const validTracking = tracking => Boolean(tracking?.signature && iso(tracking.trackingStartedAt) && iso(tracking.timerStartedAt)
  && Number.isSafeInteger(tracking.revision) && tracking.revision > 0 && tracking.revision < Number.MAX_SAFE_INTEGER);
const episodeKey = tracking => hash({ signature: tracking.signature, revision: tracking.revision, timerStartedAt: tracking.timerStartedAt });
function requiredContactPending(record) {
  const smsDone = Boolean(record.smsVerified || record.smsVerifiedAt), emailDone = Boolean(record.emailVerified || record.emailVerifiedAt);
  return Boolean((record.smsVerificationRequired && !smsDone) || (record.emailVerificationRequired && !emailDone));
}

function activity(record = {}) {
  const status = String(record.status || '').toLowerCase();
  if (isClosedSignup(record) || record.supersededAt || record.canonicalSignupAttemptId) return 'closed';
  if (record.pausedAt || record.paused === true || record.intakePaused === true || /(?:^|_)paused(?:_|$)|suspended|cancelled|canceled|decommissioned/.test(status)
    || ['paused', 'canceled', 'cancelled', 'unpaid'].includes(String(record.subscriptionStatus || '').toLowerCase())) return 'paused';
  if (status === 'setup_ready' || status === 'business_exists') return 'ready';
  // Explicit allowlist: a paid/trial account or unknown legacy row is not an unfinished signup.
  if (!['signup_received', 'pending_verification', 'pending_email_verification', 'setup_started', 'setup_error', 'provisioning', 'provisioning_pending', 'provisioning_unknown', 'agent_testing', 'review_required', 'manual_review_reopened', 'checkout_started', 'checkout_completed', 'customer_followup_failed', 'customer_followup_partial'].includes(status)) return 'inactive';
  return /verification/.test(status) || requiredContactPending(record) ? 'waiting_customer' : 'working';
}
function checkpoint(record = {}) {
  const mode = activity(record);
  const progress = buildSignupProgress({ signup: record, channel: 'email',
    // Reuse the canonical verified-contact predicate, but never let a different
    // verified channel mask an explicitly required, still-pending channel.
    contactVerified: mode !== 'waiting_customer' && !requiredContactPending(record) && isContactVerified(record),
    ready: record.status === 'setup_ready' });
  const current = progress.steps.find(step => step.status === 'current');
  let label = current?.working || 'Setup checks';
  let nextAction = 'Inspect the existing setup and provider receipts; do not create another number or repeat signup.';
  if (mode === 'waiting_customer') { label = 'Waiting for contact verification'; nextAction = 'Check whether the verification message arrived. Contact the owner only after reviewing this signup.'; }
  else if (record.reviewRequired || /review/.test(record.status || '')) { label = 'Waiting for admin review'; nextAction = 'Review the exact signup and resolve its recorded blocker. Do not automatically approve or retry it.'; }
  else if (/error|failed|partial/.test(record.status || '')) label = `Needs attention · ${current?.working || 'checking setup'}`;
  if (mode === 'ready') label = 'Setup ready';
  if (mode === 'paused') label = 'Deliberately paused / inactive service';
  if (mode === 'closed') label = 'Closed or superseded';
  const code = String(record.phoneProvisioningCode || record.makeProviderCode || record.agentTestError || record.smsRoutingError || '').trim();
  return { mode, label, nextAction, progress, blockerCode: /^[A-Z0-9_.:-]{3,100}$/i.test(code) ? code : '' };
}
function progressSignature(record) {
  const c = checkpoint(record);
  // Poll timestamps, generic updatedAt, alert markers, profile edits and costs do not count.
  return hash({ mode: c.mode,
    checks: c.progress.steps.map(s => [s.key, s.status]),
    number: record.twilioPhoneNumber || '', assistant: record.vapiAssistantId || '',
    route: record.agentRouteBindingFingerprint || '', content: record.agentContentFingerprint || '' });
}
function trackProgress(previous = {}, next = {}, now = Date.now()) {
  const signature = progressSignature(next), prior = previous.onboardingTracker;
  const at = new Date(now).toISOString();
  if (prior?.signature === signature && validTracking(prior)) return prior;
  const isNew = !Object.keys(previous).length;
  const changed = Boolean(validTracking(prior) && prior.signature !== signature);
  return { signature, revision: (validTracking(prior) ? prior.revision : 0) + 1,
    trackingStartedAt: iso(prior?.trackingStartedAt) || at,
    lastProgressAt: changed || isNew ? at : null,
    timerStartedAt: at, timeBasis: changed || isNew ? 'observed_progress' : 'tracking_started',
    alertedRevision: null, alertQueuedAt: null };
}
function businessInfo(record = {}) {
  return Object.fromEntries(Object.keys(EDIT_FIELDS).map(key => [key, String(record[key] || '')]));
}
function infoRevision(record) { return hash(businessInfo(record)); }
function trackerRow(record, now = Date.now()) {
  const c = checkpoint(record), tracking = record.onboardingTracker || {};
  const timer = validTracking(tracking) && tracking.signature === progressSignature(record) ? iso(tracking.timerStartedAt) : null;
  const elapsedMs = timer ? Math.max(0, now - Date.parse(timer)) : null;
  const active = ['working', 'waiting_customer'].includes(c.mode);
  return { attemptId: record.signupAttemptId || '', businessId: record.businessId || null,
    businessName: String(record.businessName || 'Unnamed business'), ownerName: String(record.ownerName || ''),
    status: String(record.status || 'unknown'), mode: c.mode, active, currentStep: c.label, nextAction: c.nextAction,
    blockerCode: c.blockerCode, steps: c.progress.steps, completedSteps: c.progress.completed, totalSteps: c.progress.total,
    signedUpAt: iso(record.signedUpAt || record.createdAt), lastProgressAt: iso(tracking.lastProgressAt),
    trackingStartedAt: iso(tracking.trackingStartedAt), timerStartedAt: timer, timeBasis: tracking.timeBasis || 'unknown', elapsedMs,
    stalled: active && elapsedMs != null && elapsedMs >= STALL_MS,
    alertQueuedAt: validTracking(tracking) && record.onboardingStallAlertEpisode === episodeKey(tracking) ? iso(record.onboardingStallAlertQueuedAt) : null,
    editable: validAttempt(record.signupAttemptId) && !['closed', 'inactive'].includes(c.mode),
    info: businessInfo(record), infoRevision: infoRevision(record),
    publishing: 'admin_record_only', identityProtected: true };
}
function dashboard(records = [], now = Date.now()) {
  const rows = records.map(record => trackerRow(record, now));
  rows.sort((a, b) => Number(b.stalled) - Number(a.stalled) || Number(b.active) - Number(a.active) || (Date.parse(b.signedUpAt) || 0) - (Date.parse(a.signedUpAt) || 0));
  return { generatedAt: new Date(now).toISOString(), stallAfterMinutes: 10, pollIntervalSeconds: 60,
    summary: { active: rows.filter(r => r.active).length, stalled: rows.filter(r => r.stalled).length,
      waitingCustomer: rows.filter(r => r.mode === 'waiting_customer').length, ready: rows.filter(r => r.mode === 'ready').length }, rows };
}
function validateInfo(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !Object.hasOwn(EDIT_FIELDS, k))) throw fail('Only the listed business information fields can be edited.', 'SIGNUP_INFO_FIELD_FORBIDDEN');
  const result = {};
  for (const [key, limit] of Object.entries(EDIT_FIELDS)) {
    if (typeof input[key] !== 'string') throw fail('Supply all business information fields.', 'SIGNUP_INFO_INVALID');
    const value = input[key].normalize('NFKC').trim();
    if (value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw fail(`Check the length and characters in ${key}.`, 'SIGNUP_INFO_INVALID');
    result[key] = value;
  }
  if (result.businessWebsite) {
    let url; try { url = new URL(result.businessWebsite); } catch { throw fail('Enter a full https:// or http:// website address.', 'SIGNUP_INFO_WEBSITE_INVALID'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw fail('Use an http(s) website without credentials.', 'SIGNUP_INFO_WEBSITE_INVALID');
  }
  return result;
}
function updateInfo({ records, attemptId, input, save }) {
  if (!validAttempt(attemptId)) throw fail('This signup reference is invalid.', 'SIGNUP_INFO_ID_INVALID');
  if (!input || Object.keys(input).some(k => !['expectedRevision', 'details'].includes(k)) || !/^[a-f0-9]{64}$/.test(String(input.expectedRevision || ''))) throw fail('Reload the business information before saving.', 'SIGNUP_INFO_REVISION_REQUIRED');
  const matches = records.filter(r => r.signupAttemptId === attemptId);
  if (matches.length !== 1) throw fail('Exactly one canonical signup must match this reference.', 'SIGNUP_INFO_IDENTITY_CONFLICT', 409);
  const record = matches[0], row = trackerRow(record);
  if (!row.editable) throw fail('This signup is closed or unavailable for editing.', 'SIGNUP_INFO_CLOSED', 409);
  const details = validateInfo(input.details);
  if (infoRevision(record) !== input.expectedRevision) {
    if (hash(details) === infoRevision(record)) return { record, changedFields: [], replayed: true };
    throw fail('Another change was saved. Reload before editing again; your draft has not been overwritten.', 'SIGNUP_INFO_STALE', 409);
  }
  const changedFields = Object.keys(EDIT_FIELDS).filter(k => details[k] !== businessInfo(record)[k]);
  const saved = changedFields.length ? save({ ...record, ...details, adminBusinessInfoSavedAt: new Date().toISOString() }) : record;
  return { record: saved, changedFields, replayed: !changedFields.length };
}
function stallMessage(row, detectedAt) {
  const safe = s => redactIncidentText(String(s || ''), { maxLength: 160 }).replace(/[\r\n]+/g, ' ');
  return `MY AI PA — SIGNUP NEEDS ATTENTION\nBusiness: ${safe(row.businessName)}\nStep: ${safe(row.currentStep)}\nNo observed setup progress for at least 10 minutes as of ${detectedAt}.\n${row.mode === 'waiting_customer' ? 'Waiting on the customer is not proof of a technical failure. ' : ''}Next: ${safe(row.nextAction)}\nNo setup, text or payment was retried.`;
}
function applyTrackerChange(record, change, now = Date.now()) {
  if (record.signupAttemptId !== change.attemptId || !['working', 'waiting_customer'].includes(activity(record))) return record;
  if (change.kind === 'initialize') {
    const tracking = trackProgress(record, record, now);
    return tracking === record.onboardingTracker ? record : { ...record, onboardingTracker: tracking };
  }
  const tracking = record.onboardingTracker;
  if (change.kind !== 'alert_queued' || !validTracking(tracking) || episodeKey(tracking) !== change.expectedEpisode
    || progressSignature(record) !== tracking.signature) return record;
  return { ...record, onboardingStallAlertRevision: tracking.revision, onboardingStallAlertEpisode: change.expectedEpisode, onboardingStallAlertQueuedAt: change.detectedAt };
}
function createTrackerBatchSaver({ read, write, findKey, normalize = record => record, now = () => Date.now() }) {
  return changes => {
    const store = read(); let changed = 0;
    for (const change of changes) {
      const key = findKey(store, { signupAttemptId: change.attemptId });
      const current = key ? store[key] : null;
      if (!current || current.signupAttemptId !== change.attemptId) continue;
      const effective = normalize(current), next = applyTrackerChange(effective, change, now());
      if (next === effective) continue;
      store[key] = { ...current, onboardingTracker: next.onboardingTracker,
        ...(change.kind === 'alert_queued' ? { onboardingStallAlertEpisode: next.onboardingStallAlertEpisode,
          onboardingStallAlertRevision: next.onboardingStallAlertRevision, onboardingStallAlertQueuedAt: next.onboardingStallAlertQueuedAt } : {}) };
      changed++;
    }
    if (changed) write(store);
    return { changed };
  };
}
function createStallProcessor({ list, saveMany, enqueue, frontendUrl, now = () => Date.now(), yieldControl = () => new Promise(resolve => setImmediate(resolve)) }) {
  let running = false;
  return async function processSignupStalls() {
    if (running) return { skipped: true, reason: 'already_running' };
    running = true;
    try {
      let queued = 0, initialized = 0;
      const changes = [];
      await yieldControl();
      const records = list();
      await yieldControl();
      const counts = new Map();
      for (const record of records) counts.set(record.signupAttemptId, (counts.get(record.signupAttemptId) || 0) + 1);
      for (const initial of records) {
        if (counts.get(initial.signupAttemptId) !== 1) continue;
        if (!validAttempt(initial.signupAttemptId) || !['working', 'waiting_customer'].includes(activity(initial))) continue;
        // Bound alert/initialization work, and NEVER do per-record whole-store
        // reads/writes. saveMany performs one fresh, conditional metadata batch.
        if (queued + initialized >= 25) break;
        if (!validTracking(initial.onboardingTracker) || initial.onboardingTracker.signature !== progressSignature(initial)) {
          changes.push({ kind: 'initialize', attemptId: initial.signupAttemptId }); initialized++; continue;
        }
        const record = initial, row = trackerRow(record, now()), tracking = record.onboardingTracker;
        const episode = episodeKey(tracking);
        if (!row.stalled || record.onboardingStallAlertEpisode === episode) continue;
        const detectedAt = new Date(now()).toISOString();
        await yieldControl();
        const result = await enqueue({ text: stallMessage(row, detectedAt),
          adminUrl: `${String(frontendUrl).replace(/\/$/, '')}/#/admin?tab=signups`, buttonText: 'Open signup tracker',
          dedupeKey: `signup-stall:${record.signupAttemptId}:${episode}` });
        await yieldControl();
        if (!(result?.queued || result?.duplicate)) continue;
        changes.push({ kind: 'alert_queued', attemptId: record.signupAttemptId, expectedEpisode: episode, detectedAt });
        queued++;
      }
      if (changes.length) {
        await yieldControl();
        await saveMany(changes);
        await yieldControl();
      }
      return { queued, initialized };
    } finally { running = false; }
  };
}
function registerTrackerRoutes({ app, requireAdmin, isAllowedOrigin, list, save, audit, actorHash }) {
  const safelyAudit = async event => { try { return await audit(event) !== null; } catch { return false; } };
  app.get('/api/admin/signup-tracker', requireAdmin, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, ...dashboard(list()) });
  });
  app.patch('/api/admin/signups/:attemptId/business-info', requireAdmin, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      if (!req.headers.origin || !isAllowedOrigin(req.headers.origin) || req.headers['x-myaipa-admin-editor'] !== '1'
        || !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) throw fail('Open the signed-in admin editor before saving.', 'SIGNUP_INFO_ORIGIN_REQUIRED', 403);
      const result = updateInfo({ records: list(), attemptId: req.params.attemptId, input: req.body, save });
      const auditRecorded = await safelyAudit({ action: 'edit_signup_business_info', outcome: 'success', actorHash: actorHash(req), targetType: 'signup',
        targetId: hash(req.params.attemptId).slice(0, 24), details: { changedFields: result.changedFields, providerWrites: false, replayed: result.replayed } });
      res.json({ ok: true, row: trackerRow(result.record), replayed: result.replayed, publishedToReceptionist: false, auditRecorded });
    } catch (error) {
      const known = String(error.code || '').startsWith('SIGNUP_INFO_');
      await safelyAudit({ action: 'edit_signup_business_info', outcome: 'failed', actorHash: actorHash(req), targetType: 'signup',
        details: { code: known ? error.code : 'SIGNUP_INFO_SAVE_FAILED' } });
      res.status(known ? error.statusCode : 500).json({ error: known ? error.message : 'Business information could not be saved. Reload to check its current state.', code: known ? error.code : 'SIGNUP_INFO_SAVE_FAILED' });
    }
  });
}
module.exports = { STALL_MS, EDIT_FIELDS, activity, checkpoint, progressSignature, trackProgress, trackerRow, dashboard, businessInfo, infoRevision, validateInfo, updateInfo, stallMessage, createStallProcessor, applyTrackerChange, createTrackerBatchSaver, episodeKey, registerTrackerRoutes };
