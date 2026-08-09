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
  assert.equal((prompt.match(/Thanks for calling First Class Rentals Niagara\. Take care\./gi) || []).length, 1);
});

test("interruptions continue from the next missing field without restarting intake", () => {
  assert.match(prompt, /If the caller interrupts, stop speaking, listen to the new information, store every usable detail/i);
  assert.match(prompt, /ask only the next still-missing item/i);
  assert.match(prompt, /Never restart the route or repeat a field the caller already answered/i);
});

test("unclear answers receive one narrow clarification and are never guessed", () => {
  assert.match(prompt, /ask one narrow clarification about that detail only/i);
  assert.match(prompt, /Never guess consent, a phone number, an address, urgency, or a safety fact/i);
});

test("silence recovery is bounded and cannot create an incomplete request", () => {
  assert.match(prompt, /I'm still here\. Take your time/i);
  assert.match(prompt, /repeat only the current question once/i);
  assert.match(prompt, /After a second unusable response/i);
  assert.match(prompt, /Do not create or send a request from incomplete information/i);
});

test("notification failures are reported from tool results rather than assumed", () => {
  assert.match(prompt, /Never claim a notification succeeded because the tool was called/i);
  assert.match(prompt, /Use only the returned owner and customer delivery results/i);
  assert.match(prompt, /If complete is not true, say: "I couldn't confirm that the request was delivered/i);
});
