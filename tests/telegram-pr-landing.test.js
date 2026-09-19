const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  dispatchTelegramApprovedPrLanding,
  inspectPullRequestLandingReadiness,
} = require("../server/telegramPrLanding");

const token = "github-token";
const repository = "OllieinCanada/MyA.I.PA";
const headSha = "a".repeat(40);

function response(status, body = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test("readiness requires the exact repo, base, head, independent verification, completed checks, and resolved reviews", async () => {
  const fetchImpl = async (url) => {
    if (url.endsWith("/pulls/123")) return response(200, { state: "open", draft: false, html_url: "https://github.com/OllieinCanada/MyA.I.PA/pull/123", base: { ref: "main" }, head: { sha: headSha, repo: { full_name: repository } }, mergeable: true, mergeable_state: "clean" });
    if (url.includes("check-runs")) return response(200, { check_runs: [{ status: "completed", conclusion: "success" }] });
    if (url.endsWith("/status")) return response(200, { statuses: [{ context: "incident-repair/verified", state: "success" }] });
    if (url.endsWith("/graphql")) return response(200, { data: { repository: { pullRequest: { isDraft: false, reviewDecision: null, reviewThreads: { nodes: [{ isResolved: true }] } } } } });
    throw new Error(`Unexpected URL ${url}`);
  };
  const result = await inspectPullRequestLandingReadiness({ token, repository, prNumber: 123, headSha, fetchImpl });
  assert.equal(result.ready, true);
});

test("readiness fails closed on an exact-head mismatch", async () => {
  const result = await inspectPullRequestLandingReadiness({
    token, repository, prNumber: 123, headSha,
    fetchImpl: async () => response(200, { state: "open", base: { ref: "main" }, head: { sha: "b".repeat(40), repo: { full_name: repository } } }),
  });
  assert.deepEqual({ ready: result.ready, blocked: result.blocked, reason: result.reason }, { ready: false, blocked: true, reason: "head_sha_mismatch" });
});

test("approved landing dispatch seals the exact PR head", async () => {
  let sent;
  const result = await dispatchTelegramApprovedPrLanding({
    token,
    repository,
    dispatchSecret: "incident-dispatch-secret-for-tests-1234567890",
    approvalId: "0123456789abcdef",
    prNumber: 123,
    headSha,
    approvedAt: "2026-09-19T12:00:00.000Z",
    fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return response(204); },
  });
  assert.equal(result.dispatched, true);
  assert.equal(sent.inputs.head_sha, headSha);
  assert.match(sent.inputs.authorization, /^[a-f0-9]{64}$/);
});
