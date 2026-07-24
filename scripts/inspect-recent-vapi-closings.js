const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").trim().replace(/\/+$/, "");

function listFrom(value) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "calls", "results"]) {
    if (Array.isArray(value?.[key])) return value[key];
  }
  return [];
}

function clean(value, max = 1200) {
  return String(value || "").replace(/\r/g, "").trim().slice(0, max);
}

function last4(value) {
  return String(value || "").replace(/\D/g, "").slice(-4);
}

function transcriptFrom(call) {
  const direct = clean(call?.artifact?.transcript || call?.transcript, 30000);
  if (direct) return direct;
  const messages = Array.isArray(call?.artifact?.messages) ? call.artifact.messages : [];
  return messages
    .map((message) => {
      const role = clean(message?.role || message?.type, 40);
      const text = clean(message?.message || message?.content || message?.text || message?.transcript, 2000);
      return text ? `${role}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolNames(call) {
  const names = new Set();
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const name = clean(value?.function?.name || value?.name, 160);
    if (/^(send_call_summaries_|endCall$)/i.test(name)) names.add(name);
    Object.values(value).forEach(visit);
  }
  visit(call);
  return [...names];
}

async function request(pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
  });
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = {};
  }
  if (!response.ok) {
    throw new Error(`GET ${pathname} failed with HTTP ${response.status}: ${clean(payload?.message || payload?.error || "request failed", 240)}`);
  }
  return payload;
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  const since = new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString();
  const summaries = listFrom(await request(`/call?limit=25&createdAtGt=${encodeURIComponent(since)}`))
    .sort((left, right) => new Date(right?.createdAt || 0) - new Date(left?.createdAt || 0));
  const assistantCache = new Map();
  const reports = [];
  for (const summary of summaries.slice(0, 12)) {
    const callId = String(summary?.id || summary?.callId || "").trim();
    if (!callId) continue;
    const call = await request(`/call/${encodeURIComponent(callId)}`);
    const assistantId = String(call?.assistantId || call?.assistant?.id || "").trim();
    if (assistantId && !assistantCache.has(assistantId)) {
      assistantCache.set(assistantId, await request(`/assistant/${encodeURIComponent(assistantId)}`));
    }
    const assistant = assistantCache.get(assistantId) || {};
    const transcript = transcriptFrom(call);
    reports.push({
      callId,
      createdAt: call?.createdAt || call?.startedAt || null,
      endedReason: clean(call?.endedReason || call?.status, 120),
      callerLast4: last4(call?.customer?.number || call?.caller?.number || call?.from),
      aiNumberLast4: last4(call?.phoneNumber?.number || call?.to),
      assistantId,
      assistantName: clean(assistant?.name || call?.assistant?.name || "Unnamed assistant", 160),
      toolNames: toolNames(call),
      transcriptTail: transcript.slice(-1200),
    });
  }
  console.log(JSON.stringify(reports, null, 2));
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exitCode = 1;
});
