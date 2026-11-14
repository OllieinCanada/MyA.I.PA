const assert = require("node:assert/strict");
const { test } = require("node:test");

const { ensureTelegramActionWebhook, telegramWebhookFailureDiagnostics } = require("../server/telegramBotApi");

test("guarded Telegram webhook activation sets only callback updates and verifies the retained URL", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const method = url.split("/").pop();
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    return {
      ok: true,
      status: 200,
      json: async () => method === "setWebhook"
        ? { ok: true, result: true }
        : { ok: true, result: { url: "https://api.myaipa.ca/api/webhooks/telegram/actions" } },
    };
  };
  const result = await ensureTelegramActionWebhook({
    webhookUrl: "https://api.myaipa.ca/api/webhooks/telegram/actions",
    webhookSecret: "w".repeat(32),
  }, { token: "test-bot-token", fetchImpl });

  assert.equal(result.configured, true);
  assert.deepEqual(calls[0], {
    method: "setWebhook",
    body: {
      url: "https://api.myaipa.ca/api/webhooks/telegram/actions",
      secret_token: "w".repeat(32),
      allowed_updates: ["callback_query"],
      drop_pending_updates: false,
    },
  });
  assert.equal(calls[1].method, "getWebhookInfo");
});

test("guarded Telegram webhook activation rejects unsafe configuration", async () => {
  await assert.rejects(
    ensureTelegramActionWebhook({ webhookUrl: "http://example.com/callback", webhookSecret: "w".repeat(32) }, { token: "x" }),
    /credential-free HTTPS/i
  );
  await assert.rejects(
    ensureTelegramActionWebhook({ webhookUrl: "https://example.com/callback", webhookSecret: "short" }, { token: "x" }),
    /32-character/i
  );
});

for (const stage of ['setWebhook','getWebhookInfo']) {
  for (const bodyTimeout of [false,true]) test(`webhook ${stage} ${bodyTimeout ? 'body' : 'transport'} timeout has sanitized stage and no retry`,async()=>{
    const calls=[];
    const failure=()=>{throw new DOMException('PRIVATE_TOKEN_PRIVATE_URL','TimeoutError');};
    const fetchImpl=async url=>{
      const method=url.split('/').pop();calls.push(method);
      if(method===stage && !bodyTimeout)failure();
      return {ok:true,status:200,json:async()=>{if(method===stage && bodyTimeout)failure();return{ok:true,result:true};}};
    };
    await assert.rejects(ensureTelegramActionWebhook({webhookUrl:'https://example.invalid/callback',webhookSecret:'x'.repeat(32)},{token:'PRIVATE_TOKEN',fetchImpl}),error=>{
      const diagnostic=telegramWebhookFailureDiagnostics(error);
      assert.equal(diagnostic.code,'TELEGRAM_WEBHOOK_REQUEST_TIMEOUT');assert.equal(diagnostic.stage,stage);
      assert.equal(diagnostic.outcome,stage==='setWebhook'?'configuration_unconfirmed':'verification_unavailable');
      assert.equal(diagnostic.automaticRetry,false);
      assert.doesNotMatch(JSON.stringify([error,diagnostic]),/PRIVATE_|example.invalid|secret|https:/);
      return true;
    });
    assert.deepEqual(calls,stage==='setWebhook'?['setWebhook']:['setWebhook','getWebhookInfo']);
  });
}
test('rejected webhook and unknown network errors retain sanitized distinction',async()=>{
  for(const rejected of [true,false])await assert.rejects(ensureTelegramActionWebhook({webhookUrl:'https://example.invalid/callback',webhookSecret:'x'.repeat(32)},
    {token:'PRIVATE_TOKEN',fetchImpl:async()=>{if(!rejected)throw Error('PRIVATE_TOKEN');return{ok:false,status:401,json:async()=>({ok:false,description:'PRIVATE_TOKEN'})};}}),error=>{
      const d=telegramWebhookFailureDiagnostics(error);assert.equal(d.stage,'setWebhook');
      assert.equal(d.code,rejected?'TELEGRAM_ACTION_RESPONSE_FAILED':'TELEGRAM_WEBHOOK_REQUEST_FAILED');
      assert.doesNotMatch(JSON.stringify(d),/PRIVATE_TOKEN|401/);return true;
    });
  assert.deepEqual(telegramWebhookFailureDiagnostics({stage:'PRIVATE_TOKEN',code:'PRIVATE_TOKEN'}),{
    code:'TELEGRAM_WEBHOOK_CONFIGURATION_FAILED',stage:'configuration_validation',outcome:'not_requested',automaticRetry:false});
});
