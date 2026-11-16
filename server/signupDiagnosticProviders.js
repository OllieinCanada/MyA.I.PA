'use strict';

// Deliberately not a general HTTP client. Only these exact GET resources are
// admitted; never follow a provider-returned URL, redirect or pagination link.
const SID = /^AC[0-9a-f]{32}$/i;
const PN = /^PN[0-9a-f]{32}$/i;
const SM = /^SM[0-9a-f]{32}$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXECUTION = /^[a-zA-Z0-9]{32}$/;
const problem = code => Object.assign(new Error('Read-only provider evidence unavailable.'), { code });

function createProviderReader({ env = process.env, fetchImpl = fetch, now = Date.now,
  timeoutMs = 4000, budgetMs = 14000, maxReads = 8, maxBytes = 512000 } = {}) {
  const started = now(); let reads = 0;
  async function get(url, authorization) {
    if (++reads > maxReads) throw problem('READ_BUDGET_EXHAUSTED');
    const remaining = budgetMs - (now() - started);
    if (remaining <= 0) throw problem('READ_BUDGET_EXHAUSTED');
    const controller = new AbortController(); let timer;
    const expired = new Promise((_, reject) => { timer = setTimeout(() => {
      controller.abort(); reject(problem('READ_TIMEOUT'));
    }, Math.min(timeoutMs, remaining)); });
    try {
      return await Promise.race([expired, (async () => {
        const response = await fetchImpl(url, { method: 'GET', redirect: 'error',
          headers: { Authorization: authorization, Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) throw problem(response.status === 404 ? 'RESOURCE_NOT_FOUND'
          : [401,403].includes(response.status) ? 'PROVIDER_ACCESS_DENIED'
            : response.status === 429 ? 'PROVIDER_RATE_LIMITED' : 'PROVIDER_READ_FAILED');
        if (response.redirected) throw problem('PROVIDER_REDIRECT_REFUSED');
        if (!response.body?.getReader) throw problem('PROVIDER_RESPONSE_INVALID');
        const reader = response.body.getReader(); const chunks = []; let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read(); if (done) break;
            size += value.byteLength;
            if (size > maxBytes) throw problem('PROVIDER_RESPONSE_TOO_LARGE');
            chunks.push(Buffer.from(value));
          }
        } finally { try { await reader.cancel(); } catch { /* No retry. */ } }
        let body;
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { throw problem('PROVIDER_RESPONSE_INVALID'); }
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw problem('PROVIDER_RESPONSE_INVALID');
        return body;
      })()]);
    } finally { clearTimeout(timer); controller.abort(); }
  }
  function twilio(kind, id) {
    if (!SID.test(env.TWILIO_ACCOUNT_SID || '') || !env.TWILIO_AUTH_TOKEN) throw problem('PROVIDER_CONFIGURATION_MISSING');
    const pattern = kind === 'number' ? PN : kind === 'message' ? SM
      : kind === 'number-marker' ? /^myaipa-twilio-number-[a-f0-9]{20}$/ : null;
    if (!pattern?.test(id || '')) throw problem('RESOURCE_REFERENCE_MISSING');
    const resource = kind === 'number-marker' ? 'IncomingPhoneNumbers.json?FriendlyName='+encodeURIComponent(id)+'&PageSize=50'
      : `${kind === 'number' ? 'IncomingPhoneNumbers' : 'Messages'}/${id}.json`;
    return get(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/${resource}`,
      'Basic ' + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64'));
  }
  function vapi(kind, id) {
    if (!env.VAPI_API_KEY) throw problem('PROVIDER_CONFIGURATION_MISSING');
    if (!UUID.test(id || '') || !['assistant','phone-number'].includes(kind)) throw problem('RESOURCE_REFERENCE_MISSING');
    return get(`https://api.vapi.ai/${kind}/${id}`, 'Bearer ' + env.VAPI_API_KEY);
  }
  function make(scenarioId, executionId) {
    const base = String(env.MAKE_API_BASE_URL || 'https://us2.make.com/api/v2').replace(/\/$/, '');
    // Configured Make zones only; do not transmit credentials to arbitrary env URLs.
    if (!/^https:\/\/(?:us[12]|eu[12])\.make\.com\/api\/v2$/.test(base)) throw problem('PROVIDER_ORIGIN_REFUSED');
    const token = env.MAKE_AUDIT_API_TOKEN || env.MAKE_API_TOKEN;
    if (!token) throw problem('PROVIDER_CONFIGURATION_MISSING');
    if (!/^[1-9]\d{0,11}$/.test(String(scenarioId)) || !EXECUTION.test(executionId || '')) throw problem('EXECUTION_LINK_MISSING');
    return get(`${base}/scenarios/${scenarioId}/logs/${executionId}`, 'Token ' + token);
  }
  return { twilio, vapi, make, count: () => reads };
}
module.exports = { createProviderReader, PN, SM, UUID, problem };
