const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const monitorKey = String(env.MONITOR_API_KEY || "").trim();
const shouldApply = process.argv.includes("--apply");
const confirmation = String(
  process.argv.find((argument) => argument.startsWith("--confirm="))?.split("=")[1] || ""
).trim();
const expectedConfirmation = "RUN_INCIDENT_REMEDIATION_CANARY";
const endpoint = "https://api.myaipa.ca/api/internal/operations/incident-remediation-canary";

async function main() {
  console.log(JSON.stringify({
    mode: shouldApply ? "apply" : "dry-run",
    target: "api.myaipa.ca",
    expectedTelegramMessages: shouldApply ? 2 : 0,
    customerDataIncluded: false,
    providerResourcesChanged: false,
    originalCustomerOperationReplayed: false,
  }, null, 2));

  if (!shouldApply) {
    console.log(
      `Dry run only. Re-run with --apply --confirm=${expectedConfirmation} to start one controlled production canary.`
    );
    return;
  }
  if (!monitorKey) throw new Error("MONITOR_API_KEY is not configured.");
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Refusing to start the canary without --confirm=${expectedConfirmation}.`);
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
  if (response.status !== 202 || data?.ok !== true || data?.accepted !== true || !data?.incidentId) {
    throw new Error(
      `Production remediation canary failed (${response.status}): ${String(data?.error || "incident was not accepted").slice(0, 220)}`
    );
  }

  console.log(JSON.stringify({
    ok: true,
    productionApiAcceptedDurableIncident: true,
    incidentReferenceExposed: false,
    expectedTelegramSequence: [
      "initial incident report",
      "SERVICE HEALTHY AGAIN or NEEDS YOU",
    ],
    customerDataIncluded: false,
    originalCustomerOperationReplayed: false,
  }, null, 2));
}

main().catch((error) => {
  console.error(String(error?.message || error).slice(0, 500));
  process.exit(1);
});
