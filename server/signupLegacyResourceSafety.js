const { isClosedSignup, signupBusinessKey } = require('./signupBusinessIdentity');
const { normalizeNorthAmericanE164 } = require('./canadianPhoneNumber');

function resourceError(code, message, statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode, provider: 'DATABASE', failedStage: 'BACKEND_REQUEST' });
}

async function assertLegacyBusinessResourcesSafe({ records, businessKey, attemptId, hasResources, inspectArchived }) {
  for (const record of records) {
    if (record.signupAttemptId === attemptId || signupBusinessKey(record) !== businessKey
      || !hasResources(record)) continue;
    if (!isClosedSignup(record) && record.provisioningBusinessKey) continue;
    if (!isClosedSignup(record)) {
      throw resourceError('SIGNUP_BUSINESS_MIGRATION_REQUIRED', 'An active older setup still owns business resources. Identity migration is required before retrying.');
    }
    let evidence;
    try { evidence = await inspectArchived(record); } catch {
      throw resourceError('SIGNUP_ARCHIVED_RESOURCES_UNVERIFIED', 'The old setup is archived, but its live resources could not be checked. Setup stopped to prevent duplicates.', 503);
    }
    if (evidence?.state === 'live') {
      throw resourceError('SIGNUP_ARCHIVED_RESOURCES_STILL_OWNED', 'The old setup is archived, but its phone, assistant or billing resources still exist. Reconcile them before creating a replacement.');
    }
    if (evidence?.state !== 'absent') {
      throw resourceError('SIGNUP_ARCHIVED_RESOURCES_UNVERIFIED', 'The old setup is archived, but its live resources could not be checked. Setup stopped to prevent duplicates.', 503);
    }
    // Historical identifiers stay intact for audit. Only positive provider
    // evidence of absence allows this old receipt to stop blocking a new setup.
  }
}

async function inspectArchivedSignupResources(record, { readTwilioNumbers, readVapi, readSubscription, readCheckout, readCustomerSubscriptions }) {
  let live = false;
  const phone = record.twilioPhoneNumber || record.assignedPhone;
  if (phone) {
    const numbers = await readTwilioNumbers();
    const normalized = normalizeNorthAmericanE164(phone);
    if (!normalized || !Array.isArray(numbers)) throw new Error('Phone ownership evidence is invalid.');
    live ||= numbers.some(n => normalizeNorthAmericanE164(n.phone_number) === normalized);
  }
  for (const [resource, id] of [['assistant', record.vapiAssistantId], ['phone-number', record.vapiPhoneNumberId]]) {
    if (id) live = Boolean(await readVapi(resource, id)) || live;
  }
  const subscriptionId = record.subscriptionId || record.stripeSubscriptionId;
  const checkoutId = record.checkoutSessionId;
  const customerId = record.customerId || record.stripeCustomerId;
  if (subscriptionId) {
    const sub = await readSubscription(subscriptionId);
    live ||= Boolean(sub && !['canceled', 'incomplete_expired'].includes(sub.status));
  }
  if (checkoutId) {
    const checkout = await readCheckout(checkoutId);
    live ||= Boolean(checkout && checkout.status === 'open');
    if (checkout?.subscription && !subscriptionId) {
      const sub = await readSubscription(typeof checkout.subscription === 'string' ? checkout.subscription : checkout.subscription.id);
      live ||= Boolean(sub && !['canceled', 'incomplete_expired'].includes(sub.status));
    }
  }
  if (customerId) {
    const subscriptions = await readCustomerSubscriptions(customerId);
    live ||= subscriptions.some(s => !['canceled', 'incomplete_expired'].includes(s.status));
  }
  // A bare billing status without a queryable reference is not proof of absence.
  if (!subscriptionId && !customerId && !checkoutId && ['active', 'trialing', 'paid', 'complete', 'completed'].includes(String(record.subscriptionStatus || record.paymentStatus || record.checkoutStatus || '').toLowerCase())) {
    return { state: live ? 'live' : 'unknown' };
  }
  return { state: live ? 'live' : 'absent' };
}

module.exports = { assertLegacyBusinessResourcesSafe, inspectArchivedSignupResources };
