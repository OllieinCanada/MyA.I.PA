const test = require('node:test');
const assert = require('node:assert/strict');
const { isDeepStrictEqual } = require('node:util');
const { signupKeyFor } = require('../server/callForwardingService');
const { EDITABLE_FIELDS, buildContentPatch, cleanDetails, identityFor, protectedDefinition,
  ownedReadyForwardingSetupUrl, publishedBusinessRevision, readBusinessDetails, readinessSignupForRevision, updateBusinessDetails } = require('../server/customerBusinessDetails');
const clone = value => JSON.parse(JSON.stringify(value));

function fixture() {
  const rows = new Map();
  let queue = Promise.resolve();
  const runtimeStore = {
    findUnique: async ({ where }) => rows.has(where.key) ? { key: where.key, data: clone(rows.get(where.key)) } : null,
    upsert: async ({ where, create, update }) => { const data = clone(rows.has(where.key) ? update.data : create.data); rows.set(where.key, data); return { key: where.key, data }; },
  };
  const prisma = { runtimeStore, $queryRaw: async () => [], $transaction: operation => {
    const run = queue.then(() => operation(prisma)); queue = run.catch(() => {}); return run;
  } };
  const signup = { signupAttemptId: 'signup_exact', businessId: 7, businessName: 'Old Electric', businessPhone: '+19055550123',
    ownerPhone: '+19055550124', ownerEmail: 'owner@example.test', vapiAssistantId: 'assistant-exact', vapiPhoneNumberId: 'phone-exact', twilioPhoneNumber: '+12895550199' };
  const setup = { id: 'setup-exact', businessId: 7, signupKey: signupKeyFor({ signupId: signup.signupAttemptId, ownerEmail: signup.ownerEmail, existingBusinessNumber: signup.businessPhone }),
    existingBusinessNumber: signup.businessPhone, assignedMyAiPaNumber: signup.twilioPhoneNumber, vapiPhoneNumberId: signup.vapiPhoneNumberId };
  const payload = { businessProfile: { businessName: signup.businessName, services: 'Repairs' }, setupDetails: { serviceArea: 'Niagara', specializationNotes: 'Old notes' } };
  let assistant = { id: signup.vapiAssistantId, name: 'provider-resource-name', firstMessage: 'Recording notice. Thanks for calling Old Electric.',
    model: { provider: 'openai', model: 'gpt-4o', temperature: 0.1, toolIds: ['tenant-protected', 'end-call'], messages: [
      { role: 'system', content: '- Business name: Old Electric\n- Service area: Niagara\n- Services: Repairs\nPricing stays protected.\n## MYAIPA ISOLATED SMS ROUTING\nNever change owner destinations. Consent is required.' },
    ] }, voice: { provider: 'voice', voiceId: 'keep-me' }, server: { url: 'https://api.example.test/webhook', secret: 'do-not-return' },
    recordingEnabled: true, transcriber: { provider: 'deepgram', model: 'nova-3' }, firstMessageMode: 'assistant-speaks-first' };
  const original = clone(assistant), requests = [], gatePublications = [];
  const state = { activeCalls: [], gate: null, phone: { id: signup.vapiPhoneNumberId, number: signup.twilioPhoneNumber, assistantId: signup.vapiAssistantId },
    failBeforePatch: false, failAfterPatch: false, tamperReadback: false, tamperInlineTools: false, lifecycleBlocked: false };
  const api = async (path, options = {}) => {
    requests.push({ path, method: options.method || 'GET', body: options.body && clone(options.body) });
    assert.notEqual(options.method, 'POST', 'Never create a provider resource');
    if (path.startsWith('call?')) return clone(state.activeCalls);
    if (path === `phone-number/${signup.vapiPhoneNumberId}`) return clone(state.phone);
    assert.equal(path, `assistant/${signup.vapiAssistantId}`);
    if (options.method === 'PATCH') {
      if (state.failBeforePatch) throw new Error('Provider unavailable with a secret provider detail');
      assistant = { ...assistant, ...clone(options.body), updatedAt: new Date().toISOString() };
      if (state.tamperReadback) assistant.model.toolIds = ['wrong-tenant'];
      if (state.tamperInlineTools) assistant.model.tools = [{ type: 'endCall' }];
      if (state.failAfterPatch) throw new Error('Connection lost after accepted PATCH');
    }
    return clone(assistant);
  };
  const details = { businessName: 'New Electric', services: 'Repairs and panels', serviceAreas: 'Hamilton and Niagara', businessNotes: 'No roof work.' };
  const input = { requestId: 'request-0001', expectedRevision: 0, details };
  const context = { prisma, signup, setup, payload, api, gateWebhookUrl: 'https://api.example.test/trial',
    assertLifecycle: async () => { if (state.lifecycleBlocked) throw Object.assign(new Error('Paused'), { statusCode: 409, code: 'BUSINESS_EDITOR_LIFECYCLE_BLOCKED' }); },
    readGate: async () => state.gate,
    publishGate: async value => { gatePublications.push(value); },
  };
  return { ...context, context, input, details, rows, original, requests, state, gatePublications,
    assistant: () => clone(assistant), setAssistant: value => { assistant = clone(value); } };
}

