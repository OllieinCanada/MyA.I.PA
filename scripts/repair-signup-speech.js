// Scoped, repeatable speech repair. Never changes tools, numbers, billing or
// other assistants. Default is read-only; --apply requires the exact pairing.
const crypto = require("node:crypto");
const { loadProjectEnv } = require("./_helpers");
const { signupSpeechPatch, normalizeConsentPrompt, inspectSignupSpeech } = require("../server/signupSpeechPolicy");
const { definitionMatches } = require("./vapi-release-evidence");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
function speechSnapshot(a) {
  const { tools: _expandedTools, ...model } = a.model || {};
  return { model, firstMessage: a.firstMessage, voice: a.voice, firstMessageMode: a.firstMessageMode || "assistant-speaks-first", firstMessageInterruptionsEnabled: a.firstMessageInterruptionsEnabled ?? false, modelOutputInMessagesEnabled: a.modelOutputInMessagesEnabled ?? false };
}
function repairPayload(a) {
  const original = speechSnapshot(a);
  if (!original.model.messages?.some(m => m.role === "system")) throw new Error("No system prompt: manual review required.");
  return { ...signupSpeechPatch(a), model: { ...original.model, messages: original.model.messages.map(m => m.role === "system" ? { ...m, content: normalizeConsentPrompt(m.content) } : m) } };
}
async function repair({ api, assistantId, phoneId, number, apply = false, verifyGatedPairing }) {
  async function pairingVerified(phone) {
    if (phone.id !== phoneId || phone.number !== number) return false;
    if (phone.assistantId) return phone.assistantId === assistantId;
    // Trial-gated phones resolve the assistant through the signed server
    // handler rather than phone.assistantId. Require authenticated CRM proof.
    return (phone.server?.url || phone.serverUrl) === "https://api.myaipa.ca/api/webhooks/voice"
      && Boolean(verifyGatedPairing && await verifyGatedPairing({assistantId,phoneId,number}));
  }
  const phone = await api(`/phone-number/${encodeURIComponent(phoneId)}`);
  if (!await pairingVerified(phone)) throw new Error("Exact phone/assistant pairing could not be verified; nothing changed.");
  const original = await api(`/assistant/${encodeURIComponent(assistantId)}`);
  if (original.id !== assistantId) throw new Error("Assistant identity mismatch.");
  const payload = repairPayload(original);
  const before = inspectSignupSpeech(original);
  if (!apply) return { mode: "dry-run", numberLast4: number.slice(-4), before, after: inspectSignupSpeech({ ...original, ...payload }), liveAudioTest: "required" };
  const fresh = await api(`/assistant/${encodeURIComponent(assistantId)}`);
  if (hash(speechSnapshot(fresh)) !== hash(speechSnapshot(original))) throw new Error("Assistant changed during review; nothing changed.");
  await api(`/assistant/${encodeURIComponent(assistantId)}`, { method: "PATCH", body: payload });
  let verified;
  try {
    verified = await api(`/assistant/${encodeURIComponent(assistantId)}`);
    const checks = inspectSignupSpeech(verified);
    if (!Object.values(checks).every(Boolean) || !definitionMatches(payload, speechSnapshot(verified))) throw new Error("Speech configuration read-back failed.");
    const finalPhone = await api(`/phone-number/${encodeURIComponent(phoneId)}`);
    if (!await pairingVerified(finalPhone)) throw new Error("Phone routing changed during repair.");
    return { mode: "applied", numberLast4: number.slice(-4), checks, publishedVersion: verified.latestVersion || null, liveAudioTest: "required", toolsPreserved: true };
  } catch (error) {
    // Never overwrite a concurrent edit during rollback.
    const current = await api(`/assistant/${encodeURIComponent(assistantId)}`).catch(() => null);
    if (current && hash(speechSnapshot(current)) === hash({ ...speechSnapshot(original), ...payload })) {
      await api(`/assistant/${encodeURIComponent(assistantId)}`, { method: "PATCH", body: speechSnapshot(original) });
    }
    throw error;
  }
}
async function main() {
  const args = Object.fromEntries(process.argv.slice(2).filter(s => s.startsWith("--") && s.includes("=")).map(s => { const i=s.indexOf("="); return [s.slice(2,i),s.slice(i+1)]; }));
  if (!args.assistant || !args.phone || !/^\+[1-9]\d{7,14}$/.test(args.number || "")) throw new Error("Supply --assistant=ID --phone=ID --number=E164.");
  const env = loadProjectEnv();
  const key = env.VAPI_API_KEY || env.VAPI_KEY;
  if (!key) throw new Error("VAPI_API_KEY is required.");
  const api = async (path, {method="GET",body}={}) => {
    const r = await fetch(`https://api.vapi.ai${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type":"application/json" }, body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000) });
    if(!r.ok) throw new Error(`Vapi ${method} returned HTTP ${r.status}.`);
    return r.json();
  };
  let cookie;
  const verifyGatedPairing = async ({assistantId,phoneId,number}) => {
    if (!env.ADMIN_PASSWORD) return false;
    if (!cookie) {
      const login=await fetch("https://api.myaipa.ca/api/admin/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({password:env.ADMIN_PASSWORD,mfaCode:env.ADMIN_TOTP_SECRET?require("../server/adminSecurity").totpCode(env.ADMIN_TOTP_SECRET):undefined}),signal:AbortSignal.timeout(20000)});
      if(!login.ok) throw new Error(`Admin authentication returned HTTP ${login.status}.`);
      cookie=login.headers.get("set-cookie")?.split(";")[0];
      if(!cookie) throw new Error("Admin session not established.");
    }
    const r=await fetch("https://api.myaipa.ca/api/admin/signups",{headers:{cookie},signal:AbortSignal.timeout(20000)});
    if(!r.ok) throw new Error(`Signup inventory returned HTTP ${r.status}.`);
    const rows=(await r.json()).signups || [];
    const active=rows.filter(s=>!s.archivedAt&&(s.twilioPhoneNumber===number||s.vapiPhoneNumberId===phoneId||s.vapiAssistantId===assistantId));
    return active.length===1&&active[0].twilioPhoneNumber===number&&active[0].vapiPhoneNumberId===phoneId&&active[0].vapiAssistantId===assistantId&&active[0].agentRouteBindingMode==="trial-gate";
  };
  console.log(JSON.stringify(await repair({api,assistantId:args.assistant,phoneId:args.phone,number:args.number,apply:process.argv.includes("--apply"),verifyGatedPairing}),null,2));
}
if (require.main === module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={repairPayload,repair,speechSnapshot};
