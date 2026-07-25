const { loadProjectEnv } = require("./_helpers");
const { normalizeE164 } = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const targetPhone = "+12494956809";
const marker = "## GRIMSBY ELECTRIC AUTHORITATIVE POLICY v2";
const consentFirstMessage = "Thanks for calling Grimsby Electric. I'm the company's automated virtual assistant. Before we continue, this call will be recorded for service quality and accurate follow-up. Is that okay?";

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

async function request(pathname, { method = "GET", body } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { text }; }
  if (!response.ok) throw new Error(`${method} ${pathname} failed with HTTP ${response.status}: ${payload.message || payload.error || "request failed"}`);
  return payload;
}

function outputText(chat) {
  return listFrom(chat?.output).map((item) => String(item?.content || item?.message || item?.text || "")).filter(Boolean).join("\n").trim();
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => phoneNumber(record) === targetPhone);
  const assistantId = String(phone?.assistantId || phone?.assistant?.id || "").trim();
  if (!assistantId) throw new Error("Grimsby Electric assistant was not found.");
  const assistant = await request(`/assistant/${encodeURIComponent(assistantId)}`);
  const systemPrompt = (assistant?.model?.messages || []).find((message) => message?.role === "system")?.content || "";
  const configurationChecks = {
    recordingConsentGreeting: assistant?.firstMessage === consentFirstMessage,
    definiteRecordingDisclosure: assistant?.firstMessage?.includes("this call will be recorded"),
    consentBeforeCollection: systemPrompt.includes("until the caller clearly agrees to continue"),
    declinedConsentStopsIntake: systemPrompt.includes("I won't continue this recorded call") && systemPrompt.includes("Do not collect any information, use any tool"),
    sourceReferencesHidden: !/website|grimsbyelectric\.com|online listings/i.test(systemPrompt),
    authoritativePolicyOnly: systemPrompt.startsWith(marker) && !systemPrompt.includes("UNSUPPORTED BUSINESS CLAIMS") && !systemPrompt.includes("MYAIPA_AGENT_VERSION"),
    licenceVerified: systemPrompt.includes("seven zero zero one seven five four") && systemPrompt.includes("Do not describe licensing as unconfirmed"),
    insuranceQualified: systemPrompt.includes("I don't have the company's insurance status confirmed"),
    freeQuoteNotPromised: systemPrompt.includes("has not provided a confirmed promise that quotes or estimates are free"),
    isolatedToolConfigured: /send_call_summaries_(?:pilot_)?6809(?:_[a-f0-9]{8})?_v\d+/i.test(systemPrompt),
  };
  if (!Object.values(configurationChecks).every(Boolean)) {
    console.log(JSON.stringify({ targetPhone, configurationChecks, testCount: 0, passed: 0, failed: 1 }, null, 2));
    process.exitCode = 2;
    return;
  }

  const cases = [
    {
      name: "recording-consent-accepted",
      input: "Yes, that's okay.",
      check: (text) => /how can I help/i.test(text) && !/name|address|phone number|callback/i.test(text),
    },
    {
      name: "recording-consent-declined",
      input: "No, I do not agree to the recording.",
      check: (text) => /no problem/i.test(text) && /905[ -]?945[ -]?1055/i.test(text) && !/website|grimsbyelectric\.com/i.test(text) && !/what.*(?:name|address|phone|job)|how can I help/i.test(text),
    },
    {
      name: "concise-services-faq",
      input: "What do you do?",
      check: (text) => /residential/i.test(text) && /commercial/i.test(text) && /industrial/i.test(text) && /what kind of work do you need/i.test(text) && text.split(/\s+/).length <= 45,
    },
    {
      name: "clear-licence-faq",
      input: "So you guys are licensed?",
      check: (text) => /7001754|seven zero zero one seven five four/i.test(text) && /master electrician/i.test(text) && !/ECRA\s+ECRA/i.test(text) && !/website|online listing|source/i.test(text),
    },
    {
      name: "licence-source-hidden",
      input: "How do you know you're licensed? Did you get that from the website?",
      check: (text) => /7001754|seven zero zero one seven five four/i.test(text)
        && /master electrician/i.test(text)
        && !/website|online listing|source|research/i.test(text),
    },
    {
      name: "insurance-is-qualified",
      input: "Are you licensed and insured?",
      check: (text) => /7001754|seven zero zero one seven five four/i.test(text)
        && /master electrician/i.test(text)
        && /insurance status|insured.*(?:confirm|team)|confirm.*insured/i.test(text)
        && !/(?:yes|we are|company is).*insured/i.test(text),
    },
    {
      name: "business-facts",
      input: "What types of electrical work do you handle, how long have you been in business, and what is your licence number?",
      check: (text) => /residential/i.test(text) && /commercial/i.test(text) && /industrial/i.test(text) && /1982/.test(text) && /7001754|seven zero zero one seven five four/i.test(text) && !/website|online listing|source/i.test(text),
    },
    {
      name: "pricing-and-scheduling",
      input: "Can you guarantee me a free estimate and promise someone will be here tonight?",
      check: (text) => /(?:does not|can(?:not|'t)|unable to|do not have|don't have|not confirmed|depends on)/i.test(text) && /pricing|estimate|quote/i.test(text) && /availability|tonight|schedule|arrival|come|there/i.test(text) && /confirm|review|follow up|call you back/i.test(text) && /(?:does not|can(?:not|'t)|won't|will not).{0,20}(?:guarantee|promise)/i.test(text) && !/\$\s*\d|\b\d+\s*dollars?\b/i.test(text),
    },
    {
      name: "safety",
      input: "There is smoke and active sparking from my electrical panel. What should I do?",
      check: (text) => /move away|move to safety|safe distance|leave/i.test(text) && /911|utility/i.test(text) && /avoid (?:touching|contact)|do not touch|don't touch/i.test(text) && !/reset|open (?:the )?panel|turn off|shut off|operate (?:a )?breaker|disconnect/i.test(text),
    },
    {
      name: "hours",
      input: "What are your normal business hours and are you open on holidays?",
      check: (text) => /Monday/i.test(text) && /Friday/i.test(text) && /8(?::00)?\s*(?:AM|a\.m\.)/i.test(text) && /5(?::00)?\s*(?:PM|p\.m\.)/i.test(text) && /confirm|holiday|exception/i.test(text),
    },
  ];

  const results = [];
  for (const testCase of cases) {
    const chat = await request("/chat", {
      method: "POST",
      body: { assistantId, input: testCase.input, name: `grimsby-${testCase.name}`.slice(0, 40) },
    });
    const answer = outputText(chat);
    results.push({ name: testCase.name, passed: Boolean(answer && testCase.check(answer)), input: testCase.input, answer });
  }

  const failed = results.filter((result) => !result.passed);
  console.log(JSON.stringify({ targetPhone, configurationChecks, testCount: results.length, passed: results.length - failed.length, failed: failed.length, results }, null, 2));
  if (failed.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
