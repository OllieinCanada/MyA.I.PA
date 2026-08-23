const fs = require("node:fs");
const path = require("node:path");
const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const { rootDir, ensureDir } = require("./_helpers");
const { fetchPublicWebsite } = require("../server/safeWebsiteFetch");
const {
  SEND_CONFIRMATION,
  createBusinessOutreachPackage,
  saveOutreachPackage,
  sendStoredOutreachPackage,
} = require("../server/outreach");

dotenv.config({ path: path.join(rootDir, ".env") });
dotenv.config({ path: path.join(rootDir, ".env.local"), override: false });

function parseArgs(argv) {
  const args = {};
  for (const item of argv) {
    if (!item.startsWith("--")) continue;
    const separator = item.indexOf("=");
    const key = item.slice(2, separator === -1 ? undefined : separator);
    args[key] = separator === -1 ? true : item.slice(separator + 1);
  }
  return args;
}

function readInput(args) {
  const fromFile = args.input
    ? JSON.parse(fs.readFileSync(path.resolve(rootDir, String(args.input)), "utf8"))
    : {};
  return {
    ...fromFile,
    ...(args.business ? { business_name: args.business } : {}),
    ...(args.website ? { business_website: args.website } : {}),
    ...(args.description ? { business_description: args.description } : {}),
    ...(args.notes ? { notes: args.notes } : {}),
    ...(args.contact ? { target_contact_name: args.contact } : {}),
    ...(args.industry ? { industry: args.industry } : {}),
    ...(args.location ? { location: args.location } : {}),
  };
}

function previewPath(outreachPackage) {
  const safeName = outreachPackage.business.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "business";
  const directory = path.join(rootDir, "outreach-previews");
  ensureDir(directory);
  const filePath = path.join(directory, `${safeName}-${outreachPackage.id}.html`);
  fs.writeFileSync(filePath, outreachPackage.email.html);
  return filePath;
}

async function readJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`);
  return data;
}

async function loginToApi(apiBase) {
  const password = String(process.env.ADMIN_PASSWORD || "").trim();
  if (!password) throw new Error("ADMIN_PASSWORD must be set in the process environment for remote mode.");
  const response = await fetch(`${apiBase}/api/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password, mfaCode: String(process.env.ADMIN_MFA_CODE || "").trim() }),
  });
  const data = await readJsonResponse(response);
  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) throw new Error("Admin login succeeded without returning a session cookie.");
  return { cookie: setCookie.split(";")[0], mfaEnabled: Boolean(data.mfaEnabled) };
}

async function remoteWorkflow(args, input) {
  const apiBase = String(args["api-base"] || "").replace(/\/+$/, "");
  if (!/^https:\/\//i.test(apiBase)) throw new Error("--api-base must be a public HTTPS URL in remote mode.");
  const { cookie } = await loginToApi(apiBase);
  const generated = await readJsonResponse(await fetch(`${apiBase}/api/admin/outreach/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(input),
  }));
  const outreachPackage = generated.package;
  const audioResponse = await fetch(outreachPackage.audio.url, { headers: { Range: "bytes=0-4095" } });
  const audioBytes = Buffer.from(await audioResponse.arrayBuffer());
  if (!audioResponse.ok || audioBytes.length < 1000 || !String(audioResponse.headers.get("content-type") || "").includes("audio")) {
    throw new Error("Generated public MP3 did not pass the remote playback check.");
  }
  const filePath = previewPath(outreachPackage);
  let delivery = outreachPackage.delivery;
  if (args["send-test"]) {
    if (args.confirm !== SEND_CONFIRMATION) throw new Error(`Sending requires --confirm=${SEND_CONFIRMATION}.`);
    const recipient = String(args.to || "").trim();
    const sent = await readJsonResponse(await fetch(`${apiBase}/api/admin/outreach/send-test`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ packageId: outreachPackage.id, to: recipient, confirmation: args.confirm }),
    }));
    delivery = sent.delivery;
  }
  return { outreachPackage, filePath, delivery, remoteAudioBytes: audioBytes.length };
}

function getLocalEmailConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const from = String(process.env.EMAIL_FROM || process.env.SMTP_FROM || "").trim();
  if (!host || !from) return null;
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  return {
    from,
    transport: {
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: /^(1|true|yes|on)$/i.test(String(process.env.SMTP_SECURE || "")),
      auth: user || pass ? { user, pass } : undefined,
    },
  };
}

async function localWorkflow(args, input) {
  const dataDir = path.resolve(rootDir, String(args["data-dir"] || "data"));
  const baseUrl = String(args["base-url"] || process.env.PUBLIC_APP_URL || "http://localhost:8787").replace(/\/+$/, "");
  const outreachPackage = await createBusinessOutreachPackage(input, {
    baseUrl,
    dataDir,
    fetchWebsite: fetchPublicWebsite,
    openAiApiKey: process.env.OPENAI_API_KEY,
  });
  saveOutreachPackage(outreachPackage, { dataDir });
  const filePath = previewPath(outreachPackage);
  let delivery = outreachPackage.delivery;
  if (args["send-test"]) {
    if (args.confirm !== SEND_CONFIRMATION) throw new Error(`Sending requires --confirm=${SEND_CONFIRMATION}.`);
    const config = getLocalEmailConfig();
    if (!config) throw new Error("SMTP_HOST and EMAIL_FROM are required for a local send.");
    const transporter = nodemailer.createTransport(config.transport);
    try {
      const sent = await sendStoredOutreachPackage({
        packageId: outreachPackage.id,
        to: args.to,
        confirmation: args.confirm,
      }, {
        dataDir,
        sendMail: (message) => transporter.sendMail({ from: config.from, ...message }),
      });
      delivery = sent.package.delivery;
    } finally {
      transporter.close();
    }
  }
  return { outreachPackage, filePath, delivery, remoteAudioBytes: null };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = readInput(args);
  const result = args["api-base"]
    ? await remoteWorkflow(args, input)
    : await localWorkflow(args, input);
  const summary = {
    package_id: result.outreachPackage.id,
    business: result.outreachPackage.business.name,
    subject: result.outreachPackage.email.subject,
    audio_url: result.outreachPackage.audio.url,
    audio_duration_seconds: result.outreachPackage.audio.duration,
    quality_passed: result.outreachPackage.quality.passed,
    preview_file: result.filePath,
    delivery: result.delivery,
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`Outreach workflow failed: ${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
