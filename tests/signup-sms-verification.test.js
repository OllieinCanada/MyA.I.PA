const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildSignupVerificationText,
  deliverSignupVerificationText,
  verificationDeliveryFields,
  verificationDeliveryUpdate,
} = require("../server/signupSmsVerification");

const sid = `SM${"b".repeat(32)}`;
const request = { ownerPhone: "9055550123", businessName: "Test Electric", verificationUrl: "https://api.myaipa.ca/verify" };

test("verification polls acceptance to delivery without sending a second text", async () => {
  let sends = 0; let polls = 0;
  const result = await deliverSignupVerificationText({ ...request,
    sendSms: async () => { sends++; return {sid, status:"queued"}; },
    fetchStatus: async () => ({status: ++polls === 1 ? "sent" : "delivered"}), wait: async () => {},
  });
  assert.equal(sends,1); assert.equal(polls,2);
  assert.equal(verificationDeliveryFields(result).smsVerificationDeliveryStatus,"delivered");
});

test("missing delivery proof stays pending; provider rejection is recorded separately", async () => {
  const pending = await deliverSignupVerificationText({...request,sendSms:async()=>({sid,status:"queued"}),fetchStatus:async()=>{throw new Error("timeout");}});
  assert.equal(verificationDeliveryFields(pending).smsVerificationDeliveryStatus,"pending");
  const failed = await deliverSignupVerificationText({...request,sendSms:async()=>({sid,status:"queued"}),fetchStatus:async()=>({status:"undelivered",errorCode:30007})});
  assert.equal(verificationDeliveryFields(failed).smsVerificationDeliveryStatus,"failed");
  assert.equal(verificationDeliveryFields(failed).smsVerificationErrorCode,30007);
});

test("slow carrier delivery has bounded polls and never triggers an automatic resend", async () => {
  let polls=0; let sends=0;
  const result=await deliverSignupVerificationText({...request,
    sendSms:async()=>{sends++;return {sid,status:"queued"};},
    fetchStatus:async()=>{polls++;return {status:"sent"};},wait:async()=>{},
  });
  assert.equal(polls,3); assert.equal(sends,1);
  assert.equal(verificationDeliveryFields(result).smsVerificationDeliveryStatus,"pending");
});

test("delivery callbacks require exact SID and cannot downgrade confirmed delivery", () => {
  const signup={smsVerificationMessageSid:sid,smsVerificationDeliveryStatus:"pending"};
  assert.equal(verificationDeliveryUpdate(signup,{sid:`SM${"c".repeat(32)}`,status:"delivered"}),null);
  const delivered=verificationDeliveryUpdate(signup,{sid,status:"delivered"});
  assert.equal(delivered.smsVerificationDeliveryStatus,"delivered");
  assert.equal(verificationDeliveryUpdate({...signup,...delivered},{sid,status:"sent"}),null);
});

test("successful HTTP responses without a Twilio message ID do not count as sent", async () => {
  await assert.rejects(deliverSignupVerificationText({...request,sendSms:async()=>({status:"queued"})}),error=>error.code==="SIGNUP_SMS_VERIFICATION_NOT_SENT");
});

test("website signup verification text contains the secure link and expiry", () => {
  const text = buildSignupVerificationText({
    businessName: "Test Electric",
    verificationUrl: "https://api.myaipa.ca/api/integrations/verify-signup-contact?token=signed",
  });
  assert.match(text, /Test Electric/);
  assert.match(text, /verify-signup-contact\?token=signed/);
  assert.match(text, /expires in 24 hours/i);
  assert.match(text, /number will appear on the page/i);
  assert.doesNotMatch(text, /then press Verify and continue/i);
});

test("website signup verification requires a real provider acceptance", async () => {
  await assert.rejects(
    deliverSignupVerificationText({
      ownerPhone: "905-555-0123",
      businessName: "Test Electric",
      verificationUrl: "https://api.myaipa.ca/api/integrations/verify-signup-contact?token=signed",
      sendSms: async () => ({ mocked: true }),
    }),
    (error) => error.code === "SIGNUP_SMS_VERIFICATION_NOT_SENT" && error.statusCode === 503
  );
});

test("website signup verification normalizes the destination without making a paid call", async () => {
  let request;
  const delivered = await deliverSignupVerificationText({
    ownerPhone: "(905) 555-0123",
    businessName: "Test Electric",
    verificationUrl: "https://api.myaipa.ca/api/integrations/verify-signup-contact?token=signed",
    sendSms: async (value) => {
      request = value;
      return { mocked: false, provider: "test", sid: `SM${"a".repeat(32)}`, status: "queued" };
    },
  });
  assert.equal(request.to, "+19055550123");
  assert.equal(delivered.to, "+19055550123");
  assert.match(request.message, /tap to verify your phone/i);
  assert.match(request.message, /Welcome, Test Electric! Signup received/);
  assert.doesNotMatch(request.message, /Signup complete|setup is ready/i);
});

test("website signup verification rejects non-HTTPS links and malformed phones", async () => {
  await assert.rejects(
    deliverSignupVerificationText({ ownerPhone: "not-a-phone", verificationUrl: "https://api.myaipa.ca/verify" }),
    /valid E\.164 phone number/i
  );
  await assert.rejects(
    deliverSignupVerificationText({ ownerPhone: "+19055550123", verificationUrl: "http://api.myaipa.ca/verify" }),
    (error) => error.code === "SIGNUP_VERIFICATION_URL_INVALID"
  );
});
