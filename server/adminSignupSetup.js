// Read-only projections. No provider clients, provisioning claims or mutations.
const { buildSignupProgress } = require('./signupProgress');
const { buildAgentReadiness, buildAgentTestFingerprint } = require('./signupAgentTesting');
const { buildProvisioningAccountKey } = require('./signupProvisioning');
const { buildMakeSignupEventKey } = require('./makeSignupWebhook');
const { contextStoreKey } = require('./signupProvisioningContext');
const { provisioningStateKey } = require('./provisioningState');
const { allowedAreaCodes } = require('./numberAreaPolicy');
const { isContactVerified } = require('./signupVerificationChannel');
const iso = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const kinds = ['twilio-number', 'vapi-assistant', 'vapi-import'];
function setupTimeline(record, receipts, search, groups) {
  const events = [];
  const add = (id, label, at, state, source) => { const stamp = iso(at); if (stamp) events.push({id,label,at:stamp,state,source}); };
  add('signup','Signup received',record.signedUpAt || record.createdAt,'recorded','Saved signup');
  add('sms-verified','Phone verification recorded',record.smsVerifiedAt,'verified','Saved verification');
  add('email-verified','Email verification recorded',record.emailVerifiedAt,'verified','Saved verification');
  const titles = {'twilio-number':'Number purchase','vapi-assistant':'Assistant creation','vapi-import':'Number import'};
  for (const kind of kinds) {
    const receipt = receipts[kind];
    if (!receipt) continue;
    add(kind+'-started',titles[kind]+' started',receipt.claimedAt,'recorded','Durable receipt');
    if(receipt.status==='completed' && receipt.result) add(kind+'-complete',titles[kind]+' saved',receipt.completedAt,'verified','Durable receipt');
    if(receipt.status==='failed') add(kind+'-failed',titles[kind]+' failed',receipt.failedAt,'blocked','Durable receipt');
  }
  for(const check of groups.flatMap(g=>g.checks)) {
    if (check.state==='verified' && ['script','route','Owner-accepted','Owner-delivered','Customer-accepted','Customer-delivered'].includes(check.id)) {
      add(check.id,check.label,check.at,'verified','Saved setup proof');
    }
  }
  const phases={searching:'Searching',empty:'No inventory returned',candidate_found:'Candidate found',purchase_dispatching:'Purchase dispatched',completed:'Purchase response observed',failed:'Search/purchase failed'};
  for(const [index,event] of (search?.history || []).slice(-20).entries()) {
    if (!Object.hasOwn(phases,event.phase)) continue;
    const area=/^[2-9]\d{2}$/.test(event.areaCode || '') ? ` · ${event.areaCode}` : '';
    add('search-'+index,phases[event.phase]+area,event.at,event.phase==='failed'?'blocked':'observed','Process-local observation · incomplete history possible');
  }
  return events.sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id)).slice(-50);
}

// Diagnostic only: bounded process-local status never authorizes or retries work.
function createNumberSearchTracker({ now = Date.now } = {}) {
  const rows = new Map();
  return {
    record(key, contextHash, event) {
      if (!/^[a-f0-9]{64}$/.test(key || '') || !/^[a-f0-9]{64}$/.test(contextHash || '')) return;
      const phases = ['searching', 'empty', 'candidate_found', 'purchase_dispatching', 'completed', 'failed'];
      if (!phases.includes(event.phase)) return;
      const areaCode = /^[2-9]\d{2}$/.test(event.areaCode || '') ? event.areaCode : null;
      if (!rows.has(key) && rows.size >= 500) rows.delete(rows.keys().next().value);
      const previous = rows.get(key);
      const history = previous?.contextHash === contextHash ? previous.history : [];
      const update = { phase: event.phase, areaCode, at: new Date(now()).toISOString() };
      rows.set(key, { contextHash, ...update, history: [...history, update].slice(-20), expires: now() + 10 * 60000 });
    },
    read(key, contextHash) {
      const row = rows.get(key);
      if (!row || row.contextHash !== contextHash || row.expires <= now()) return null;
      const { history, phase, areaCode, at } = row;
      return { history, phase, areaCode, at, stale: now() - Date.parse(at) > 30000,
        source: 'Process-local observation; lost on restart, not a durable purchase receipt' };
    },
  };
}

