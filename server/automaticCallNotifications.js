'use strict';
// Automatic candidate: caller approval, not admin approval. No provider/tool
// credentials or model-provided approval flags are accepted as consent proof.
const { assessConfirmationHistory } = require('./callConfirmation');
const { prepareNotificationDraft, dispatchConfirmedNotification } = require('./smsNotificationDrafts');
const { buildOwnerBody, buildCustomerBody, normalizeE164, executeCompositeNotifications } = require('./compositeCallNotifications');
const { dispatchContext } = require('./smsNotificationDispatch');
const fail = code => Object.assign(new Error(code), { code, statusCode: 409 });
const fields = ['businessName', 'requestType', 'name', 'rawPhoneNumber', 'callbackNumber', 'jobDetails', 'streetAddress',
  'city', 'preferredStartDate', 'bestCallbackTime', 'urgency', 'safetyConcern', 'pricingDiscussed', 'workDetailsConfirmed', 'message'];
const canonical = args => JSON.stringify(fields.map(key => [key, args?.[key] ?? null]));

function validateAutomaticArguments(leg, args) {
  if (!['owner', 'customer'].includes(leg) || !args || typeof args !== 'object' || Array.isArray(args)
    || Object.keys(args).some(key => !fields.includes(key))) throw fail('automatic_notification_input_invalid');
  const definition = require('./compositeCallNotifications').getAutomaticVapiCompositeToolDefinition().function.parameters;
  for (const [key, value] of Object.entries(args)) {
    const rule = definition.properties[key];
    if (!rule || typeof value !== rule.type || rule.type === 'string' && value.length > 1600
      || rule.enum && !rule.enum.includes(value)) throw fail('automatic_notification_input_invalid');
  }
  if (definition.required.some(key => args[key] == null)) throw fail('automatic_notification_input_invalid');
}
function confirmedInput({ call, route, callId, leg, args, now = Date.now() }) {
  validateAutomaticArguments(leg, args);
  if (call?.id !== callId || !['in-progress', 'ended'].includes(call.status)
    || !Number.isFinite(Date.parse(call.startedAt)) || now - Date.parse(call.startedAt) < 0
    || now - Date.parse(call.startedAt) > 30 * 60 * 1000
    || call.status === 'ended' && (!Number.isFinite(Date.parse(call.endedAt)) || now - Date.parse(call.endedAt) > 120000)) {
    throw fail('automatic_notification_call_unverified');
  }
  const from = normalizeE164(route?.from), owner = normalizeE164(route?.owner), customer = normalizeE164(call.customer?.number);
  if (!from || !owner || !customer || route.assistantId !== call.assistantId
    || normalizeE164(call.phoneNumber?.number) !== from || route.ownerEnabled !== true && leg === 'owner'
    || !route.businessName || args.businessName !== route.businessName
    || typeof route.pricingOptions?.includePartsExtra !== 'boolean'
    || typeof route.pricingOptions?.includeAssessment !== 'boolean') throw fail('automatic_notification_route_unverified');
  // Require one exact provider-read history representation, not a transcript or
  // a history/boolean supplied by the caller of our integration endpoint.
  const messages = call.artifact?.messagesOpenAIFormatted;
  if (!Array.isArray(messages) || messages.length > 1000 || messages.some(m =>
    !m || !['system', 'user', 'assistant', 'tool', 'tool_call_result', 'tool_calls'].includes(m.role)
    || m.role === 'user' && (typeof m.content !== 'string' || m.final === false || m.transcriptType === 'partial'))) {
    throw fail('automatic_notification_history_unverified');
  }
  const permission = assessConfirmationHistory(messages, { allowDraftQuestion: false });
  if (!permission.allowed) throw fail(permission.reason);
  const invocations = messages.flatMap(m => m.tool_calls || []).filter(t => /^send_call_summaries_/i.test(t?.function?.name || ''));
  const last = invocations.at(-1);
  let observedArgs;
  try { observedArgs = typeof last?.function?.arguments === 'string' ? JSON.parse(last.function.arguments) : last?.function?.arguments; }
  catch { throw fail('automatic_notification_arguments_unverified'); }
  if (!observedArgs || canonical(observedArgs) !== canonical(args)) throw fail('automatic_notification_arguments_unverified');
  const summary = { ...args, ...route.pricingOptions, rawPhoneNumber: customer, businessName: route.businessName };
  return { callId, from, to: leg === 'owner' ? owner : customer, leg,
    body: leg === 'owner' ? buildOwnerBody(summary) : buildCustomerBody(summary) };
}

