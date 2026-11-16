'use strict';
const crypto=require('node:crypto');
const MESSAGES=Object.freeze({
 // Provider definitions: https://www.twilio.com/docs/api/errors/{code}
 '30007':'Twilio or the carrier filtered this message. The saved code does not identify the exact filtering rule.',
 '21610':'The recipient opted out. Sending must remain blocked; do not work around the opt-out.',
 '21211':'Twilio rejected the destination phone number as invalid or incorrectly formatted.',
 '20003':'Twilio rejected access. Credentials, account scope or permissions require inspection.',
 P2028:'The database transaction expired or closed; this code alone does not establish the exact cause.',
 P2024:'The database connection pool timed out.',
 ETIMEDOUT:'The request timed out. Its external outcome must be checked before retrying.',
 UND_ERR_SOCKET:'The connection closed before the response was confirmed. Do not assume the action did not happen.',
 UND_ERR_CONNECT_TIMEOUT:'The connection could not be established within its time limit.',
 MAKE_SIGNUP_TIMEOUT:'Make did not return a confirmed result before the time limit.',
 MAKE_SIGNUP_UNREACHABLE:'The Make connection failed; completion remains unconfirmed.',
 MAKE_SIGNUP_RESPONSE_INCOMPLETE:'Make returned an incomplete setup result.',
 MAKE_SIGNUP_INCOMPLETE:'Make returned no complete, verified setup result.',
 MAKE_SIGNUP_FAILED:'The Make handoff failed; inspect the exact saved provider steps.',
 SIGNUP_HANDOFF_OUTCOME_UNCERTAIN:'The earlier Make handoff has an unknown outcome; only reconciliation is allowed.',
 SIGNUP_JOB_LEASE_LOST:'This worker lost its execution lease. A replacement may own the work; do not replay it.',
 SIGNUP_JOB_AUTHORIZATION_INVALID:'The verified signup authorization expired or changed before setup could continue.',
 SIGNUP_JOB_BINDING_CONFLICT:'The saved worker job does not match this signup identity.',
 SIGNUP_JOB_SECRET_REQUIRED:'The setup worker signing/encryption configuration is unavailable.',
 PROVISIONING_RECONCILIATION_REQUIRED:'A prior provider action is uncertain and requires receipt inspection before another attempt.',
 SIGNUP_CLOSED:'The signup is closed; delayed work must not reopen it.',
 SIGNUP_SMS_VERIFICATION_NOT_SENT:'The verification text was not confirmed as accepted by the provider.',
 SIGNUP_SMS_VERIFICATION_DELIVERY_FAILED:'Verification text delivery failed.',
 SIGNUP_VERIFICATION_URL_INVALID:'The verification link configuration is invalid.',
 SMTP_NOT_CONFIGURED:'Email delivery is not configured for this operation.',
 SMTP_AUTH_FAILED:'The email service rejected authentication.',
 EAUTH:'The email service rejected authentication.',
 ECONNECTION:'The email service connection failed.',
 ECONNRESET:'The connection was reset before completion was confirmed.',
 EMAIL_DELIVERY_FAILED:'The email service did not confirm acceptance.',
 SMS_DELIVERY_FAILED:'The text service did not confirm acceptance.',
 SMS_SUPPRESSED:'The recipient has opted out; sending is intentionally blocked.',
 TWILIO_MESSAGE_UNDELIVERED:'The provider reports the message was not delivered.',
 SIGNUP_COMPLETION_NO_DELIVERY_CHANNEL:'No usable setup-completion delivery channel was available.',
 STRIPE_TRIAL_CREATION_FAILED:'Stripe did not create a confirmed trial subscription.',
 SIGNUP_BILLING_OWNERSHIP_CONFLICT:'Billing records do not prove a unique subscription for this business.',
 STRIPE_NOT_CONFIGURED:'Stripe is not configured for trial activation.',
 SIGNUP_JOB_FAILED:'The setup worker failed without a more specific saved cause.',
});
function signupDiagnosticError(error={}) {
 const original=error.providerCode || error.code || '',code=['string','number'].includes(typeof original)?String(original):'';
 const numeric=/^\d{5}$/.test(code),known=Object.hasOwn(MESSAGES,code);
 const statusValue=error.providerStatus || error.statusCode || error.status || error.httpStatus;
 const status=['string','number'].includes(typeof statusValue)?Number(statusValue):NaN;
 return {code:known||numeric?code:null,
  message:known?MESSAGES[code]:numeric?'The messaging provider returned error '+code+'. Inspect the matching message receipt; it is not proof that another attempt is safe.'
   :[401,403].includes(status)?'The service rejected access or authentication.':status===429?'The service rate-limited the request.':status>=500&&status<=599?'The service returned a server error; completion is unconfirmed.':'The exact cause was not safely captured. No success or safe retry is implied.',
  httpStatus:Number.isInteger(status)&&status>=400&&status<=599?status:null,
  reference:code&&!known&&!numeric?crypto.createHash('sha256').update(code).digest('hex').slice(0,12):typeof error.reference==='string'&&/^[a-f0-9]{12}$/.test(error.reference)?error.reference:null};
}
module.exports={signupDiagnosticError};
