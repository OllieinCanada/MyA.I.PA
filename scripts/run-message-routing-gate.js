const fs = require("fs");
const path = require("path");
const { executeCompositeNotifications } = require("../server/compositeCallNotifications");
const { rootPath } = require("./_helpers");

function option(name, fallback = "") {
  const prefix = `--${name}=`;
  const argument = process.argv.find((item) => item.startsWith(prefix));
  return argument ? argument.slice(prefix.length) : fallback;
}

function providerResponse(ok, payload, status = ok ? 201 : 400) {
  return { ok, status, json: async () => payload };
}

function syntheticNumber(prefix, index) {
  return `${prefix}${String(index).padStart(4, "0")}`;
}

async function runMessageRoutingGate({ count = 50 } = {}) {
  const requestedCount = Number(count);
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 500) {
    throw new Error("Message-routing count must be an integer from 1 to 500.");
  }

  const failures = [];
  const runs = [];
  for (let index = 1; index <= requestedCount; index += 1) {
    const owner = syntheticNumber("+1905555", 1000 + index);
    const customer = syntheticNumber("+1289555", 2000 + index);
    const sender = syntheticNumber("+1249555", 3000 + index);
    const providerCalls = [];
    const fetchImpl = async (url, options = {}) => {
      if (String(url).includes("/sms/suppression/check")) {
        return providerResponse(true, { allowed: true }, 200);
      }
      const body = new URLSearchParams(String(options.body || ""));
      providerCalls.push({
        to: body.get("To"),
        from: body.get("From"),
        body: body.get("Body"),
      });
      return providerResponse(true, { sid: `SM_SHIPPING_${index}_${providerCalls.length}`, status: "queued" });
    };

    try {
      const result = await executeCompositeNotifications({
        args: {
          businessName: `Shipping Gate Business ${index}`,
          requestType: index % 3 === 0 ? "repair" : index % 3 === 1 ? "installation" : "message",
          name: `Synthetic Caller ${index}`,
          rawPhoneNumber: customer,
          jobDetails: `Synthetic routing verification ${index}`,
          streetAddress: `${index} Test Street`,
          city: "Hamilton",
          preferredStartDate: "next week",
          bestCallbackTime: "afternoon",
        },
        env: {
          TWILIO_ACCOUNT_SID: "AC_SHIPPING_GATE_ONLY",
          TWILIO_AUTH_TOKEN: "SHIPPING_GATE_ONLY",
          DEFAULT_FROM_NUMBER: sender,
          DEFAULT_OWNER_TO_NUMBER: owner,
          CALL_ID: `shipping-message-${index}`,
          SMS_SUPPRESSION_CHECK_URL: "https://api.example.test/sms/suppression/check",
          SMS_SUPPRESSION_API_KEY: "shipping-gate-only",
        },
        fetchImpl,
        btoaImpl: (value) => Buffer.from(String(value), "utf8").toString("base64"),
        URLSearchParamsImpl: URLSearchParams,
      });

      const destinations = providerCalls.map((call) => call.to);
      const safe = result.complete === true
        && result.owner?.sent === true
        && result.customer?.sent === true
        && result.executionOrder?.join(",") === "owner,customer"
        && providerCalls.length === 2
        && destinations[0] === owner
        && destinations[1] === customer
        && providerCalls.every((call) => call.from === sender)
        && !destinations.includes(sender)
        && owner !== customer;
      if (!safe) throw new Error("owner/customer routing or execution order did not match the isolated call context");
      runs.push({ index, passed: true });
    } catch (error) {
      failures.push({ index, reason: String(error?.message || error).slice(0, 180) });
      runs.push({ index, passed: false });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    mode: "local-provider-simulation",
    requested: requestedCount,
    passed: runs.filter((run) => run.passed).length,
    failed: failures.length,
    consecutivePasses: failures.length ? failures[0].index - 1 : requestedCount,
    wrongRecipientCount: failures.filter((failure) => /routing/i.test(failure.reason)).length,
    providerRequestsMade: false,
    ready: failures.length === 0,
    failures,
  };
}

async function main() {
  const report = await runMessageRoutingGate({ count: option("count", "50") });
  const output = option("out");
  if (output) {
    const outputPath = path.isAbsolute(output) ? output : rootPath(output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Message-routing gate report written to ${outputPath}`);
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.ready) process.exitCode = 1;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = { runMessageRoutingGate };
