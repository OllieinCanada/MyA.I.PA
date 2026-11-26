'use strict';
// Pure preparation/projection only. No transport, database client, file writer,
// route, auth bypass or executor. Evidence must be collected by a trusted reader.
// These supplied snapshots are not a synchronized production admission check.
const crypto = require('node:crypto');
const { signupBusinessKey, isClosedSignup } = require('./signupBusinessIdentity');
const { normalizeNorthAmericanE164: phone } = require('./canadianPhoneNumber');
const { verifySignupProvisioningAuthorization, buildProvisioningResourceName } = require('./signupProvisioning');
const { buildSignupAssistantConfig } = require('./signupAssistantTemplate');
const { assessSignupAssistantContent } = require('./signupAssistantVerification');
const { completeInventoryRead } = require('./vapiInventoryCoverage');
const {pendingGateProof,assertNeverStartedSignup,assertPendingPhone}=require('./signupPendingConnection');
const fail = code => { throw Object.assign(new Error(code), { code }); };
const stable = x => x instanceof Date ? x.toISOString() : Array.isArray(x) ? x.map(stable)
  : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
const digest = x => crypto.createHash('sha256').update(JSON.stringify(stable(x))).digest('hex');
const configDigest = x => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const uuid = x => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(x || '');
const scopeFields = ['attemptRowId','attemptId','idempotencyKey','contextHash','number','twilioSid','assistantId','release','configFingerprint'];
const resourceFields = ['twilioPhoneNumber','assignedPhone','vapiAssistantId','vapiPhoneNumberId'];
const warned=read=>[read,read?.data,read?.data?.meta,read?.data?.metadata,read?.data?.pagination].some(x=>x
  && (x.successful===false || x.complete===false || (Array.isArray(x.warnings)?x.warnings.length>0:!!x.warnings)));
const hasBilling = r => ['customerId','stripeCustomerId','subscriptionId','stripeSubscriptionId','checkoutSessionId'].some(k => r?.[k])
  || ['active','trialing','paid','complete','completed'].includes(String(r?.subscriptionStatus || r?.paymentStatus || r?.checkoutStatus || '').toLowerCase());
