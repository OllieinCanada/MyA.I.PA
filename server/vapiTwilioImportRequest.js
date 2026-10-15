// Pure validation shared by live signup and the one-step recovery diagnostic.
function buildTwilioImportRequest({ phoneNumber, assistantId, accountSid, authToken, name }) {
  const fail = message => { const error = new Error(message); error.code = 'VAPI_IMPORT_REQUEST_INVALID'; error.statusCode = 400; throw error; };
  if (!/^\+1[2-9]\d{9}$/.test(phoneNumber || '')) fail('A normalized North American number is required.');
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(assistantId || '')) fail('An existing assistant UUID is required.');
  if (!/^AC[a-f0-9]{32}$/i.test(accountSid || '')) fail('A valid Twilio Account SID is required.');
  if (!/^[a-f0-9]{32}$/i.test(authToken || '')) fail('A valid Twilio Auth Token is required.');
  const label = String(name || `${phoneNumber} Number`).trim().replace(/\s+/g, ' ');
  if (!label || label.length > 40) fail('The Vapi phone label must be at most 40 characters.');
  return { twilioPhoneNumber:phoneNumber, twilioAccountSid:accountSid, twilioAuthToken:authToken,
    name:label, assistantId, smsEnabled:false };
}
module.exports = { buildTwilioImportRequest };