function projectSetup(record = {}, { context, receipts = {}, search = null, coverage = 'saved_record_only', business } = {}) {
  const contactVerified = isContactVerified(record) && !(record.smsVerificationRequired && !(record.smsVerified || record.smsVerifiedAt))
    && !(record.emailVerificationRequired && !(record.emailVerified || record.emailVerifiedAt));
  const progress = buildSignupProgress({ signup: record, contactVerified, ready: record.status === 'setup_ready' });
  const readiness = buildAgentReadiness({ signup: record, business });
  const done = key => progress.steps.some(s => s.key === key && s.status === 'done');
  const at = key => iso(record[key]);
  const check = (id, label, passed, detail, when, failed = false) => ({ id, label,
    state: passed ? 'verified' : failed ? 'blocked' : 'pending', detail, at: when || null });
  const stage = kind => {
    const receipt = receipts[kind];
    const complete = receipt?.status !== 'completed' || (receipt.result && typeof receipt.result === 'object');
    return { status: complete && ['completed','processing','failed','invalidated'].includes(receipt?.status) ? receipt.status : 'unknown',
      attempts: Number.isSafeInteger(receipt?.attempts) && receipt.attempts >= 0 ? receipt.attempts : null,
      at: iso(receipt?.updatedAt || receipt?.failedAt || receipt?.completedAt),
      uncertain: Boolean(receipt?.dispatchStartedAt && receipt.status !== 'completed'),
    };
  };
  const stages = Object.fromEntries(kinds.map(kind => [kind, stage(kind)]));
  let areaOrder = [], preferredAreaCode = null, policyValid = false;
  try {
    preferredAreaCode = /^[2-9]\d{2}$/.test(context?.payload?.provisioning?.preferredAreaCode || '') ? context.payload.provisioning.preferredAreaCode : null;
    if (context?.payload?.provisioning) {
      const p = context.payload.provisioning;
      areaOrder = allowedAreaCodes(p.preferredAreaCode, p.preferredRegion, p.allowedAreaCodes);
      policyValid = true;
    }
  } catch (_) { /* Invalid policy remains unknown; never infer a broader search. */ }
  const fingerprint = buildAgentTestFingerprint({ assistantId: record.vapiAssistantId, aiNumber: record.twilioPhoneNumber,
    ownerPhone: record.ownerPhone || record.businessPhone, contentFingerprint: record.agentContentFingerprint });
  const currentTests = Boolean(record.vapiAssistantId && record.twilioPhoneNumber && record.agentContentFingerprint && record.agentTestFingerprint === fingerprint);
  const message = channel => {
    const prefix = 'agentTest' + channel;
    const status = ['accepted','queued','sending','sent','delivered','read','failed','undelivered','canceled'].includes(record[prefix + 'ProviderStatus']) ? record[prefix + 'ProviderStatus'] : 'unknown';
    const failed = currentTests && ['failed','undelivered','canceled'].includes(status);
    const delivered = readiness.checks.some(c => c.key === (channel === 'Owner' ? 'owner-text' : 'customer-text') && c.done);
    return [check(channel + '-accepted', `${channel === 'Owner' ? 'Owner' : 'Customer-copy'} practice text accepted`, currentTests && Boolean(at(prefix + 'AcceptedAt')),
      currentTests ? `Saved provider status: ${status}. Accepted is not delivered.` : 'No matching receipt for the current number, assistant and script.', currentTests ? at(prefix + 'AcceptedAt') : null, failed),
    check(channel + '-delivered', `${channel === 'Owner' ? 'Owner' : 'Customer-copy'} practice text delivered`, delivered,
      delivered ? 'Provider delivery receipt matches this setup. Both practice copies go to the owner; this is not a real customer send.' : currentTests ? `Awaiting matching delivery proof; status: ${status}.` : 'Missing or stale configuration-bound delivery proof.', delivered ? at(prefix + 'DeliveredAt') : null, failed)];
  };
  const assigned = /^\+1\d{10}$/.test(record.twilioPhoneNumber || '') ? record.twilioPhoneNumber : null;
  const result = { checkedAt: new Date().toISOString(), coverage, readOnly: true,
    number: { preferredAreaCode, areaOrder, policyValid, locked: Boolean(context?.lockedAt),
      assignedAreaCode: assigned ? assigned.slice(2,5) : null, assignedLast4: assigned ? assigned.slice(-4) : null,
      search, stage: stages['twilio-number'], reserveUseAuthorized: false },
    groups: [
      { id: 'number', title: 'Find and assign a new number', checks: [
        check('policy','Exact area-code policy saved',policyValid,policyValid ? `${areaOrder.join(' → ') || 'Regional / Canadian inventory'}${context.lockedAt ? ' · locked request; not broadened by current settings' : ''}` : 'No exact registered context available. Preferred/current area code is unknown.'),
        check('purchase','Number purchase saved',stages['twilio-number'].status === 'completed',`Durable stage: ${stages['twilio-number'].status}. Attempts: ${stages['twilio-number'].attempts ?? 'unknown'}.${stages['twilio-number'].uncertain ? ' Provider dispatch occurred; inspect receipts before any retry.' : ''}`,stages['twilio-number'].at,stages['twilio-number'].status === 'failed'),
        check('assigned','Number assigned to this signup',Boolean(assigned),assigned ? `Area code ${assigned.slice(2,5)} · ending ${assigned.slice(-4)}. Saved assignment, not a fresh provider lookup.` : 'No assigned number saved. Held reserves are not automatically used.'),
      ] },
      { id: 'assistant', title: 'Build the assistant and install its script', checks: [
        check('assistant-created','Assistant created',done('assistant'),`Saved assistant stage: ${stages['vapi-assistant'].status}.`,stages['vapi-assistant'].at,stages['vapi-assistant'].status === 'failed'),
        check('script','Business script installed and matched',done('content'),done('content') ? 'Stored content fingerprint and verification timestamp match the saved script. Individual greeting/pricing sections are not separately certified.' : 'Script installation/readback has not been verified against the saved business answers.',at('agentContentVerifiedAt'),record.agentContentStatus === 'failed'),
        check('import','Number imported into Vapi',Boolean(record.vapiPhoneNumberId),`Saved import stage: ${stages['vapi-import'].status}.`,stages['vapi-import'].at,stages['vapi-import'].status === 'failed'),
        check('route','Number routes to the correct assistant',done('call-route'),done('call-route') ? 'Saved routing proof matches this number and assistant.' : 'Matching route proof not yet recorded.',at('agentRouteBindingVerifiedAt'),record.agentRouteBindingStatus === 'failed'),
        ...[['business','Business record exists'], ['number-mapping','Number linked to this business'], ['phone-id-mapping','Vapi phone linked to this business'], ['assistant-mapping','Assistant linked to this business']].map(([key,label]) =>
          check(key,label,readiness.checks.some(c=>c.key===key&&c.done),business ? 'Checked against saved business mappings; not a live provider request.' : 'Business mapping evidence not read yet; use Analyze saved setup.')),
      ] },
      { id: 'texts', title: 'Check routing and both practice texts', checks: [
        check('text-routing','Owner and caller text routes checked',done('text-routing'),'Uses the saved text-routing assessment; this page sends nothing.',null,record.smsRoutingStatus === 'failed'),
        ...message('Owner'), ...message('Customer'),
      ] },
      { id: 'activation', title: 'Activate the trial and finish setup', checks: [
        check('trial','Trial billing record activated',done('trial'),'Verified only from a saved active/trialing subscription with no recorded trial error. A checkout return is not proof.'),
        check('ready','All required setup checks complete',done('ready') && readiness.passed,'Requires canonical setup checkpoints and business mappings. Trial activation alone does not mean the receptionist is ready.'),
      ] },
    ],
    limitation: 'Saved evidence, not continuous live provider verification. Historical search history may be absent; process-local search status becomes stale after 30 seconds and disappears on restart. This dashboard never buys numbers, retries setup or sends practice texts.' };
  result.timeline = setupTimeline(record,receipts,search,result.groups);
  return result;
}

