const { spawnSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { loadProjectEnv, rootPath } = require("./_helpers");

const env = loadProjectEnv();
const shouldPost = process.argv.includes("--post");
const outputIndex = process.argv.indexOf("--out");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1] : "";
const apiBaseUrl = String(
  env.PUBLIC_API_BASE_URL || env.REACT_APP_API_BASE_URL || "https://api.myaipa.ca"
).replace(/\/+$/, "");
const adminPassword = String(env.ADMIN_PASSWORD || "").trim();
const fixtureName = `.myaipa-signup-sandbox-${process.pid}-${Date.now()}.json`;
const fixturePath = rootPath(fixtureName);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getResourceEvidence(value, pathPrefix = "") {
  const matches = [];
  if (!value || typeof value !== "object") return matches;
  for (const [key, item] of Object.entries(value)) {
    const itemPath = pathPrefix ? `${pathPrefix}.${key}` : key;
    if (
      /^(twilioPhoneNumber|assignedPhoneNumber|vapiAssistantId|stripeCustomerId|subscriptionId|checkoutSessionId)$/i.test(key) &&
      String(item || "").trim()
    ) {
      matches.push(itemPath);
    }
    if (item && typeof item === "object") matches.push(...getResourceEvidence(item, itemPath));
  }
  return matches;
}

async function getJson(route, options = {}) {
  const response = await fetch(`${apiBaseUrl}${route}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.admin ? { "x-admin-password": adminPassword } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${route} returned invalid JSON.`);
  }
  return { response, body };
}

function validateFixture(payload) {
  const required = [
    ["businessProfile.businessName", payload?.businessProfile?.businessName],
    ["businessProfile.phone", payload?.businessProfile?.phone],
    ["businessProfile.address", payload?.businessProfile?.address],
    ["setupDetails.ownerName", payload?.setupDetails?.ownerName],
    ["setupDetails.ownerEmail", payload?.setupDetails?.ownerEmail],
    ["setupDetails.ownerPhone", payload?.setupDetails?.ownerPhone],
    ["setupDetails.callForwardingNumber", payload?.setupDetails?.callForwardingNumber],
    ["setupDetails.greetingScript", payload?.setupDetails?.greetingScript],
    ["pricing.pricingScript", payload?.pricing?.pricingScript],
    ["security.clientElapsedMs", payload?.security?.clientElapsedMs],
  ];
  const missing = required.filter(([, value]) => value == null || String(value).trim() === "").map(([name]) => name);
  assert(missing.length === 0, `Sandbox fixture is missing required fields: ${missing.join(", ")}`);
  assert(
    /@mailinator\.com$/i.test(payload.setupDetails.ownerEmail),
    "Sandbox fixture must use the disposable test domain so production holds it for review."
  );
  assert(
    Number(payload.security.clientElapsedMs) >= 2500,
    "Sandbox fixture must not simulate an impossibly fast form submission."
  );
  return {
    businessName: payload.businessProfile.businessName,
    ownerEmail: payload.setupDetails.ownerEmail,
    ownerPhoneLast4: String(payload.setupDetails.ownerPhone).replace(/\D/g, "").slice(-4),
    businessPhoneLast4: String(payload.businessProfile.phone).replace(/\D/g, "").slice(-4),
  };
}

async function main() {
  const fixture = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "test-signup-payload.js"),
      "--review-only",
      "--out",
      fixtureName,
    ],
    { cwd: rootPath(), encoding: "utf8" }
  );
  if (fixture.status !== 0) {
    throw new Error(`Could not generate sandbox fixture: ${fixture.stderr || fixture.stdout}`);
  }

  const payload = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const fixtureSummary = validateFixture(payload);
  const publicFixtureSummary = {
    businessName: "Synthetic review-only business",
    ownerEmailHash: crypto.createHash("sha256").update(fixtureSummary.ownerEmail).digest("hex").slice(0, 12),
    ownerEmailDomain: fixtureSummary.ownerEmail.split("@")[1] || "",
    ownerPhoneLast4: fixtureSummary.ownerPhoneLast4,
    businessPhoneLast4: fixtureSummary.businessPhoneLast4,
  };
  const report = {
    checkedAt: new Date().toISOString(),
    mode: shouldPost ? "production-review-only" : "dry-run",
    apiBaseUrl,
    fixture: publicFixtureSummary,
    checks: {
      fixtureSchema: "passed",
      reviewHoldIdentity: "passed",
      health: "not-run",
      readiness: "not-run",
      reviewResponse: "not-run",
      externalResourcesAbsent: "not-run",
      adminRecord: "not-run",
    },
  };

  if (shouldPost) {
    assert(adminPassword, "ADMIN_PASSWORD is required for the post-run admin verification.");
    const health = await getJson("/api/health");
    assert(health.response.ok && health.body.ok === true, "Production health check failed.");
    report.checks.health = "passed";

    const readiness = await getJson("/api/health/ready");
    assert(readiness.response.ok && readiness.body.ok === true, "Production readiness check failed.");
    report.checks.readiness = "passed";

    const submission = await getJson("/api/integrations/signup-complete", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    assert(
      submission.response.status === 202 &&
        submission.body.ok === true &&
        submission.body.reviewRequired === true,
      `Expected a 202 review-only response; received HTTP ${submission.response.status}.`
    );
    report.checks.reviewResponse = "passed";

    const resourceEvidence = getResourceEvidence(submission.body);
    assert(
      resourceEvidence.length === 0,
      `Sandbox unexpectedly created an external resource: ${resourceEvidence.join(", ")}`
    );
    report.checks.externalResourcesAbsent = "passed";

    const admin = await getJson("/api/admin/signups", { admin: true });
    assert(admin.response.ok, `Admin signup verification failed with HTTP ${admin.response.status}.`);
    const signups = Array.isArray(admin.body.signups) ? admin.body.signups : [];
    const record = signups.find(
      (item) =>
        String(item?.ownerEmail || "").trim().toLowerCase() ===
        fixtureSummary.ownerEmail.toLowerCase()
    );
    assert(record, "The sandbox signup was accepted but did not appear in the admin signup feed.");
    assert(
      record.reviewRequired === true || String(record.status || "").includes("review"),
      "The sandbox signup appeared in admin but was not held for review."
    );
    assert(
      getResourceEvidence(record).length === 0,
      "The stored sandbox signup contains an external provisioning identifier."
    );
    report.checks.adminRecord = "passed";
    report.adminRecord = {
      status: String(record.status || ""),
      reviewRequired: Boolean(record.reviewRequired),
      reviewReasons: Array.isArray(record.reviewReasons) ? record.reviewReasons : [],
    };
  }

  if (outputPath) {
    const finalPath = rootPath(outputPath);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.writeFileSync(finalPath, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`Signup sandbox report written to ${finalPath}`);
  }
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error(error.message || error);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      fs.unlinkSync(fixturePath);
    } catch {
      // The temporary fixture may already be absent.
    }
  });
