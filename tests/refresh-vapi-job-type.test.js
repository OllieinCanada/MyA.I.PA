const test = require("node:test");
const assert = require("node:assert/strict");
const { refreshJobTypes } = require("../scripts/refresh-vapi-job-type");

function fixture({ pinned = false, fail = false } = {}) {
  const tool = { id: "tool-one", type: "code", function: { name: "send_call_summaries_0123_12345678_v2", parameters: {} }, code: "old-code", environmentVariables: [{ name: "DEFAULT_OWNER_TO_NUMBER", value: "+19055550123" }] };
  const assistant = { id: "assistant-one", model: { provider: "openai", model: "unchanged-model", messages: [{ role: "system", content: "Keep business pricing and context." }], ...(pinned ? { toolRefs: [{ toolId: tool.id, version: "3" }] } : { toolIds: [tool.id] }) } };
  const writes = [];
  let failed = false;
  const request = async (path, options = {}) => {
    if (options.method) {
      writes.push({ path, ...options });
      if (path === "/assistant/assistant-one" && fail && !failed) { failed = true; throw new Error("Simulated API failure"); }
      Object.assign(path.startsWith("/tool/") ? tool : assistant, structuredClone(options.body));
    }
    return structuredClone(path.startsWith("/tool?") ? [tool] : path.startsWith("/assistant?") ? [assistant] : path.startsWith("/tool/") ? tool : assistant);
  };
  return { request, writes, tool, assistant };
}
test("job-type refresh is read-only by default", async () => {
  const input = fixture();
  assert.equal((await refreshJobTypes(input)).assistants, 1);
  assert.equal(input.writes.length, 0);
});
test("refresh updates existing content only and verifies both code and prompt", async () => {
  const input = fixture();
  const report = await refreshJobTypes({ ...input, apply: true });
  assert.equal(report.results[0].verified, true);
  assert.ok(input.writes.every((write) => write.method === "PATCH"));
  assert.deepEqual(Object.keys(input.writes[0].body).sort(), ["code", "function"]);
  assert.equal(input.tool.environmentVariables[0].value, "+19055550123");
  assert.match(input.tool.code, /Job type:/);
  assert.doesNotMatch(input.tool.code, /env\.TWILIO_API_KEY_SID|env\.TWILIO_API_KEY_SECRET|env\.OWNER_SMS_ENABLED/);
  assert.match(input.assistant.model.messages[0].content, /Include the job type in the spoken read-back/);
  assert.match(input.assistant.model.messages[0].content, /Keep business pricing and context/);
  assert.equal(input.assistant.model.model, "unchanged-model");
});
test("pinned references block all writes", async () => {
  const input = fixture({ pinned: true });
  await assert.rejects(refreshJobTypes({ ...input, apply: true }), /Pinned/);
  assert.equal(input.writes.length, 0);
});
test("failed assistant update rolls tool content back without changing resources", async () => {
  const input = fixture({ fail: true });
  await assert.rejects(refreshJobTypes({ ...input, apply: true }), /Rollback completed/);
  assert.equal(input.tool.code, "old-code");
  assert.equal(input.assistant.model.messages[0].content, "Keep business pricing and context.");
  assert.ok(input.writes.every((write) => write.method === "PATCH"));
});
