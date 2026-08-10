const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv, rootPath } = require("./_helpers");

const env = loadProjectEnv();
const apiKey = String(env.VAPI_API_KEY || env.VAPI_KEY || env.VAPI_TOKEN || "").trim();
const apiBase = String(env.VAPI_API_BASE_URL || "https://api.vapi.ai").replace(/\/+$/, "");
const publicApiBase = String(env.PUBLIC_API_BASE_URL || env.REACT_APP_API_BASE_URL || "https://api.myaipa.ca").replace(/\/+$/, "");
const adminPassword = String(env.ADMIN_PASSWORD || "").trim();
const configuredTestCallerNumbers = new Set(String(env.AUDIT_TEST_CALLER_NUMBERS || "")
  .split(",")
  .map(normalizePhone)
  .filter(Boolean));
const days = Math.max(1, Math.min(365, Number(valueArg("days") || 60)));
const outputPath = valueArg("out");

function valueArg(name) {
  const prefix = `--${name}=`;
  return process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length) || "";
}

function listFrom(value, keys = []) {
  if (Array.isArray(value)) return value;
  for (const key of ["data", "results", ...keys]) if (Array.isArray(value?.[key])) return value[key];
  return [];
}

function clean(value, max = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 12);
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `+1${digits}` : `+${digits}`;
}

function phoneLast4(value) {
  const normalized = normalizePhone(value);
  return normalized ? normalized.slice(-4) : "unknown";
}

