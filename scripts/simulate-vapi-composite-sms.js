const { executeCompositeNotifications, getVapiCompositeToolDefinition } = require("../server/compositeCallNotifications");

function response(ok, payload, status = ok ? 201 : 400) {
  return { ok, status, json: async () => payload };
}

async function simulate(label, fetchImpl) {
  const calls = [];
  const wrappedFetch = async (url, options) => {
    if (String(url).includes("/sms/suppression/check")) {
      return response(true, { allowed: true }, 200);
    }
    const params = new URLSearchParams(String(options.body || ""));
    calls.push({ toLast4: String(params.get("To") || "").slice(-4), fromLast4: String(params.get("From") || "").slice(-4) });
    return fetchImpl(url, options, calls.length);
  };
  const result = await executeCompositeNotifications({
    args: {
      businessName: "Example Electrical",
      requestType: "installation",
      name: "Test Caller",
      rawPhoneNumber: "+19055551234",
      jobDetails: "hot tub electrical setup",
      streetAddress: "123 Test Street",
      city: "Hamilton",
      preferredStartDate: "right away",
      bestCallbackTime: "afternoons or after 5 PM",
    },
    env: {
      TWILIO_ACCOUNT_SID: "AC_DIAGNOSTIC_ONLY",
      TWILIO_AUTH_TOKEN: "AUTH_DIAGNOSTIC_ONLY",
      DEFAULT_FROM_NUMBER: "+12495550100",
      DEFAULT_OWNER_TO_NUMBER: "+19055550123",
      CALL_ID: `simulation-${label}`,
      SMS_SUPPRESSION_CHECK_URL: "https://api.example.test/sms/suppression/check",
      SMS_SUPPRESSION_API_KEY: "simulation-only",
    },
    fetchImpl: wrappedFetch,
    btoaImpl: (value) => Buffer.from(String(value), "utf8").toString("base64"),
    URLSearchParamsImpl: URLSearchParams,
  });
  return { label, calls, result };
}

async function main() {
  const scenarios = [
    await simulate("both-succeed", async (_url, _options, index) => response(true, { sid: `SM_TEST_${index}`, status: "queued" })),
    await simulate("owner-fails", async (_url, _options, index) => index === 1
      ? response(false, { code: 21610 }, 400)
      : response(true, { sid: "SM_CUSTOMER", status: "queued" })),
    await simulate("customer-fails", async (_url, _options, index) => index === 2
      ? response(false, { code: 30007 }, 400)
      : response(true, { sid: "SM_OWNER", status: "queued" })),
  ];
  const tool = getVapiCompositeToolDefinition();
  console.log("MyAIPA composite SMS local simulation");
  console.log("====================================");
  console.log(`Tool: ${tool.function.name}`);
  console.log(`Required fields: ${tool.function.parameters.required.join(", ")}`);
  for (const scenario of scenarios) {
    console.log("");
    console.log(`${scenario.label}:`);
    console.log(`  order: ${scenario.result.executionOrder.join(" -> ")}`);
    console.log(`  owner: ${scenario.result.owner.sent ? "accepted" : `failed (${scenario.result.owner.errorCode})`}`);
    console.log(`  customer: ${scenario.result.customer.sent ? "accepted" : `failed (${scenario.result.customer.errorCode})`}`);
    console.log(`  complete: ${scenario.result.complete}`);
  }
  console.log("");
  console.log("Simulation only. No provider requests were made.");
}

main().catch((error) => {
  console.error(error.message || error);
  process.exitCode = 1;
});
