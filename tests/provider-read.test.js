const test = require("node:test");
const assert = require("node:assert/strict");
const { fetchProviderReadText } = require("../server/providerRead");
test("retries a read interrupted during body consumption", async () => {
  let calls = 0;
  const result = await fetchProviderReadText("https://example.com", {}, {
    sleep: async () => {}, fetchImpl: async () => ({ text: async () => {
      if (++calls === 1) throw new TypeError("terminated", { cause: { code: "ECONNRESET" } });
      return "[]";
    } })
  });
  assert.equal(result.text, "[]");assert.equal(calls, 2);
});
test("persistent failure stops after three reads", async () => {
  let calls = 0;
  await assert.rejects(fetchProviderReadText("https://example.com", {}, {
    sleep: async () => {}, fetchImpl: async () => { calls++;throw Object.assign(new Error("reset"), { code: "ECONNRESET" }); }
  }));
  assert.equal(calls, 3);
});
test("never retries mutations or unknown implementation failures", async () => {
  let calls = 0;const fetchImpl = async () => { calls++;throw new Error("bug"); };
  await assert.rejects(fetchProviderReadText("https://example.com", { method: "POST" }, { fetchImpl }));
  assert.equal(calls, 0);
  await assert.rejects(fetchProviderReadText("https://example.com", {}, { fetchImpl }));
  assert.equal(calls, 1);
});
