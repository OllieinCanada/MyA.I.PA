const test = require("node:test");
const assert = require("node:assert/strict");

const { runMessageRoutingGate } = require("../scripts/run-message-routing-gate");

test("message-routing shipping gate isolates owner and customer routes repeatedly", async () => {
  const report = await runMessageRoutingGate({ count: 10 });
  assert.equal(report.ready, true);
  assert.equal(report.requested, 10);
  assert.equal(report.passed, 10);
  assert.equal(report.failed, 0);
  assert.equal(report.wrongRecipientCount, 0);
  assert.equal(report.providerRequestsMade, false);
});

test("message-routing shipping gate rejects invalid volume", async () => {
  await assert.rejects(() => runMessageRoutingGate({ count: 0 }), /integer from 1 to 500/i);
  await assert.rejects(() => runMessageRoutingGate({ count: 501 }), /integer from 1 to 500/i);
});
