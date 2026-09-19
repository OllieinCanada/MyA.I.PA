require("dotenv").config();
require("dotenv").config({ path: ".env.local", override: false });

const APPLY_CONFIRMATION = "CONFIGURE_TELEGRAM_GUARDED_ACTIONS";
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const confirmation = args.find((value) => value.startsWith("--confirm="))?.slice("--confirm=".length) || "";
const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "");
const webhookUrl = String(process.env.TELEGRAM_WEBHOOK_URL || "https://api.myaipa.ca/api/webhooks/telegram/actions").trim();

function assertConfiguration() {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required.");
  if (secret.length < 32) throw new Error("TELEGRAM_WEBHOOK_SECRET must contain at least 32 characters.");
  const url = new URL(webhookUrl);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("TELEGRAM_WEBHOOK_URL must be a credential-free HTTPS URL.");
}

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) throw new Error(`Telegram ${method} failed (${response.status}).`);
  return data.result;
}

async function main() {
  assertConfiguration();
  const current = await telegram("getWebhookInfo", {});
  const report = {
    apply,
    desiredUrl: webhookUrl,
    currentUrl: String(current?.url || ""),
    pendingUpdates: Number(current?.pending_update_count || 0),
    secretConfiguredLocally: true,
    allowedUpdates: ["callback_query"],
  };
  if (!apply) {
    console.log(JSON.stringify({ ...report, next: `Re-run with --apply --confirm=${APPLY_CONFIRMATION}.` }, null, 2));
    return;
  }
  if (confirmation !== APPLY_CONFIRMATION) throw new Error(`Use --confirm=${APPLY_CONFIRMATION} to change the live bot webhook.`);
  const configured = await telegram("setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["callback_query"],
    drop_pending_updates: false,
  });
  const verified = await telegram("getWebhookInfo", {});
  if (configured !== true || String(verified?.url || "") !== webhookUrl) throw new Error("Telegram did not retain the guarded-actions webhook URL.");
  console.log(JSON.stringify({ ...report, configured: true, verifiedUrl: verified.url }, null, 2));
}

main().catch((error) => {
  console.error(String(error?.message || error));
  process.exitCode = 1;
});
