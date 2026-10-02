const clean = (value) => String(value || "").trim();
const { isClosedSignup } = require("./signupBusinessIdentity");
const phone = (value) => clean(value).replace(/\D/g, "");

function selectTrialSignup(records = [], config = {}) {
  const subscription = clean(config.subscriptionId);
  const number = phone(config.phoneNumber);
  if (!number || !clean(config.assistantId) || !Number(config.businessId)) return null;
  // Email is contact information, not proof of ownership of a voice route.
  const matches = records.filter((record) => {
    if (phone(record.twilioPhoneNumber) !== number) return false;
    if (subscription && clean(record.subscriptionId) !== subscription) return false;
    if (clean(record.vapiAssistantId) !== clean(config.assistantId)) return false;
    if (record.businessId && Number(record.businessId) !== Number(config.businessId)) return false;
    if (config.phoneNumberId && clean(record.vapiPhoneNumberId) !== clean(config.phoneNumberId)) return false;
    return !isClosedSignup(record) && clean(record.status).toLowerCase() !== "superseded";
  });
  return matches.length === 1 ? matches[0] : null;
}

module.exports = { selectTrialSignup };
