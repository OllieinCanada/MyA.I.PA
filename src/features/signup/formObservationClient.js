const STORAGE_KEY = 'myaipa_signup_observation_v1';
const BUSINESS_IDS = Object.freeze({ ownerName: 'owner_name', businessName: 'business_name', phone: 'business_phone', email: 'business_email', streetAddress: 'street_address', city: 'city', province: 'province', postalCode: 'postal_code' });
export function observedBusinessFields({ details, validation, touched = {}, attemptedAdvance = false, visible = true }) {
  // Values are inspected only in this pure browser function. Only fixed IDs,
  // booleans and enum states leave it; never concatenate a value into metadata.
  return Object.entries(BUSINESS_IDS).map(([key, id]) => {
    const present = Boolean(String(details[key] || '').trim()), interacted = Boolean(touched[key] || attemptedAdvance);
    const invalid = interacted && Boolean(validation.errors[key]);
    return { id, presence: visible ? present ? 'present' : 'blank' : 'unknown', visible: visible ? 'visible' : 'hidden', required: true, interacted,
      validation: visible && interacted ? invalid ? 'invalid' : 'valid' : 'not_observed', reason: !visible || !interacted ? 'not_observed' : invalid ? present ? 'validation_failed' : 'required_missing' : 'none' };
  });
}
function observedField(id, present, { required = true, visible = true, interacted = false, valid = present } = {}) {
  const invalid = required ? !valid : false;
  return { id, presence: visible ? present ? 'present' : 'blank' : 'unknown', visible: visible ? 'visible' : 'hidden', required, interacted,
    validation: visible && interacted ? invalid ? 'invalid' : 'valid' : 'not_observed', reason: !visible || !interacted ? 'not_observed' : invalid ? present ? 'validation_failed' : 'required_missing' : 'none' };
}
export function observedFormSnapshot({ step, details, validation, touched = {}, attemptedAdvance = false, selectedTradeId, selectedSpecializationIds = [], selectedAreas = [], pricing = {}, humanVerified = false, wide = true }) {
  let fields = [];
  if (step === 'trade') fields = [observedField('trade_choice', Boolean(selectedTradeId), { interacted: Boolean(touched.trade_choice || attemptedAdvance) })];
  if (step === 'property_types') fields = [observedField('property_types', selectedSpecializationIds.length > 0, { interacted: Boolean(touched.property_types || attemptedAdvance) })];
  if (step === 'service_areas') fields = [observedField('service_areas', selectedAreas.length > 0, { interacted: Boolean(touched.service_areas || attemptedAdvance) })];
  if (step === 'business_details' || step === 'final_review') fields = observedBusinessFields({ details, validation, touched, attemptedAdvance, visible: step === 'business_details' || wide });
  if (step === 'pricing') {
    const choices = ['includeVisitFee', 'includeHourlyRate', 'includeAssessment', 'includePartsExtra', 'installationFreeEstimate'];
    fields = [observedField('pricing_choices', choices.some(key => pricing[key] === true), { required: false, interacted: Boolean(choices.some(key => touched[key]) || attemptedAdvance) }),
      ...[['visit_fee', 'includeVisitFee', 'repairVisitFee'], ['hourly_rate', 'includeHourlyRate', 'repairHourlyRate']].map(([id, choice, amount]) => {
        const visible = pricing[choice] === true, present = Boolean(String(pricing[amount] || '').trim());
        return observedField(id, present, { visible, required: visible, interacted: Boolean(visible && (touched[choice] || touched[amount] || attemptedAdvance)), valid: Number.isFinite(Number(pricing[amount])) && Number(pricing[amount]) > 0 });
      })];
  }
  if (step === 'final_review') fields.push(observedField('human_verification', Boolean(humanVerified), { interacted: Boolean(touched.human_verification || attemptedAdvance) }));
  return { currentStep: step, attemptedAdvance, fields };
}
export function observedSignupStep(currentStep, businessSlide, tradePanel) {
  if (currentStep === 3) return 'final_review';
  if (businessSlide === 1) return tradePanel === 'trade' ? 'trade' : 'property_types';
  return { 2: 'service_areas', 3: 'business_details', 4: 'pricing' }[businessSlide] || 'trade';
}
function pointerValid(value) { return value && /^fd_[0-9a-f-]{36}$/.test(value.id || '') && /^[A-Za-z0-9_-]{43}$/.test(value.token || '')
  && Number.isSafeInteger(value.revision) && value.revision >= 0 && Number.isSafeInteger(value.sequence) && value.sequence >= 0 && Number.isFinite(value.expiresAt); }
