const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const QRCode = require("qrcode");

const { rootPath } = require("./_helpers");

const serviceId = String(process.argv.find((arg) => arg.startsWith("--service-id="))?.slice(13) || process.env.RENDER_SERVICE_ID || "srv-d92503a8qa3s73crdpog").trim();
const apply = process.argv.includes("--apply");
const confirmation = String(process.argv.find((arg) => arg.startsWith("--confirm="))?.slice(10) || "");
const expectedConfirmation = "ENABLE_ADMIN_TOTP";
const outputPath = rootPath("diagnostics", "security", "admin-totp-enrollment.png");

function base32(buffer) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let result = "";
  for (let offset = 0; offset < bits.length; offset += 5) {
    result += alphabet[Number.parseInt(bits.slice(offset, offset + 5).padEnd(5, "0"), 2)];
  }
  return result;
}

function stripYamlValue(value) {
  const text = String(value || "").trim();
  return ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'")))
    ? text.slice(1, -1)
    : text;
}

function renderCredentials() {
  const configPath = path.join(process.env.USERPROFILE || process.env.HOME || "", ".render", "cli.yaml");
  const source = fs.readFileSync(configPath, "utf8");
  const block = source.match(/(?:^|\r?\n)api:\s*\r?\n([\s\S]*?)(?=\r?\n\S|\s*$)/)?.[1] || "";
  const key = stripYamlValue(block.match(/^\s+key:\s*(.+)$/m)?.[1]);
  const host = stripYamlValue(block.match(/^\s+host:\s*(.+)$/m)?.[1]).replace(/\/+$/, "");
  if (!key || !host) throw new Error("The authorized Render profile is unavailable.");
  return { key, host };
}

async function request(credentials, endpoint, options = {}) {
  const response = await fetch(`${credentials.host}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${credentials.key}`,
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!response.ok) throw new Error(`Render request failed with HTTP ${response.status}.`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

async function main() {
  if (!/^srv-[a-z0-9]+$/i.test(serviceId)) throw new Error("A valid Render service ID is required.");
  if (apply && confirmation !== expectedConfirmation) throw new Error(`Apply mode requires --confirm=${expectedConfirmation}.`);
  const secret = base32(crypto.randomBytes(32));
  const label = encodeURIComponent("My AI PA Admin");
  const issuer = encodeURIComponent("My AI PA");
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await QRCode.toFile(outputPath, uri, { width: 700, margin: 3, errorCorrectionLevel: "H" });

  if (!apply) {
    fs.rmSync(outputPath, { force: true });
    console.log(JSON.stringify({ mode: "dry-run", serviceId, qrCanBeGenerated: true, secretPrinted: false }, null, 2));
    console.log(`Dry run only. Re-run with --apply --confirm=${expectedConfirmation}.`);
    return;
  }

  const credentials = renderCredentials();
  await request(credentials, `/services/${encodeURIComponent(serviceId)}/env-vars/ADMIN_TOTP_SECRET`, {
    method: "PUT",
    body: JSON.stringify({ value: secret }),
  });
  const deploy = await request(credentials, `/services/${encodeURIComponent(serviceId)}/deploys`, {
    method: "POST",
    body: JSON.stringify({ deployMode: "deploy_only" }),
  });
  console.log(JSON.stringify({
    ok: true,
    serviceId,
    qrPath: outputPath,
    secretPrinted: false,
    deployId: deploy.id || deploy.deploy?.id || "",
    nextStep: "Scan the QR code with an authenticator app before signing out of any existing admin session.",
  }, null, 2));
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