function dateValue(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

async function request(route, attempt = 0) {
  const response = await fetch(`${apiBase}${route}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(120000),
  });
  if ((response.status === 429 || response.status >= 500) && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** attempt)));
    return request(route, attempt + 1);
  }
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  if (!response.ok) throw new Error(`${route} failed with HTTP ${response.status}: ${payload.message || payload.error || "request failed"}`);
  return payload;
}

function callDate(call) {
  return dateValue(call?.startedAt || call?.createdAt || call?.endedAt || call?.updatedAt);
}

async function fetchCallsSince(cutoff, maxPages = 100) {
  const records = [];
  const seen = new Set();
  let createdAtLt = "";
  for (let page = 0; page < maxPages; page += 1) {
    // Do not send createdAtGt here. Some Vapi plans reject a requested window
    // older than their provider retention period. Page backwards through every
    // call the account still exposes, then apply the requested cutoff locally.
    const query = new URLSearchParams({ limit: "1000" });
    if (createdAtLt) query.set("createdAtLt", createdAtLt);
    const batch = listFrom(await request(`/call?${query.toString()}`), ["calls"]);
    for (const call of batch) {
      const id = String(call?.id || call?.callId || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if ((callDate(call)?.getTime() || 0) >= cutoff.getTime()) records.push(call);
    }
    if (batch.length < 1000) break;
    const times = batch.map(callDate).filter(Boolean).map((date) => date.getTime());
    if (!times.length) break;
    createdAtLt = new Date(Math.min(...times) - 1).toISOString();
  }
  return records;
}

async function fetchAdminCalls() {
  if (!adminPassword) return { available: false, reason: "ADMIN_PASSWORD is not configured.", calls: [] };
  try {
    const response = await fetch(`${publicApiBase}/api/admin/calls`, {
      headers: { "x-admin-password": adminPassword, Accept: "application/json" },
      signal: AbortSignal.timeout(90000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { available: false, reason: `Admin API returned HTTP ${response.status}.`, calls: [] };
    return { available: true, reason: "", calls: listFrom(payload, ["calls"]) };
  } catch (error) {
    return { available: false, reason: clean(error?.message || error, 240), calls: [] };
  }
}

function adminCallForAnalysis(call) {
  return {
    ...call,
    id: call?.externalId || `database-call-${call?.id || hash(JSON.stringify(call || {}))}`,
    _analysisSource: "myaipa_database",
    _assistantName: call?.business?.name || "My AI PA stored call",
    _phoneNumber: call?.business?.phone || "",
    durationSeconds: call?.durationSec,
    cost: call?.vapiCost ?? call?.totalInternalCost,
    type: call?.externalProvider || "database",
  };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function transcriptFrom(call) {
  const direct = call?.artifact?.transcript || call?.transcript || call?.analysis?.transcript;
  if (typeof direct === "string") return direct.trim();
  if (Array.isArray(direct)) {
    return direct.map((item) => `${item?.role || item?.speaker || "unknown"}: ${item?.text || item?.message || item?.content || ""}`).join("\n");
  }
  return "";
}

function messageCollections(call) {
  return [
    call?.artifact?.messages,
    call?.messages,
    call?.artifact?.messagesOpenAIFormatted,
    call?.messagesOpenAIFormatted,
  ].find((value) => Array.isArray(value) && value.length) || [];
}

function messageText(message) {
  const direct = message?.message ?? message?.content ?? message?.text ?? message?.transcript;
  if (typeof direct === "string") return clean(direct, 8000);
  if (Array.isArray(direct)) return direct.map((item) => clean(item?.text || item?.content || item, 2000)).filter(Boolean).join(" ");
  return "";
}

function turnsFrom(call, transcript) {
  const messages = messageCollections(call)
    .map((message) => ({
      role: clean(message?.role || message?.type, 60).toLowerCase(),
      text: messageText(message),
      toolCalls: listFrom(message?.toolCallList || message?.toolCalls || message?.tool_calls),
      toolResult: message?.result ?? message?.output,
    }))
    .filter((message) => message.text || message.toolCalls.length || message.toolResult != null);
  if (messages.length) return messages;
  // Stored transcripts normally use one speaker per line, but older imports can
  // contain the entire conversation on one line. Match role markers globally so
  // those calls are still assessable without persisting their raw contents.
  const rolePattern = /(?:^|\n|\s)(assistant|ai|bot|user|caller|customer)\s*:\s*([\s\S]*?)(?=(?:\n|\s)(?:assistant|ai|bot|user|caller|customer)\s*:|$)/gi;
  return [...String(transcript || "").matchAll(rolePattern)].map((match) => ({
    role: match[1].toLowerCase(),
    text: clean(match[2], 8000),
    toolCalls: [],
    toolResult: null,
  })).filter((turn) => turn.text);
}

function assistantRole(role) {
  return /assistant|bot|ai/.test(role);
}

function callerRole(role) {
  return /user|caller|customer/.test(role);
}

function wordCount(value) {
  return clean(value, 20000).split(/\s+/).filter(Boolean).length;
}

function questionFamilies(text) {
  const value = String(text || "").toLowerCase();
  const families = [];
  const patterns = {
    name: /\b(?:your|caller'?s|tenant'?s) name\b|\bwho (?:am i|are we) speaking with\b|\bmay i (?:have|get) your name\b/,
    phone: /\b(?:phone|callback|contact) number\b|\bbest number to reach\b|\bnumber (?:you are|you're) calling from\b/,
    address: /\b(?:property|service|street|building) address\b|\bwhat(?:'s| is) the address\b/,
    city: /\bwhat city\b|\bwhich city\b|\blocation\b/,
    callback: /\b(?:best|preferred) (?:time|day).{0,25}(?:call|reach|contact)\b|\bwhen should.{0,20}call\b/,
    email: /\bemail address\b|\bbest email\b/,
    issue: /\bwhat (?:happened|is happening|seems to be|can i help|are you calling about)\b|\bdescribe (?:the|your) (?:issue|problem|concern)\b/,
    safety: /\b(?:smoke|sparks?|gas smell|carbon monoxide|immediate danger|active flooding|911)\b/,
    consent: /\b(?:recorded|recording|consent|is that okay|okay to continue)\b/,
  };
  for (const [family, pattern] of Object.entries(patterns)) if (pattern.test(value)) families.push(family);
  return families;
}

function explicitCallerAnswers(text, promptedFamilies = []) {
  const value = clean(text, 12000).toLowerCase();
  const answers = new Set();
  const digits = value.replace(/\D/g, "");
  if (/\b(?:my name is|this is|you can call me)\b/.test(value)) answers.add("name");
  if (digits.length >= 7 || /\b(?:this|the|same) number (?:i(?:'m| am) calling from|on (?:the )?caller id)\b/.test(value)) answers.add("phone");
  if (/\b(?:address is|located at|property is at)\b/.test(value) || /\b\d{1,6}\s+[a-z][a-z .'-]{1,50}\b(?:street|st|road|rd|avenue|ave|drive|dr|boulevard|blvd|lane|ln|court|ct)\b/.test(value)) answers.add("address");
  if (/\b(?:city is|in (?:the city of )?[a-z][a-z .'-]{2,30})\b/.test(value)) answers.add("city");
  if (/\b(?:morning|afternoon|evening|any ?time|after \d|before \d|between \d|at \d|tomorrow|today|weekday|weekend)\b/.test(value)) answers.add("callback");
  if (/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/.test(value)) answers.add("email");
  if (/\b(?:broken|stopped|not working|no heat|no power|leak|flood|smoke|sparks?|gas|alarm|repair|install|maintenance|complaint|message|calling about)\b/.test(value)) answers.add("issue");
  if (promptedFamilies.includes("consent") && /\b(?:yes|no|okay|ok|i consent|that's fine|that is fine)\b/.test(value)) answers.add("consent");
  if (promptedFamilies.length === 1 && !answers.size && value.split(/\s+/).length <= 8 && !/\b(?:what|why|how|sorry|repeat)\b/.test(value)) {
    answers.add(promptedFamilies[0]);
  }
  return answers;
}

function repeatedAnsweredQuestionFamilies(turns) {
  const answered = new Set();
  const repeated = new Set();
  let prompted = [];
  for (const turn of turns) {
    if (assistantRole(turn.role)) {
      prompted = questionFamilies(turn.text);
      for (const family of prompted) if (answered.has(family)) repeated.add(family);
      continue;
    }
    if (!callerRole(turn.role)) continue;
    for (const family of explicitCallerAnswers(turn.text, prompted)) answered.add(family);
    prompted = [];
  }
  return [...repeated];
}

function classifyIntent(text, assistantName) {
  const value = `${assistantName} ${text}`.toLowerCase();
  const matches = [
    ["constituent_service", /dean allison|constituen|passport|immigration|federal service|member of parliament/],
    ["tenant_maintenance", /tenant|landlord|rent|lease|furnace|no heat|stove|maintenance|property manager/],
    ["electrical_service", /electric|wiring|panel|outlet|breaker|hot tub|sparks?/],
    ["plumbing_hvac", /plumb|leak|pipe|drain|toilet|furnace|boiler|air condition|no heat/],
    ["signup_or_demo", /sign.?up|free trial|my ai pa|private demo|test call/],
    ["sales_or_spam", /seo|marketing|google ranking|sell you|salesperson|promotion/],
  ];
  return matches.find(([, pattern]) => pattern.test(value))?.[0] || "general_inquiry";
}

function callDurationSeconds(call) {
  const direct = number(call?.durationSeconds || call?.duration);
  if (direct > 0) return direct;
  const started = dateValue(call?.startedAt || call?.createdAt);
  const ended = dateValue(call?.endedAt);
  return started && ended ? Math.max(0, (ended.getTime() - started.getTime()) / 1000) : 0;
}

function analyzeCall(call, context) {
  const transcript = transcriptFrom(call);
  const turns = turnsFrom(call, transcript);
  const assistantTurns = turns.filter((turn) => assistantRole(turn.role) && turn.text);
  const callerTurns = turns.filter((turn) => callerRole(turn.role) && turn.text);
  const assistantText = assistantTurns.map((turn) => turn.text).join("\n");
  const callerText = callerTurns.map((turn) => turn.text).join("\n");
  const fullText = `${assistantText}\n${callerText}`;
  const repeatedFamilies = repeatedAnsweredQuestionFamilies(turns);
  const assistantWords = assistantTurns.map((turn) => wordCount(turn.text));
  const longestAssistantTurnWords = Math.max(0, ...assistantWords);
  const averageAssistantTurnWords = assistantWords.length ? round(assistantWords.reduce((sum, count) => sum + count, 0) / assistantWords.length, 1) : 0;
  const callerGoodbyeIndex = turns.findIndex((turn) => callerRole(turn.role) && /\b(?:goodbye|bye|that'?s all|no thanks|nothing else)\b/i.test(turn.text));
  const afterGoodbye = callerGoodbyeIndex >= 0 ? turns.slice(callerGoodbyeIndex + 1).filter((turn) => assistantRole(turn.role)) : [];
  const assistantQuestionAfterGoodbye = afterGoodbye.some((turn) => /\?/.test(turn.text));
  const assistantClosingAfterGoodbye = afterGoodbye.some((turn) => /\b(?:take care|goodbye|thanks for calling|have a good)\b/i.test(turn.text));
  const callerUsesCallingNumberIndex = turns.findIndex((turn) => callerRole(turn.role) && /\b(?:this|the|same) number (?:i(?:'m| am) calling from|on the (?:caller )?id)|\bnumber i(?:'m| am) calling from\b/i.test(turn.text));
  const asksPhoneAfterCallingNumber = callerUsesCallingNumberIndex >= 0 && turns.slice(callerUsesCallingNumberIndex + 1).some((turn) => assistantRole(turn.role) && questionFamilies(turn.text).includes("phone"));
  const toolCallCount = turns.reduce((sum, turn) => sum + turn.toolCalls.length, 0);
  const toolFailure = turns.some((turn) => /\b(?:tool|message|text|sms).{0,30}(?:failed|error|unable|not sent)\b/i.test(`${turn.text} ${JSON.stringify(turn.toolResult || "")}`));
  const unsupportedClaims = [];
  const claimPatterns = {
    licensed_or_insured: /\b(?:we|they|the company|our technicians?).{0,24}(?:licensed|insured|certified)\b/i,
    response_promise: /\b(?:we'?ll|get|be) (?:right back|there (?:right away|soon)|call you back as soon as possible)|\bsomeone is on the way\b/i,
    guaranteed_outcome: /\b(?:guarantee|definitely).{0,35}(?:appointment|approval|price|repair|response)\b/i,
    source_disclosure: /\b(?:according to|found on|saw on|from) (?:the|their|your)?\s*website\b/i,
  };
  for (const [code, pattern] of Object.entries(claimPatterns)) if (pattern.test(assistantText)) unsupportedClaims.push(code);
  const firstAssistantText = assistantTurns[0]?.text || "";
  const recordingNotice = /\b(?:recorded|recording)\b/i.test(firstAssistantText);
  const virtualDisclosure = /\b(?:virtual receptionist|ai assistant|artificial intelligence|private demo)\b/i.test(assistantText);
  const fillerCount = (assistantText.match(/\b(?:i understand|i see|absolutely|of course|one moment|just a moment|this will just take a sec)\b/gi) || []).length;
  const safetyTermsMentioned = /\b(?:gas smell|smell(?:ing)? gas|carbon monoxide|co alarm|smoke|fire|sparks?|immediate danger|911)\b/i.test(callerText);
  const explicitlyNegatedSafety = /\b(?:there (?:is|are)|i (?:have|see|smell)|we (?:have|see|smell))?\s*(?:no|without|not experiencing|not seeing|not smelling)\b[^.!?\n]{0,160}\b(?:gas smell|smell(?:ing)? gas|carbon monoxide|co alarm|smoke|fire|sparks?)\b/i.test(callerText);
  const affirmativeSafety = /\b(?:i|we|there(?:'s| is)|the alarm|it)\b[^.!?\n]{0,50}\b(?:smell(?:ing)? gas|gas smell|carbon monoxide|co alarm|smoke|fire|sparks?|immediate danger)\b/i.test(callerText);
  const negationReversed = /\b(?:but|however)\b[^.!?\n]{0,80}\b(?:gas smell|smell(?:ing)? gas|carbon monoxide|co alarm|smoke|fire|sparks?|immediate danger)\b/i.test(callerText);
  const safetyMentioned = safetyTermsMentioned && (!explicitlyNegatedSafety || negationReversed || (affirmativeSafety && !/\b(?:no|without|not)\b/i.test(callerText)));
  const safeRedirect = /\b(?:leave|exit|move to a safe).{0,180}\b(?:911|fire department|gas utility)\b/i.test(assistantText);
  const endedReason = clean(call?.endedReason, 120).toLowerCase();
  const flags = [];
  if (!transcript) flags.push("missing_transcript");
  if (callerTurns.length === 0) flags.push("no_caller_turns");
  if (repeatedFamilies.length) flags.push("repeated_questions");
  if (longestAssistantTurnWords > 55) flags.push("assistant_monologue");
  if (assistantQuestionAfterGoodbye) flags.push("question_after_goodbye");
  if (callerGoodbyeIndex >= 0 && !assistantClosingAfterGoodbye) flags.push("missing_closing_after_goodbye");
  if (callerGoodbyeIndex >= 0 && /customer-ended-call/.test(endedReason) && (!assistantClosingAfterGoodbye || assistantQuestionAfterGoodbye)) flags.push("caller_had_to_disconnect");
  if (asksPhoneAfterCallingNumber) flags.push("calling_number_not_reused");
  if (unsupportedClaims.length) flags.push("unsupported_or_source_claim");
  if (toolFailure) flags.push("tool_or_sms_failure");
  if (fillerCount > Math.max(2, assistantTurns.length / 2)) flags.push("excessive_filler");
  if (safetyMentioned && !safeRedirect) flags.push("safety_response_unconfirmed");
  if (callDurationSeconds(call) > 240) flags.push("long_call");
  const assistantId = String(call?.assistantId || call?.assistant?.id || "");
  const phoneNumberId = String(call?.phoneNumberId || call?.phoneNumber?.id || "");
  const phone = context.phoneById.get(phoneNumberId);
  const assistant = context.assistantById.get(assistantId || String(phone?.assistantId || ""));
  const assistantName = clean(call?._assistantName || call?.assistant?.name || assistant?.name || phone?.name || phone?.assistantName || "Unidentified assistant", 120);
  if (/first class rentals/i.test(assistantName) && /\bfirst (?:cloud|class rental)(?!s\b)/i.test(assistantText)) flags.push("business_name_drift");
  const callerNumber = normalizePhone(call?.customer?.number || call?.customer?.phoneNumber || call?.caller?.phone || call?.caller?.number || call?.from || call?.fromNumber);
  const ownedCaller = context.ownedPhones.has(callerNumber);
  const syntheticQa = ownedCaller || context.testCallerNumbers.has(callerNumber) || /\b(?:private demo|test call|controlled call|i consent\. my name is alex martin)\b/i.test(fullText);
  return {
    callIdHash: hash(call?.id || call?.callId),
    createdAt: call?.createdAt || call?.startedAt || null,
    assistantIdHash: hash(assistantId || phone?.assistantId),
    assistantName,
    phoneLast4: phoneLast4(call?._phoneNumber || phone?.number || call?.phoneNumber?.number || call?.phoneNumber),
    callType: clean(call?._analysisSource || call?.type || "unknown", 80),
    syntheticQa,
    intent: callerTurns.length || assistantTurns.length ? classifyIntent(fullText, assistantName) : "unclassified_no_conversation",
    durationSeconds: round(callDurationSeconds(call), 1),
    costUsd: round(call?.cost ?? call?.costs?.total, 4),
    status: clean(call?.status, 80),
    endedReason,
    transcriptPresent: Boolean(transcript),
    callerTurns: callerTurns.length,
    assistantTurns: assistantTurns.length,
    averageAssistantTurnWords,
    longestAssistantTurnWords,
    repeatedQuestionFamilies: repeatedFamilies,
    recordingNotice,
    virtualDisclosure,
    callerSaidGoodbye: callerGoodbyeIndex >= 0,
    assistantClosedAfterGoodbye: assistantClosingAfterGoodbye,
    assistantQuestionAfterGoodbye,
    trustedCallingNumberUsed: callerUsesCallingNumberIndex >= 0 && !asksPhoneAfterCallingNumber,
    toolCallCount,
    toolFailure,
    unsupportedClaims,
    flags,
  };
}

function tally(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])));
}

const EVIDENCE_FLAGS = new Set(["missing_transcript", "no_caller_turns"]);

function splitFlags(flags) {
  return {
    evidence: flags.filter((flag) => EVIDENCE_FLAGS.has(flag)),
    behavior: flags.filter((flag) => !EVIDENCE_FLAGS.has(flag)),
  };
}

function recommendationsFor(group) {
  const flags = tally(group.calls.flatMap((call) => call.flags));
  const recommendations = [];
  if (flags.repeated_questions) recommendations.push("Use a structured state ledger and forbid re-asking any confirmed field unless the caller corrects it.");
  if (flags.assistant_monologue) recommendations.push("Keep routine turns below about 35 words and ask exactly one question at a time.");
  if (flags.calling_number_not_reused) recommendations.push("Read the trusted inbound caller ID into the call context and ask for a number only when it is unavailable or the caller chooses another number.");
  if (flags.question_after_goodbye || flags.caller_had_to_disconnect || flags.missing_closing_after_goodbye) recommendations.push("Use one approved closing plus a matching Vapi end-call phrase so the assistant ends immediately after goodbye.");
  if (flags.unsupported_or_source_claim) recommendations.push("Move business facts into an approved knowledge block and prohibit licences, insurance, timing, price, source, and availability claims unless explicitly verified.");
  if (flags.tool_or_sms_failure) recommendations.push("Keep SMS routing deterministic, announce only verified delivery results, and log owner/caller delivery separately.");
  if (flags.business_name_drift) recommendations.push("Keep the business name in a short pronunciation-safe opening and regression-test the exact spoken name.");
  if (flags.excessive_filler) recommendations.push("Remove filler acknowledgements and prefer a short confirmation followed by the next necessary question.");
  if (flags.safety_response_unconfirmed) recommendations.push("Put emergency classification ahead of ordinary intake and use deterministic evacuation/911 wording.");
  if (flags.missing_transcript) recommendations.push("Verify recording/transcript configuration and end-of-call artifact delivery before relying on dashboard review.");
  if (!recommendations.length) recommendations.push("Preserve the current behaviour and add regression cases for its strongest completed calls before changing the prompt.");
  const name = group.assistantName.toLowerCase();
  if (/first class|rental/.test(name)) recommendations.push("Keep separate rental-inquiry, tenant-routine, tenant-urgent, and emergency-redirect states with no response-time promise.");
  else if (/dean allison|constituen/.test(name)) recommendations.push("Keep unofficial-demo disclosure, political neutrality, sensitive-identifier refusal, and no contact with the real office without authorization.");
  else if (/electric/.test(name)) recommendations.push("Collect installation/repair type, address and city, outage scope, hazards, desired timing, callback number, and best callback time without diagnosing the fault.");
  else if (/plumb|heating|arscott/.test(name)) recommendations.push("Distinguish active water damage, gas/CO danger, no heat, routine maintenance, and installation inquiries before ordinary intake continues.");
  else if (/my ai pa/.test(name)) recommendations.push("Separate product questions from confirmed signup intent, read back contact details once, and submit only after explicit authorization.");
  return [...new Set(recommendations)];
}

function summarizeGroup(calls) {
  const transcriptCalls = calls.filter((call) => call.transcriptPresent);
  const assessableCalls = calls.filter((call) => call.transcriptPresent && call.callerTurns > 0);
  const behaviorIssueCalls = assessableCalls.filter((call) => splitFlags(call.flags).behavior.length);
  const group = {
    assistantName: calls[0]?.assistantName || "Unidentified assistant",
    assistantIdHash: calls[0]?.assistantIdHash || "",
    phoneLast4s: [...new Set(calls.map((call) => call.phoneLast4))].sort(),
    calls,
  };
  return {
    assistantName: group.assistantName,
    assistantIdHash: group.assistantIdHash,
    phoneLast4s: group.phoneLast4s,
    callCount: calls.length,
    syntheticQaCalls: calls.filter((call) => call.syntheticQa).length,
    totalMinutes: round(calls.reduce((sum, call) => sum + call.durationSeconds, 0) / 60, 2),
    averageDurationSeconds: round(calls.reduce((sum, call) => sum + call.durationSeconds, 0) / Math.max(1, calls.length), 1),
    transcriptCoveragePercent: round((transcriptCalls.length / Math.max(1, calls.length)) * 100, 1),
    assessableCallCount: assessableCalls.length,
    evidenceGapCounts: tally(calls.flatMap((call) => splitFlags(call.flags).evidence)),
    behaviorIssueCalls: behaviorIssueCalls.length,
    behaviorPassRatePercent: round(((assessableCalls.length - behaviorIssueCalls.length) / Math.max(1, assessableCalls.length)) * 100, 1),
    endedReasons: tally(calls.map((call) => call.endedReason || "unknown")),
    intents: tally(calls.map((call) => call.intent)),
    behaviorIssueCounts: tally(assessableCalls.flatMap((call) => splitFlags(call.flags).behavior)),
    recommendations: recommendationsFor(group),
    callEvidence: calls.map((call) => ({
      callIdHash: call.callIdHash,
      createdAt: call.createdAt,
      syntheticQa: call.syntheticQa,
      intent: call.intent,
      durationSeconds: call.durationSeconds,
      endedReason: call.endedReason,
      transcriptPresent: call.transcriptPresent,
      callerTurns: call.callerTurns,
      assistantTurns: call.assistantTurns,
      averageAssistantTurnWords: call.averageAssistantTurnWords,
      longestAssistantTurnWords: call.longestAssistantTurnWords,
      repeatedQuestionFamilies: call.repeatedQuestionFamilies,
      flags: call.flags,
      source: call.callType,
    })),
  };
}

function ultimatePlaybook() {
  return [
    "Start promptly with the approved business greeting, virtual-receptionist identity, and recording notice when recording is enabled.",
    "Ask one question at a time, keep routine responses concise, and silently remember every confirmed field.",
    "Classify the call before deep intake: emergency redirect, urgent non-emergency, routine service, quote/installation, message, signup, or non-customer.",
    "Stop ordinary intake for immediate danger; give the approved leave-and-call-911 or utility wording without diagnosis or repair instructions.",
    "Collect only the fields relevant to that call. Reuse trusted caller ID when the caller approves the number they are calling from.",
    "Read back critical phone numbers, addresses, dates, and consent once; do not repeat the entire intake.",
    "Use only approved business facts. Never invent licensing, insurance, price, availability, technician status, response time, or the source of internal knowledge.",
    "Run owner/customer notifications through an isolated business-specific tool. Report success only from the tool result and keep the two delivery outcomes separate.",
    "Give a short recap, state the truthful next step, say one approved closing, and attach the same sentence as an end-call phrase.",
    "Log observable classifications, structured details, tool outcomes, transcript availability, and end reason—never hidden reasoning.",
  ];
}

async function main() {
  if (!apiKey) throw new Error("VAPI_API_KEY is not configured.");
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [callSummaries, phonePayload, assistantPayload, adminPayload] = await Promise.all([
    fetchCallsSince(cutoff),
    request("/phone-number?limit=1000"),
    request("/assistant?limit=1000"),
    fetchAdminCalls(),
  ]);
  const phones = listFrom(phonePayload, ["phoneNumbers", "phone_numbers"]);
  const assistants = listFrom(assistantPayload, ["assistants"]);
  const phoneById = new Map(phones.map((phone) => [String(phone?.id || ""), phone]));
  const assistantById = new Map(assistants.map((assistant) => [String(assistant?.id || ""), assistant]));
  const ownedPhones = new Set(phones.map((phone) => normalizePhone(phone?.number || phone?.phoneNumber || phone?.providerResourceId)).filter(Boolean));
  const details = await mapLimit(callSummaries, 4, async (summary) => {
    const id = String(summary?.id || summary?.callId || "");
    try { return await request(`/call/${encodeURIComponent(id)}`); }
    catch { return summary; }
  });
  const providerIds = new Set(details.map((call) => String(call?.id || call?.callId || "")).filter(Boolean));
  const storedCalls = adminPayload.calls
    .filter((call) => (callDate(call)?.getTime() || 0) >= cutoff.getTime())
    .filter((call) => !providerIds.has(String(call?.externalId || "")))
    .map(adminCallForAnalysis);
  const combinedCalls = [...details, ...storedCalls];
  const analyzed = combinedCalls.map((call) => analyzeCall(call, {
    phoneById,
    assistantById,
    ownedPhones,
    testCallerNumbers: configuredTestCallerNumbers,
  }));
  const testCalls = analyzed.filter((call) => call.syntheticQa);
  const assessableTestCalls = testCalls.filter((call) => call.transcriptPresent && call.callerTurns > 0);
  const grouped = new Map();
  for (const call of analyzed) {
    const key = `${call.assistantIdHash}:${call.phoneLast4}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(call);
  }
  const assistantReports = [...grouped.values()].map(summarizeGroup).sort((left, right) => right.callCount - left.callCount || left.assistantName.localeCompare(right.assistantName));
  const report = {
    generatedAt: new Date().toISOString(),
    window: { days, from: cutoff.toISOString(), to: new Date().toISOString() },
    privacy: {
      rawTranscriptsPersisted: false,
      callerPhoneNumbersPersisted: false,
      recordingsAccessed: false,
      callIdentifiers: "SHA-256 prefixes only",
    },
    coverage: {
      calls: analyzed.length,
      providerCallsAvailable: details.length,
      storedDatabaseCallsAdded: storedCalls.length,
      storedDatabaseRowsInWindow: adminPayload.calls.filter((call) => (callDate(call)?.getTime() || 0) >= cutoff.getTime()).length,
      adminDatabaseAvailable: adminPayload.available,
      adminDatabaseReason: adminPayload.reason || null,
      assistantsObserved: assistantReports.length,
      minutes: round(analyzed.reduce((sum, call) => sum + call.durationSeconds, 0) / 60, 2),
      transcriptCoveragePercent: round((analyzed.filter((call) => call.transcriptPresent).length / Math.max(1, analyzed.length)) * 100, 1),
      syntheticQaCalls: analyzed.filter((call) => call.syntheticQa).length,
      assessableCalls: analyzed.filter((call) => call.transcriptPresent && call.callerTurns > 0).length,
      earliestProviderCall: details.map(callDate).filter(Boolean).sort((left, right) => left - right)[0]?.toISOString() || null,
      providerRetentionNote: "Vapi currently rejects direct requests older than the account retention window; My AI PA database rows are used for older retained evidence.",
    },
    portfolioPatterns: {
      evidenceGapCounts: tally(analyzed.flatMap((call) => splitFlags(call.flags).evidence)),
      behaviorIssueCounts: tally(analyzed.filter((call) => call.transcriptPresent && call.callerTurns > 0).flatMap((call) => splitFlags(call.flags).behavior)),
      intents: tally(analyzed.map((call) => call.intent)),
      endedReasons: tally(analyzed.map((call) => call.endedReason || "unknown")),
    },
    testCallerPatterns: {
      calls: testCalls.length,
      assessableCalls: assessableTestCalls.length,
      assistants: tally(testCalls.map((call) => call.assistantName)),
      behaviorIssueCounts: tally(assessableTestCalls.flatMap((call) => splitFlags(call.flags).behavior)),
      note: configuredTestCallerNumbers.size
        ? "Includes calls from the configured audit caller numbers plus transcript-labelled controlled tests; numbers are not persisted."
        : "Includes only transcript-labelled controlled tests; set AUDIT_TEST_CALLER_NUMBERS for a known-caller audit without persisting the numbers.",
    },
    ultimatePlaybook: ultimatePlaybook(),
    assistants: assistantReports,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outputPath) {
    const finalPath = path.isAbsolute(outputPath) ? outputPath : rootPath(outputPath);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.writeFileSync(finalPath, json);
    console.log(`Sanitized call-playbook audit written to ${finalPath}`);
  } else {
    console.log(json.trim());
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  });
}

module.exports = {
  analyzeCall,
  explicitCallerAnswers,
  repeatedAnsweredQuestionFamilies,
  splitFlags,
  turnsFrom,
  ultimatePlaybook,
};
