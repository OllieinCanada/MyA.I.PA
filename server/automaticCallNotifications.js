'use strict';
// Backend-only admission. No model-provided approval, recipient or claim token
// can authorize a send. The legacy phone claim endpoint remains closed.
const { assessConfirmationHistory } = require('./callConfirmation');
const { executeCompositeNotifications, getVapiCompositeToolDefinition } = require('./compositeCallNotifications');
const { withDispatchLock, claimNotificationDispatch, completeNotificationDispatch, dispatchContext } = require('./smsNotificationDispatch');
const crypto = require('node:crypto');
const fail = code => Object.assign(new Error(code), { code });
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
// A distinct name prevents this default-off path from changing legacy tools.
const SUMMARY_TOOL = /^send_call_summaries_auto_\d{4}_[a-f0-9]{8}_v\d+$/i;
const CONVERSATION_MAX_AGE_MS = 60000;
function requireFreshConversation(timestamp) {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || Date.now()-timestamp > CONVERSATION_MAX_AGE_MS
    || timestamp-Date.now() > 5000) throw fail('notification_conversation_stale_or_unverified');
}
function targetEnabled(env, businessId) {
  if (env.SMS_AUTOMATIC_NOTIFICATION_ENABLED !== 'true') throw fail('automatic_notification_disabled');
  if (env.SMS_NOTIFICATION_DISPATCH_ENABLED !== 'true') throw fail('notification_dispatch_disabled');
  let ids;
  try { ids = JSON.parse(env.SMS_AUTOMATIC_NOTIFICATION_BUSINESS_IDS || 'null'); } catch { /* Refuse below. */ }
  if (!Array.isArray(ids) || !ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)
    || !ids.includes(businessId)) throw fail('notification_business_not_enabled');
}

