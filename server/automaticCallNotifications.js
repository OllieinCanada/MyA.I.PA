'use strict';
// Function-tool webhooks carry live context; never poll GET /call to authorize.
const { assessConfirmationHistory } = require('./callConfirmation');
const { normalizeVapiToolCall, validateVapiToolArguments } = require('./vapiToolCalls');
const { prepareNotificationDraft, dispatchConfirmedNotification } = require('./smsNotificationDrafts');
const { buildOwnerBody, buildCustomerBody, normalizeE164, notificationIntakeMissingFields,
  getAutomaticVapiCompositeToolDefinition, AUTOMATIC_NOTIFICATION_TOOL } = require('./compositeCallNotifications');
const { dispatchContext } = require('./smsNotificationDispatch');
const fail = code => Object.assign(new Error(code), { code, statusCode: 409 });

function validateAutomaticArguments(args) {
  const definition = getAutomaticVapiCompositeToolDefinition().function.parameters;
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw fail('automatic_notification_input_invalid');
  for (const [key, value] of Object.entries(args)) {
    const rule = definition.properties[key];
    if (!rule || typeof value !== rule.type || rule.type === 'string' && value.length > 1600
      || rule.enum && !rule.enum.includes(value)) throw fail('automatic_notification_input_invalid');
  }
  if (definition.required.some(key => args[key] == null)) throw fail('automatic_notification_input_invalid');
  if (notificationIntakeMissingFields(args).length) throw fail('automatic_notification_intake_required');
}
function confirmWebhook({ message, rawToolCall, route }) {
  const admission = validateVapiToolArguments(rawToolCall);
  if (!admission.ok) throw fail(admission.errorCode);
  const tool = normalizeVapiToolCall(rawToolCall), args = tool.parameters;
  if (message?.type !== 'tool-calls' || tool.name !== AUTOMATIC_NOTIFICATION_TOOL || !tool.id) throw fail('automatic_notification_invocation_invalid');
  validateAutomaticArguments(args);
  const call = message.call;
  if (!/^[a-f0-9-]{36}$/i.test(String(call?.id || ''))) throw fail('automatic_notification_call_unverified');
  // Only the live message artifact is accepted. call.artifact can be stale.
  const histories = [];
  if (Array.isArray(message.artifact?.messagesOpenAIFormatted)) histories.push(message.artifact.messagesOpenAIFormatted);
  if (Array.isArray(message.artifact?.messages)) histories.push(message.artifact.messages.map(m =>
    m && ({ ...m, role: m.role === 'bot' ? 'assistant' : m.role, content: m.message ?? m.content })));
  if (!histories.length) throw fail('automatic_notification_history_unverified');
  for (const messages of histories) {
    if (messages.length > 1000 || messages.some(m => !m
      || !['system', 'user', 'assistant', 'tool', 'tool_call_result', 'tool_calls'].includes(m.role)
      || m.role === 'user' && (typeof m.content !== 'string' || m.final === false || m.transcriptType === 'partial'))) {
      throw fail('automatic_notification_history_unverified');
    }
    const permission = assessConfirmationHistory(messages, { allowDraftQuestion: false });
    if (!permission.allowed) throw fail(permission.reason);
  }
  const numbers = [message.phoneNumber?.number, call.phoneNumber?.number].filter(Boolean).map(normalizeE164);
  const callers = [message.customer?.number, call.customer?.number].filter(Boolean).map(normalizeE164);
  const assistants = [call.assistantId, message.assistant?.id].filter(Boolean);
  const from = normalizeE164(route?.from), owner = normalizeE164(route?.owner);
  if (!from || !owner || !numbers.length || numbers.some(n => n !== from)
    || !callers.length || !callers[0] || callers.some(n => n !== callers[0])
    || !route.assistantId || assistants.some(id => id !== route.assistantId)
    || typeof route.ownerEnabled !== 'boolean' || args.businessName !== route.businessName
    || typeof route.pricingOptions?.includePartsExtra !== 'boolean'
    || typeof route.pricingOptions?.includeAssessment !== 'boolean') throw fail('automatic_notification_route_unverified');
  const summary = { ...args, ...route.pricingOptions, rawPhoneNumber: callers[0], businessName: route.businessName };
  return { tool, inputs: [
    ...(route.ownerEnabled ? [{ callId: call.id, from, to: owner, leg: 'owner', body: buildOwnerBody(summary) }] : []),
    { callId: call.id, from, to: callers[0], leg: 'customer', body: buildCustomerBody(summary) }
  ] };
}
async function handleAutomaticNotificationTool({ message, rawToolCall, authenticated, prisma, loadRoute,
  env = process.env, suppressionChecker, fetchImpl }) {
  if (authenticated !== true) throw fail('automatic_notification_unauthorized');
  if (env.SMS_AUTOMATIC_DISPATCH_ENABLED !== 'true') throw fail('automatic_notification_dispatch_disabled');
  const admission = validateVapiToolArguments(rawToolCall);
  if (!admission.ok) throw fail(admission.errorCode);
  validateAutomaticArguments(normalizeVapiToolCall(rawToolCall).parameters);
  const route = await loadRoute(message);
  const { inputs } = confirmWebhook({ message, rawToolCall, route });
  const result = { owner: { attempted: false, sent: false, skipped: true, status: 'disabled_by_policy' } };
  for (const input of inputs) {
    try {
      const draft = await prepareNotificationDraft({ prisma, input });
      const { contextHash } = dispatchContext(input);
      const sent = await dispatchConfirmedNotification({ prisma, id: draft.draftId,
        expectedRevision: draft.revision, expectedHash: contextHash, env, suppressionChecker, fetchImpl,
        authorize: data => data.contextHash === contextHash });
      result[input.leg] = { ...(sent.result || { attempted: false, sent: false, status: 'held', requiresReconciliation: true }),
        dispatchReceiptStored: sent.state === 'completed' };
    } catch {
      // An earlier request may have completed; never retry or claim no attempt.
      result[input.leg] = { attempted: null, sent: false, status: 'unconfirmed', requiresReconciliation: true };
    }
  }
  const accepted = r => r?.sent === true && /^(?:SM|MM)[a-f0-9]{32}$/i.test(r.messageId || '') && r.dispatchReceiptStored === true;
  const complete = accepted(result.customer) && (!route.ownerEnabled || accepted(result.owner));
  return { ...result, ok: complete, complete, requiresApproval: false, ownerSmsEnabled: route.ownerEnabled,
    requiresReconciliation: !complete, status: complete ? 'submitted' : 'unconfirmed' };
}

