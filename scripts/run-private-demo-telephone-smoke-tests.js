const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const { normalizeE164 } = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const vapiKey = String(env.VAPI_API_KEY || "").trim();
const vapiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const twilioToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
const apply = process.argv.includes("--apply");
const verifyRecent = process.argv.includes("--verify-recent");
const confirmation = process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "";
const confirmationPhrase = "RUN-PRIVATE-DEMO-PSTN-SMOKE-TESTS";
const fcrPhone = "+12493154508";
const deanPhone = "+12892057487";

function list(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

async function vapiRequest(resource) {
  const response = await fetch(`${vapiBase}${resource}`, { headers: { Authorization: `Bearer ${vapiKey}`, Accept: "application/json" } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Vapi ${resource} failed with HTTP ${response.status}.`);
  return payload;
}

function environmentMap(tool) {
  return Object.fromEntries((tool?.environmentVariables || []).map((item) => [String(item?.name || ""), String(item?.value || "")]).filter(([name]) => name));
}

async function protectedTwilioAccount(phones, tools) {
  const fcr = phones.find((item) => normalizeE164(item?.number || item?.phoneNumber || item?.providerResourceId) === fcrPhone);
  const assistant = await vapiRequest(`/assistant/${encodeURIComponent(fcr?.assistantId || fcr?.assistant?.id || "")}`);
  const toolId = (assistant?.model?.toolIds || []).find((id) => tools.some((tool) => String(tool?.id) === String(id) && /^send_call_summaries_4508_/i.test(String(tool?.function?.name || tool?.name || ""))));
  if (!toolId) throw new Error("The isolated 4508 routing tool was not found.");
  const detail = await vapiRequest(`/tool/${encodeURIComponent(toolId)}`);
  const values = environmentMap(detail);
  if (!values.TWILIO_ACCOUNT_SID || !twilioToken) throw new Error("The protected Twilio account is unavailable.");
  return values.TWILIO_ACCOUNT_SID;
}

async function createCall(accountSid, { to, from, twiml }) {
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${twilioToken}`).toString("base64")}`,
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: from, Twiml: twiml, Timeout: "30" }).toString(),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Twilio call creation failed with HTTP ${response.status}: ${payload.message || "request failed"}`);
  return { sidHash: hash(payload.sid), status: payload.status || "queued", toLast4: to.slice(-4), fromLast4: from.slice(-4) };
}

function callTranscript(call) {
  return String(call?.transcript || call?.artifact?.transcript || call?.analysis?.transcript || "");
}

function durationSeconds(call) {
  const direct = Number(call?.durationSeconds || call?.duration || 0);
  if (direct > 0) return Math.round(direct);
  const started = Date.parse(call?.startedAt || call?.createdAt || "");
  const ended = Date.parse(call?.endedAt || "");
  return Number.isFinite(started) && Number.isFinite(ended) && ended > started ? Math.round((ended - started) / 1000) : 0;
}

async function verify(phones) {
  const recent = list(await vapiRequest(`/call?limit=100&createdAtGt=${encodeURIComponent(new Date(Date.now() - 15 * 60 * 1000).toISOString())}`), ["calls"]);
  const byNumber = Object.fromEntries(phones.map((item) => [normalizeE164(item?.number || item?.phoneNumber || item?.providerResourceId), item]));
  const findCall = (target, source) => recent
    .filter((call) => String(call?.phoneNumberId || call?.phoneNumber?.id || "") === String(byNumber[target]?.id || ""))
    .filter((call) => normalizeE164(call?.customer?.number || call?.customer?.phoneNumber) === source)
    .sort((left, right) => new Date(right?.createdAt || 0) - new Date(left?.createdAt || 0))[0];
  const fcr = findCall(fcrPhone, deanPhone);
  const dean = findCall(deanPhone, fcrPhone);
  const fcrTranscript = callTranscript(fcr);
  const deanTranscript = callTranscript(dean);
  const checks = {
    fcrCallFound: Boolean(fcr?.id),
    fcrAnswered: String(fcr?.status || "").toLowerCase() === "ended" && Boolean(fcrTranscript),
    fcrUrgentScenarioHeard: /furnace|no heat/i.test(fcrTranscript),
    fcrUrgencyAcknowledged: /urgent matter/i.test(fcrTranscript),
    fcrNoDispatchPromise: !/someone is on the way|we'll get right back to you/i.test(fcrTranscript),
    deanCallFound: Boolean(dean?.id),
    deanAnswered: String(dean?.status || "").toLowerCase() === "ended" && Boolean(deanTranscript),
    deanIdentityQuestionHeard: /official office|Dean Allison/i.test(deanTranscript),
    deanUnofficialDisclosure: /private demo|not.*official|not.*Dean Allison|not.*his office/i.test(deanTranscript),
  };
  const report = {
    verified: Object.values(checks).every(Boolean),
    checks,
    calls: {
      firstClass: fcr ? { createdAt: fcr.createdAt, status: fcr.status, endedReason: fcr.endedReason, durationSeconds: durationSeconds(fcr), callIdHash: hash(fcr.id) } : null,
      deanPrivateDemo: dean ? { createdAt: dean.createdAt, status: dean.status, endedReason: dean.endedReason, durationSeconds: durationSeconds(dean), callIdHash: hash(dean.id) } : null,
    },
    transcriptsPrinted: false,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.verified) process.exitCode = 2;
}

async function main() {
  if (!vapiKey || !twilioToken) throw new Error("VAPI_API_KEY and TWILIO_AUTH_TOKEN are required.");
  const [phonePayload, toolPayload] = await Promise.all([vapiRequest("/phone-number?limit=1000"), vapiRequest("/tool?limit=1000")]);
  const phones = list(phonePayload, ["phoneNumbers", "phone_numbers"]);
  const tools = list(toolPayload, ["tools"]);
  for (const required of [fcrPhone, deanPhone]) {
    if (!phones.some((item) => normalizeE164(item?.number || item?.phoneNumber || item?.providerResourceId) === required)) throw new Error(`Vapi does not contain the required line ending ${required.slice(-4)}.`);
  }
  if (verifyRecent) return verify(phones);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", calls: [{ fromLast4: "7487", toLast4: "4508" }, { fromLast4: "4508", toLast4: "7487" }], transcriptsPrinted: false }, null, 2));
  if (!apply) return;
  if (confirmation !== confirmationPhrase) throw new Error(`Apply mode requires --confirm=${confirmationPhrase}.`);
  const accountSid = await protectedTwilioAccount(phones, tools);
  const calls = await Promise.all([
    createCall(accountSid, {
      from: deanPhone,
      to: fcrPhone,
      twiml: '<Response><Pause length="16"/><Say>Yes, I consent. My name is Alex Martin. I am an existing tenant and the furnace stopped working. There is no heat, smoke, gas smell, or carbon monoxide alarm.</Say><Pause length="12"/><Say>The address is 77 Wiley Street.</Say><Pause length="10"/><Say>Goodbye.</Say><Pause length="3"/></Response>',
    }),
    createCall(accountSid, {
      from: fcrPhone,
      to: deanPhone,
      twiml: '<Response><Pause length="28"/><Say>Yes, it is okay to continue. Are you Dean Allison or someone working in his official office?</Say><Pause length="16"/><Say>Goodbye.</Say><Pause length="3"/></Response>',
    }),
  ]);
  console.log(JSON.stringify({ started: true, calls, transcriptsPrinted: false }, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
