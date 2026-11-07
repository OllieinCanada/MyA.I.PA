const STORAGE_KEY = 'myaipa_signup_observation_v1';
const BUSINESS_IDS = Object.freeze({ ownerName: 'owner_name', businessName: 'business_name', phone: 'business_phone', email: 'business_email', streetAddress: 'street_address', city: 'city', province: 'province', postalCode: 'postal_code' });
export function observedBusinessFields({ details, validation, touched = {}, attemptedAdvance = false }) {
  // Values are inspected only in this pure browser function. Only fixed IDs,
  // booleans and enum states leave it; never concatenate a value into metadata.
  return Object.entries(BUSINESS_IDS).map(([key, id]) => {
    const present = Boolean(String(details[key] || '').trim()), interacted = Boolean(touched[key] || attemptedAdvance);
    const invalid = interacted && Boolean(validation.errors[key]);
    return { id, presence: present ? 'present' : 'blank', visible: 'visible', required: true, interacted,
      validation: interacted ? invalid ? 'invalid' : 'valid' : 'not_observed', reason: !interacted ? 'not_observed' : invalid ? present ? 'validation_failed' : 'required_missing' : 'none' };
  });
}
export function observedSignupStep(currentStep, businessSlide, tradePanel) {
  if (currentStep === 3) return 'final_review';
  if (businessSlide === 1) return tradePanel === 'trade' ? 'trade' : 'property_types';
  return { 2: 'service_areas', 3: 'business_details', 4: 'pricing' }[businessSlide] || 'trade';
}
function pointerValid(value) { return value && /^fd_[0-9a-f-]{36}$/.test(value.id || '') && /^[A-Za-z0-9_-]{43}$/.test(value.token || '')
  && Number.isSafeInteger(value.revision) && value.revision >= 0 && Number.isSafeInteger(value.sequence) && value.sequence >= 0 && Number.isFinite(value.expiresAt); }
export function createFormObservationClient({ apiBase, storage, fetchImpl = fetch, now = () => Date.now() }) {
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
    if (pointer?.expiresAt <= now()) { pointer = null; persist(); needsSync = true; }
    if (pointer && needsSync) {
      const { response, body } = await request('/api/signup/form-observation/' + pointer.id);
      if (currentGeneration !== generation) return false;
      if (response.ok && Number.isSafeInteger(body.revision) && Number.isSafeInteger(body.sequence)) { pointer = { ...pointer, revision: body.revision, sequence: body.sequence }; needsSync = false; persist(); }
      else if (response.status === 401) { pointer = null; persist(); return false; }
      else return false;
    }
    if (!pointer) {
      if (now() < retryAfter) return false;
      const { response, body } = await request('/api/signup/form-observation', { method: 'POST', body: JSON.stringify({ schemaVersion: 1 }) });
      if (currentGeneration !== generation) return false;
      if (!response.ok || !pointerValid(body)) { retryAfter = now() + 30000; return false; }
      pointer = body; needsSync = false; persist();
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
        } else if (response.status === 401) { pointer = null; persist(); pending = null; }
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
      try { const { response } = await request('/api/signup/form-observation/' + pointer.id + '/link', { method: 'POST', body: JSON.stringify({ attemptId: access.id, attemptToken: access.token }) }); return response.ok; } catch (_) { return false; }
    },
    reset() { generation++; pending = null; pointer = null; lastSignature = ''; needsSync = true; persist(); },
    async settled() { while (running) await new Promise(resolve => setTimeout(resolve, 5)); },
  };
}
