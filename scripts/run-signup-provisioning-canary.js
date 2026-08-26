const { loadProjectEnv } = require("./_helpers");

const env = loadProjectEnv();
const requestedBaseUrl = String(
  process.argv.find((argument) => argument.startsWith("--base-url="))?.slice("--base-url=".length)
    || "https://api.myaipa.ca"
).trim();
const parsedBaseUrl = new URL(requestedBaseUrl);
if (parsedBaseUrl.protocol !== "https:" || parsedBaseUrl.username || parsedBaseUrl.password || parsedBaseUrl.search || parsedBaseUrl.hash) {
  throw new Error("The canary base URL must be a clean HTTPS origin.");
}
const baseUrl = parsedBaseUrl.origin;
const monitorKey = String(env.MONITOR_API_KEY || "").trim();
const shouldApply = process.argv.includes("--apply");
const confirmation = String(
  process.argv.find((argument) => argument.startsWith("--confirm="))?.split("=")[1] || ""
).trim();
const expectedConfirmation = "RUN_PROVISIONING_CANARY";

function stableFingerprintSet(result) {
  const fingerprints = result?.fingerprints || {};
  return [fingerprints.twilioNumber, fingerprints.vapiPhone, fingerprints.vapiAssistant]
    .map((value) => String(value || ""))
    .join(":");
}

async function runOnce(label) {
  const startedAt = Date.now();
  const response = await fetch(`${baseUrl}/api/internal/operations/provisioning-canary`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-monitor-api-key": monitorKey,
    },
    body: JSON.stringify({ confirmation: expectedConfirmation }),
    signal: AbortSignal.timeout(190_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok !== true) {
    throw new Error(`${label} failed (${response.status}): ${String(data?.error || "canary failed").slice(0, 220)}`);
  }
  return {
    label,
    elapsedMs: Date.now() - startedAt,
    safe: data.responseComplete === true
      && data.phoneReady === true
      && data.exactlyOneOfEach === true
      && data.relationshipsVerified === true
      && Object.values(data.resourceCounts || {}).every((count) => count === 1),
    fingerprintSet: stableFingerprintSet(data),
  };
}

async function main() {
  console.log(JSON.stringify({
    mode: shouldApply ? "apply" : "dry-run",
    target: new URL(baseUrl).host,
    liveProviderExecutions: shouldApply ? 4 : 0,
    checks: [
      "one controlled initial provisioning",
      "one exact sequential replay",
      "two exact concurrent replays",
      "one Canadian call-ready number and one matching Vapi assistant/phone",
      "stable redacted resource fingerprints across every replay",
    ],
  }, null, 2));

  if (!shouldApply) {
    console.log(`Dry run only. Re-run with --apply --confirm=${expectedConfirmation} to create/reuse the synthetic canary resources.`);
    return;
  }
  if (!monitorKey) throw new Error("MONITOR_API_KEY is not configured.");
  if (confirmation !== expectedConfirmation) {
    throw new Error(`Refusing live provider work without --confirm=${expectedConfirmation}.`);
  }
  if (parsedBaseUrl.hostname !== "api.myaipa.ca") {
    throw new Error("Live provisioning canaries may target only api.myaipa.ca.");
  }

  const first = await runOnce("initial");
  const retry = await runOnce("sequential-replay");
  const concurrent = await Promise.all([
    runOnce("concurrent-replay-a"),
    runOnce("concurrent-replay-b"),
  ]);
  const results = [first, retry, ...concurrent];
  const stableResources = results.every((result) => (
    result.safe && result.fingerprintSet && result.fingerprintSet === first.fingerprintSet
  ));
  const report = {
    safeToActivate: stableResources,
    executions: results.map(({ label, elapsedMs, safe }) => ({ label, elapsedMs, safe })),
    sameResourcesAcrossAllReplays: stableResources,
    rawProviderIdentifiersExposed: false,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!stableResources) process.exitCode = 1;
}

main().catch((error) => {
  console.error(String(error?.message || error).slice(0, 500));
  process.exit(1);
});
