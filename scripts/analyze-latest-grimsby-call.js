const crypto = require("crypto");
const { loadProjectEnv } = require("./_helpers");
const { normalizeE164 } = require("../server/compositeCallNotifications");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const targetPhone = "+12494956809";

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "calls", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function phoneNumber(record) {
  return normalizeE164(record?.number || record?.phoneNumber || record?.twilioPhoneNumber || record?.providerResourceId);
}

function callTime(call) {
  return new Date(call?.createdAt || call?.startedAt || 0).getTime() || 0;
}

function clean(value, max = 10000) {
  return String(value || "").replace(/\r/g, "").trim().slice(0, max);
}

function parseObject(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try { return JSON.parse(value); } catch { return {}; }
}

async function request(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(`GET ${pathname} failed with HTTP ${response.status}: ${payload.message || payload.error || "request failed"}`);
  return payload;
}

function messageCollections(call) {
  const candidates = [
    call?.artifact?.messages,
    call?.messages,
    call?.artifact?.messagesOpenAIFormatted,
    call?.messagesOpenAIFormatted,
  ];
  return candidates.find((value) => Array.isArray(value) && value.length) || [];
}

function messageText(message) {
  const direct = message?.message ?? message?.content ?? message?.text ?? message?.transcript;
  if (typeof direct === "string") return clean(direct, 4000);
  if (Array.isArray(direct)) return direct.map((item) => clean(item?.text || item?.content || item, 1000)).filter(Boolean).join(" ");
  return "";
}

function messageSeconds(message, startedMs) {
  for (const value of [message?.secondsFromStart, message?.time, message?.startTime, message?.timestamp]) {
    const number = Number(value);
    if (Number.isFinite(number)) {
      if (number > 1e12 && startedMs) return Math.max(0, (number - startedMs) / 1000);
      if (number > 1e9 && startedMs) return Math.max(0, (number * 1000 - startedMs) / 1000);
      return Math.max(0, number);
    }
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && startedMs) return Math.max(0, (parsed - startedMs) / 1000);
  }
  return null;
}

function safeMessages(call) {
  const startedMs = callTime(call);
  return messageCollections(call).map((message, index) => {
    const role = clean(message?.role || message?.type || "unknown", 80);
    const toolCalls = listFrom(message?.toolCallList || message?.toolCalls || message?.tool_calls).map((item) => ({
      name: clean(item?.name || item?.function?.name, 160),
      idHash: hash(item?.id || item?.toolCallId || item?.tool_call_id),
      arguments: parseObject(item?.arguments || item?.function?.arguments || item?.parameters),
    }));
    const toolResult = parseObject(message?.result ?? message?.output);
    return {
      index,
      secondsFromStart: messageSeconds(message, startedMs),
      role,
      text: messageText(message),
      toolCalls,
      toolResult: Object.keys(toolResult).length ? toolResult : undefined,
    };
  }).filter((message) => message.text || message.toolCalls.length || message.toolResult);
}

function structuredOutputs(call) {
  const outputs = call?.artifact?.structuredOutputs || call?.analysis?.structuredOutputs || {};
  return Object.values(outputs).map((output) => ({
    name: clean(output?.name || "unnamed", 120),
    result: output?.result,
  }));
}

function scorecards(call) {
  const cards = call?.artifact?.scorecards || call?.analysis?.scorecards || {};
  return Object.values(cards).map((card) => ({
    name: clean(card?.name || "unnamed", 120),
    score: card?.score,
    scoreNormalized: card?.scoreNormalized,
    metricPointValues: Object.values(card?.metricPoints || {}),
  }));
}

function responseTiming(messages) {
  const turns = [];
  for (let index = 0; index < messages.length - 1; index += 1) {
    const current = messages[index];
    const next = messages[index + 1];
    if (!/user|customer/i.test(current.role) || !/assistant|bot/i.test(next.role)) continue;
    if (current.secondsFromStart == null || next.secondsFromStart == null) continue;
    turns.push({
      afterCallerMessage: current.text.slice(0, 120),
      responseDelaySeconds: Number(Math.max(0, next.secondsFromStart - current.secondsFromStart).toFixed(2)),
    });
  }
  return turns;
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  const phones = listFrom(await request("/phone-number?limit=1000"), ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => phoneNumber(record) === targetPhone);
  const phoneId = String(phone?.id || phone?.phoneNumberId || "").trim();
  if (!phoneId) throw new Error("The Grimsby 6809 Vapi phone was not found.");

  const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
  const calls = listFrom(await request(`/call?limit=100&createdAtGt=${encodeURIComponent(since)}`))
    .sort((left, right) => callTime(right) - callTime(left));
  let call = null;
  for (const candidate of calls) {
    const id = String(candidate?.id || candidate?.callId || "").trim();
    if (!id) continue;
    const detail = await request(`/call/${encodeURIComponent(id)}`);
    if (String(detail?.phoneNumberId || detail?.phoneNumber?.id || "") === phoneId || phoneNumber(detail?.phoneNumber) === targetPhone) {
      call = detail;
      break;
    }
  }
  if (!call) throw new Error("No Grimsby call was found in the last six hours.");

  const startedMs = callTime(call);
  const endedMs = new Date(call?.endedAt || call?.ended_at || 0).getTime() || 0;
  const messages = safeMessages(call);
  const report = {
    call: {
      idHash: hash(call?.id || call?.callId),
      createdAt: call?.createdAt || call?.startedAt || null,
      endedAt: call?.endedAt || null,
      durationSeconds: startedMs && endedMs ? Number(((endedMs - startedMs) / 1000).toFixed(1)) : call?.durationSeconds || null,
      status: call?.status || "",
      endedReason: call?.endedReason || "",
      callerLast4: phoneNumber(call?.customer || call?.caller || { number: call?.from || call?.fromNumber }).slice(-4),
      cost: call?.cost ?? call?.costs?.total ?? null,
    },
    transcript: clean(call?.artifact?.transcript || call?.transcript, 30000),
    messages,
    responseTiming: responseTiming(messages),
    performanceMetrics: call?.artifact?.performanceMetrics || null,
    toolCallCount: messages.reduce((sum, message) => sum + message.toolCalls.length, 0),
    structuredOutputs: structuredOutputs(call),
    scorecards: scorecards(call),
    summary: clean(call?.analysis?.summary || call?.summary, 5000),
    successEvaluation: call?.analysis?.successEvaluation ?? call?.analysis?.successEvaluationResult ?? null,
    artifactKeys: Object.keys(call?.artifact || {}).sort(),
    analysisKeys: Object.keys(call?.analysis || {}).sort(),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
