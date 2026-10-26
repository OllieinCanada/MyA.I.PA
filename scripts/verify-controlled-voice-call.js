// READ ONLY: this helper cannot create calls, texts, numbers or assistants.
const { loadProjectEnv } = require('./_helpers');
const { totpCode } = require('../server/adminSecurity');

function assess({ health, expectedRelease, after, call, phoneId, signup, savedCalls }) {
  const saved = savedCalls.filter(row => row.externalProvider === 'vapi' && row.externalId === call.id);
  const checks = {
    repairedRelease: health.ok === true && health.releaseCommit === expectedRelease,
    afterDeployment: Number.isFinite(Date.parse(after)) && Date.parse(call.createdAt) >= Date.parse(after),
    inbound: call.type === 'inboundPhoneCall',
    exactPhone: call.phoneNumberId === phoneId && signup.vapiPhoneNumberId === phoneId,
    exactAssistant: Boolean(signup.vapiAssistantId) && call.assistantId === signup.vapiAssistantId,
    conversationStarted: Boolean(call.startedAt),
    positiveConversationDuration: Date.parse(call.endedAt) > Date.parse(call.startedAt),
    normalEnding: /^(?:customer-ended-call|assistant-ended-call)$/.test(call.endedReason || ''),
    oneCanonicalRecord: saved.length === 1,
    correctBusiness: saved.length === 1 && Number(saved[0].businessId) === Number(signup.businessId),
    truthfulCompletedRecord: saved.length === 1 && saved[0].status === 'COMPLETED'
      && saved[0].endedReason === call.endedReason && Number(saved[0].durationSec) > 0,
  };
  return { verified: Object.values(checks).every(Boolean), callsSubmitted: 0, checks,
    scope: 'Inbound answering and canonical call persistence only; not a complete signup, intake, SMS or fallback outage test.' };
}

async function run({ argv = process.argv.slice(2), env = loadProjectEnv(), fetchImpl = fetch } = {}) {
  const allowed = new Set(['call-id', 'phone-id', 'business-id', 'release', 'after']);
  const opt = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !allowed.has(match[1])) throw Error('Only read-only verification arguments are accepted.');
    opt[match[1]] = match[2];
  }
  for (const key of ['call-id', 'phone-id']) if (!/^[a-f0-9-]{36}$/i.test(opt[key] || '')) throw Error(`An exact --${key} is required.`);
  if (!/^[a-f0-9]{40}$/.test(opt.release || '') || !/^[1-9]\d*$/.test(opt['business-id'] || '')
    || !Number.isFinite(Date.parse(opt.after))) throw Error('An exact release, business ID and post-deployment UTC --after timestamp are required.');
  for (const key of ['VAPI_API_KEY', 'ADMIN_PASSWORD']) if (!env[key]) throw Error(`${key} must be injected securely; never paste secret values into arguments.`);
  const request = async (url, headers = {}) => {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(`Read-only verification failed with HTTP ${response.status}.`);
    return response.json();
  };
  const api = 'https://api.myaipa.ca';
  const health = await request(`${api}/api/health/ready`);
  const call = await request(`https://api.vapi.ai/call/${opt['call-id']}`, { authorization: `Bearer ${env.VAPI_API_KEY}` });
  // Normal authentication creates an audit/session record, not a business or
  // provider mutation. No Twilio request or Vapi mutation exists in this file.
  const login = await fetchImpl(`${api}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: env.ADMIN_PASSWORD, ...(env.ADMIN_TOTP_SECRET ? { mfaCode: totpCode(env.ADMIN_TOTP_SECRET) } : {}) }), signal: AbortSignal.timeout(15000) });
  if (!login.ok) throw Error('Admin authentication failed. No call was placed.');
  const cookie = login.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const dashboard = await request(`${api}/api/admin/signups`, { cookie });
  const matches = (dashboard.signups || []).filter(signup => signup.vapiPhoneNumberId === opt['phone-id']
    && Number(signup.businessId) === Number(opt['business-id']) && !signup.archivedAt && !signup.supersededAt
    && signup.status === 'setup_ready');
  if (matches.length !== 1) throw Error('Exactly one current signup must own this phone and business.');
  const rows = await request(`${api}/api/admin/calls?businessId=${opt['business-id']}`, { cookie });
  return assess({ health, expectedRelease: opt.release, after: opt.after, call,
    phoneId: opt['phone-id'], signup: matches[0], savedCalls: rows.calls || [] });
}

if (require.main === module) run().then(result => { console.log(JSON.stringify(result, null, 2)); if (!result.verified) process.exitCode = 2; })
  .catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { assess, run };