// Select the existing server-owned voice-route snapshot, not a fallback business
// or model metadata. The one-time policy is prepared at reviewed migration.
function createAutomaticWebhookRouteLoader({ prisma, readGate, selectSignup, env = process.env }) {
  return async message => {
    const call = message.call || {}, phone = message.phoneNumber || call.phoneNumber;
    const phoneIds = [message.phoneNumber?.id, call.phoneNumberId, call.phoneNumber?.id].filter(Boolean);
    if (new Set(phoneIds).size > 1) throw fail('automatic_notification_route_unverified');
    const gate = await readGate({ ...call, phoneNumber: phone });
    const allowed = String(env.SMS_AUTOMATIC_ASSISTANT_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!gate || gate.status !== 'active' || !allowed.includes(gate.assistantId)
      || gate.automaticSms?.version !== 1 || typeof gate.automaticSms.ownerEnabled !== 'boolean') throw fail('automatic_notification_route_unverified');
    const signup = await selectSignup(gate);
    if (!signup || Number(signup.businessId) !== Number(gate.businessId)
      || signup.vapiAssistantId !== gate.assistantId || normalizeE164(signup.twilioPhoneNumber) !== normalizeE164(gate.phoneNumber)) throw fail('automatic_notification_route_unverified');
    const business = await prisma.business.findUnique({ where: { id: Number(gate.businessId) }, include: { settings: true } });
    if (!business || !normalizeE164(signup.ownerPhone)
      || normalizeE164(business.settings?.ownerPhone) !== normalizeE164(signup.ownerPhone)) throw fail('automatic_notification_route_unverified');
    const pricingOptions = require('../src/features/signup/pricingPolicy').pricingSummaryOptionsFromAssistant(gate.assistantSnapshot)
      || { includePartsExtra: true, includeAssessment: true };
    return { assistantId: gate.assistantId, from: gate.phoneNumber, owner: signup.ownerPhone,
      businessName: business.name, ownerEnabled: gate.automaticSms.ownerEnabled, pricingOptions };
  };
}
module.exports = { handleAutomaticNotificationTool, confirmWebhook, createAutomaticWebhookRouteLoader };
