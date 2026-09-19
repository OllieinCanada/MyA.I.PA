const { prLandingAuthorization } = require("./telegramApprovalActions");

function safeRepository(value) {
  const repository = String(value || "").trim();
  return /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repository) ? repository : "";
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${String(token || "").trim()}`,
    "Content-Type": "application/json",
    "User-Agent": "my-ai-pa-telegram-release-guard",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubJson(url, { token, fetchImpl = fetch, method = "GET", body } = {}) {
  const response = await fetchImpl(url, {
    method,
    headers: githubHeaders(token),
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: fetchImpl === fetch && typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(10_000) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(`GitHub release guard failed (${response.status}).`);
    error.code = response.status === 401 || response.status === 403
      ? "GITHUB_RELEASE_GUARD_AUTH_FAILED"
      : "GITHUB_RELEASE_GUARD_FAILED";
    error.statusCode = 502;
    throw error;
  }
  return data;
}

async function inspectPullRequestLandingReadiness({ token, repository, prNumber, headSha, fetchImpl = fetch } = {}) {
  const repo = safeRepository(repository);
  const number = Number(prNumber);
  const exactHead = String(headSha || "").trim().toLowerCase();
  if (!String(token || "").trim() || !repo || !Number.isSafeInteger(number) || number < 1 || !/^[a-f0-9]{40}$/.test(exactHead)) {
    return { ready: false, blocked: true, reason: "release_guard_not_configured" };
  }
  const base = `https://api.github.com/repos/${repo}`;
  const pull = await githubJson(`${base}/pulls/${number}`, { token, fetchImpl });
  if (String(pull.state || "").toLowerCase() !== "open") return { ready: false, blocked: true, reason: "pull_request_not_open" };
  if (String(pull.base?.ref || "") !== "main") return { ready: false, blocked: true, reason: "base_branch_mismatch" };
  if (String(pull.head?.sha || "").toLowerCase() !== exactHead) return { ready: false, blocked: true, reason: "head_sha_mismatch" };
  if (String(pull.head?.repo?.full_name || "").toLowerCase() !== repo.toLowerCase()) {
    return { ready: false, blocked: true, reason: "fork_pull_request_not_allowed" };
  }

  const [checks, combinedStatus] = await Promise.all([
    githubJson(`${base}/commits/${exactHead}/check-runs?per_page=100`, { token, fetchImpl }),
    githubJson(`${base}/commits/${exactHead}/status`, { token, fetchImpl }),
  ]);
  const checkRuns = Array.isArray(checks.check_runs) ? checks.check_runs : [];
  const statuses = Array.isArray(combinedStatus.statuses) ? combinedStatus.statuses : [];
  const verified = statuses.some((item) => item.context === "incident-repair/verified" && item.state === "success");
  if (!verified) return { ready: false, blocked: false, reason: "independent_verification_pending" };
  const failingCheck = checkRuns.find((item) => item.status === "completed" && !["success", "neutral", "skipped"].includes(item.conclusion));
  const pendingCheck = checkRuns.find((item) => item.status !== "completed");
  const failingStatus = statuses.find((item) => ["error", "failure"].includes(item.state));
  const pendingStatus = statuses.find((item) => item.state === "pending");
  if (failingCheck || failingStatus) return { ready: false, blocked: true, reason: "required_check_failed" };
  if (pendingCheck || pendingStatus) return { ready: false, blocked: false, reason: "checks_pending" };

  const query = `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){isDraft reviewDecision reviewThreads(first:100){nodes{isResolved}}}}}`;
  const [owner, name] = repo.split("/");
  const graph = await githubJson("https://api.github.com/graphql", {
    token,
    fetchImpl,
    method: "POST",
    body: { query, variables: { owner, name, number } },
  });
  const review = graph?.data?.repository?.pullRequest;
  if (!review) return { ready: false, blocked: true, reason: "pull_request_review_state_missing" };
  if (review.isDraft) return { ready: false, blocked: false, reason: "pull_request_still_draft", nodeId: String(pull.node_id || "") };
  if (review.reviewDecision === "CHANGES_REQUESTED") return { ready: false, blocked: true, reason: "changes_requested" };
  if ((review.reviewThreads?.nodes || []).some((thread) => thread?.isResolved === false)) {
    return { ready: false, blocked: false, reason: "review_threads_unresolved" };
  }
  if (pull.mergeable === false || String(pull.mergeable_state || "").toLowerCase() === "dirty") {
    return { ready: false, blocked: true, reason: "pull_request_conflicted" };
  }
  return {
    ready: true,
    blocked: false,
    reason: "ready",
    prUrl: String(pull.html_url || ""),
    prNumber: number,
    headSha: exactHead,
  };
}

async function markPullRequestReadyForReview({ token, nodeId, fetchImpl = fetch } = {}) {
  const id = String(nodeId || "").trim();
  if (!id) throw new TypeError("A pull-request node ID is required.");
  const mutation = `mutation($id:ID!){markPullRequestReadyForReview(input:{pullRequestId:$id}){pullRequest{isDraft}}}`;
  const graph = await githubJson("https://api.github.com/graphql", {
    token,
    fetchImpl,
    method: "POST",
    body: { query: mutation, variables: { id } },
  });
  const pull = graph?.data?.markPullRequestReadyForReview?.pullRequest;
  if (!pull || pull.isDraft !== false) {
    const error = new Error("GitHub did not mark the guarded repair pull request ready for review.");
    error.code = "GITHUB_PR_READY_FAILED";
    throw error;
  }
  return { readyForReview: true };
}

async function dispatchTelegramApprovedPrLanding({
  token,
  repository,
  dispatchSecret,
  approvalId,
  prNumber,
  headSha,
  approvedAt = new Date().toISOString(),
  fetchImpl = fetch,
} = {}) {
  const repo = safeRepository(repository);
  const payload = {
    approval_id: String(approvalId || "").trim().toLowerCase(),
    pr_number: Number(prNumber),
    head_sha: String(headSha || "").trim().toLowerCase(),
    approved_at: new Date(approvedAt).toISOString(),
  };
  const authorization = prLandingAuthorization(payload, dispatchSecret);
  const response = await fetchImpl(`https://api.github.com/repos/${repo}/actions/workflows/telegram-approved-pr-landing.yml/dispatches`, {
    method: "POST",
    headers: githubHeaders(token),
    body: JSON.stringify({
      ref: "main",
      inputs: {
        approval_id: payload.approval_id,
        pr_number: String(payload.pr_number),
        head_sha: payload.head_sha,
        approved_at: payload.approved_at,
        authorization,
      },
    }),
    signal: fetchImpl === fetch && typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(10_000) : undefined,
  });
  if (response.status !== 204) {
    const error = new Error(`GitHub did not accept the approved PR landing (${response.status}).`);
    error.code = "GITHUB_PR_LANDING_DISPATCH_FAILED";
    error.statusCode = 502;
    throw error;
  }
  return {
    dispatched: true,
    workflowUrl: `https://github.com/${repo}/actions/workflows/telegram-approved-pr-landing.yml`,
    ...payload,
  };
}

module.exports = {
  dispatchTelegramApprovedPrLanding,
  inspectPullRequestLandingReadiness,
  markPullRequestReadyForReview,
  safeRepository,
};