test('prefills only allowed saved fields and never exposes private journal/provider data', async () => {
  const f = fixture();
  const result = await readBusinessDetails(f);
  assert.equal(result.revision, 0); assert.equal(result.details.businessName, 'Old Electric');
  assert.equal(result.details.businessNotes, 'Old notes'); assert.deepEqual(result.editableFields, EDITABLE_FIELDS);
  assert.doesNotMatch(JSON.stringify(result), /secret|token|toolIds|ownerEmail/);
});
test('requires exact owner/setup/business/phone binding, not an email-only relationship', () => {
  const f = fixture();
  for (const setup of [{ ...f.setup, businessId: 8 }, { ...f.setup, vapiPhoneNumberId: 'another' },
    { ...f.setup, assignedMyAiPaNumber: '+12895550198' }, { ...f.setup, existingBusinessNumber: '+19055550122' }]) {
    assert.throws(() => identityFor(f.signup, setup), error => error.statusCode === 403);
  }
  assert.throws(() => identityFor({ ...f.signup, archivedAt: 'now' }, f.setup), /does not belong/);
  assert.throws(() => identityFor({ ...f.signup, forwardingSetupId: 'new-setup' }, f.setup), /does not belong/);
  assert.throws(() => identityFor(f.signup, { ...f.setup, signupKey: 'stale-attempt' }), /does not belong/);
});
test('strictly rejects provider IDs, pricing, phone changes, malformed fields and marker injection', () => {
  const f = fixture();
  for (const extra of [{ ownerPhone: '+19055550199' }, { assistantId: 'other' }, { pricing: {} }, { model: {} }]) {
    assert.throws(() => cleanDetails({ ...f.details, ...extra }), /Only business/);
  }
  assert.throws(() => cleanDetails({ ...f.details, businessName: 'line\nbreak' }), /one line/);
  assert.throws(() => cleanDetails({ ...f.details, businessNotes: 'x'.repeat(4001) }), /length/);
  assert.throws(() => cleanDetails({ ...f.details, businessNotes: '## MYAIPA VERIFIED BUSINESS DETAILS v1' }), /length/);
});
test('normalizes before validating both reserved markers and expanded character lengths', () => {
  const f = fixture();
  const fullwidth = value => [...value].map(character => /[!-~]/.test(character)
    ? String.fromCharCode(character.charCodeAt(0) + 0xfee0) : character).join('');
  for (const marker of ['## MYAIPA VERIFIED BUSINESS DETAILS v1', '## END MYAIPA VERIFIED BUSINESS DETAILS']) {
    assert.equal(fullwidth(marker).normalize('NFKC'), marker);
    assert.throws(() => cleanDetails({ ...f.details, businessNotes: fullwidth(marker) }), error => error.code === 'BUSINESS_DETAILS_INVALID');
  }
  // One ligature expands to three letters; raw length alone would accept it.
  assert.throws(() => cleanDetails({ ...f.details, businessName: '\ufb03'.repeat(47) }), /length/);
  assert.throws(() => cleanDetails({ ...f.details, businessNotes: '\ufb03'.repeat(1400) }), /length/);
});
test('updates the exact existing assistant once, preserving protected configuration and original signup', async () => {
  const f = fixture(), originalSignup = clone(f.signup), originalPayload = clone(f.payload);
  const response = await updateBusinessDetails({ ...f.context, input: f.input });
  assert.equal(response.status, 'published'); assert.equal(response.revision, 1); assert.deepEqual(response.details, f.details);
  assert.equal(f.requests.filter(item => item.method === 'PATCH').length, 1);
  assert.ok(f.requests.every(item => item.method === 'GET' || (item.method === 'PATCH' && item.path === 'assistant/assistant-exact')));
  assert.deepEqual(protectedDefinition(f.assistant()), protectedDefinition(f.original));
  assert.match(f.assistant().firstMessage, /Recording notice.*New Electric/);
  const prompt = f.assistant().model.messages[0].content;
  assert.match(prompt, /No roof work/); assert.match(prompt, /Pricing stays protected/);
  assert.ok(prompt.indexOf('VERIFIED BUSINESS DETAILS') < prompt.indexOf('ISOLATED SMS ROUTING'));
  assert.deepEqual(f.signup, originalSignup); assert.deepEqual(f.payload, originalPayload);
  assert.equal(f.gatePublications[0].gate, null);
});
test('a successful repeated save returns its receipt without more provider requests', async () => {
  const f = fixture();
  await updateBusinessDetails({ ...f.context, input: f.input }); const count = f.requests.length;
  const replay = await updateBusinessDetails({ ...f.context, input: f.input });
  assert.equal(replay.replayed, true); assert.equal(replay.revision, 1); assert.equal(f.requests.length, count);
  await assert.rejects(updateBusinessDetails({ ...f.context, input: { ...f.input, details: { ...f.details, services: 'Different' } } }), /identifier/);
});
test('stale revisions and forbidden top-level fields cannot touch providers', async () => {
  const f = fixture();
  await assert.rejects(updateBusinessDetails({ ...f.context, input: { ...f.input, expectedRevision: 9 } }), error => error.code === 'BUSINESS_EDIT_STALE');
  await assert.rejects(updateBusinessDetails({ ...f.context, input: { ...f.input, assistantId: 'other' } }), error => error.statusCode === 400);
  assert.equal(f.requests.length, 0);
});
test('concurrent edits serialize; only one request may own the publication', async () => {
  const f = fixture();
  const results = await Promise.allSettled([updateBusinessDetails({ ...f.context, input: f.input }),
    updateBusinessDetails({ ...f.context, input: { ...f.input, requestId: 'request-0002', details: { ...f.details, businessName: 'Other' } } })]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(f.requests.filter(item => item.method === 'PATCH').length, 1);
});
test('active calls and paused lifecycle block all assistant writes', async () => {
  for (const scenario of ['call', 'lifecycle']) {
    const f = fixture(); if (scenario === 'call') f.state.activeCalls = [{ status: 'in-progress' }]; else f.state.lifecycleBlocked = true;
    await assert.rejects(updateBusinessDetails({ ...f.context, input: f.input }), error => /CALL_ACTIVE|LIFECYCLE_BLOCKED/.test(error.code));
    assert.equal(f.requests.filter(item => item.method === 'PATCH').length, 0);
  }
});
test('a conflicting live phone route cannot be edited or repaired by this endpoint', async () => {
  const f = fixture(); f.state.phone.assistantId = 'other-tenant';
  await assert.rejects(updateBusinessDetails({ ...f.context, input: f.input }), error => error.code === 'BUSINESS_EDIT_ROUTE_CONFLICT');
  assert.equal(f.requests.filter(item => item.method === 'PATCH').length, 0);
});
test('uncertain accepted PATCH recovers by readback on exact retry, never creates or blindly resends', async () => {
  const f = fixture(); f.state.failAfterPatch = true;
  await assert.rejects(updateBusinessDetails({ ...f.context, input: f.input }), error => error.code === 'BUSINESS_EDIT_PROVIDER_UNAVAILABLE' && !error.message.includes('secret'));
  assert.equal((await readBusinessDetails(f)).status, 'needs_attention');
  await assert.rejects(updateBusinessDetails({ ...f.context, input: { ...f.input, requestId: 'different-request' } }), error => error.code === 'BUSINESS_EDIT_PENDING');
  f.state.failAfterPatch = false;
  const reloaded = await readBusinessDetails(f);
  assert.deepEqual(reloaded.pendingSave, f.input);
  assert.doesNotMatch(JSON.stringify(reloaded), /originalFingerprint|protectedBefore|do-not-return|tenant-protected/);
  const recovered = await updateBusinessDetails({ ...f.context, input: reloaded.pendingSave });
  assert.equal(recovered.status, 'published'); assert.equal(f.requests.filter(item => item.method === 'PATCH').length, 1);
});
test('readback detects protected tool tampering and never returns published', async () => {
  const f = fixture(); f.state.tamperReadback = true;
  await assert.rejects(updateBusinessDetails({ ...f.context, input: f.input }), error => error.code === 'BUSINESS_EDIT_READBACK_FAILED');
  assert.equal((await readBusinessDetails(f)).revision, 0);
});
test('trial routes require exact active gate and publish the verified same assistant snapshot', async () => {
  const f = fixture(); f.state.phone = { ...f.state.phone, assistantId: null, server: { url: f.context.gateWebhookUrl } };
  f.state.gate = { status: 'active', assistantId: f.signup.vapiAssistantId, phoneNumberId: f.signup.vapiPhoneNumberId,
    businessId: f.signup.businessId, phoneNumber: f.signup.twilioPhoneNumber, fallbackPhone: f.signup.ownerPhone };
  const result = await updateBusinessDetails({ ...f.context, input: f.input });
  assert.equal(result.status, 'published'); assert.deepEqual(f.gatePublications[0].gate, f.state.gate);
  assert.equal(f.gatePublications[0].assistant.id, f.signup.vapiAssistantId);
});
test('a trial snapshot publishing failure holds the save and allows safe exact-request recovery', async () => {
  const f = fixture(); let failing = true;
  const publishGate = async () => { if (failing) throw new Error('DB outage'); };
  await assert.rejects(updateBusinessDetails({ ...f.context, input: f.input, publishGate }), /could not be confirmed/);
  assert.equal((await readBusinessDetails(f)).revision, 0);
  failing = false; assert.equal((await updateBusinessDetails({ ...f.context, input: f.input, publishGate })).status, 'published');
  assert.equal(f.requests.filter(item => item.method === 'PATCH').length, 1);
});
test('published revision is isolated by signup, business and assistant, and never broadens access', async () => {
  const f = fixture(); await updateBusinessDetails({ ...f.context, input: f.input });
  assert.equal((await publishedBusinessRevision(f)).revision, 1);
  assert.equal(await publishedBusinessRevision({ ...f, signup: { ...f.signup, vapiAssistantId: 'other' } }), null);
  assert.equal(await publishedBusinessRevision({ ...f, signup: { ...f.signup, signupAttemptId: 'other' } }), null);
});
test('a second content revision replaces the generated facts block instead of stacking instructions', async () => {
  const f = fixture(); await updateBusinessDetails({ ...f.context, input: f.input });
  const details = { ...f.details, businessName: 'Third Electric', services: 'Panels only' };
  const result = await updateBusinessDetails({ ...f.context, input: { requestId: 'request-0002', expectedRevision: 1, details } });
  assert.equal(result.revision, 2);
  const prompt = f.assistant().model.messages[0].content;
  assert.equal((prompt.match(/## MYAIPA VERIFIED BUSINESS DETAILS v1/g) || []).length, 1);
  assert.doesNotMatch(prompt, /New Electric/); assert.match(prompt, /Panels only/);
});
test('custom greeting and expanded-only tools fail closed instead of resetting tenant configuration', () => {
  const f = fixture();
  assert.throws(() => buildContentPatch({ ...f.original, firstMessage: 'Custom greeting' }, { businessName: 'Old Electric' }, f.details), /custom greeting/);
  const assistant = clone(f.original); delete assistant.model.toolIds; assistant.model.tools = [{ id: 'tenant' }];
  assert.throws(() => buildContentPatch(assistant, { businessName: 'Old Electric' }, f.details), /custom receptionist/);
  assert.ok(isDeepStrictEqual(protectedDefinition(f.original), protectedDefinition(f.original)));
});
test('mixed inline built-in/MCP tools and toolIds fail closed without altering assistant, prompt or number', async () => {
  for (const tools of [[{ type: 'endCall' }], [{ type: 'mcp', server: { url: 'https://tools.example.test/mcp' } }], { type: 'endCall' }]) {
    const f = fixture(), before = f.assistant(), beforeSignup = clone(f.signup), beforeSetup = clone(f.setup);
    before.model.tools = tools; f.setAssistant(before);
    await assert.rejects(updateBusinessDetails({ ...f.context, input: f.input }), error => error.code === 'BUSINESS_EDITOR_CUSTOM_ASSISTANT' && error.statusCode === 409);
    assert.equal(f.requests.filter(item => item.method === 'PATCH').length, 0);
    assert.deepEqual(f.assistant(), before); assert.deepEqual(f.signup, beforeSignup); assert.deepEqual(f.setup, beforeSetup);
    assert.equal((await readBusinessDetails(f)).revision, 0);
  }
});
test('canonical saved-tool GET expansions publish in place without dropping saved capabilities', async () => {
  const f = fixture();
  const savedTools = [{ id: 'end-call', type: 'endCall', orgId: 'tenant-7' },
    { id: 'tenant-protected', type: 'code', function: { name: 'sendConfirmedSummary' },
      environmentVariables: [{ name: 'PRIVATE_ROUTING', value: 'unchanged' }] }];
  // Realistic provider contract: PATCH accepts saved toolIds; GET re-expands
  // reusable resources, whose expansion order need not match reference order.
  const api = async (path, options = {}) => {
    const result = await f.api(path, options);
    if (path === 'assistant/assistant-exact' && options.method !== 'PATCH') result.model.tools = clone(savedTools);
    return result;
  };
  const result = await updateBusinessDetails({ ...f.context, api, input: f.input });
  assert.equal(result.status, 'published'); assert.equal(result.revision, 1);
  const writes = f.requests.filter(item => item.method === 'PATCH');
  assert.equal(writes.length, 1); assert.equal(writes[0].path, 'assistant/assistant-exact');
  assert.deepEqual(writes[0].body.model.toolIds, f.original.model.toolIds);
  assert.equal(Object.hasOwn(writes[0].body.model, 'tools'), false);
  assert.deepEqual(f.assistant().model.toolIds, ['tenant-protected', 'end-call']);
  assert.deepEqual(f.gatePublications[0].assistant.model.tools, savedTools);
  assert.equal(f.assistant().id, f.signup.vapiAssistantId); assert.deepEqual(f.state.phone, {
    id: f.signup.vapiPhoneNumberId, number: f.signup.twilioPhoneNumber, assistantId: f.signup.vapiAssistantId });
  assert.deepEqual(protectedDefinition(f.gatePublications[0].assistant), protectedDefinition(f.original));
  assert.ok(f.requests.every(item => item.method === 'GET' || item.path === 'assistant/assistant-exact'));
});

test('canonical saved aliases are type-independent but malformed or mismatched representations never PATCH', async () => {
  const f = fixture();
  for (const type of ['code', 'endCall', 'function', 'apiRequest', 'mcp']) {
    const assistant = clone(f.original);
    assistant.model.tools = [{ id: 'tenant-protected', type }, { id: 'end-call', type: 'endCall' }];
    assert.deepEqual(buildContentPatch(assistant, { businessName: 'Old Electric' }, f.details).model.toolIds, f.original.model.toolIds);
    assert.deepEqual(protectedDefinition(assistant), protectedDefinition(f.original));
  }
  const malformed = [
    { toolIds: null }, { toolIds: 'tenant-protected' }, { toolIds: ['tenant-protected', 'tenant-protected'] },
    { toolIds: ['', 'end-call'] }, { toolIds: [' tenant-protected', 'end-call'] }, { toolIds: [{ id: 'tenant-protected' }, 'end-call'] },
    { tools: [{ id: 'tenant-protected' }] }, { tools: [{ id: 'tenant-protected' }, { id: 'other' }] },
    { tools: [{ id: 'tenant-protected' }, { id: 'tenant-protected' }] },
    { tools: [{ id: 'tenant-protected' }, { id: 'end-call' }, { type: 'mcp' }] },
    { tools: [{ id: 'tenant-protected' }, { id: 'end-call' }, { id: 'extra' }] },
    { tools: [{ id: 'tenant-protected' }, { id: '' }] }, { tools: [{ id: 'tenant-protected' }, { id: ' end-call' }] },
    { tools: [null, { id: 'end-call' }] }, { tools: [[], { id: 'end-call' }] }, { tools: ['tenant-protected', 'end-call'] },
    { tools: { id: 'tenant-protected' } },
  ];
  for (const changed of malformed) {
    const current = fixture(), before = current.assistant();
    Object.assign(before.model, changed); current.setAssistant(before);
    await assert.rejects(updateBusinessDetails({ ...current.context, input: current.input }), error => error.code === 'BUSINESS_EDITOR_CUSTOM_ASSISTANT');
    assert.equal(current.requests.filter(item => item.method === 'PATCH').length, 0);
    assert.deepEqual(current.assistant(), before); assert.equal((await readBusinessDetails(current)).revision, 0);
  }
});

test('protected readback retains noncanonical expansions instead of hiding missing, extra or mixed tools', () => {
  const f = fixture(), baseline = protectedDefinition(f.original);
  for (const tools of [[{ id: 'tenant-protected' }], [{ id: 'tenant-protected' }, { id: 'wrong' }],
    [{ id: 'tenant-protected' }, { id: 'end-call' }, { type: 'endCall' }],
    [{ id: 'tenant-protected' }, { id: 'tenant-protected' }], { id: 'tenant-protected' }]) {
    const changed = clone(f.original); changed.model.tools = tools;
    assert.notDeepEqual(protectedDefinition(changed), baseline);
    assert.deepEqual(protectedDefinition(changed).model.tools, tools);
  }
});

test('protected readback does not hide newly introduced inline tools', async () => {
  const f = fixture(); f.state.tamperInlineTools = true;
  await assert.rejects(updateBusinessDetails({ ...f.context, input: f.input }), error => error.code === 'BUSINESS_EDIT_READBACK_FAILED');
  assert.equal((await readBusinessDetails(f)).revision, 0);
});
test('literal $& and SMS names cannot rewrite protected instructions, secrets or routing', () => {
  const f = fixture();
  const assistant = clone(f.original);
  assistant.firstMessage = 'SMS recording notice. Thanks for calling SMS.';
  assistant.model.messages[0].content = 'You are the voice agent for SMS.\n- Business name: SMS\n- Service area: Old\n- Services: Old\n## MYAIPA ISOLATED SMS ROUTING\nSMS routing stays byte-for-byte. DEFAULT_OWNER=SMS';
  const suffix = assistant.model.messages[0].content.slice(assistant.model.messages[0].content.indexOf('\n## MYAIPA ISOLATED'));
  const patch = buildContentPatch(assistant, { businessName: 'SMS' }, { ...f.details, businessName: '$& Electric', services: '$& repairs', serviceAreas: '$& town' });
  assert.equal(patch.firstMessage, 'SMS recording notice. Thanks for calling $& Electric.');
  assert.match(patch.model.messages[0].content, /- Business name: \$& Electric/);
  assert.match(patch.model.messages[0].content, /- Services: \$& repairs/);
  assert.ok(patch.model.messages[0].content.endsWith(suffix));
});
test('ready setup link access is bound to the exact original attempt, setup and assigned resources', async () => {
  const f = fixture(); let tokens = 0; const statuses = [];
  f.setup.status = 'ACTIVE';
  f.prisma.callForwardingSetup = { findUnique: async () => clone(f.setup) };
  const args = { ...f, assignedPhone: f.signup.twilioPhoneNumber, frontendAppUrl: 'https://www.myaipa.ca', onBoundSetup: bound => statuses.push(bound.forwardingStatus), createToken: setup => { tokens += 1; assert.equal(setup.id, f.setup.id); return 'signed-scope'; } };
  assert.equal(await ownedReadyForwardingSetupUrl(args), 'https://www.myaipa.ca/#/f/signed-scope');
  assert.equal(tokens, 1);
  assert.deepEqual(statuses, ['active']);
  for (const signup of [{ ...f.signup, forwardingSetupId: 'another' }, { ...f.signup, signupAttemptId: 'stale' },
    { ...f.signup, vapiAssistantId: '' }, { ...f.signup, businessId: 8 }, { ...f.signup, archivedAt: 'now' }]) {
    assert.equal(await ownedReadyForwardingSetupUrl({ ...args, signup }), '');
  }
  assert.equal(await ownedReadyForwardingSetupUrl({ ...args, assignedPhone: '+12895550198' }), '');
  assert.equal(tokens, 1);
  assert.deepEqual(statuses, ['active']);
});
test('projection invalidates old content-bound test proof without changing saved lifecycle or sending SMS', async () => {
  const f = fixture(); f.signup.status = 'setup_ready'; f.signup.agentContentFingerprint = 'old-content'; f.signup.agentTestFingerprint = 'historical-test';
  await updateBusinessDetails({ ...f.context, input: f.input });
  const revision = await publishedBusinessRevision(f), projection = readinessSignupForRevision(f.signup, revision);
  assert.equal(projection.status, 'setup_ready'); assert.notEqual(projection.agentContentFingerprint, 'old-content');
  assert.equal(projection.agentTestFingerprint, 'historical-test'); assert.equal(f.signup.agentContentFingerprint, 'old-content');
  assert.equal(f.signup.status, 'setup_ready');
  assert.ok(f.requests.every(item => !/Messages|sms|phone-number.*PATCH/.test(item.path)));
});
