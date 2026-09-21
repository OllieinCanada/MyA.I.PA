const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  authorizeTelegramCallback,
  buildApprovalKeyboard,
  buildCallbackData,
  claimTelegramApproval,
  createTelegramApproval,
  finalizeProcessingTelegramApproval,
  finishTelegramApproval,
  parseCallbackData,
  prLandingAuthorization,
  verifyCallbackData,
  verifyTelegramWebhookSecret,
} = require("../server/telegramApprovalActions");

const secret = "telegram-action-signing-secret-for-tests-123456";

function fakePrisma() {
  const rows = [];
  return {
    rows,
    telegramApprovalAction: {
      async create({ data }) {
        if (rows.some((row) => row.dedupeKey === data.dedupeKey)) {
          const error = new Error("unique"); error.code = "P2002"; throw error;
        }
        const row = { id: `row-${rows.length + 1}`, status: "PENDING", decidedAction: null, ...data };
        rows.push(row); return { ...row };
      },
      async findUnique({ where }) {
        const row = rows.find((item) => Object.entries(where).every(([key, value]) => item[key] === value));
        return row ? { ...row } : null;
      },
      async updateMany({ where, data }) {
        const row = rows.find((item) => item.id === where.id);
        const allowed = row
          && (!where.status || row.status === where.status)
          && (where.decidedAction === undefined || row.decidedAction === where.decidedAction)
          && (!where.expiresAt?.gt || new Date(row.expiresAt) > new Date(where.expiresAt.gt));
        if (!allowed) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
      async update({ where, data }) {
        const row = rows.find((item) => item.id === where.id);
        if (!row) throw new Error("not found");
        Object.assign(row, data); return { ...row };
      },
    },
  };
}

test("Telegram callbacks are compact, signed, and tamper resistant", () => {
  const value = buildCallbackData("0123456789abcdef", "a", secret);
  assert.ok(value.length <= 64);
  assert.deepEqual(parseCallbackData(value), { publicId: "0123456789abcdef", actionCode: "a", signature: value.split(".")[3] });
  assert.equal(verifyCallbackData(value, secret)?.actionCode, "a");
  assert.equal(verifyCallbackData(value.replace(".a.", ".r."), secret), null);
});

test("signup, incident, and PR keyboards expose only their allowed decisions", () => {
  const signup = buildApprovalKeyboard({ publicId: "0123456789abcdef", purpose: "SIGNUP_REVIEW", context: { openUrl: "https://www.myaipa.ca/#/admin?tab=attention" } }, secret);
  assert.deepEqual(signup.inline_keyboard[0].map((item) => item.text), ["Approve and continue", "Reject without provisioning"]);
  assert.equal(signup.inline_keyboard[1][0].text, "Open details");
  const pr = buildApprovalKeyboard({ publicId: "fedcba9876543210", purpose: "PR_LANDING", context: { prNumber: 123, headSha: "a".repeat(40), openUrl: "https://github.com/OllieinCanada/MyA.I.PA/pull/123" } }, secret);
  assert.deepEqual(pr.inline_keyboard[0].map((item) => item.text), ["Approve merge & deploy", "Reject"]);
  assert.equal(pr.inline_keyboard[1][0].text, "Open PR");
});

test("only the configured private Telegram owner is authorized", () => {
  const update = { callback_query: { from: { id: 123 }, message: { chat: { id: 123 } } } };
  assert.equal(authorizeTelegramCallback(update, { chatId: "123", userId: "123" }).authorized, true);
  assert.equal(authorizeTelegramCallback(update, { chatId: "123", userId: "456" }).authorized, false);
  assert.equal(verifyTelegramWebhookSecret("w".repeat(32), "w".repeat(32)), true);
  assert.equal(verifyTelegramWebhookSecret("wrong", "w".repeat(32)), false);
});

test("approval creation is deduplicated and a decision can be claimed only once", async () => {
  const prisma = fakePrisma();
  const signupAttemptId = `signup_${"c".repeat(32)}`;
  const input = { prismaClient: prisma, purpose: "SIGNUP_REVIEW", targetType: "signup", targetId: "a".repeat(24), dedupeKey: `signup:${"a".repeat(24)}:review`, context: { signupAttemptId, openUrl: "https://www.myaipa.ca/#/admin" } };
  const first = await createTelegramApproval(input);
  const duplicate = await createTelegramApproval(input);
  assert.equal(first.id, duplicate.id);
  assert.equal(first.context.signupAttemptId, signupAttemptId);
  const callbackData = buildCallbackData(first.publicId, "a", secret);
  const claimed = await claimTelegramApproval({ prismaClient: prisma, callbackData, signingSecret: secret, actorTelegramUserId: "123", telegramChatId: "123" });
  assert.equal(claimed.claimed, true);
  assert.equal(claimed.action, "approve");
  const replay = await claimTelegramApproval({ prismaClient: prisma, callbackData, signingSecret: secret, actorTelegramUserId: "123", telegramChatId: "123" });
  assert.equal(replay.claimed, false);
  assert.equal(replay.reason, "already_decided");
  const finished = await finishTelegramApproval(prisma, first.id, { status: "COMPLETED", result: { safe: true } });
  assert.equal(finished.status, "COMPLETED");
});

test("signup approvals discard malformed attempt identities", async () => {
  const prisma = fakePrisma();
  const approval = await createTelegramApproval({
    prismaClient: prisma,
    purpose: "SIGNUP_REVIEW",
    targetType: "signup",
    targetId: "d".repeat(24),
    dedupeKey: `signup:${"d".repeat(24)}:review`,
    context: { signupAttemptId: "signup_not-a-server-owned-id" },
  });
  assert.equal(approval.context.signupAttemptId, undefined);
});

test("expired approvals fail closed without executing", async () => {
  const prisma = fakePrisma();
  const approval = await createTelegramApproval({ prismaClient: prisma, purpose: "INCIDENT_REVIEW", targetType: "runtime_incident", targetId: "b".repeat(24), dedupeKey: `incident:${"b".repeat(24)}:g1`, context: { generation: 1 }, now: new Date("2026-01-01T00:00:00Z"), expiresInMs: 60_000 });
  const result = await claimTelegramApproval({ prismaClient: prisma, callbackData: buildCallbackData(approval.publicId, "i", secret), signingSecret: secret, actorTelegramUserId: "123", telegramChatId: "123", now: new Date("2026-01-01T00:02:00Z") });
  assert.equal(result.claimed, false);
  assert.equal(result.reason, "expired");
});

test("PR landing authorization binds the exact approval, PR, head, and timestamp", () => {
  const payload = { approval_id: "0123456789abcdef", pr_number: 104, head_sha: "b".repeat(40), approved_at: "2026-09-19T12:00:00.000Z" };
  const signature = prLandingAuthorization(payload, secret);
  assert.match(signature, /^[a-f0-9]{64}$/);
  assert.notEqual(signature, prLandingAuthorization({ ...payload, head_sha: "c".repeat(40) }, secret));
});

test("a PR landing result can finalize its processing approval only once", async () => {
  const prisma = fakePrisma();
  const approval = await createTelegramApproval({
    prismaClient: prisma,
    purpose: "PR_LANDING",
    targetType: "pull_request",
    targetId: "104",
    dedupeKey: `pr:104:${"b".repeat(40)}`,
    context: { prNumber: 104, headSha: "b".repeat(40) },
  });
  const claimed = await claimTelegramApproval({
    prismaClient: prisma,
    callbackData: buildCallbackData(approval.publicId, "m", secret),
    signingSecret: secret,
    actorTelegramUserId: "123",
    telegramChatId: "123",
  });
  assert.equal(claimed.claimed, true);

  const first = await finalizeProcessingTelegramApproval(prisma, approval.id, {
    status: "COMPLETED",
    result: { mergeSha: "c".repeat(40) },
  });
  const replay = await finalizeProcessingTelegramApproval(prisma, approval.id, {
    status: "FAILED",
    failureCode: "replayed_result",
  });
  assert.equal(first.finalized, true);
  assert.equal(replay.finalized, false);
  assert.equal(prisma.rows[0].status, "COMPLETED");
});
