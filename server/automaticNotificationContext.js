'use strict';
const { selectTrialSignup } = require('./trialSignupSelection');
const { getTrialLifecycle } = require('./trialUsagePolicy');
const { normalizeE164 } = require('./compositeCallNotifications');
const { pricingSummaryOptionsFromAssistant } = require('../src/features/signup/pricingPolicy');
const refuse = () => { throw Object.assign(new Error('notification_route_or_eligibility_unproven'), { code: 'notification_route_or_eligibility_unproven' }); };

// Existing exact voice-gate and open-signup selection; no name/contact matching,
// provisioning, subscription updates, trial reservations or provider reads.
function createAutomaticNotificationContextReader({ prisma, readGate, listSignups, resolveBusinessId }) {
  return async call => {
    const routed = await resolveBusinessId(call);
    const gate = await readGate(call);
    if (!gate || gate.status !== 'active' || gate.businessId !== routed
      || gate.assistantId !== call.assistantId || gate.phoneNumberId !== call.phoneNumberId) refuse();
    const signup = selectTrialSignup(listSignups(), gate);
    if (!signup) refuse();
    const lifecycle = getTrialLifecycle(signup);
    if (lifecycle.state !== 'paid' && !(lifecycle.state === 'trial' && lifecycle.endAt > Date.now())) refuse();
    const business = await prisma.business.findUnique({ where: { id: routed }, include: { settings: true } });
    const from = normalizeE164(gate.phoneNumber), owner = normalizeE164(signup.ownerPhone);
    if (!business || business.id !== routed || !business.name || !from || !owner
      || (business.settings?.ownerPhone && normalizeE164(business.settings.ownerPhone) !== owner)
      || normalizeE164(signup.twilioPhoneNumber) !== from
      || (call.phoneNumber?.number && normalizeE164(call.phoneNumber.number) !== from)) refuse();
    return { businessId: routed, businessName: business.name, assistantId: gate.assistantId,
      phoneNumberId: gate.phoneNumberId, from, owner, eligible: true,
      signupAttemptId: signup.signupAttemptId, subscriptionId: signup.subscriptionId,
      lifecycle: lifecycle.state, periodEnd: lifecycle.endAt,
      pricingOptions: pricingSummaryOptionsFromAssistant(gate.assistantSnapshot || {}) };
  };
}
module.exports = { createAutomaticNotificationContextReader };
