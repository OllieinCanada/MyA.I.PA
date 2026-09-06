const assert = require("node:assert/strict");
const test = require("node:test");
const { authoritativePrompt } = require("../scripts/configure-grimsby-vapi");

const prompt = authoritativePrompt("send_call_summaries_6809_test", { ownerSmsEnabled: true });

test("Grimsby intake requires specific acknowledgement and one question per turn", () => {
  assert.match(prompt, /acknowledge the specific problem or project/i);
  assert.match(prompt, /Ask exactly one question per turn/i);
  assert.match(prompt, /Never list the fields/i);
  assert.match(prompt, /do not answer with a checklist/i);
});

test("Grimsby commercial downtime is acknowledged without a timing promise", () => {
  assert.match(prompt, /explicitly repeat the stated operational impact before intake/i);
  assert.match(prompt, /I understand your business cannot operate because power is out\. Is there any smoke, fire, sparking, injury, or immediate danger\?/i);
  assert.match(prompt, /Never say the team will respond "as soon as possible"/i);
  assert.match(prompt, /Do not book or confirm appointments, arrival windows, start dates, dispatch, availability/i);
});

test("Grimsby stays inside the electrical-business role", () => {
  const prompt = authoritativePrompt("send_call_summaries_test_v1");
  assert.match(prompt, /Do not answer unrelated general-knowledge/i);
  assert.match(prompt, /do not provide a factual hint/i);
  assert.match(prompt, /Do you need electrical service or want to leave a message\?/i);
});