async function readSetupEvidence({ prisma, record, searchTracker }) {
  let key, context;
  const business = Number.isSafeInteger(record.businessId) && record.businessId > 0 && prisma.business
    ? await prisma.business.findUnique({ where: { id: record.businessId }, select: { id: true, vapiMappings: { select: { matchType: true, matchValue: true } } } }) : undefined;
  try { key = buildProvisioningAccountKey(record.ownerEmail, record.ownerPhone, record.businessName); }
  catch (_) { return projectSetup(record, { business }); }
  context = (await prisma.runtimeStore.findUnique({ where: { key: contextStoreKey(key) } }))?.data;
  // An owner match is insufficient: require the exact signed attempt and context.
  if (!context?.payload || buildMakeSignupEventKey(context.payload) !== record.signupAttemptId
    || context.payload.provisioning?.idempotencyKey !== key || context.contextHash !== context.payload.provisioning.contextHash) {
    return projectSetup(record, { coverage: 'exact_context_unavailable', business });
  }
  const receipts = {};
  for (const kind of kinds) {
    const data = (await prisma.runtimeStore.findUnique({ where: { key: provisioningStateKey(kind,key) } }))?.data;
    if (data && data.contextHash !== context.contextHash) return projectSetup(record, { coverage: 'receipt_context_mismatch', business });
    receipts[kind] = data;
  }
  return projectSetup(record, { context, receipts, search: searchTracker?.read(key, context.contextHash), coverage: 'exact_context_and_saved_receipts', business });
}
module.exports = { projectSetup, readSetupEvidence, createNumberSearchTracker };