export function createFormObservationClient({ apiBase, storage, fetchImpl = (...args) => globalThis.fetch(...args), now = () => Date.now(), waitImpl = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  let pointer = null, pending = null, running = false, needsSync = true, lastSignature = '', retryAfter = 0, generation = 0;
  try { const saved = JSON.parse(storage?.getItem(STORAGE_KEY) || 'null'); if (pointerValid(saved) && saved.expiresAt > now()) pointer = saved; } catch (_) { /* Coverage remains unknown; no identity fallback. */ }
  const persist = () => { try { if (pointer) storage?.setItem(STORAGE_KEY, JSON.stringify({ id: pointer.id, token: pointer.token, revision: pointer.revision, sequence: pointer.sequence, expiresAt: pointer.expiresAt })); else storage?.removeItem(STORAGE_KEY); } catch (_) { /* Memory-only capability is allowed. */ } };
  async function request(path, options = {}) {
    const response = await fetchImpl(apiBase + path, { method: 'GET', cache: 'no-store', credentials: 'omit',
      headers: { 'Content-Type': 'application/json', 'X-MyAIPA-Form-Observation': '1', ...(pointer ? { Authorization: 'SignupDraft ' + pointer.token } : {}) },
      signal: AbortSignal.timeout(6000), ...options });
    let body; try { body = await response.json(); } catch (_) { body = {}; }
    return { response, body };
  }
  async function ready(currentGeneration) {
    if (pointer?.expiresAt <= now()) { pointer = null; lastSignature = ''; persist(); needsSync = true; }
    if (pointer && needsSync) {
      const { response, body } = await request('/api/signup/form-observation/' + pointer.id);
      if (currentGeneration !== generation) return false;
      if (response.ok && Number.isSafeInteger(body.revision) && Number.isSafeInteger(body.sequence)) { pointer = { ...pointer, revision: body.revision, sequence: body.sequence }; needsSync = false; persist(); }
      else if (response.status === 401) { pointer = null; lastSignature = ''; persist(); return false; }
      else return false;
    }
    if (!pointer) {
      if (now() < retryAfter) return false;
      const { response, body } = await request('/api/signup/form-observation', { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) });
      if (currentGeneration !== generation) return false;
      if (!response.ok || !pointerValid(body)) { retryAfter = now() + 30000; return false; }
      pointer = body; lastSignature = ''; needsSync = false; persist();
    }
    return true;
  }
  async function flush() {
    if (running) return; running = true; const currentGeneration = generation;
    try {
      while (pending && currentGeneration === generation) {
        const snapshot = pending; pending = null;
        if (!await ready(currentGeneration) || currentGeneration !== generation) continue;
        const signature = JSON.stringify(snapshot);
        if (signature === lastSignature) continue;
        const sequence = pointer.sequence + 1;
        const { response, body } = await request('/api/signup/form-observation/' + pointer.id, { method: 'PUT',
          body: JSON.stringify({ schemaVersion: 1, sequence, expectedRevision: pointer.revision, ...snapshot }) });
        if (currentGeneration !== generation) break;
        if (response.ok && Number.isSafeInteger(body.revision) && Number.isSafeInteger(body.sequence)) {
          pointer = { ...pointer, revision: body.revision, sequence: body.sequence }; persist();
          if (!body.ignored) lastSignature = signature;
          else needsSync = true;
        } else if (response.status === 401) { pointer = null; lastSignature = ''; persist(); pending = null; }
        else { needsSync = true; pending = null; }
        // An old/stale snapshot is never replayed automatically. Only a new
        // observation after fresh interaction can write at the new revision.
      }
    } catch (_) { if (currentGeneration === generation) { needsSync = true; pending = null; } }
    finally { running = false; if (pending && currentGeneration !== generation) void flush(); }
  }
  return {
    observe(snapshot, engaged) { if (!engaged) return Promise.resolve(); pending = snapshot; return flush(); },
    async link(access) {
      if (!pointer || !access?.id || !access?.token) return false;
      const currentGeneration = generation, draftId = pointer.id;
      const association = JSON.stringify({ attemptId: access.id, attemptToken: access.token });
      // This endpoint only associates existing metadata using both capabilities.
      // Replaying this exact association cannot submit signup, payment or SMS.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (currentGeneration !== generation || pointer?.id !== draftId || pointer.expiresAt <= now()) return false;
        try {
          const { response, body } = await request('/api/signup/form-observation/' + draftId + '/link', { method: 'POST', body: association });
          if (currentGeneration !== generation || pointer?.id !== draftId) return false;
          if (response.ok) return body.linked === true;
          if (![409, 500, 502, 503, 504].includes(response.status)) return false;
        } catch (_) { /* A lost metadata acknowledgement is safe to retry once. */ }
        if (attempt === 0 && currentGeneration === generation && pointer?.id === draftId) await waitImpl(500);
      }
      return false;
    },
    reset() { generation++; pending = null; pointer = null; lastSignature = ''; needsSync = true; persist(); },
    async settled() { while (running) await new Promise(resolve => setTimeout(resolve, 5)); },
  };
}
