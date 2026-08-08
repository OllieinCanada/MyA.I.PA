const test = require("node:test");
const assert = require("node:assert/strict");
const { authoritativePrompt } = require("../scripts/configure-first-class-rentals-vapi");

const prompt = authoritativePrompt("send_call_summaries_4508_test");

test("First Class prompt enumerates every emergency group", () => {
  for (const expected of [
    "fire",
    "smoke",
    "sparks or burning wiring",
    "suspected gas leak",
    "carbon-monoxide alarm",
    "violence",
    "break-in in progress",
    "medical danger",
    "immediate danger",
    "flooding near energized equipment",
  ]) assert.match(prompt, new RegExp(expected, "i"));
});

test("First Class prompt enumerates every urgent group", () => {
  for (const expected of [
    "burst pipe or major active leak",
    "sewage backup",
    "no heat",
    "failed furnace",
    "no water",
    "electrical outage",
    "inability to secure the unit",
    "lockout",
    "essential stove",
    "air-conditioning failure",
  ]) assert.match(prompt, new RegExp(expected, "i"));
});

test("deterministic urgent calls require a spoken classification before intake", () => {
  assert.match(prompt, /Deterministic urgent examples/i);
  assert.match(prompt, /Before asking the next intake question, always say: "I'll mark this as an urgent matter for Dave's review\."/i);
  assert.match(prompt, /Do not silently classify a deterministic urgent example and move straight to intake/i);
});

test("routine examples remain distinct from urgent and emergency paths", () => {
  assert.match(prompt, /Routine review includes a minor drip, cosmetic damage, an appliance question with no serious impact, ordinary noise/i);
  assert.match(prompt, /Never call every plumbing, electrical, appliance, heating, or cooling question urgent/i);
});

test("notification and closing safeguards remain in the local candidate", () => {
  assert.match(prompt, /Use tenant_urgent only for the urgent-matter level, never for an emergency redirect/i);
  assert.match(prompt, /Do not say Dave has received, accepted, or acted on it unless the notification tool confirms delivery/i);
  assert.match(prompt, /Thanks for calling First Class Rentals Niagara\. Take care\./i);
});
