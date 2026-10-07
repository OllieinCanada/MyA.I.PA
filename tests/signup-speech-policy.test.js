const test = require("node:test");
const assert = require("node:assert/strict");
const { fixedConsentOpening, normalizeConsentPrompt, signupSpeechPatch, inspectSignupSpeech } = require("../server/signupSpeechPolicy");
const { buildSignupAssistantConfig } = require("../server/signupAssistantTemplate");
const { updateMessages } = require("../server/vapiIsolatedSmsProvisioning");
const { assessSignupAssistantContent } = require("../server/signupAssistantVerification");

test("legacy opening migrates once, preserves business name, and asks only consent", () => {
  for (const name of ["Mc dooper electricsl", "Example Electric", "A.B. Services"]) {
    const value = fixedConsentOpening(`For quality and service purposes, this call may be recorded. Thanks for calling ${name}. How are you today?`);
    assert.match(value, new RegExp(`^Thanks for calling ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
    assert.equal(fixedConsentOpening(value), value);
    assert.equal((value.match(/recorded/g) || []).length, 1);
    assert.equal((value.match(/\?/g) || []).length, 1);
    assert.doesNotMatch(value, /How are you|may be recorded/);
  }
});

test("audio file openings require review instead of being silently replaced", () => {
  assert.throws(() => fixedConsentOpening("https://example.test/opening.wav"), /explicit review/);
});

test("provisioning and recovery use the same speech policy", () => {
  const config = buildSignupAssistantConfig({ business: { name: "Example Electric" }, owner: { phone: "+19055550199" }, aiAssistant: { businessType: "Electrical", serviceArea: "Niagara" } }, { assignedPhone: "+12895550123" });
  assert.deepEqual(signupSpeechPatch(config), signupSpeechPatch({ firstMessage: "Thanks for calling Example Electric. How are you today?" }));
  assert.ok(Object.values(inspectSignupSpeech(config)).every(Boolean));
  assert.equal(normalizeConsentPrompt(config.model.messages[0].content), config.model.messages[0].content);
  const recovered = { ...config, model: { ...config.model, messages: updateMessages(config.model.messages, "send_call_summaries_1234_abc12345_v2") } };
  assert.equal(assessSignupAssistantContent({ expectedConfig: config, liveAssistant: recovered }).passed, true);
  const old = { ...config, voice: { provider: "vapi", voiceId: "Jess", version: 2 } };
  assert.equal(inspectSignupSpeech(old).speechVoicePinned, false);
});

test("legacy instructions no longer demand social response followed by a second disclosure", () => {
  const prompt = normalizeConsentPrompt(`Business instructions.\nAfter the caller answers how they are, briefly acknowledge it, then give the exact recording notice.\n- After the opening greeting and the caller's social response, say this call will be recorded.\nKeep pricing consent and SMS tool rules.`);
  assert.doesNotMatch(prompt, /After the caller answers|After the opening greeting/);
  assert.match(prompt, /Keep pricing consent and SMS tool rules/);
  assert.match(prompt, /social answer such as "I'm fine" is not consent/);
});
