const test = require("node:test");
const assert = require("node:assert/strict");
const { buildVapiSmsRequest, getVapiSmsConfig, sendSmsViaVapi } = require("../server/vapiSms");

test("Vapi SMS request uses direct Twilio transport without LLM rewriting", () => {
  const config = { assistantId: "assistant-1", phoneNumberId: "phone-1" };
  const body = buildVapiSmsRequest({ to: "905-555-1234", message: "Lead alert", config });
  assert.equal(body.assistantId, "assistant-1");
  assert.equal(body.input, "Lead alert");
  assert.deepEqual(body.transport, {
    provider: "twilio",
    phoneNumberId: "phone-1",
    customer: { number: "+19055551234" },
    useLLMGeneratedMessageForOutbound: false,
  });
});

test("Vapi SMS client posts to the Chat API and returns acceptance identifiers", async () => {
  let request;
  const result = await sendSmsViaVapi({
    to: "+12495550123",
    message: "New quote lead",
    env: {
      NODE_ENV: "test",
      VAPI_API_KEY: "test-key",
      VAPI_API_BASE_URL: "https://api.vapi.ai",
      VAPI_SMS_ASSISTANT_ID: "assistant-1",
      VAPI_SMS_PHONE_NUMBER_ID: "phone-1",
    },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ id: "chat-1", messageId: "message-1", sessionId: "session-1" }) };
    },
  });
  assert.equal(request.url, "https://api.vapi.ai/chat");
  assert.equal(request.options.method, "POST");
  assert.match(request.options.headers.authorization, /^Bearer /);
  assert.equal(JSON.parse(request.options.body).transport.useLLMGeneratedMessageForOutbound, false);
  assert.equal(result.requestId, "chat-1");
  assert.equal(result.messageId, "message-1");
});

test("production requires the three Vapi SMS settings", async () => {
  assert.deepEqual(getVapiSmsConfig({}), {
    apiKey: "",
    apiBaseUrl: "https://api.vapi.ai",
    assistantId: "",
    phoneNumberId: "",
  });
  await assert.rejects(
    () => sendSmsViaVapi({ to: "+12495550123", message: "Lead", env: { NODE_ENV: "production" } }),
    /Vapi SMS is not configured/
  );
});

const fixtureEnv={NODE_ENV:'test',VAPI_API_KEY:'fixture-only',VAPI_SMS_ASSISTANT_ID:'fixture-assistant',VAPI_SMS_PHONE_NUMBER_ID:'fixture-phone'};
test('network loss and identifier-free responses retain uncertain attempted state',async()=>{
 for(const fetchImpl of [async()=>{throw Error('fixture timeout');},async()=>({ok:true,json:async()=>({})})]){
  await assert.rejects(sendSmsViaVapi({to:'+15555550100',message:'Fixture',env:fixtureEnv,fetchImpl}),e=>e.providerActionAttempted===true&&e.providerCode==='VAPI_SMS_OUTCOME_UNCERTAIN');
 }
});
test('input validation refuses before transport and explicitly proves no provider attempt',async()=>{let calls=0;
 await assert.rejects(sendSmsViaVapi({to:'invalid',message:'Fixture',env:fixtureEnv,fetchImpl:async()=>{calls++;}}),e=>e.providerActionAttempted===false);assert.equal(calls,0);
});
test('an HTTP error is not silently treated as a supported safe-to-resend guarantee',async()=>{
 await assert.rejects(sendSmsViaVapi({to:'+15555550100',message:'Fixture',env:fixtureEnv,fetchImpl:async()=>({ok:false,status:500,json:async()=>({code:'fixture'})})}),e=>e.providerActionAttempted===true&&e.providerStatus===500);
});
