const test = require("node:test");
const assert = require("node:assert/strict");
const { createMakeIntakeQueueAdapter } = require("../scripts/make-intake-queue-adapter");
test("Make adapter exposes only exact-item deletion, validates API destination and redacts errors", async () => {
  const calls = [];
  const adapter = createMakeIntakeQueueAdapter({ baseUrl: "https://us2.make.com/api/v2", token: "synthetic-token", fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => ({ incomings: ["queue-id"] }) }; } });
  assert.deepEqual(await adapter.deleteOne({ hookId: "123" }, "queue-id"), { deleted: "queue-id" });
  assert.deepEqual(JSON.parse(calls[0].options.body), { ids: ["queue-id"] });
  assert.equal(calls[0].options.redirect, "error");
  assert.throws(() => createMakeIntakeQueueAdapter({ baseUrl: "https://evilmake.com/api/v2", token: "synthetic-token" }));
  await assert.rejects(adapter.deleteOne({ hookId: "../production" }, "queue-id"));
});
test("missing running-execution visibility blocks deletion eligibility; partial delete response is not success", async () => {
  const adapter = createMakeIntakeQueueAdapter({ baseUrl: "https://us2.make.com/api/v2", token: "synthetic-token", fetchImpl: async (url) => ({ ok: true, status: 200, json: async () => url.includes("/scenarios/") ? { scenario: { id: 10, hookId: 20, isActive: false } } : { incomings: ["queue-id"], error: { message: "partial result" } } }) });
  assert.equal((await adapter.state({ scenarioId: 10 })).runningExecutions, null);
  await assert.rejects(adapter.deleteOne({ hookId: 20 }, "queue-id"), /MAKE_QUEUE_DELETE_UNCONFIRMED/);
});
