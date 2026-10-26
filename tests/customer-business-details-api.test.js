const { before, beforeEach, after, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const temporaryData = fs.mkdtempSync(path.join(os.tmpdir(), 'myaipa-business-editor-api-'));
Object.assign(process.env, { NODE_ENV: 'test', DISABLE_LOCAL_ENV_FILES: '1', DATA_DIR: temporaryData,
  DATABASE_URL: '', SECURITY_STATE_FORCE_DATABASE: 'false', ADMIN_SESSION_SECRET: 'synthetic-editor-session-secret-at-least-32',
  CUSTOMER_DASHBOARD_SESSION_SECRET: 'synthetic-editor-owner-secret-at-least-32', FORWARDING_SETUP_SECRET: 'synthetic-editor-setup-secret-at-least-32',
  VAPI_API_KEY: 'synthetic-vapi', VAPI_API_BASE_URL: 'https://provider.invalid', STRIPE_SECRET_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '',
  TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', TWILIO_API_KEY_SID: '', TWILIO_API_KEY_SECRET: '',
  MAKE_SIGNUP_WEBHOOK_URL: '', SMTP_HOST: '', SMTP_USER: '', SMTP_PASS: '', TRIAL_REMINDER_DISABLE: 'true',
  VAPI_AUTO_SYNC_ENABLED: 'false', MISSED_CALL_ALERT_ENABLED: 'false', DAILY_DIGEST_ENABLED: 'false', SIGNUP_SETUP_WORKER_PAUSED: 'true' });
const { prisma } = require('../server/prisma');
const { signupKeyFor, createSetupToken } = require('../server/callForwardingService');
const { signupBusinessKey } = require('../server/signupBusinessIdentity');
const rows = new Map(), clone = value => JSON.parse(JSON.stringify(value));
prisma.$transaction = async callback => callback(prisma);
prisma.$queryRaw = async () => [];
prisma.runtimeStore.findUnique = async ({ where }) => rows.has(where.key) ? { key: where.key, data: clone(rows.get(where.key)) } : null;
prisma.runtimeStore.findMany = async ({ where }) => (where?.key?.in || []).filter(key => rows.has(key)).map(key => ({ key, data: clone(rows.get(key)) }));
prisma.runtimeStore.findFirst = async ({ where }) => {
  const key = (where?.key?.in || []).find(item => rows.has(item));
  return key ? { key, data: clone(rows.get(key)) } : null;
};
prisma.runtimeStore.upsert = async ({ where, create, update }) => { const data = clone(rows.has(where.key) ? update.data : create.data); rows.set(where.key, data); return { key: where.key, data }; };
prisma.runtimeStore.update = async ({ where, data }) => { assert.ok(rows.has(where.key)); rows.set(where.key, clone(data.data)); return { key: where.key, data: clone(data.data) }; };
const signup = { signupAttemptId: 'signup_editor_api', businessId: 17, businessName: 'Editor Electric', ownerEmail: 'editor@example.test',
  ownerPhone: '+19055550124', businessPhone: '+19055550123', twilioPhoneNumber: '+12895550199', vapiAssistantId: 'editor-assistant',
  vapiPhoneNumberId: 'editor-phone', forwardingSetupId: 'editor-setup', subscriptionStatus: 'trialing', status: 'setup_ready' };
const setup = { id: signup.forwardingSetupId, businessId: signup.businessId, existingBusinessNumber: signup.businessPhone, assignedMyAiPaNumber: signup.twilioPhoneNumber,
  vapiPhoneNumberId: signup.vapiPhoneNumberId, status: 'READY_TO_ACTIVATE', carrier: 'ROGERS', lineType: 'MOBILE', forwardingMode: 'NO_ANSWER' };
setup.signupKey = signupKeyFor({ signupId: signup.signupAttemptId, ownerEmail: signup.ownerEmail, existingBusinessNumber: signup.businessPhone });
const attempt = { eventKey: signup.signupAttemptId, ownerEmail: signup.ownerEmail, status: 'setup_ready', payload: {
  businessProfile: { businessName: signup.businessName, services: 'Panels' }, setupDetails: { serviceArea: 'Niagara', specializationNotes: 'Saved answer' } } };
prisma.signupAttempt.findUnique = async ({ where }) => where.eventKey === signup.signupAttemptId ? clone(attempt) : null;
prisma.callForwardingSetup.findUnique = async ({ where }) => (where.id === setup.id || where.signupKey === setup.signupKey) ? clone(setup) : null;
prisma.vapiBusinessMapping.findMany = async () => [
  { businessId: signup.businessId, matchType: 'assistantId', matchValue: signup.vapiAssistantId },
  { businessId: signup.businessId, matchType: 'phoneNumberId', matchValue: signup.vapiPhoneNumberId },
  { businessId: signup.businessId, matchType: 'phoneNumber', matchValue: signup.twilioPhoneNumber },
];
const { app, __test } = require('../server/index');
const nativeFetch = global.fetch;
let server, base, ownerCookie, token, assistant, providerRequests, phoneRecord, activeCalls;
const details = { businessName: 'Edited Electric', services: 'Panels and repairs', serviceAreas: 'Hamilton', businessNotes: 'Owner notes' };
const input = { requestId: 'editor-api-request', expectedRevision: 0, details };
const headers = () => ({ 'Content-Type': 'application/json', Origin: 'https://www.myaipa.ca', 'X-MyAIPA-Editor': '1',
  Authorization: `Forwarding ${token}`, Cookie: ownerCookie });

before(async () => {
  global.fetch = async (url, options = {}) => {
    if (new URL(String(url)).hostname === '127.0.0.1') return nativeFetch(url, options);
    assert.equal(new URL(String(url)).origin, 'https://provider.invalid', 'Never contact a real provider');
    providerRequests.push({ url: String(url), method: options.method || 'GET' });
    assert.ok(['GET', 'PATCH'].includes(options.method || 'GET'), 'No provider creates');
    let result;
    const resource = new URL(String(url)).pathname;
    if (resource === '/call') result = activeCalls;
    else if (resource === '/phone-number/editor-phone') result = phoneRecord;
    else if (resource === '/assistant/editor-assistant') {
      if (options.method === 'PATCH') assistant = { ...assistant, ...JSON.parse(options.body) };
      result = assistant;
    } else assert.fail(`Unexpected provider resource ${resource}`);
    return new Response(JSON.stringify(result), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  token = createSetupToken(setup);
  ownerCookie = `myaipa_customer_dashboard_session=${encodeURIComponent(__test.createCustomerDashboardSessionToken({ email: signup.ownerEmail, phone: signup.ownerPhone }))}`;
});
beforeEach(() => {
  rows.clear(); providerRequests = [];
  activeCalls = [];
  phoneRecord = { id: signup.vapiPhoneNumberId, number: signup.twilioPhoneNumber, assistantId: signup.vapiAssistantId };
  assistant = { id: signup.vapiAssistantId, name: 'stable-provider-name', firstMessage: 'Thanks for calling Editor Electric. How are you today?',
    model: { provider: 'openai', model: 'gpt-4o', toolIds: ['protected-tenant-tool'], messages: [{ role: 'system', content: '- Business name: Editor Electric\n- Service area: Niagara\n- Services: Panels\n## MYAIPA ISOLATED SMS ROUTING\nRecording and routing remain protected.' }] }, voice: { voiceId: 'stable' } };
  __test.upsertSignupDashboardRecord({ ...signup });
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  global.fetch = nativeFetch;
  await prisma.$disconnect();
  assert.equal(path.dirname(temporaryData), os.tmpdir());
  assert.ok(path.basename(temporaryData).startsWith('myaipa-business-editor-api-'));
  fs.rmSync(temporaryData, { recursive: true, force: true });
});

test('GET requires an owner session even with a valid forwarding token', async () => {
  const response = await fetch(`${base}/api/customer/dashboard/business-details`, { headers: { Authorization: `Forwarding ${token}` } });
  assert.equal(response.status, 401); assert.equal(providerRequests.length, 0);
});
test('trusted browser preflight permits credentialled PATCH with the scoped editor headers', async () => {
  const response = await fetch(`${base}/api/customer/dashboard/business-details`, { method: 'OPTIONS', headers: {
    Origin: 'https://www.myaipa.ca', 'Access-Control-Request-Method': 'PATCH',
    'Access-Control-Request-Headers': 'authorization,content-type,x-myaipa-editor',
  } });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://www.myaipa.ca');
  assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
  assert.match(response.headers.get('access-control-allow-methods'), /PATCH/);
  assert.match(response.headers.get('access-control-allow-headers'), /x-myaipa-editor/);
  assert.equal(providerRequests.length, 0);
});
test('GET requires a valid setup token even with a valid owner session', async () => {
  const response = await fetch(`${base}/api/customer/dashboard/business-details`, { headers: { Cookie: ownerCookie } });
  assert.equal(response.status, 401); assert.equal(providerRequests.length, 0);
});
test('GET returns original saved form answers, not provider credentials or internal prompt', async () => {
  const response = await fetch(`${base}/api/customer/dashboard/business-details`, { headers: headers() });
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.details.businessName, signup.businessName); assert.equal(body.details.businessNotes, 'Saved answer');
  assert.doesNotMatch(JSON.stringify(body), /synthetic|toolIds|system|ownerEmail/); assert.equal(providerRequests.length, 0);
});
test('PATCH rejects untrusted origin and missing non-simple editor header before provider access', async () => {
  for (const changed of [{ ...headers(), Origin: 'https://attacker.invalid' }, { ...headers(), 'X-MyAIPA-Editor': '' }]) {
    const response = await fetch(`${base}/api/customer/dashboard/business-details`, { method: 'PATCH', headers: changed, body: JSON.stringify(input) });
    assert.equal(response.status, 403);
  }
  assert.equal(providerRequests.length, 0);
});
test('PATCH rejects cross-business setup even if the same owner possesses its token', async () => {
  const wrong = { ...setup, businessId: 99 };
  const original = prisma.callForwardingSetup.findUnique;
  prisma.callForwardingSetup.findUnique = async () => wrong;
  try {
    const response = await fetch(`${base}/api/customer/dashboard/business-details`, { method: 'PATCH', headers: { ...headers(), Authorization: `Forwarding ${createSetupToken(wrong)}` }, body: JSON.stringify(input) });
    assert.equal(response.status, 403); assert.equal(providerRequests.length, 0);
  } finally { prisma.callForwardingSetup.findUnique = original; }
});
test('PATCH publishes a verified update in place and a replay makes no second provider request', async () => {
  const response = await fetch(`${base}/api/customer/dashboard/business-details`, { method: 'PATCH', headers: headers(), body: JSON.stringify(input) });
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.status, 'published'); assert.equal(body.revision, 1); assert.equal(assistant.id, signup.vapiAssistantId);
  assert.deepEqual(assistant.model.toolIds, ['protected-tenant-tool']); assert.deepEqual(assistant.voice, { voiceId: 'stable' });
  assert.equal(providerRequests.filter(item => item.method === 'PATCH').length, 1);
  const count = providerRequests.length;
  const replay = await fetch(`${base}/api/customer/dashboard/business-details`, { method: 'PATCH', headers: headers(), body: JSON.stringify(input) });
  assert.equal(replay.status, 200); assert.equal((await replay.json()).replayed, true); assert.equal(providerRequests.length, count);
});
test('PATCH refreshes both exact protected trial snapshot aliases without altering lifecycle or ownership', async () => {
  phoneRecord.assistantId = null; phoneRecord.server = { url: 'https://api.myaipa.ca/api/webhooks/voice' };
  const gate = { status: 'active', businessKey: signupBusinessKey(signup), signupAttemptId: signup.signupAttemptId, businessId: signup.businessId,
    assistantId: signup.vapiAssistantId, phoneNumberId: signup.vapiPhoneNumberId, phoneNumber: signup.twilioPhoneNumber,
    ownerEmail: signup.ownerEmail, fallbackPhone: signup.ownerPhone, assistantMaxSeconds: 300, assistantSnapshot: clone(assistant) };
  const keys = [`trial-voice-gate:phone-id:${signup.vapiPhoneNumberId}`, `trial-voice-gate:number:${signup.twilioPhoneNumber}`];
  for (const key of keys) rows.set(key, clone(gate));
  const response = await fetch(`${base}/api/customer/dashboard/business-details`, { method: 'PATCH', headers: headers(), body: JSON.stringify(input) });
  const body = await response.json(); assert.equal(response.status, 200, JSON.stringify(body)); assert.equal(body.status, 'published');
  for (const key of keys) {
    const saved = rows.get(key);
    assert.equal(saved.businessKey, gate.businessKey); assert.equal(saved.status, 'active'); assert.equal(saved.fallbackPhone, gate.fallbackPhone);
    assert.equal(saved.assistantId, gate.assistantId); assert.equal(saved.phoneNumberId, gate.phoneNumberId);
    assert.equal(saved.assistantContentFingerprint, rows.get('business-details:v1:17').contentFingerprint);
    assert.match(saved.assistantSnapshot.firstMessage, /Edited Electric/);
  }
  assert.deepEqual(rows.get(keys[0]), rows.get(keys[1]));
  assert.ok(providerRequests.every(item => item.method !== 'POST' && !(item.method === 'PATCH' && /phone-number/.test(item.url))));
});
test('PATCH refuses an active call without changing the provider or publishing a revision', async () => {
  activeCalls = [{ id: 'active-test-call', status: 'in-progress' }];
  const response = await fetch(`${base}/api/customer/dashboard/business-details`, { method: 'PATCH', headers: headers(), body: JSON.stringify(input) });
  assert.equal(response.status, 409); assert.equal(providerRequests.filter(item => item.method === 'PATCH').length, 0);
  assert.equal(rows.get('business-details:v1:17').revision, 0);
});
test('PATCH safely refuses mixed inline tools without replacing prompt, assistant or phone', async () => {
  assistant.model.tools = [{ type: 'endCall' }, { type: 'mcp', server: { url: 'https://tools.example.test/mcp' } }];
  const beforeAssistant = clone(assistant), beforePhone = clone(phoneRecord);
  const response = await fetch(`${base}/api/customer/dashboard/business-details`, { method: 'PATCH', headers: headers(), body: JSON.stringify(input) });
  assert.equal(response.status, 409); assert.equal(providerRequests.filter(item => item.method === 'PATCH').length, 0);
  assert.deepEqual(assistant, beforeAssistant); assert.deepEqual(phoneRecord, beforePhone);
  assert.equal(rows.get('business-details:v1:17').revision, 0);
});