// Compare every expected config field, not only the content fingerprint (which
// deliberately excludes some routing/tool/security settings). Provider extras OK.
function containsConfig(expected, live) {
  if (Array.isArray(expected)) return Array.isArray(live) && live.length === expected.length && expected.every((v,i) => containsConfig(v,live[i]));
  if (expected && typeof expected === 'object') return live && typeof live === 'object' && Object.keys(expected).every(k => containsConfig(expected[k],live[k]));
  return expected === live;
}
function prepareNumberConnection(input) {
  const {policy:p,context,attempt,store,registry,numberStage,assistantStage,importStage,
    inventories,otherAttempts,signingSecret,twilioAccountSid,observedRelease,readWindow,now=Date.now()} = input;
  if (!p || Object.keys(p).length !== scopeFields.length || scopeFields.some(k => !Object.hasOwn(p,k))
    || !/^[a-z0-9]{10,80}$/.test(p.attemptRowId || '') || !/^signup_[a-f0-9]{32}$/.test(p.attemptId || '')
    || ![p.idempotencyKey,p.contextHash,p.configFingerprint].every(x => /^[a-f0-9]{64}$/.test(x || ''))
    || !/^PN[a-f0-9]{32}$/i.test(p.twilioSid || '') || !/^AC[a-f0-9]{32}$/i.test(twilioAccountSid || '')
    || !uuid(p.assistantId) || !/^\+1[2-9]\d{9}$/.test(p.number || '') || !/^[a-f0-9]{40}$/.test(p.release || '')) fail('CONNECTION_SCOPE_INVALID');
  if (observedRelease !== p.release) fail('CONNECTION_RELEASE_CHANGED');
  if (!readWindow || ![readWindow.startedAt,readWindow.finishedAt,now].every(Number.isFinite)
    || readWindow.startedAt > readWindow.finishedAt || readWindow.finishedAt > now
    || readWindow.finishedAt-readWindow.startedAt > 30000 || now-readWindow.startedAt > 60000) fail('CONNECTION_EVIDENCE_STALE');
  const payload=context?.payload, pv=payload?.provisioning;
  if (context?.signupEventKey !== p.attemptId || context.contextHash !== p.contextHash || context.completedAt
    || pv?.contextHash !== p.contextHash || pv?.idempotencyKey !== p.idempotencyKey || pv?.businessKey !== p.idempotencyKey
    || signupBusinessKey(payload) !== p.idempotencyKey || !verifySignupProvisioningAuthorization(payload,signingSecret)) fail('CONNECTION_CONTEXT_UNPROVEN');
  if (!attempt || attempt.id !== p.attemptRowId || attempt.eventKey !== p.attemptId || attempt.status !== 'setup_error'
    || isClosedSignup(attempt) || signupBusinessKey(attempt) !== p.idempotencyKey || hasBilling(attempt)) fail('CONNECTION_ATTEMPT_UNPROVEN');
  if (!store || typeof store !== 'object' || Array.isArray(store)
    || Object.values(store).some(r => !r || typeof r !== 'object' || Array.isArray(r))) fail('CONNECTION_STORE_UNAVAILABLE');
  const targets=Object.entries(store).filter(([,r]) => r.signupAttemptId === p.attemptId);
  if (targets.length !== 1) fail('CONNECTION_EXACT_TARGET_REQUIRED');
  const [targetKey,target]=targets[0];
  if (target.identityVerified !== true || target.status !== 'setup_error' || isClosedSignup(target)
    || signupBusinessKey(target) !== p.idempotencyKey || hasBilling(target)
    || target.resourceAssociationRepair) fail('CONNECTION_TARGET_UNPROVEN');
  const pending=input.operation==='stage'||importStage?.result?.routeMode==='setup-pending';
  const gateProof=pending?pendingGateProof(input.pendingGate):null;
  if(pending)assertNeverStartedSignup(target);
  // This plan is for an unmapped original signup, not the older phantom-move
  // writer. Never create/substitute a tenant from a name/phone match.
  if (registry !== null || attempt.businessId || target.businessId) fail('CONNECTION_BUSINESS_SCOPE_CHANGED');
  if (!Array.isArray(otherAttempts) || otherAttempts.length) fail('CONNECTION_OTHER_ATTEMPT_CONFLICT');
  const config=buildSignupAssistantConfig(payload,{assignedPhone:p.number,resourceName:buildProvisioningResourceName('vapi-assistant',p.idempotencyKey)});
  if (configDigest(config) !== p.configFingerprint) fail('CONNECTION_CONFIG_CHANGED');
  if (numberStage?.status !== 'completed' || assistantStage?.status !== 'completed'
    || [numberStage,assistantStage].some(s => s.contextHash !== p.contextHash)
    || numberStage.result?.twilioPhoneNumber !== p.number || (numberStage.result?.twilioSid || numberStage.result?.sid) !== p.twilioSid
    || assistantStage.result?.assistantId !== p.assistantId) fail('CONNECTION_RECEIPTS_UNPROVEN');
  const t=inventories?.twilio;
  if (t?.httpStatus !== 200 || warned(t) || !Array.isArray(t.data?.incoming_phone_numbers) || t.data.next_page_uri !== null
    || t.data.incoming_phone_numbers.length >= 1000 || t.data.incoming_phone_numbers.some(n => !/^PN[a-f0-9]{32}$/i.test(n?.sid || '') || !phone(n.phone_number))
    || new Set(t.data.incoming_phone_numbers.map(n=>n.sid)).size !== t.data.incoming_phone_numbers.length) fail('CONNECTION_TWILIO_INCOMPLETE');
  const numberName=buildProvisioningResourceName('twilio-number',p.idempotencyKey);
  const numbers=t.data.incoming_phone_numbers.filter(n => n.sid === p.twilioSid || phone(n.phone_number) === p.number || n.friendly_name === numberName);
  if (numbers.length !== 1 || numbers[0].sid !== p.twilioSid || numbers[0].phone_number !== p.number
    || numbers[0].friendly_name !== numberName || numbers[0].account_sid !== twilioAccountSid
    || numbers[0].capabilities?.voice !== true || !numbers[0].voice_url) fail('CONNECTION_NUMBER_CONFLICT');
  const readVapi=(read,names) => { if (read?.httpStatus !== 200 || warned(read)) fail('CONNECTION_VAPI_READ_FAILED'); return completeInventoryRead(read.data,names).records; };
  const assistants=readVapi(inventories.assistants,['assistants','agents']), phones=readVapi(inventories.phones,['phoneNumbers','phone_numbers']);
  const candidates=assistants.filter(a => a.id === p.assistantId || a.name === config.name || a.metadata?.businessKey === p.idempotencyKey || a.metadata?.contextHash === p.contextHash);
  const live=inventories.assistant;
  if (candidates.length !== 1 || candidates[0].id !== p.assistantId || live?.httpStatus !== 200 || live.data?.id !== p.assistantId
    || !containsConfig(config,live.data)) fail('CONNECTION_ASSISTANT_CONFLICT');
  const ownershipOK=r => (!r.metadata?.businessKey || r.metadata.businessKey === p.idempotencyKey)
    && (!r.metadata?.contextHash || r.metadata.contextHash === p.contextHash)
    && [r.businessId,r.metadata?.businessId].every(x=>x === undefined || x === null || x === '');
  const content=assessSignupAssistantContent({expectedConfig:config,liveAssistant:live.data});
  if (!content.passed || assistantStage.result.contentFingerprint !== content.liveFingerprint
    || !ownershipOK(live.data) || !ownershipOK(candidates[0])) fail('CONNECTION_ASSISTANT_PROOF_UNPROVEN');
  const phoneName=buildProvisioningResourceName('vapi-phone',p.idempotencyKey);
  const matching=phones.filter(n => phone(n.number || n.twilioPhoneNumber) === p.number || n.name === phoneName
    || n.assistantId === p.assistantId || n.metadata?.businessKey === p.idempotencyKey || n.metadata?.contextHash === p.contextHash);
  let phoneId=null;
  if (importStage === null) {
    if (matching.length || [attempt,target].some(r=>resourceFields.some(k=>r[k]))) fail('CONNECTION_STATE_CHANGED');
  } else {
    if (importStage?.status !== 'completed' || importStage.contextHash !== p.contextHash
      || importStage.result?.number !== p.number || importStage.result?.assistantId !== p.assistantId || !uuid(importStage.result?.id)) fail('CONNECTION_IMPORT_UNCERTAIN_INSPECT_FIRST');
    phoneId=importStage.result.id;
    const n=matching[0];
    if (matching.length !== 1 || n.id !== phoneId || (n.number || n.twilioPhoneNumber) !== p.number
      || !pending&&n.assistantId !== p.assistantId || n.name !== phoneName || n.smsEnabled !== false || !ownershipOK(n)
      || n.twilioAccountSid && n.twilioAccountSid !== twilioAccountSid) fail('CONNECTION_PHONE_BINDING_UNPROVEN');
    if(pending){
      assertPendingPhone(n,input.pendingGate);
      if(n.provider!=='twilio'||n.twilioAccountSid!==twilioAccountSid||importStage.result.attachedAssistantId!==null
        ||digest(importStage.result.pendingGate)!==digest(gateProof))fail('CONNECTION_PENDING_ROUTE_UNPROVEN');
    }
    if ([attempt,target].some(r => Object.entries({assignedPhone:p.number,twilioPhoneNumber:p.number,vapiAssistantId:p.assistantId,vapiPhoneNumberId:phoneId})
      .some(([k,v]) => r[k] && r[k] !== v))) fail('CONNECTION_ASSOCIATION_CONFLICT');
  }
  if (Object.values(store).some(r => r.signupAttemptId !== p.attemptId
    && (phone(r.twilioPhoneNumber) === p.number || phone(r.assignedPhone) === p.number || r.vapiAssistantId === p.assistantId
      || phoneId && r.vapiPhoneNumberId === phoneId || signupBusinessKey(r) === p.idempotencyKey
      && (resourceFields.some(k=>r[k]) || hasBilling(r))))) fail('CONNECTION_THIRD_OWNER');
  const attemptFields=phoneId ? {assignedPhone:p.number,vapiAssistantId:p.assistantId,vapiPhoneNumberId:phoneId} : null;
  const dashboardFields=phoneId ? {twilioPhoneNumber:p.number,vapiAssistantId:p.assistantId,vapiPhoneNumberId:phoneId} : null;
  const sourceDigest=digest({context,attempt,store,registry,numberStage,assistantStage,importStage,otherAttempts});
  const binding={...Object.fromEntries(scopeFields.map(k=>[k,p[k]])),phoneId,...pending?{routeMode:'setup-pending',pendingGate:gateProof}: {}};
  return {version:1,readOnly:true,ready:false,applyAllowed:false,liveReadinessProven:false,
    phase:phoneId?'prepare_associations_only':'prepare_phone_connection',binding,targetKey,sourceDigest,
    planDigest:digest({binding,sourceDigest}),observedAt:new Date(readWindow.finishedAt).toISOString(),
    proposedAttemptFields:attemptFields,proposedDashboardFields:dashboardFields,
    alreadyAssociated:!!phoneId && Object.entries(attemptFields).every(([k,v])=>attempt[k]===v) && Object.entries(dashboardFields).every(([k,v])=>target[k]===v),
    callAdmission:pending?'blocked':'not-granted',maximumPhoneImports:phoneId?0:1,numbersPurchased:0,signupReplays:0,messages:0,calls:0,billingChanges:0,
    requirements:['Separate explicit approval before application','Fresh exact source/receipt/provider checks at final dispatch',
      pending?'Setup-only import has no attached assistant or fallback; terminal authenticated gate always refuses calls':
        'Prove normal account eligibility and call-admission routing before changing inbound routing; no trial/security bypass',
      'Use durable vapi-import lease/dispatch/uncertainty safeguards; inspect unknown outcomes without another import',
      'Narrow authenticated no-send entry point; NEVER the broad import/recovery route',
      'Existing running dashboard lifecycle fence and single-writer coordination; no independent fence instance',
      'Durable association journal, fresh CAS and crash inspection across SQL/file writes; no automatic rollback or replay'],
    remaining:['Tenant/business mapping ownership and routing admission must be separately verified; no business ID is invented',
      'Trial/eligibility, delivery and completed-signup evidence remain unchanged and unproven',
      'No production runtime/SQL-file adapter is added or proven by this pure preparation helper']};
}
function projectConnectionAssociations(input,expectedPlanDigest) {
  // Rebuild from fresh trusted evidence, not mutable client-selected patch data.
  const plan=prepareNumberConnection(input);
  if (plan.phase !== 'prepare_associations_only' || plan.planDigest !== expectedPlanDigest) fail('CONNECTION_PLAN_CHANGED');
  return {plan,attempt:{...structuredClone(input.attempt),...plan.proposedAttemptFields},
    store:{...structuredClone(input.store),[plan.targetKey]:{...structuredClone(input.store[plan.targetKey]),...plan.proposedDashboardFields}}};
}
module.exports={prepareNumberConnection,projectConnectionAssociations};
