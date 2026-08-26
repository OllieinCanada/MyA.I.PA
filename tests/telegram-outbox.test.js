const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MAX_OUTBOX_ITEMS,
  enqueueTelegramMessage,
  processTelegramOutbox,
  resetTelegramOutboxLocksForTests,
  validateAdminUrl,
} = require("../server/telegramOutbox");

function createOutboxPath(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "myaipa-telegram-outbox-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, "telegram-outbox.json");
}

function readOutbox(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

test.beforeEach(() => resetTelegramOutboxLocksForTests());

test("enqueue stores a redacted message, validated exact link, and hashed dedupe key only", async (t) => {
  const filePath = createOutboxPath(t);
  const incidentId = "abcdef1234567890abcdef12";
  const adminUrl = `https://www.myaipa.ca/#/admin?tab=attention&incident=${incidentId}`;
  const result = await enqueueTelegramMessage({
    filePath,
    text: "Crash for owner@example.com at +1 905-555-0123 token=top-secret",
    adminUrl,
    buttonText: "Open exact incident",
    dedupeKey: "contains-private-dedupe-material",
    now: 1_000,
  });
  assert.equal(result.queued, true);
  const raw = fs.readFileSync(filePath, "utf8");
  const outbox = JSON.parse(raw);
  assert.equal(outbox.items.length, 1);
  assert.equal(outbox.items[0].adminUrl, adminUrl);
  assert.match(outbox.items[0].dedupeHash, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(raw, /owner@example\.com|905-555-0123|top-secret|contains-private-dedupe-material/);
  assert.equal(Object.prototype.hasOwnProperty.call(outbox.items[0], "token"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(outbox.items[0], "chatId"), false);
});

test("enqueue deduplicates and refuses overflow without silently deleting an older incident", async (t) => {
  const filePath = createOutboxPath(t);
  const first = await enqueueTelegramMessage({ filePath, text: "same", dedupeKey: "same", now: 1 });
  const duplicate = await enqueueTelegramMessage({ filePath, text: "same", dedupeKey: "same", now: 2 });
  assert.equal(first.queued, true);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.id, first.id);

  const items = Array.from({ length: MAX_OUTBOX_ITEMS }, (_, index) => ({
    id: crypto.createHash("sha256").update(`id-${index}`).digest("hex").slice(0, 24),
    dedupeHash: crypto.createHash("sha256").update(`key-${index}`).digest("hex"),
    text: `message ${index}`,
    adminUrl: "",
    buttonText: "Open exact issue",
    createdAt: index + 10,
    nextAttemptAt: index + 10,
    attempts: 0,
  }));
  fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, items })}\n`, "utf8");
  const overflow = await enqueueTelegramMessage({ filePath, text: "newest message", dedupeKey: "newest", now: 1_000 });
  const outbox = readOutbox(filePath);
  assert.equal(overflow.queued, false);
  assert.equal(overflow.overflow, true);
  assert.equal(outbox.items.length, MAX_OUTBOX_ITEMS);
  assert.equal(outbox.items.some((item) => item.text === "newest message"), false);
  assert.equal(outbox.items.some((item) => item.text === "message 0"), true);
});

test("processor removes only messages Telegram confirms with exact ok true", async (t) => {
  const filePath = createOutboxPath(t);
  await enqueueTelegramMessage({ filePath, text: "deliver me", dedupeKey: "deliver", now: 1_000 });
  const requests = [];
  const result = await processTelegramOutbox({
    filePath,
    token: "bot-secret",
    chatId: "12345",
    now: 1_000,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 1 } }) };
    },
  });
  assert.deepEqual({ sent: result.sent, retried: result.retried, permanentFailures: result.permanentFailures }, {
    sent: 1,
    retried: 0,
    permanentFailures: 0,
  });
  assert.equal(readOutbox(filePath).items.length, 0);
  assert.match(requests[0].url, /botbot-secret\/sendMessage$/);
  assert.equal(fs.readFileSync(filePath, "utf8").includes("bot-secret"), false);
  assert.equal(fs.readFileSync(filePath, "utf8").includes("12345"), false);
});

test("processor exponentially retries timeouts, 429, 5xx, and non-ok Telegram bodies", async (t) => {
  const cases = [
    { name: "timeout", response: () => { const error = new Error("timed out"); error.name = "TimeoutError"; throw error; } },
    { name: "rate limit", response: async () => ({ ok: false, status: 429, json: async () => ({ ok: false, parameters: { retry_after: 180 } }) }) },
    { name: "server error", response: async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }) },
    { name: "invalid success body", response: async () => ({ ok: true, status: 200, json: async () => ({ ok: "true" }) }) },
  ];
  for (const [index, entry] of cases.entries()) {
    const filePath = path.join(path.dirname(createOutboxPath(t)), `${index}.json`);
    await enqueueTelegramMessage({ filePath, text: entry.name, dedupeKey: entry.name, now: 10_000 });
    const first = await processTelegramOutbox({
      filePath,
      token: "token",
      chatId: "chat",
      now: 10_000,
      fetchImpl: entry.response,
    });
    assert.equal(first.retried, 1, entry.name);
    const afterFirst = readOutbox(filePath).items[0];
    assert.equal(afterFirst.attempts, 1, entry.name);
    assert.ok(afterFirst.nextAttemptAt >= 70_000, entry.name);

    const secondNow = afterFirst.nextAttemptAt;
    await processTelegramOutbox({
      filePath,
      token: "token",
      chatId: "chat",
      now: secondNow,
      fetchImpl: entry.response,
    });
    const afterSecond = readOutbox(filePath).items[0];
    assert.equal(afterSecond.attempts, 2, entry.name);
    assert.ok(afterSecond.nextAttemptAt >= secondNow + 120_000, entry.name);
  }
});

test("processor retains queued data without credentials and preserves Telegram 4xx failures", async (t) => {
  const filePath = createOutboxPath(t);
  await enqueueTelegramMessage({ filePath, text: "bad request", dedupeKey: "bad", now: 1_000 });
  const skipped = await processTelegramOutbox({ filePath, token: "", chatId: "", now: 1_000 });
  assert.equal(skipped.skipped, true);
  assert.equal(readOutbox(filePath).items.length, 1);

  const result = await processTelegramOutbox({
    filePath,
    token: "token",
    chatId: "chat",
    now: 1_000,
    fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ ok: false, description: "contains-sensitive-detail" }) }),
  });
  assert.equal(result.permanentFailures, 0);
  assert.equal(result.retried, 1);
  assert.equal(readOutbox(filePath).items.length, 1);
  assert.doesNotMatch(fs.readFileSync(filePath, "utf8"), /contains-sensitive-detail/);
});

test("processor retains authorization failures so incidents survive credential repair", async (t) => {
  const filePath = createOutboxPath(t);
  await enqueueTelegramMessage({ filePath, text: "saved incident", dedupeKey: "saved", now: 1_000 });
  const result = await processTelegramOutbox({
    filePath,
    token: "wrong-token",
    chatId: "chat",
    now: 1_000,
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ ok: false }) }),
  });
  assert.equal(result.retried, 1);
  assert.equal(result.permanentFailures, 0);
  assert.equal(readOutbox(filePath).items.length, 1);
  assert.equal(readOutbox(filePath).items[0].lastStatus, 401);
});

test("processor enforces maxBatch and serializes concurrent processors", async (t) => {
  const filePath = createOutboxPath(t);
  await enqueueTelegramMessage({ filePath, text: "one", dedupeKey: "one", now: 1 });
  await enqueueTelegramMessage({ filePath, text: "two", dedupeKey: "two", now: 1 });

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = processTelegramOutbox({
    filePath,
    token: "token",
    chatId: "chat",
    now: 1,
    maxBatch: 1,
    fetchImpl: async () => {
      await gate;
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  const concurrent = await processTelegramOutbox({
    filePath,
    token: "token",
    chatId: "chat",
    now: 1,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }),
  });
  assert.equal(concurrent.busy, true);
  release();
  const completed = await first;
  assert.equal(completed.sent, 1);
  assert.equal(readOutbox(filePath).items.length, 1);
});

test("admin URL validation permits HTTPS and localhost but rejects credentials, secret params, and invalid incidents", () => {
  assert.equal(validateAdminUrl("https://www.myaipa.ca/#/admin?tab=attention&incident=abcdef1234567890abcdef12"), "https://www.myaipa.ca/#/admin?tab=attention&incident=abcdef1234567890abcdef12");
  assert.equal(validateAdminUrl("http://localhost:3000/#/admin?tab=attention"), "http://localhost:3000/#/admin?tab=attention");
  assert.equal(validateAdminUrl("http://www.myaipa.ca/admin"), "");
  assert.equal(validateAdminUrl("https://user:pass@www.myaipa.ca/admin"), "");
  assert.equal(validateAdminUrl("https://www.myaipa.ca/admin?token=secret"), "");
  assert.equal(validateAdminUrl("https://www.myaipa.ca/#/admin?tab=attention&incident=owner@example.com"), "");
});
