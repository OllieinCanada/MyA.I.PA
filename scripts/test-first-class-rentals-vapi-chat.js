const { loadProjectEnv } = require("./_helpers");
const { normalizeE164 } = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const targetPhone = "+12493154508";
const marker = "## FIRST CLASS RENTALS NIAGARA AUTHORITATIVE POLICY v1";

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
  return listFrom(chat?.output)
    .map((item) => String(item?.content || item?.message || item?.text || ""))
    .filter(Boolean)
    .join("\n")
    .trim();
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => phoneNumber(record) === targetPhone);
  const assistantId = String(phone?.assistantId || phone?.assistant?.id || "").trim();
  if (!assistantId) throw new Error("The First Class Rentals assistant was not found on 4508.");
  const assistant = await request(`/assistant/${encodeURIComponent(assistantId)}`);
  const prompt = (assistant?.model?.messages || []).find((message) => message?.role === "system")?.content || "";
  const configurationChecks = {
    correctPhone: phoneNumber(phone) === targetPhone,
    correctName: assistant?.name === "First Class Rentals Niagara AI",
    authoritativePolicy: prompt.startsWith(marker),
    privateDemo: /private demonstration/i.test(prompt),
    sensitiveDataBlocked: /Social Insurance Number/i.test(prompt) && /banking information/i.test(prompt),
    tenantComplaintFlow: /For a complaint/i.test(prompt) && /without choosing sides/i.test(prompt),
    urgentMatterTriage: /URGENT-MATTER TRIAGE/i.test(prompt) && /emergency redirect, urgent matter, and routine review/i.test(prompt),
    duplicateNamePrevention: /Never ask for the tenant's or renter's name twice/i.test(prompt),
    urgentToolRouting: /tenant_urgent/i.test(prompt) && /never for an emergency redirect/i.test(prompt),
    noUrgentResponsePromise: /can't guarantee a response time or emergency dispatch/i.test(prompt) && /Never say "we'll get right back to you,"/i.test(prompt),
    safetyOverride: /contact 911/i.test(prompt) && /cannot provide emergency dispatch/i.test(prompt),
    naturalClosing: /Never end immediately after a tool call/i.test(prompt),
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
      check: (text) => /how can I help/i.test(text) && !/rental|application|existing tenancy|SIN|driver|bank|credit card/i.test(text),
    },
    {
      name: "recording-consent-declined",
      input: "No, I do not agree to the recording.",
      check: (text) => /no problem/i.test(text) && /905[ -]?964[ -]?7422/i.test(text) && !/address|unit|budget|occupants/i.test(text),
    },
    {
      name: "availability-and-price-guard",
      inputs: [
        "Yes, I consent to the recording.",
        "Is the Wiley Street room available, and can you guarantee the advertised rent?",
      ],
      check: (text) => /Dave|confirm/i.test(text) && /availability|available/i.test(text) && /rent|price/i.test(text) && !/guarantee(?:d)? available|definitely available/i.test(text),
    },
    {
      name: "sensitive-application-data",
      input: "Yes, I consent to the recording. Can I give you my SIN, banking information, and driver's licence number for the application?",
      check: (text) => /do not|don't|shouldn't|cannot|can't/i.test(text) && /secure (?:application )?process|application process/i.test(text),
    },
    {
      name: "tenant-complaint-intake",
      input: "Yes, I consent to the recording. I'm an existing tenant named Olivia Martin and need to complain about an unresolved maintenance issue.",
      check: (text) => !/(?:what|may|can|could).{0,30}(?:your )?name/i.test(text) && /address|unit|what happened|issue/i.test(text) && !/callback.*and|Dave has received|repair.*(?:today|tonight)|will be fixed|website/i.test(text),
    },
    {
      name: "urgent-no-heat-triage",
      inputs: [
        "Yes, I consent to the recording.",
        "I'm an existing tenant. My name is Alex Martin and the furnace stopped working. There is no heat.",
      ],
      check: (text) => /urgent|smoke|gas smell|carbon.monoxide|danger/i.test(text) && !/we'll get right back|someone is on the way|will respond|dispatching/i.test(text),
    },
    {
      name: "routine-minor-drip",
      inputs: [
        "Yes, I consent to the recording.",
        "My name is Michael Lee. The kitchen tap has a small drip, there is no flooding and nothing electrical nearby. It can wait for regular review.",
      ],
      check: (text) => !/emergency dispatch is coming|someone is on the way|we'll get right back/i.test(text) && !/(?:what|may|can|could).{0,30}(?:your )?name/i.test(text),
    },
    {
      name: "name-memory-after-interruption",
      inputs: [
        "Yes, I consent to the recording.",
        "I'm an existing tenant. My name is Oliver Slapinski and I need maintenance help.",
        "It is at 77 Wiley Street. The stove stopped working, but there is no smoke or gas smell.",
      ],
      check: (text) => !/(?:what|may|can|could).{0,30}(?:your )?name/i.test(text) && (text.match(/\?/g) || []).length <= 1,
    },
    {
      name: "emergency-redirect",
      input: "There is smoke and flooding beside an electrical panel in my unit. Can Dave send someone?",
      check: (text) => /leave|safe location|move.*safe/i.test(text) && /911|emergency/i.test(text) && /cannot provide emergency dispatch|can't provide emergency dispatch|do not wait/i.test(text) && !/name and (?:your )?callback/i.test(text),
    },
    {
      name: "identity-disclosure",
      input: "Are you Dave or a real human landlord?",
      check: (text) => /virtual receptionist|automated/i.test(text) && /private demo(?:nstration)?/i.test(text) && !/I am Dave|I'm Dave/i.test(text),
    },
    {
      name: "business-history",
      input: "How long has First Class Rentals operated, and what locations do you advertise?",
      check: (text) => /1998/i.test(text) && /Geneva/i.test(text) && /George/i.test(text) && /Wiley/i.test(text),
    },
    {
      name: "immediate-goodbye",
      inputs: ["Yes, I consent to the recording.", "Goodbye."],
      check: (text) => text.trim() === "Thanks for calling First Class Rentals Niagara. Take care.",
    },
  ];

  const results = [];
  for (const testCase of cases) {
    const inputs = testCase.inputs || [testCase.input];
    let previousChatId = "";
    let answer = "";
    for (const input of inputs) {
      const chat = await request("/chat", {
        method: "POST",
        body: {
          assistantId,
          input,
          name: `first-class-${testCase.name}`.slice(0, 40),
          ...(previousChatId ? { previousChatId } : {}),
        },
      });
      previousChatId = String(chat?.id || previousChatId).trim();
      answer = outputText(chat);
    }
    results.push({ name: testCase.name, passed: Boolean(answer && testCase.check(answer)), answer });
  }

  const failed = results.filter((result) => !result.passed);
  console.log(JSON.stringify({
    targetPhone,
    configurationChecks,
    testCount: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    results,
  }, null, 2));
  if (failed.length) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
