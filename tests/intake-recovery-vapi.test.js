const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(require.resolve("../server/index.js"), "utf8");
function load(name, next, bindings) {
  const text = source.slice(source.indexOf(`async function ${name}(`), source.indexOf(`async function ${next}(`));
  return vm.runInNewContext(`${text}\n${name}`, bindings);
}
test("actual Vapi assistant reconciliation cannot create a missing assistant", async () => {
  const requests = [];
  const create = load("createSignupVapiAssistant", "reconcileVapiPhoneNumberImport", {
    VAPI_API_KEY: "synthetic", buildSignupAssistantConfig: () => ({}),
    findSignupVapiAssistantByResourceName: async () => null,
    requestVapiResource: async (...args) => { requests.push(args); return { id: "assistant-1" }; },
    assessSignupAssistantContent: () => ({ passed: true, expectedFingerprint: "fingerprint" }),
    getVapiAssistantName: () => "synthetic-assistant",
  });
  assert.equal(await create({ reconcileOnly: true }), null);
  assert.equal(requests.length, 0);
  await create({});
  assert.equal(requests.filter(([, options]) => options?.method === "POST").length, 1);
  const route = source.slice(source.indexOf('kind: "vapi-assistant"', source.indexOf('"/api/integrations/vapi/create-assistant"')));
  assert.match(route, /reconcile:[\s\S]*?reconcileOnly: true/);
});
test("actual Vapi inventory reader rejects malformed and capped reconciliation inventories", async () => {
  for (const response of [{}, { items: [], hasMore: true }, Array.from({ length: 1000 }, (_, i) => ({ id: String(i) }))]) {
    const fetchCollection = load("fetchVapiCollection", "requestVapiResource", {
      VAPI_API_KEY: "synthetic", VAPI_API_BASE_URL: "https://example.invalid", URL,
      fetch: async () => ({ ok: true, text: async () => JSON.stringify(response) }),
      parseJsonObject: JSON.parse,
    });
    await assert.rejects(fetchCollection("assistant", [], { requireComplete: true }), { code: "VAPI_INVENTORY_INCOMPLETE" });
  }
});
