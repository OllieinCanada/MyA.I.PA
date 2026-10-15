const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { dispatchSignupSms } = require('../server/signupSmsDispatch');
const { runProvisioningStep, claimProvisioningStep, provisioningStateKey } = require('../server/provisioningState');
const { deliverSignupCompletion } = require('../server/signupCompletion');
const { runAgentTextTest } = require('../server/signupAgentTesting');
const { fetchProviderReadText } = require('../server/providerRead');
const { classifyOperationalError } = require('../server/operationalErrorClassifier');

function fixture() {
  const rows = new Map(); let tail = Promise.resolve();
  const runtimeStore = {
    async findUnique({ where }) { return rows.has(where.key) ? { data: structuredClone(rows.get(where.key)) } : null; },
    async upsert({ where, update, create }) { const data = structuredClone(rows.has(where.key) ? update.data : create.data); rows.set(where.key, data); return { data }; },
  };
  const prisma = { runtimeStore, $transaction(work) {
    const job = tail.then(() => work({ runtimeStore, $queryRaw: async () => [] })); tail = job.catch(() => {}); return job;
  } };
  return { prisma, rows };
}
const request = { to: '+19055550123', from: '+12895550123', message: 'Synthetic test', purpose: 'owner-test' };
test('ambiguous SMS acceptance never automatically resends, even across repeated retries', async () => {
  const { prisma, rows } = fixture(); let calls = 0;
  const input = { prisma, identity: 'business-a', purpose: 'agent-test', request,
    sendSms: async () => { calls++; throw new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } }); } };
  await assert.rejects(dispatchSignupSms(input));
  for (let i = 0; i < 3; i++) await assert.rejects(dispatchSignupSms(input), { code: 'PROVISIONING_RECONCILIATION_REQUIRED' });
  assert.equal(calls, 1);
  // Error evidence survives the first failure, before reconciliation errors.
  assert.equal(rows.size, 1);
  assert.equal([...rows.values()][0].originalErrorCode, 'UND_ERR_SOCKET');
});
test('concurrent SMS dispatches have one provider send and durable SID replay', async () => {
  const { prisma } = fixture(); let calls = 0;
  const input = { prisma, identity: 'business-a', purpose: 'agent-test', request,
    sendSms: async () => { calls++; await new Promise(r => setTimeout(r, 10)); return { sid: 'SMfixture', status: 'queued' }; } };
  const outcomes = await Promise.allSettled([dispatchSignupSms(input), dispatchSignupSms(input)]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(calls, 1);
  const replay = await dispatchSignupSms(input);
  assert.equal(replay.sid, 'SMfixture'); assert.equal(calls, 1);
  await assert.rejects(dispatchSignupSms({ ...input, request: { ...request, message: 'Changed link' } }), { code: 'PROVISIONING_CONTEXT_MISMATCH' });
});
test('businesses and owner/customer test legs cannot share a dispatch claim', async () => {
  const { prisma } = fixture(); let calls = 0;
  const input = { prisma, identity: 'business-a', purpose: 'agent-test', request, sendSms: async () => ({ sid: `SM${++calls}`, status: 'queued' }) };
  await dispatchSignupSms(input);
  await dispatchSignupSms({ ...input, request: { ...request, purpose: 'customer-test' } });
  await dispatchSignupSms({ ...input, identity: 'business-b' }); assert.equal(calls, 3);
});
test('final setup SMS stores acceptance receipt and an ambiguous retry cannot send again', async () => {
  const { prisma } = fixture(); let calls = 0;
  const input = { prisma, dispatchIdentity: 'business-a', ownerPhone: request.to, assignedPhone: request.from,
    sendSms: async () => { calls++; throw Error('response lost'); } };
  assert.equal((await deliverSignupCompletion(input)).status, 'failed');
  const retry = await deliverSignupCompletion(input); assert.equal(calls, 1);
  assert.equal(retry.errors[0].code, 'PROVISIONING_RECONCILIATION_REQUIRED');
  const other = await deliverSignupCompletion({ ...input, ownerPhone: '+19055550124', sendSms: async () => ({ sid: 'SMreceipt', status: 'queued' }) });
  assert.deepEqual(other.receipts.sms, { sid: 'SMreceipt', status: 'queued', delivered: false });
});
test('actual text test retains duplicate protection after an accepted response disappears', async () => {
  const { prisma } = fixture(); let calls = 0;
  const signup = { signupAttemptId: 'business-a', twilioPhoneNumber: request.from, ownerPhone: request.to, vapiAssistantId: 'assistant-a', smsRoutingStatus: 'healthy', agentContentStatus: 'verified', agentContentFingerprint: 'content', agentContentVerifiedAt: new Date().toISOString() };
  const input = { signup, persist: fields => Object.assign(signup, fields), sendSms: payload => dispatchSignupSms({ prisma, identity: signup.signupAttemptId, purpose: 'agent-test', request: payload, sendSms: async () => { calls++; throw Error('accepted, response lost'); } }) };
  await assert.rejects(runAgentTextTest(input));
  await assert.rejects(runAgentTextTest(input), { code: 'PROVISIONING_RECONCILIATION_REQUIRED' }); assert.equal(calls, 1);
});
test('crash before dispatch safely resumes; legacy unknown records stay blocked on every replay', async () => {
  const { prisma, rows } = fixture(); let calls = 0;
  const input = { prisma, kind: 'twilio-number', idempotencyKey: 'before-dispatch', contextHash: 'ctx', reconcile: async () => null, execute: async () => { calls++; return { sid: 'PNfixture' }; } };
  const claim = await claimProvisioningStep(input); rows.get(claim.key).leaseExpiresAt = new Date(0).toISOString();
  await runProvisioningStep(input); assert.equal(calls, 1);
  const key = provisioningStateKey(input.kind, 'legacy');
  rows.set(key, { status: 'failed', attempts: 1, contextHash: 'ctx' });
  for (let i = 0; i < 3; i++) await assert.rejects(runProvisioningStep({ ...input, idempotencyKey: 'legacy' }), { code: 'PROVISIONING_RECONCILIATION_REQUIRED' });
  assert.equal(calls, 1);
});
test('actual Vapi read call sites retry truncated bodies, but mutations execute once', async () => {
  const source = fs.readFileSync(require.resolve('../server/index'), 'utf8');
  for (const name of ['fetchVapiCollection', 'requestVapiResource']) {
    const start = source.indexOf(`async function ${name}(`), end = source.indexOf('\nasync function ', start + 1);
    let calls = 0;
    const fetchImpl = async () => { calls++; return { ok: true, text: async () => { if (calls === 1) throw Object.assign(Error('closed'), { code: 'UND_ERR_SOCKET' }); return name === 'fetchVapiCollection' ? '[]' : '{"id":"ok"}'; } }; };
    const context = { URL, VAPI_API_KEY: 'fixture', VAPI_API_BASE_URL: 'https://fixture.invalid', parseJsonObject: JSON.parse, fetch: fetchImpl,
      fetchProviderReadText: (url, options) => fetchProviderReadText(url, options, { fetchImpl, sleep: async () => {} }) };
    vm.createContext(context); vm.runInContext(`${source.slice(start, end)}; this.subject = ${name};`, context);
    await context.subject('assistant'); assert.equal(calls, 2);
    if (name === 'requestVapiResource') { calls = 0; await assert.rejects(context.subject('assistant', { method: 'POST', body: {} })); assert.equal(calls, 1); }
  }
});
test('socket interruptions retain the network root cause in alert classification', () => {
  assert.equal(classifyOperationalError(new TypeError('terminated', { cause: { code: 'UND_ERR_SOCKET' } }), { provider: 'VAPI' }).category, 'network');
});
test('partial recovery reads a purchased number from the exact durable signed context', async () => {
  const source = fs.readFileSync(require.resolve('../server/index'), 'utf8');
  const start = source.indexOf('async function inspectSignupRecoveryState('), end = source.indexOf('\nasync function ', start + 1);
  let inspectedPhone = '';
  const context = { prisma: {}, readPendingSignupStore: async () => ({}),
    providerFailureDetail: ({message}) => message || '',
    findPendingSignupForDashboardRecord: () => ['hash', { payload: { provisioning: { idempotencyKey: 'exact-key', contextHash: 'exact-context' } } }],
    readProvisioningStep: async input => { assert.equal(input.idempotencyKey, 'exact-key'); return { data: { status: 'completed', contextHash: 'exact-context', result: { twilioPhoneNumber: request.from } } }; },
    fetchVapiCollection: async () => [], fetchTwilioIncomingPhoneNumbers: async () => [],
    getSignupProviderRecoveryDiagnostics: input => { inspectedPhone = input.signup.twilioPhoneNumber; return { providerLookup: input.providerLookup }; },
    isStaleSignupArchiveEligible: () => false,
  };
  vm.createContext(context); vm.runInContext(`${source.slice(start, end)}; this.subject = inspectSignupRecoveryState;`, context);
  const result = await context.subject({ signupAttemptId: 'exact-attempt' });
  assert.equal(inspectedPhone, request.from); assert.equal(result.partialResourceEvidence, true); assert.equal(result.providerLookup, 'complete');
  context.readProvisioningStep = async () => ({ data: { status: 'completed', contextHash: 'wrong-context', result: { twilioPhoneNumber: request.from } } });
  const refused = await context.subject({ signupAttemptId: 'exact-attempt' });
  assert.equal(inspectedPhone, undefined); assert.equal(refused.providerReconciliationRequired, true);
});

test('raw pending signup diagnostics read only its exact registered context and preserve the original import failure', async () => {
  const source = fs.readFileSync(require.resolve('../server/index'), 'utf8');
  const start = source.indexOf('async function inspectSignupRecoveryState('), end = source.indexOf('\nasync function ', start + 1);
  let reads=0,identityChecked=false;
  const registered={business:{name:'isolated roofing'},provisioning:{idempotencyKey:'exact-key',contextHash:'exact-context'}};
  const context={process:{env:{}},prisma:{runtimeStore:{findUnique:async({where})=>{assert.equal(where.key,'context:exact-key');reads++;return {data:{payload:registered,contextHash:'exact-context'}};}}},
    readPendingSignupStore:async()=>({}),findPendingSignupForDashboardRecord:()=>['hash',{payload:{business:{name:'isolated roofing'}}}],
    isContactVerified:()=>true,getProvisioningSigningSecret:()=> 'fixture',contextStoreKey:key=>'context:'+key,
    normalizeSignupProvisioningPayload:()=>registered,assertPendingSignupRecoveryIdentity:()=>{identityChecked=true;},
    providerFailureDetail:({message})=>message||'',signupRecoveryError:(m,c)=>Object.assign(Error(m),{code:c}),
    readProvisioningStep:async({kind})=>({data:{contextHash:'exact-context',status:kind==='vapi-import'?'failed':'completed',
      result:{twilioPhoneNumber:request.from},originalErrorCode:kind==='vapi-import'?'VAPI_TWILIO_IMPORT_FAILED':'',originalProviderStatus:kind==='vapi-import'?400:null,originalProviderDetail:kind==='vapi-import'?'specific validation explanation':''}}),
    fetchVapiCollection:async()=>[],fetchTwilioIncomingPhoneNumbers:async()=>[],getSignupProviderRecoveryDiagnostics:()=>({}),isStaleSignupArchiveEligible:()=>false};
  vm.createContext(context);vm.runInContext(`${source.slice(start,end)};this.subject=inspectSignupRecoveryState;`,context);
  const report=await context.subject({status:'setup_error'});
  assert.equal(reads,1);assert.equal(identityChecked,true);
  assert.equal(report.provisioningStages['vapi-import'].originalProviderStatus,400);
  assert.equal(report.provisioningStages['vapi-import'].originalProviderDetail,'specific validation explanation');
  assert.equal(report.partialResourceEvidence,true);
});