function confirmationMessages(message) {
  // Only the authenticated provider's artifact, never tool arguments or an
  // arbitrary transcript/summary supplied by the model. Reject ambiguous forms.
  const rows = message?.artifact?.messages;
  if (!Array.isArray(rows) || !rows.length || rows.length > 1000) throw fail('notification_conversation_required');
  return rows.map(row => {
    if (!row || !['user', 'bot', 'assistant', 'system', 'tool', 'tool_calls', 'tool_call_result'].includes(row.role)) throw fail('notification_conversation_invalid');
    const content = row.message ?? row.content ?? '';
    if (typeof content !== 'string' || content.length > 20000
      || (row.message != null && row.content != null && row.message !== row.content)) throw fail('notification_conversation_invalid');
    return { role: row.role === 'bot' ? 'assistant' : row.role, content };
  });
}
function validateContext(value, call) {
  if (!value || !Number.isSafeInteger(value.businessId) || value.businessId <= 0
    || value.eligible !== true || value.assistantId !== call.assistantId
    || value.phoneNumberId !== call.phoneNumberId || !value.businessName
    || !/^\+[1-9]\d{7,14}$/.test(value.from || '')
    || !/^\+[1-9]\d{7,14}$/.test(value.owner || '')
    || !/^\+[1-9]\d{7,14}$/.test(call.customer?.number || '')) throw fail('notification_route_or_eligibility_unproven');
  return value;
}
function validateArguments(input) {
  const schema = getVapiCompositeToolDefinition().function.parameters;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail('notification_arguments_invalid');
  for (const key of schema.required) if (input[key] == null) throw fail('notification_arguments_invalid');
  for (const [key, value] of Object.entries(input)) {
    const property = schema.properties[key];
    if (!property || typeof value !== property.type
      || (property.type === 'string' && value.length > 1600)
      || (property.enum && !property.enum.includes(value))) throw fail('notification_arguments_invalid');
  }
  if (!input.name.trim() || !input.requestType || input.requestType === 'message' && !String(input.message || '').trim()) throw fail('notification_arguments_invalid');
}
async function executeAutomaticCallNotifications({ prisma, authenticated, message, toolCall, readContext,
  suppressionChecker, env = process.env, fetchImpl = global.fetch }) {
  let actionAttempted = false;
  try {
    if (authenticated !== true) throw fail('notification_webhook_unauthorized');
    if (env.SMS_AUTOMATIC_NOTIFICATION_ENABLED !== 'true') throw fail('automatic_notification_disabled');
    const call = message?.call;
    if (!call || !/^[a-zA-Z0-9][a-zA-Z0-9:_-]{1,179}$/.test(call.id || '')
      || typeof call.assistantId !== 'string' || !call.assistantId
      || typeof call.phoneNumberId !== 'string' || !call.phoneNumberId
      || !SUMMARY_TOOL.test(toolCall?.name || '') || typeof toolCall?.id !== 'string' || !toolCall.id
      || typeof readContext !== 'function' || typeof suppressionChecker !== 'function') throw fail('notification_context_invalid');
    if (message.toolCallList?.length !== 1) throw fail('notification_single_tool_required');
    // Provider SDK timestamp is optional. Missing timestamps must refuse here,
    // not silently turn an old artifact into current send authorization.
    const conversationTimestamp = message.timestamp;
    requireFreshConversation(conversationTimestamp);
    const conversation = confirmationMessages(message);
    // A yes to saving a draft is NOT a yes to send it. Keep the shared legacy
    // draft conversation guard intact; only this automatic path excludes it.
    const proof = assessConfirmationHistory(conversation.map(row => row.role === 'assistant'
      && /should i save this request for review\?/i.test(row.content)
      ? { ...row, content: row.content + ' [Draft review does not authorize sending.]' } : row));
    if (!proof.allowed) return { ok: false, complete: false, actionAttempted: false, needsClarification: true, errorCode: proof.reason };
    const context = validateContext(await readContext(call), call), fingerprint = hash(context);
    targetEnabled(env, context.businessId);
    const args = { ...toolCall.parameters, businessName: context.businessName };
    validateArguments(args);
    if (args.pricingDiscussed === true && !context.pricingOptions) throw fail('notification_pricing_policy_unproven');
    const fresh = async () => {
      targetEnabled(env, context.businessId);
      requireFreshConversation(conversationTimestamp);
      if (hash(validateContext(await readContext(call), call)) !== fingerprint) throw fail('notification_authority_changed');
      // Eligibility reads can wait. Recheck mutable controls after the await.
      targetEnabled(env, context.businessId);
      requireFreshConversation(conversationTimestamp);
    };
    const endpoint = 'https://notification-dispatch.internal/dispatch';
    const check = 'https://notification-suppression.internal/check';
    const provider = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(String(env.TWILIO_ACCOUNT_SID || '').trim())}/Messages.json`;
    const transport = async (url, request) => {
      if (url === endpoint) {
        const input = JSON.parse(request.body);
        if (input.action === 'complete') return { ok: true, json: async () => await completeNotificationDispatch({ prisma, input }) };
        if (input.action !== 'claim' || input.callId !== call.id || input.from !== context.from
          || input.to !== (input.leg === 'owner' ? context.owner : call.customer.number)) throw fail('notification_claim_binding_invalid');
        const { key } = dispatchContext(input);
        const claim = await withDispatchLock(prisma, key, async tx => {
          // Recheck after lock waiting, not only at webhook entry. Admission
          // commits before any provider POST and is never automatically reset.
          await fresh();
          const admission = await claimNotificationDispatch({ prisma: { runtimeStore: tx.runtimeStore, $transaction: fn => fn(tx) }, input });
          if (admission.granted) {
            const row = await tx.runtimeStore.findUnique({ where: { key } });
            await tx.runtimeStore.update({ where: { key }, data: { data: { ...row.data,
              authorization: { version: 1, source: 'authenticated_vapi_conversation', businessId: context.businessId,
                leg: input.leg, callReference: crypto.createHash('sha256').update(call.id).digest('hex'),
                routeHash: fingerprint, conversationHash: hash(conversation), toolCallHash: hash(toolCall.id),
                providerTimestamp: conversationTimestamp,
                authorizedAt: new Date().toISOString() } } } });
          }
          return admission;
        });
        return { ok: true, json: async () => claim };
      }
      if (url === check) {
        await fresh();
        const suppressed = await suppressionChecker(JSON.parse(request.body).phoneNumber);
        if (typeof suppressed !== 'boolean') throw fail('notification_suppression_unavailable');
        return { ok: true, json: async () => ({ allowed: !suppressed, suppressed }) };
      }
      if (url !== provider || request.method !== 'POST') throw fail('notification_transport_refused');
      await fresh();
      targetEnabled(env, context.businessId);
      requireFreshConversation(conversationTimestamp);
      actionAttempted = true;
      return fetchImpl(url, { ...request, redirect: 'error', signal: AbortSignal.timeout(10000) });
    };
    const result = await executeCompositeNotifications({ args,
      env: { TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN,
        TWILIO_API_KEY_SID: env.TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET: env.TWILIO_API_KEY_SECRET,
        TWILIO_STATUS_CALLBACK_URL: env.TWILIO_STATUS_CALLBACK_URL,
        DEFAULT_FROM_NUMBER: context.from, DEFAULT_OWNER_TO_NUMBER: context.owner, OWNER_SMS_ENABLED: 'true',
        CALLER_NUMBER: call.customer.number, CALL_ID: call.id, SMS_NOTIFICATION_DISPATCH_URL: endpoint,
        SMS_SUPPRESSION_CHECK_URL: check, SMS_SUPPRESSION_API_KEY: 'backend-local',
        PRICING_SUMMARY_OPTIONS: context.pricingOptions ? JSON.stringify(context.pricingOptions) : '' },
      fetchImpl: transport, btoaImpl: value => Buffer.from(value).toString('base64'), URLSearchParamsImpl: URLSearchParams });
    return { ...result, actionAttempted, authorization: 'authenticated_provider_conversation', deliveryProven: false };
  } catch (e) {
    // Never expose raw provider/database errors or treat uncertainty as success.
    return { ok: false, complete: false, actionAttempted, requiresInspection: actionAttempted,
      errorCode: /^notification_|^automatic_notification_/.test(e.code || '') ? e.code : 'notification_authority_unavailable' };
  }
}
// Pure migration preparation, never patches a provider. The assistant's existing
// authenticated Server URL must deliver tool-calls with the conversation artifact.
// No Twilio credentials belong in the replacement function tool.
function automaticSummaryToolDefinition(name) {
  if (!SUMMARY_TOOL.test(name || '')) throw fail('notification_tool_name_invalid');
  return { type: 'function', function: { name,
    description: 'After reading back the request and the caller clearly approves sending it now, submit owner and caller confirmation once. A refusal or correction requires clarification and fresh approval. Do not retry uncertain outcomes; do not claim delivery from provider acceptance.',
    parameters: getVapiCompositeToolDefinition().function.parameters } };
}
module.exports = { executeAutomaticCallNotifications, confirmationMessages, SUMMARY_TOOL, automaticSummaryToolDefinition };
