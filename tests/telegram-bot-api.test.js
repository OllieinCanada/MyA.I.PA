const assert = require("node:assert/strict");
const { test } = require("node:test");

const { ensureTelegramActionWebhook } = require("../server/telegramBotApi");

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
