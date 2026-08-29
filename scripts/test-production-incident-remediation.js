const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const monitorKey = String(env.MONITOR_API_KEY || "").trim();
const shouldApply = process.argv.includes("--apply");
const confirmation = String(
  process.argv.find((argument) => argument.startsWith("--confirm="))?.split("=")[1] || ""
).trim();
const expectedConfirmation = "RUN_INCIDENT_REMEDIATION_CANARY";
const endpoint = "https://api.myaipa.ca/api/internal/operations/incident-remediation-canary";
const statusEndpoint = "https://api.myaipa.ca/api/internal/operations/incident-remediation-canary/status";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  const incidentId = String(data.incidentId);
  let lifecycle = null;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    let statusResponse;
    try {
      statusResponse = await fetch(statusEndpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-monitor-api-key": monitorKey,
        },
        body: JSON.stringify({
          confirmation: "CHECK_INCIDENT_REMEDIATION_CANARY",
          incidentId,
        }),
        signal: AbortSignal.timeout(12_000),
      });
    } catch (_error) {
      if (attempt === 30) {
        throw new Error("Production remediation canary status remained unreachable for the full verification window.");
      }
      await wait(2_000);
      continue;
    }
    if ([404, 408, 425, 429].includes(statusResponse.status) || statusResponse.status >= 500) {
      if (attempt === 30) {
        throw new Error(`Production remediation canary status stayed unavailable (${statusResponse.status}) for the full verification window.`);
      }
      await wait(2_000);
      continue;
    }
    const statusData = await statusResponse.json().catch(() => ({}));
    if (statusResponse.status !== 200 || statusData?.ok !== true || statusData?.controlledCanary !== true) {
      throw new Error(`Production remediation canary status check was rejected (${statusResponse.status}).`);
    }
    lifecycle = statusData;
    if (statusData.lifecycleComplete === true) break;
    await wait(2_000);
  }

  if (
    lifecycle?.lifecycleComplete !== true
    || lifecycle?.deliveryReceiptsConfirmed !== true
    || lifecycle?.deliveryReceiptCount !== 2
    || lifecycle?.deliverySequenceConfirmed !== true
    || lifecycle?.initialReportDelivered !== true
    || lifecycle?.completionReportDelivered !== true
    || lifecycle?.remediationTerminal !== true
    || lifecycle?.remediationStatus !== "recovered"
    || lifecycle?.readOnlyReadinessVerified !== true
    || lifecycle?.customerDataIncluded !== false
    || lifecycle?.providerResourcesChanged !== false
    || lifecycle?.originalCustomerOperationReplayed !== false
  ) {
    throw new Error("Production remediation canary did not prove the complete, receipt-backed, read-only lifecycle within 60 seconds.");
  }

  console.log(JSON.stringify({
    ok: true,
    productionApiAcceptedDurableIncident: true,
    lifecycleComplete: true,
    telegramApiAcceptedMessages: 2,
    telegramApiAcceptanceSequenceConfirmed: true,
    initialReportDelivered: true,
    completionReportDelivered: true,
    remediationStatus: "recovered",
    readOnlyReadinessVerified: true,
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
