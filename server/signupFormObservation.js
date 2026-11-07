// Metadata only. This namespace never receives form values or provider secrets.
const crypto = require('node:crypto');
const TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SLOTS = 2000;
const MAX_BYTES = 8192;
const PREFIX = 'signup-form-observation:v1:';
const BUSINESS_FIELDS = Object.freeze({ owner_name: 'Owner name', business_name: 'Business name', business_phone: 'Business phone', business_email: 'Business email', street_address: 'Street address', city: 'City', province: 'Province', postal_code: 'Postal code' });
const FIELDS = BUSINESS_FIELDS;
const STEPS = Object.freeze({ trade: { label: 'Trade', fields: [] }, property_types: { label: 'Property types', fields: [] }, service_areas: { label: 'Service areas', fields: [] },
  business_details: { label: 'Business details', fields: Object.keys(BUSINESS_FIELDS) }, pricing: { label: 'Service-call pricing', fields: [] }, final_review: { label: 'Final review', fields: [] } });
const REASONS = Object.freeze({ none: 'No validation issue observed', not_observed: 'Reason unknown / validation not observed', required_missing: 'Required field is blank', validation_failed: 'Does not pass this form’s validation' });
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
const fail = (code, status = 400) => Object.assign(new Error('Signup progress observation is unavailable.'), { code, statusCode: status });
const keysOnly = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(k => allowed.includes(k));
const idValid = id => /^fd_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(String(id || ''));
function slotFor(id, slots = MAX_SLOTS) { return parseInt(digest(id).slice(0, 8), 16) % slots; }
function keyFor(id, slots) { return PREFIX + String(slotFor(id, slots)).padStart(4, '0'); }
function safeEqual(a, b) { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function validateSnapshot(input) {
  if (!keysOnly(input, ['schemaVersion', 'sequence', 'expectedRevision', 'currentStep', 'attemptedAdvance', 'fields']) || input.schemaVersion !== 1
    || !Number.isSafeInteger(input.sequence) || input.sequence < 1 || input.sequence > 10000
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 || input.expectedRevision > 10000
    || !Object.hasOwn(STEPS, input.currentStep) || typeof input.attemptedAdvance !== 'boolean'
    || !Array.isArray(input.fields) || input.fields.length > Object.keys(FIELDS).length || Buffer.byteLength(JSON.stringify(input)) > MAX_BYTES) throw fail('FORM_OBSERVATION_INVALID');
  const seen = new Set(), allowed = STEPS[input.currentStep].fields;
  for (const field of input.fields) {
    if (!keysOnly(field, ['id', 'presence', 'visible', 'required', 'interacted', 'validation', 'reason']) || !allowed.includes(field.id) || seen.has(field.id)
      || !['unknown', 'blank', 'present'].includes(field.presence) || !['unknown', 'visible', 'hidden'].includes(field.visible)
      || typeof field.required !== 'boolean' || typeof field.interacted !== 'boolean' || !['not_observed', 'valid', 'invalid'].includes(field.validation)
      || !Object.hasOwn(REASONS, field.reason)) throw fail('FORM_OBSERVATION_INVALID');
    seen.add(field.id);
    if (!field.required) throw fail('FORM_OBSERVATION_INVALID');
    if (field.visible !== 'visible' && (field.presence !== 'unknown' || field.validation !== 'not_observed' || field.reason !== 'not_observed')) throw fail('FORM_OBSERVATION_INVALID');
    if (!field.interacted && (field.validation !== 'not_observed' || field.reason !== 'not_observed')) throw fail('FORM_OBSERVATION_INVALID');
    if (field.validation === 'invalid' && (!field.interacted || field.presence === 'unknown' || !['required_missing', 'validation_failed'].includes(field.reason))) throw fail('FORM_OBSERVATION_INVALID');
    if (field.validation === 'valid' && (!field.interacted || field.reason !== 'none' || (field.required && field.presence !== 'present'))) throw fail('FORM_OBSERVATION_INVALID');
    if (field.validation === 'not_observed' && field.reason !== 'not_observed') throw fail('FORM_OBSERVATION_INVALID');
    if (field.reason === 'required_missing' && (!field.required || field.presence !== 'blank' || field.visible !== 'visible')) throw fail('FORM_OBSERVATION_INVALID');
  }
  return input;
}
function projectObservation(record, now = Date.now()) {
  const step = record?.steps?.[record.currentStep];
  const fields = Object.entries(FIELDS).map(([id, label]) => {
    let found, foundStep;
    for (const [stepId, value] of Object.entries(record.steps || {})) { const f = value.fields?.find(item => item.id === id); if (f) { found = f; foundStep = stepId; } }
    const observedAt = found ? record.steps[foundStep].observedAt : null;
    return { id, label, presence: found?.presence || 'unknown', visibleAtObservation: found?.visible || 'unknown', currentStepVisible: foundStep === record.currentStep && found?.visible === 'visible',
      required: found?.required ?? null, interacted: found?.interacted ?? false, validation: found?.validation || 'not_observed', reason: found?.reason || 'not_observed', reasonLabel: REASONS[found?.reason] || REASONS.not_observed,
      observedAt, ageMs: observedAt ? Math.max(0, now - observedAt) : null };
  });
  const blockers = fields.filter(f => f.currentStepVisible && f.required && f.interacted && f.validation === 'invalid');
  return { id: record.id, linkedAttemptId: record.linkedAttemptId || null, identity: record.linkedAttemptId ? 'exact_attempt_link' : 'unsubmitted_visitor_unknown_identity',
    currentStep: record.currentStep, currentStepLabel: STEPS[record.currentStep]?.label || 'Not observed', revision: record.revision,
    engaged: Boolean(record.engaged), createdAt: record.createdAt, expiresAt: record.expiresAt, lastObservedAt: record.lastObservedAt || null,
    lastProgressAt: record.lastProgressAt || null, observedAgeMs: record.lastObservedAt ? Math.max(0, now - record.lastObservedAt) : null,
    coverage: { source: 'client_reported_metadata', instrumentedSteps: ['business_details'], observedFields: fields.filter(f => f.observedAt).length, totalFields: fields.length, notObservedIsNotBlank: true },
    fields, blockers, blockerLabels: blockers.map(f => `${f.label}: ${f.reasonLabel}`),
    stalled: Boolean(record.engaged && !record.completed && !record.linkedAttemptId && now - (record.lastProgressAt || record.createdAt) >= 600000),
    alertQueuedAt: record.alertedRevision === record.progressRevision ? record.alertQueuedAt || null : null };
}
function formObservationLines(row) {
  if (!row?.engaged) return ['Field-level coverage: not observed.'];
  const visible = row.fields.filter(f => f.currentStepVisible && (f.presence === 'blank' || f.validation === 'invalid'));
  const lines = visible.slice(0, 8).map(f => `${f.label}: ${f.presence === 'blank' ? 'visible blank' : 'invalid'}; ${f.interacted ? f.reasonLabel : 'untouched; reason unknown'}.`);
  return [...lines, `Field snapshot age: ${row.observedAgeMs == null ? 'unknown' : Math.floor(row.observedAgeMs / 60000) + ' min'}; ${row.coverage.observedFields}/${row.coverage.totalFields} instrumented fields observed. Unvisited/hidden fields are not assumed blank.`];
}
function createPrismaObservationStore(prisma) {
  return {
    get: async key => (await prisma.runtimeStore.findUnique({ where: { key } }))?.data || null,
    createIfExpired: async (key, record, cutoff) => {
      try { await prisma.runtimeStore.create({ data: { key, data: record, createdAt: new Date(record.createdAt) } }); return true; }
      catch (error) {
        if (error?.code !== 'P2002') throw error;
        return (await prisma.runtimeStore.updateMany({ where: { key, createdAt: { lte: new Date(cutoff) } },
          data: { data: record, createdAt: new Date(record.createdAt), updatedAt: new Date(record.createdAt) } })).count === 1;
      }
    },
    compareSwap: async (key, previous, next) => (await prisma.runtimeStore.updateMany({ where: { key, data: { equals: previous } }, data: { data: next } })).count === 1,
    list: async (cutoff, limit) => (await prisma.runtimeStore.findMany({ where: { key: { startsWith: PREFIX }, createdAt: { gt: new Date(cutoff) } }, orderBy: { updatedAt: 'desc' }, take: limit })).map(row => row.data),
    listByAttempt: async (attemptId, cutoff) => (await prisma.runtimeStore.findMany({ where: { key: { startsWith: PREFIX }, createdAt: { gt: new Date(cutoff) }, data: { path: ['linkedAttemptId'], equals: attemptId } }, orderBy: { updatedAt: 'desc' }, take: 2 })).map(row => row.data),
    purgeExpired: async cutoff => prisma.runtimeStore.deleteMany({ where: { key: { startsWith: PREFIX }, createdAt: { lte: new Date(cutoff) } } }),
  };
}
function createObservationService({ store, authenticateAttempt, now = () => Date.now(), slots = MAX_SLOTS, uuid = crypto.randomUUID, tokenBytes = () => crypto.randomBytes(32).toString('base64url') }) {
  let processingStalls = false;
  async function authenticate(id, token) {
    if (!idValid(id) || !/^[A-Za-z0-9_-]{43}$/.test(String(token || ''))) throw fail('FORM_OBSERVATION_UNAUTHORIZED', 401);
    const row = await store.get(keyFor(id, slots));
    if (!row || row.id !== id || row.expiresAt <= now() || !safeEqual(row.tokenHash, digest(token))) throw fail('FORM_OBSERVATION_UNAUTHORIZED', 401);
    return row;
  }
  async function create() {
    await store.purgeExpired(now() - TTL_MS);
    for (let attempt = 0; attempt < 8; attempt++) {
      const id = 'fd_' + uuid(), token = tokenBytes(), createdAt = now();
      const record = { schemaVersion: 1, id, tokenHash: digest(token), createdAt, expiresAt: createdAt + TTL_MS,
        sequence: 0, revision: 0, progressRevision: 0, currentStep: 'unknown', engaged: false, steps: {}, linkedAttemptId: null };
      if (await store.createIfExpired(keyFor(id, slots), record, createdAt - TTL_MS)) return { id, token, revision: 0, sequence: 0, expiresAt: record.expiresAt };
    }
    throw fail('FORM_OBSERVATION_CAPACITY', 503);
  }
  async function read(id, token) { const record = await authenticate(id, token); return { revision: record.revision, sequence: record.sequence, expiresAt: record.expiresAt }; }
  async function observe(id, token, input) {
    validateSnapshot(input); const previous = await authenticate(id, token);
    if (input.sequence <= previous.sequence) return { revision: previous.revision, sequence: previous.sequence, ignored: 'stale_sequence' };
    if (input.expectedRevision !== previous.revision) throw fail('FORM_OBSERVATION_STALE', 409);
    const engaged = previous.engaged || input.attemptedAdvance || input.fields.some(f => f.interacted);
    if (!engaged) return { revision: previous.revision, sequence: previous.sequence, ignored: 'not_engaged' };
    const signature = digest(JSON.stringify({ currentStep: input.currentStep, fields: input.fields }));
    const meaningful = signature !== previous.signature;
    const at = now(), next = { ...previous, sequence: input.sequence, revision: previous.revision + 1, engaged,
      currentStep: input.currentStep, lastObservedAt: at, signature,
      lastProgressAt: meaningful ? at : previous.lastProgressAt, progressRevision: meaningful ? previous.progressRevision + 1 : previous.progressRevision,
      steps: { ...previous.steps, [input.currentStep]: { observedAt: at, attemptedAdvance: input.attemptedAdvance, fields: input.fields } } };
    if (Buffer.byteLength(JSON.stringify(next)) > MAX_BYTES) throw fail('FORM_OBSERVATION_INVALID');
    if (!await store.compareSwap(keyFor(id, slots), previous, next)) throw fail('FORM_OBSERVATION_STALE', 409);
    return { revision: next.revision, sequence: next.sequence, expiresAt: next.expiresAt };
  }
  async function link(id, token, input) {
    if (!keysOnly(input, ['attemptId', 'attemptToken']) || !/^attempt_[a-f0-9]{20}$/.test(String(input.attemptId || '')) || typeof input.attemptToken !== 'string' || input.attemptToken.length > 150) throw fail('FORM_OBSERVATION_LINK_INVALID');
    const record = await authenticate(id, token), attempt = await authenticateAttempt(input.attemptId, input.attemptToken);
    if (!/^signup_[a-f0-9]{32}$/.test(String(attempt?.eventKey || '')) || !Number.isFinite(new Date(attempt.expiresAt).getTime()) || new Date(attempt.expiresAt).getTime() <= now() || ['archived', 'rejected', 'superseded_duplicate'].includes(attempt.status)) throw fail('FORM_OBSERVATION_UNAUTHORIZED', 401);
    if (record.linkedAttemptId && record.linkedAttemptId !== attempt.eventKey) throw fail('FORM_OBSERVATION_LINK_CONFLICT', 409);
    if (!record.linkedAttemptId && !await store.compareSwap(keyFor(id, slots), record, { ...record, linkedAttemptId: attempt.eventKey })) throw fail('FORM_OBSERVATION_STALE', 409);
    return { linked: true };
  }
  async function listAdmin() {
    const records = await store.list(now() - TTL_MS, 201);
    return { rows: records.slice(0, 200).filter(r => r.expiresAt > now() && r.engaged).map(r => projectObservation(r, now())),
      coverage: { limit: 200, hasMore: records.length > 200, retentionHours: 24, identityNotInferred: true, clientReported: true } };
  }
  async function describeAttempt(attemptId) {
    if (!/^signup_[a-f0-9]{32}$/.test(String(attemptId || ''))) return null;
    const records = await store.listByAttempt(attemptId, now() - TTL_MS);
    const matches = records.filter(r => r.linkedAttemptId === attemptId && r.expiresAt > now() && r.engaged);
    matches.sort((a,b) => (b.lastObservedAt || 0) - (a.lastObservedAt || 0));
    return matches.length ? { ...projectObservation(matches[0], now()), browserSources: matches.length } : null;
  }
  async function processStalls({ enqueue, frontendUrl }) {
    if (processingStalls) return { queued: 0, skipped: 'already_running' };
    processingStalls = true;
    try {
    await store.purgeExpired(now() - TTL_MS);
    const records = await store.list(now() - TTL_MS, MAX_SLOTS); let queued = 0;
    for (const record of records) {
      if (queued >= 5) break;
      if (!record.engaged || record.linkedAttemptId || record.expiresAt <= now() || record.alertedRevision === record.progressRevision) continue;
      const row = projectObservation(record, now()); if (!row.stalled) continue;
      await new Promise(resolve => setImmediate(resolve));
      const result = await enqueue({ text: ['MY AI PA — UNSUBMITTED SIGNUP NEEDS ATTENTION', 'Identity: unknown; no business name or contact value collected.',
        `Reference: ${record.id.slice(-8)}`, `Step: ${row.currentStepLabel}`, 'No observed progress for at least 10 minutes.', ...formObservationLines(row), 'No signup, text, payment or provider action was retried.'].join('\n'),
        adminUrl: `${String(frontendUrl).replace(/\/$/, '')}/#/admin?tab=signups`, buttonText: 'Open signup tracker', dedupeKey: `signup-form-stall:${record.id}:${record.progressRevision}` });
      if (!(result?.queued || result?.duplicate)) continue;
      await store.compareSwap(keyFor(record.id, slots), record, { ...record, alertedRevision: record.progressRevision, alertQueuedAt: now() });
      queued++;
      await new Promise(resolve => setImmediate(resolve));
    }
    return { queued, source: 'client_reported_metadata', candidatesBound: MAX_SLOTS };
    } finally { processingStalls = false; }
  }
  return { create, read, observe, link, listAdmin, describeAttempt, processStalls, authenticate };
}
function registerObservationRoutes({ app, service, isAllowedOrigin, createLimiter, updateLimiter, requireAdmin }) {
  const origin = (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.headers.origin || !isAllowedOrigin(req.headers.origin) || req.headers['x-myaipa-form-observation'] !== '1' || !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) return res.status(403).json({ code: 'FORM_OBSERVATION_ORIGIN_REQUIRED', coverage: 'unavailable' });
    next();
  };
  const token = req => /^SignupDraft [A-Za-z0-9_-]{43}$/.test(String(req.headers.authorization || '')) ? String(req.headers.authorization).slice(12) : '';
  const run = handler => async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try { res.json({ ok: true, ...await handler(req) }); }
    catch (error) { const known = /^FORM_OBSERVATION_/.test(String(error.code || '')); res.status(known ? error.statusCode : 503).json({ ok: false, code: known ? error.code : 'FORM_OBSERVATION_UNAVAILABLE', coverage: 'unavailable' }); }
  };
  app.post('/api/signup/form-observation', createLimiter, origin, run(req => {
    if (!keysOnly(req.body, ['schemaVersion']) || req.body.schemaVersion !== 1) throw fail('FORM_OBSERVATION_INVALID');
    return service.create();
  }));
  app.get('/api/signup/form-observation/:id', updateLimiter, run(req => service.read(req.params.id, token(req))));
  app.put('/api/signup/form-observation/:id', updateLimiter, origin, run(req => service.observe(req.params.id, token(req), req.body)));
  app.post('/api/signup/form-observation/:id/link', updateLimiter, origin, run(req => service.link(req.params.id, token(req), req.body)));
  app.get('/api/admin/signup-form-observations', requireAdmin, run(() => service.listAdmin()));
}
function observationBodyGuard({ jsonParser, isAllowedOrigin, createLimiter, updateLimiter }) {
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const limiter = req.method === 'POST' && (req.path === '/' || req.path === '') ? createLimiter : updateLimiter;
    return limiter(req, res, () => {
      if (Object.keys(req.query || {}).length) return res.status(400).json({ code: 'FORM_OBSERVATION_INVALID', coverage: 'unavailable' });
      if (req.method === 'GET') return next();
      if (!req.headers.origin || !isAllowedOrigin(req.headers.origin) || req.headers['x-myaipa-form-observation'] !== '1'
        || !/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type'] || ''))) return res.status(403).json({ code: 'FORM_OBSERVATION_ORIGIN_REQUIRED', coverage: 'unavailable' });
      return jsonParser(req, res, error => {
        // Never pass parser errors (which may contain a body fragment) to the
        // application's general error logger/incident pipeline.
        if (error) return res.status(error.status === 413 ? 413 : 400).json({ code: 'FORM_OBSERVATION_INVALID', coverage: 'unavailable' });
        next();
      });
    });
  };
}
module.exports = { TTL_MS, MAX_SLOTS, MAX_BYTES, PREFIX, FIELDS, STEPS, REASONS, slotFor, validateSnapshot, projectObservation, formObservationLines, createPrismaObservationStore, createObservationService, registerObservationRoutes, observationBodyGuard };
