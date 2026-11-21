const test = require("node:test");
const assert = require("node:assert/strict");
const { CONSENT_POLICY, fixedConsentOpening, normalizeConsentPrompt, signupSpeechPatch, inspectSignupSpeech } = require("../server/signupSpeechPolicy");
const { buildSignupAssistantConfig } = require("../server/signupAssistantTemplate");
const { updateMessages } = require("../server/vapiIsolatedSmsProvisioning");
const { assessSignupAssistantContent } = require("../server/signupAssistantVerification");

test("legacy opening migrates once, preserves business name, and states recording without a question", () => {
  for (const name of ["Mc dooper electricsl", "Example Electric", "A.B. Services"]) {
    const value = fixedConsentOpening(`For quality and service purposes, this call may be recorded. Thanks for calling ${name}. How are you today?`);
    assert.match(value, new RegExp(`^Thanks for calling ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
    assert.equal(fixedConsentOpening(value), value);
    assert.equal((value.match(/recorded/g) || []).length, 1);
    assert.equal((value.match(/\?/g) || []).length, 1);
    assert.match(value, /How can I help you today\?$/);
    assert.doesNotMatch(value, /Is that okay/);
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
  const old = { ...config, voice: { provider: "openai", voiceId: "alloy", model: "tts-1", cachingEnabled: false } };
  assert.equal(inspectSignupSpeech(old).speechVoicePinned, false);
});

test("legacy instructions no longer demand social response followed by a second disclosure", () => {
  const prompt = normalizeConsentPrompt(`Business instructions.\nAfter the caller answers how they are, briefly acknowledge it, then give the exact recording notice.\n- After the opening greeting and the caller's social response, say this call will be recorded.\nKeep pricing consent and SMS tool rules.`);
  assert.doesNotMatch(prompt, /After the caller answers|After the opening greeting/);
  assert.match(prompt, /Keep pricing consent and SMS tool rules/);
  assert.match(prompt, /Never claim the caller explicitly consented when they did not/);
  assert.match(prompt, /Thank you for calling\. Goodbye\./);
});

test("known legacy forced routing becomes conditional without changing custom wording or business facts", () => {
  for (const prefix of ['After recording consent', 'After the recording notice']) {
    const source = `Business facts: Invented Electric.\r\n${prefix}, say exactly: "We handle residential electrical work. Are you looking for a new installation, service, or repair today?"\r\nCustom: say exactly: "Please speak slowly."`;
    const prompt = normalizeConsentPrompt(source);
    assert.match(prompt, /Only if the caller's request type is still unclear, briefly acknowledge what they said, then ask: "We handle residential electrical work/);
    assert.doesNotMatch(prompt, /After the recording notice, say exactly:/);
    assert.match(prompt, /Business facts: Invented Electric/);
    assert.match(prompt, /Custom: say exactly: "Please speak slowly\."/);
    assert.equal(normalizeConsentPrompt(prompt), prompt);
  }
});

// These are generated-prompt contracts, not LLM dialogue/compliance evidence.
for (const [scenario, required] of [
  ['ordinary opening without a social cue', /every opening request, substantive answer and correction/],
  ['broad electrical request needs one clarification', /For a broad request such as "I need some electrical services", acknowledge the request, then clarify the missing request type once/],
  ['known repair or installation skips answered routing', /For a clear in-scope repair or installation request, acknowledge that request and continue its matching path without asking/],
  ['general businesses do not inherit contractor routing', /Only use installation\/service\/repair routing when relevant to the verified business scope/],
  ['multi-field answer skips already supplied details', /Reuse all details already supplied, even when several arrive in one answer/],
  ['caller question is answered before continuing', /answer from verified business facts \(or say the team must confirm\) before returning/],
  ['corrected details need fresh approval', /replace the old value in the same request, and follow the current readback and fresh-approval rules/],
  ['urgent request bypasses conversational delay', /Safety directions take priority over conversational acknowledgement; never delay them/],
  ['refusal must not be treated as agreement', /Respect refusals and recording objections/],
  ['price gate remains a real wait', /After pricing, wait for the caller's answer/],
  ['acknowledgement cannot interrupt final tool admission', /Do not insert a spoken acknowledgement between final submission approval and its tool call/],
  ['closing stays truthful and does not restart intake', /At closing, acknowledge thanks briefly without restarting intake or claiming an unverified/],
]) {
  test(`contract: ${scenario} survives contractor/general provisioning and isolated recovery`, () => {
    for (const businessType of ['Electrical contractor', 'Photography studio']) {
      const config = buildSignupAssistantConfig({ business: { name: 'Invented Business' }, owner: { phone: '+19055550199' },
        aiAssistant: { businessType, serviceArea: 'Fixture Town' } }, { assignedPhone: '+12895550123' });
      const recovered = updateMessages(config.model.messages, 'send_call_summaries_0123_abcdef12_v2');
      for (const prompt of [config.model.messages[0].content, recovered[0].content]) {
        assert.match(prompt, required);
        assert.equal(prompt.split(CONSENT_POLICY).length, 2);
        assert.doesNotMatch(prompt, /After the recording notice, say exactly:|Only then say exactly:/);
        assert.match(prompt, /Acknowledgement is not recording consent, pricing agreement, confirmation of uncertain details, or permission to save or send/);
      }
      assert.equal(assessSignupAssistantContent({ expectedConfig: config, liveAssistant: { ...config,
        model: { ...config.model, messages: recovered } } }).passed, true);
      assert.equal(normalizeConsentPrompt(recovered[0].content), recovered[0].content);
    }
  });
}

test("renormalizing a legacy speech block installs the new policy exactly once before the SMS overlay", () => {
  const source = `Business facts stay.\n## MYAIPA VERIFIED SPEECH OPENING\nAcknowledge social cues briefly.\n## END MYAIPA VERIFIED SPEECH OPENING\n## MYAIPA ISOLATED SMS ROUTING\nPreserve tool and authorization rules.\n## END MYAIPA ISOLATED SMS ROUTING`;
  const prompt = normalizeConsentPrompt(source);
  assert.equal(prompt.split(CONSENT_POLICY).length, 2);
  assert.ok(prompt.indexOf(CONSENT_POLICY) < prompt.indexOf('## MYAIPA ISOLATED SMS ROUTING'));
  assert.match(prompt, /Preserve tool and authorization rules/);
  assert.equal(normalizeConsentPrompt(prompt), prompt);
});
