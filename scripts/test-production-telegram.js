const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const monitorKey = String(env.MONITOR_API_KEY || "").trim();
const shouldApply = process.argv.includes("--apply");
const confirmation = String(
  process.argv.find((argument) => argument.startsWith("--confirm="))?.split("=")[1] || ""
).trim();
const expectedConfirmation = "SEND_TELEGRAM_TEST";
const endpoint = "https://api.myaipa.ca/api/internal/operations/telegram-test";

async function main() {
  console.log(JSON.stringify({
    mode: shouldApply ? "apply" : "dry-run",
    target: "api.myaipa.ca",
    sendsOneControlledTelegramMessage: shouldApply,
    customerDataIncluded: false,
  }, null, 2));
  if (!shouldApply) {
    console.log(`Dry run only. Re-run with --apply --confirm=${expectedConfirmation} to send one controlled production test.`);
    return;
  }
  if (!monitorKey) throw new Error("MONITOR_API_KEY is not configured.");
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Refusing to send a Telegram test without --confirm=${expectedConfirmation}.`);
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-monitor-api-key": monitorKey,
    },
    body: JSON.stringify({ confirmation: expectedConfirmation }),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true || data?.sent !== true || data?.configured !== true) {
    throw new Error(`Production Telegram test failed (${response.status}): ${String(data?.error || "delivery not confirmed").slice(0, 220)}`);
  }
  console.log(JSON.stringify({
    ok: true,
    productionApiConfirmedTelegramDelivery: true,
    customerDataIncluded: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(String(error?.message || error).slice(0, 500));
  process.exit(1);
});