function automaticNotificationHandler({ prisma, env = process.env, authenticate, loadEvidence, suppressionChecker, fetchImpl }) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (typeof authenticate !== 'function' || !authenticate(req)) return res.status(401).json({ schemaVersion: 1, errorCode: 'notification_dispatch_unauthorized' });
    if (env.SMS_AUTOMATIC_DISPATCH_ENABLED !== 'true') return res.status(503).json({ schemaVersion: 1, errorCode: 'automatic_notification_dispatch_disabled' });
    try {
      const { callId, leg, args } = req.body || {};
      if (req.body?.action !== 'send-confirmed' || !/^[a-f0-9-]{36}$/i.test(String(callId || '')) || Object.keys(req.body || {}).some(k => !['action', 'callId', 'leg', 'args'].includes(k))) {
        throw fail('automatic_notification_input_invalid');
      }
      validateAutomaticArguments(leg, args);
      // A bounded authenticated provider GET, not a retrying mutation. Missing
      // active-call artifacts fail closed and must be checked before rollout.
      const { call, route } = await loadEvidence(callId);
      const input = confirmedInput({ call, route, callId, leg, args });
      // Reuse the existing deterministic intake checks before storing/admitting.
      // This local adapter performs no network calls and cannot submit anything.
      const intake = await executeCompositeNotifications({ args, env: { CALLER_NUMBER: input.to,
        OWNER_SMS_ENABLED: 'false', PRICING_SUMMARY_OPTIONS: JSON.stringify(route.pricingOptions) },
        fetchImpl: async () => { throw fail('intake_must_not_send'); } });
      if (intake.needsIntakeDetails || intake.needsCustomerNumber) throw fail('automatic_notification_intake_required');
      const draft = await prepareNotificationDraft({ prisma, input });
      const { contextHash } = dispatchContext(input);
      const sent = await dispatchConfirmedNotification({ prisma, id: draft.draftId,
        expectedRevision: draft.revision, expectedHash: contextHash, env, suppressionChecker, fetchImpl,
        authorize: data => data.contextHash === contextHash });
      const receipt = sent.result;
      return res.json({ schemaVersion: 1, ...(receipt || { attempted: false, sent: false, status: 'held', requiresReconciliation: true }),
        dispatchReceiptStored: sent.state === 'completed', requiresApproval: false });
    } catch (e) {
      return res.status(e.statusCode || 503).json({ schemaVersion: 1, sent: false,
        errorCode: e.statusCode ? e.code : 'automatic_notification_evidence_unavailable', requiresReconciliation: true });
    }
  };
}

function createVapiAutomaticEvidenceReader({ prisma, env = process.env, listEligibleSignups, fetchImpl = global.fetch }) {
  return async callId => {
    const signal = AbortSignal.timeout(8000); // Whole read budget; never retry.
    async function get(resource, id) {
      if (!env.VAPI_API_KEY || !/^[a-zA-Z0-9-]{1,100}$/.test(String(id || ''))) throw fail('automatic_notification_evidence_unavailable');
      const response = await fetchImpl(`https://api.vapi.ai/${resource}/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${env.VAPI_API_KEY}`, Accept: 'application/json' }, redirect: 'error', signal });
      if (!response.ok) throw fail('automatic_notification_evidence_unavailable');
      return response.json();
    }
    const call = await get('call', callId);
    const allowed = String(env.SMS_AUTOMATIC_ASSISTANT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.includes(call.assistantId)) throw fail('automatic_notification_assistant_not_enabled');
    const signups = listEligibleSignups().filter(s => s.vapiAssistantId === call.assistantId
      && normalizeE164(s.twilioPhoneNumber) === normalizeE164(call.phoneNumber?.number));
    if (signups.length !== 1 || !signups[0].businessId) throw fail('automatic_notification_route_unverified');
    const signup = signups[0];
    const business = await prisma.business.findUnique({ where: { id: Number(signup.businessId) }, include: { settings: true } });
    if (!business || normalizeE164(business.settings?.ownerPhone) !== normalizeE164(signup.ownerPhone)) throw fail('automatic_notification_route_unverified');
    const assistant = await get('assistant', call.assistantId);
    const toolIds = assistant.model?.toolIds;
    if (!Array.isArray(toolIds) || !toolIds.length || toolIds.length > 4 || !assistant.model.messages?.some(m =>
      m.role === 'system' && String(m.content).includes('AUTOMATIC CALLER CONFIRMATION'))) throw fail('automatic_notification_configuration_unverified');
    const tools = await Promise.all(toolIds.map(id => get('tool', id)));
    const name = (call.artifact?.messagesOpenAIFormatted || []).flatMap(m => m.tool_calls || [])
      .filter(t => /^send_call_summaries_/i.test(t?.function?.name || '')).at(-1)?.function?.name;
    const matches = tools.filter(t => t.function?.name === name);
    if (matches.length !== 1) throw fail('automatic_notification_configuration_unverified');
    const tool = matches[0], entries = tool.environmentVariables || [];
    if (new Set(entries.map(e => e.name)).size !== entries.length) throw fail('automatic_notification_configuration_unverified');
    const settings = Object.fromEntries(entries.map(e => [e.name, e.value]));
    const { getAutomaticVapiCompositeToolDefinition } = require('./compositeCallNotifications');
    require('./smsDispatchReadiness').assertDispatchEnvironment(entries);
    if (tool.code !== getAutomaticVapiCompositeToolDefinition().code
      || settings.CALLER_NUMBER !== '{{ customer.number }}'
      || normalizeE164(settings.DEFAULT_FROM_NUMBER) !== normalizeE164(signup.twilioPhoneNumber)
      || normalizeE164(settings.DEFAULT_OWNER_TO_NUMBER) !== normalizeE164(signup.ownerPhone)) throw fail('automatic_notification_configuration_unverified');
    const pricingOptions = require('../src/features/signup/pricingPolicy').pricingSummaryOptionsFromAssistant(assistant)
      || { includePartsExtra: true, includeAssessment: true };
    return { call, route: { assistantId: call.assistantId, from: settings.DEFAULT_FROM_NUMBER,
      owner: settings.DEFAULT_OWNER_TO_NUMBER, businessName: business.name,
      ownerEnabled: String(settings.OWNER_SMS_ENABLED ?? 'true') !== 'false', pricingOptions } };
  };
}
module.exports = { automaticNotificationHandler, confirmedInput, createVapiAutomaticEvidenceReader };
