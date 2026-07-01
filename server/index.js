require("dotenv").config();

const crypto = require("crypto");
const cors = require("cors");
const express = require("express");
const fs = require("fs");
const nodemailer = require("nodemailer");
const path = require("path");
const Stripe = require("stripe");
const { prisma } = require("./prisma");
const {
  createLead,
  logCall,
  searchFaq,
  sendOwnerSms,
  createBooking,
  escalateToHuman,
} = require("./agentTools");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "..", "data");
const assistantRateLimit = new Map();
const signupIpRateLimit = new Map();
const signupIdentityRateLimit = new Map();
const signupDuplicateSubmissions = new Map();
const pendingSignupPath = path.join(dataDir, "pending-signup-verifications.json");
const trialReminderPath = path.join(dataDir, "trial-reminders.json");
const signupDashboardPath = path.join(dataDir, "signup-dashboard.json");
const vapiCallSyncPath = path.join(dataDir, "vapi-call-sync.json");
const GOOGLE_RECAPTCHA_TEST_SECRET_KEY = "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe";
const ASSISTANT_MAX_CHARS = 2000;
const ASSISTANT_WINDOW_MS = 60 * 1000;
const ASSISTANT_MAX_REQUESTS_PER_WINDOW = 12;
const SIGNUP_IP_WINDOW_MS = parsePositiveInt(process.env.SIGNUP_IP_WINDOW_MS, 15 * 60 * 1000);
const SIGNUP_IP_MAX_REQUESTS = parsePositiveInt(process.env.SIGNUP_IP_MAX_REQUESTS, 5);
const SIGNUP_IDENTITY_WINDOW_MS = parsePositiveInt(process.env.SIGNUP_IDENTITY_WINDOW_MS, 60 * 60 * 1000);
const SIGNUP_IDENTITY_MAX_REQUESTS = parsePositiveInt(process.env.SIGNUP_IDENTITY_MAX_REQUESTS, 2);
const SIGNUP_DUPLICATE_WINDOW_MS = parsePositiveInt(process.env.SIGNUP_DUPLICATE_WINDOW_MS, 10 * 60 * 1000);
const SIGNUP_MIN_ELAPSED_MS = parsePositiveInt(process.env.SIGNUP_MIN_ELAPSED_MS, 2500);
const WEBSITE_FETCH_TIMEOUT_MS = 8000;
const WEBSITE_MAX_HTML_CHARS = 250000;
const WEBSITE_MAX_EXTRA_PAGES = 3;
const ADMIN_SESSION_COOKIE = "myaipa_admin_session";
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const EXPOSE_CALL_TRANSCRIPTS_IN_ADMIN = /^(1|true|yes|on)$/i.test(String(process.env.EXPOSE_CALL_TRANSCRIPTS_IN_ADMIN || ""));
const EXPOSE_RECORDING_URLS_IN_ADMIN = /^(1|true|yes|on)$/i.test(String(process.env.EXPOSE_RECORDING_URLS_IN_ADMIN || ""));
const CALL_TRANSCRIPT_RETENTION_DAYS = Math.max(0, Number(process.env.CALL_TRANSCRIPT_RETENTION_DAYS || 0) || 0);
const CALL_RECORDING_RETENTION_DAYS = Math.max(0, Number(process.env.CALL_RECORDING_RETENTION_DAYS || 0) || 0);
const SENSITIVE_CALL_CLEANUP_INTERVAL_MS = 1000 * 60 * 60 * 6;
const SIGNUP_VERIFICATION_TTL_MS = parsePositiveInt(process.env.SIGNUP_VERIFICATION_TTL_MS, 24 * 60 * 60 * 1000);
const TRIAL_REMINDER_CHECK_INTERVAL_MS = parsePositiveInt(process.env.TRIAL_REMINDER_CHECK_INTERVAL_MS, 60 * 60 * 1000);
const TRIAL_HALFWAY_REMINDER_DAYS = parsePositiveInt(process.env.TRIAL_HALFWAY_REMINDER_DAYS, 7);
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_PRICE_ID = String(process.env.STRIPE_PRICE_ID || "").trim();
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const STRIPE_TRIAL_DAYS = Math.max(0, Number(process.env.STRIPE_TRIAL_DAYS || 14) || 0);
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const VAPI_API_KEY = String(process.env.VAPI_API_KEY || "").trim();
const VAPI_API_BASE_URL = String(process.env.VAPI_API_BASE_URL || "https://api.vapi.ai").trim().replace(/\/+$/, "");
const VAPI_CALL_LIMIT = Math.max(1, Math.min(1000, Number(process.env.VAPI_CALL_LIMIT || 100) || 100));
const VAPI_DEFAULT_BUSINESS_ID = parsePositiveInt(process.env.VAPI_DEFAULT_BUSINESS_ID, 1);
const VAPI_AUTO_SYNC_INTERVAL_MS = parsePositiveInt(process.env.VAPI_AUTO_SYNC_INTERVAL_MS, 15 * 60 * 1000);
const VAPI_AUTO_SYNC_ENABLED = isEnabled(process.env.VAPI_AUTO_SYNC_ENABLED);
const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
const TWILIO_API_BASE_URL = String(process.env.TWILIO_API_BASE_URL || "https://api.twilio.com").trim().replace(/\/+$/, "");
const FIXED_MONTHLY_COSTS_JSON = String(process.env.FIXED_MONTHLY_COSTS_JSON || "").trim();
const FIXED_MONTHLY_COST_USD = numberOrNull(process.env.FIXED_MONTHLY_COST_USD) || 0;
const MISSED_CALL_ALERT_ENABLED = isEnabled(process.env.MISSED_CALL_ALERT_ENABLED);
const DAILY_DIGEST_ENABLED = isEnabled(process.env.DAILY_DIGEST_ENABLED);
const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.myaipa.ca",
  "https://myaipa.ca",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
const ALLOWED_ORIGINS = parseCsv(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS);

app.set("trust proxy", 1);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);

app.post("/api/payments/stripe-webhook", express.raw({ type: "application/json" }), asyncRoute(async (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: "Stripe webhook is not configured." });
  }

  const signature = req.headers["stripe-signature"];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, signature, STRIPE_WEBHOOK_SECRET);
  } catch (error) {
    console.error("[stripe:webhook] signature verification failed", { message: error?.message || String(error) });
    return res.status(400).send(`Webhook Error: ${error.message}`);
  }

  const object = event.data?.object || {};
  if (
    event.type === "checkout.session.completed" ||
    event.type === "customer.subscription.created" ||
    event.type === "customer.subscription.updated" ||
    event.type === "customer.subscription.deleted" ||
    event.type === "invoice.payment_failed"
  ) {
    console.log("[stripe:webhook] received", {
      type: event.type,
      id: object.id,
      customer: object.customer || object.customer_email || null,
      status: object.status || object.payment_status || null,
      metadata: object.metadata || {},
    });
  }

  if (event.type === "checkout.session.completed") {
    await scheduleTrialReminderFromCheckoutSession(object);
    upsertSignupDashboardFromCheckoutSession(object, { status: "checkout_completed" });
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
    scheduleTrialReminderFromSubscription(object);
    upsertSignupDashboardFromSubscription(object);
  }

  if (event.type === "customer.subscription.deleted") {
    markTrialReminderCancelled(object.id);
    upsertSignupDashboardFromSubscription(object, { status: "subscription_cancelled" });
  }

  if (event.type === "invoice.payment_failed") {
    upsertSignupDashboardRecord({
      subscriptionId: typeof object.subscription === "string" ? object.subscription : object.subscription?.id || "",
      customerId: typeof object.customer === "string" ? object.customer : object.customer?.id || "",
      ownerEmail: String(object.customer_email || "").trim(),
      paymentStatus: "payment_failed",
      lastPaymentFailedAt: new Date().toISOString(),
      status: "payment_failed",
    });
  }

  res.json({ received: true });
}));

app.use(express.json({ limit: "15mb" }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function parseCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function isAllowedOrigin(origin) {
  const allowed = ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : DEFAULT_ALLOWED_ORIGINS;
  return allowed.includes(origin);
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "").trim();
  if (!raw) return {};
  return raw.split(/;\s*/).reduce((acc, part) => {
    const idx = part.indexOf("=");
    if (idx === -1) return acc;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function getAdminPassword() {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    const err = new Error("ADMIN_PASSWORD is not set on the backend.");
    err.statusCode = 500;
    throw err;
  }
  return expected;
}

function getAdminSessionSecret() {
  return process.env.ADMIN_SESSION_SECRET || `${getAdminPassword()}:session`;
}

function signAdminSessionPayload(payload) {
  return crypto.createHmac("sha256", getAdminSessionSecret()).update(payload).digest("hex");
}

function createAdminSessionToken() {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + ADMIN_SESSION_TTL_MS,
    })
  ).toString("base64url");
  return `${payload}.${signAdminSessionPayload(payload)}`;
}

function hasValidAdminSession(req) {
  const token = parseCookies(req)[ADMIN_SESSION_COOKIE];
  if (!token || !token.includes(".")) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  const expectedSignature = signAdminSessionPayload(payload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return false;
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return Number(data?.exp || 0) > Date.now();
  } catch (_err) {
    return false;
  }
}

function setAdminSessionCookie(res, token) {
  const isProduction = process.env.NODE_ENV === "production";
  const cookie = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    isProduction ? "SameSite=None" : "SameSite=Lax",
    `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
  ];
  if (isProduction) {
    cookie.push("Secure");
  }
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function clearAdminSessionCookie(res) {
  const isProduction = process.env.NODE_ENV === "production";
  const cookie = [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    isProduction ? "SameSite=None" : "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isProduction) {
    cookie.push("Secure");
  }
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function hasValidAdminPassword(req) {
  const supplied = req.headers["x-admin-password"] || req.body?.password || req.query.password;
  return supplied === getAdminPassword();
}

function getMakeSignupWebhookConfig() {
  return {
    url: String(process.env.MAKE_SIGNUP_WEBHOOK_URL || "").trim(),
    apiKey: String(process.env.MAKE_SIGNUP_WEBHOOK_API_KEY || "").trim(),
  };
}

function getPublicBaseUrl(req) {
  const configured = String(process.env.PUBLIC_APP_URL || process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;

  const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "http").split(",")[0].trim();
  const host = String(req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

function getStripeReturnUrls(req) {
  const baseUrl = getPublicBaseUrl(req);
  return {
    successUrl: String(process.env.STRIPE_SUCCESS_URL || "").trim() || `${baseUrl}/#/signup?payment=success`,
    cancelUrl: String(process.env.STRIPE_CANCEL_URL || "").trim() || `${baseUrl}/#/signup?payment=cancelled`,
  };
}

function getSignupVerificationUrl(req, token) {
  const configured = String(process.env.SIGNUP_VERIFICATION_BASE_URL || "").trim().replace(/\/+$/, "");
  const baseUrl = configured || getPublicBaseUrl(req);
  return `${baseUrl}/api/integrations/verify-signup-email?token=${encodeURIComponent(token)}`;
}

function getEmailTransportConfig() {
  const host = String(process.env.SMTP_HOST || "").trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const user = String(process.env.SMTP_USER || "").trim();
  const pass = String(process.env.SMTP_PASS || "").trim();
  const from = String(process.env.EMAIL_FROM || process.env.SMTP_FROM || "").trim();

  if (!host || !from) return null;

  return {
    from,
    transport: {
      host,
      port: Number.isFinite(port) && port > 0 ? port : 587,
      secure: isEnabled(process.env.SMTP_SECURE),
      auth: user || pass ? { user, pass } : undefined,
    },
  };
}

function ensurePendingSignupStore() {
  fs.mkdirSync(path.dirname(pendingSignupPath), { recursive: true });
  if (!fs.existsSync(pendingSignupPath)) {
    fs.writeFileSync(pendingSignupPath, "{}\n");
  }
}

function readPendingSignupStore() {
  ensurePendingSignupStore();
  try {
    const data = JSON.parse(fs.readFileSync(pendingSignupPath, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writePendingSignupStore(store) {
  ensurePendingSignupStore();
  fs.writeFileSync(pendingSignupPath, `${JSON.stringify(store, null, 2)}\n`);
}

function hashSignupVerificationToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function prunePendingSignupStore(store, now = Date.now()) {
  for (const [tokenHash, record] of Object.entries(store)) {
    if (record?.usedAt || Number(record?.expiresAt || 0) <= now) {
      delete store[tokenHash];
    }
  }
  return store;
}

function createPendingSignupVerification({ payload, ownerEmail, businessName, reviewReasons, ipHash }) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashSignupVerificationToken(token);
  const now = Date.now();
  const store = prunePendingSignupStore(readPendingSignupStore(), now);

  store[tokenHash] = {
    tokenHash,
    ownerEmail,
    businessName,
    reviewReasons: Array.isArray(reviewReasons) ? reviewReasons : [],
    ipHash,
    payload,
    createdAt: now,
    expiresAt: now + SIGNUP_VERIFICATION_TTL_MS,
  };

  writePendingSignupStore(store);
  return token;
}

async function sendSignupVerificationEmail({ req, ownerEmail, ownerName, businessName, token }) {
  const verificationUrl = getSignupVerificationUrl(req, token);
  const emailConfig = getEmailTransportConfig();
  const subject = `Verify your email for ${businessName || "My AI PA"}`;
  const safeOwnerName = ownerName || "there";
  const text = [
    `Hi ${safeOwnerName},`,
    "",
    "Please verify your email before we create your My AI PA agent.",
    "",
    verificationUrl,
    "",
    "This link expires in 24 hours. If you did not request this, you can ignore this email.",
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:640px">
      <h1 style="font-size:28px;line-height:1.1;margin:0 0 16px">Verify your email</h1>
      <p>Hi ${escapeHtml(safeOwnerName)},</p>
      <p>Please verify your email before we create your My AI PA agent for <strong>${escapeHtml(businessName || "your business")}</strong>.</p>
      <p>
        <a href="${verificationUrl}" style="display:inline-block;background:#07142a;color:#fff;text-decoration:none;font-weight:700;padding:14px 18px;border-radius:10px">
          Verify email and continue setup
        </a>
      </p>
      <p style="font-size:14px;color:#475569">This link expires in 24 hours. If the button does not work, copy and paste this URL into your browser:</p>
      <p style="font-size:14px;word-break:break-all;color:#2563eb">${verificationUrl}</p>
    </div>
  `;

  if (!emailConfig) {
    if (process.env.NODE_ENV !== "production" || isEnabled(process.env.EMAIL_VERIFICATION_DEV_MODE)) {
      console.warn("[signup:verification] SMTP is not configured. Dev verification link:", verificationUrl);
      return { sent: false, devVerificationUrl: verificationUrl };
    }
    const err = new Error("Email verification is enabled, but SMTP is not configured.");
    err.statusCode = 500;
    throw err;
  }

  const transporter = nodemailer.createTransport(emailConfig.transport);
  await transporter.sendMail({
    from: emailConfig.from,
    to: ownerEmail,
    subject,
    text,
    html,
  });

  return { sent: true };
}

function ensureTrialReminderStore() {
  fs.mkdirSync(path.dirname(trialReminderPath), { recursive: true });
  if (!fs.existsSync(trialReminderPath)) {
    fs.writeFileSync(trialReminderPath, "{}\n");
  }
}

function readTrialReminderStore() {
  ensureTrialReminderStore();
  try {
    const data = JSON.parse(fs.readFileSync(trialReminderPath, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeTrialReminderStore(store) {
  ensureTrialReminderStore();
  fs.writeFileSync(trialReminderPath, `${JSON.stringify(store, null, 2)}\n`);
}

function ensureSignupDashboardStore() {
  fs.mkdirSync(path.dirname(signupDashboardPath), { recursive: true });
  if (!fs.existsSync(signupDashboardPath)) {
    fs.writeFileSync(signupDashboardPath, "{}\n");
  }
}

function readSignupDashboardStore() {
  ensureSignupDashboardStore();
  try {
    const data = JSON.parse(fs.readFileSync(signupDashboardPath, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeSignupDashboardStore(store) {
  ensureSignupDashboardStore();
  fs.writeFileSync(signupDashboardPath, `${JSON.stringify(store, null, 2)}\n`);
}

function ensureVapiCallSyncStore() {
  fs.mkdirSync(path.dirname(vapiCallSyncPath), { recursive: true });
  if (!fs.existsSync(vapiCallSyncPath)) {
    fs.writeFileSync(vapiCallSyncPath, "{}\n");
  }
}

function readVapiCallSyncStore() {
  ensureVapiCallSyncStore();
  try {
    const data = JSON.parse(fs.readFileSync(vapiCallSyncPath, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writeVapiCallSyncStore(store) {
  ensureVapiCallSyncStore();
  fs.writeFileSync(vapiCallSyncPath, `${JSON.stringify(store, null, 2)}\n`);
}

function parseVapiBusinessMap() {
  const raw = String(process.env.VAPI_BUSINESS_MAP || "").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [String(key).trim().toLowerCase(), Number(value)])
        .filter(([key, value]) => key && Number.isInteger(value) && value > 0)
    );
  } catch (error) {
    console.warn("[vapi:sync] VAPI_BUSINESS_MAP must be valid JSON", { message: error?.message || String(error) });
    return {};
  }
}

function normalizePhoneForMatch(value) {
  return String(value || "").replace(/[^\d+]/g, "").replace(/^00/, "+").toLowerCase();
}

function getVapiNestedString(value, paths) {
  for (const pathKey of paths) {
    const parts = pathKey.split(".");
    let cursor = value;
    for (const part of parts) {
      cursor = cursor && typeof cursor === "object" ? cursor[part] : undefined;
    }
    if (cursor != null && String(cursor).trim()) return String(cursor).trim();
  }
  return "";
}

async function resolveBusinessIdForVapiCall(call) {
  const businessMap = parseVapiBusinessMap();
  const keys = [
    call.assistantId,
    call.assistant?.id,
    call.phoneNumberId,
    call.phoneNumber?.id,
    call.metadata?.businessId,
    call.metadata?.companyId,
    normalizePhoneForMatch(call.phoneNumber?.number),
    normalizePhoneForMatch(call.phoneNumber?.twilioPhoneNumber),
    normalizePhoneForMatch(call.destination?.number),
    normalizePhoneForMatch(call.to),
  ]
    .map((item) => String(item || "").trim().toLowerCase())
    .filter(Boolean);

  for (const key of keys) {
    if (businessMap[key]) return businessMap[key];
  }

  if (keys.length) {
    const mapping = await prisma.vapiBusinessMapping.findFirst({
      where: { matchValue: { in: keys } },
      select: { businessId: true },
    });
    if (mapping?.businessId) return mapping.businessId;
  }

  const calledNumber = normalizePhoneForMatch(
    call.phoneNumber?.number ||
      call.phoneNumber?.twilioPhoneNumber ||
      call.destination?.number ||
      call.to ||
      ""
  );
  if (calledNumber) {
    const businesses = await prisma.business.findMany({ select: { id: true, phone: true } });
    const matched = businesses.find((business) => normalizePhoneForMatch(business.phone) === calledNumber);
    if (matched) return matched.id;
  }

  return VAPI_DEFAULT_BUSINESS_ID;
}

function mapVapiStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("ended") || normalized.includes("hangup")) return "COMPLETED";
  if (["ended", "completed", "complete", "success", "successful"].includes(normalized)) return "COMPLETED";
  if (["failed", "error"].includes(normalized)) return "FAILED";
  if (["missed", "no-answer", "no_answer"].includes(normalized)) return "MISSED";
  if (["abandoned", "canceled", "cancelled"].includes(normalized)) return "ABANDONED";
  return "STARTED";
}

function getVapiDurationSeconds(call) {
  const direct = Number(call.durationSec || call.durationSeconds || call.duration || 0);
  if (Number.isFinite(direct) && direct > 0) return Math.round(direct);
  const startedAt = new Date(call.startedAt || call.createdAt || call.started_at || 0).getTime();
  const endedAt = new Date(call.endedAt || call.ended_at || call.completedAt || call.endedReasonAt || 0).getTime();
  if (startedAt && endedAt && endedAt > startedAt) return Math.round((endedAt - startedAt) / 1000);
  return null;
}

function getVapiTranscript(call) {
  return (
    getVapiNestedString(call, [
      "transcript",
      "artifact.transcript",
      "analysis.transcript",
      "summary",
      "analysis.summary",
    ]) || null
  );
}

function getVapiSummary(call) {
  return (
    getVapiNestedString(call, [
      "summary",
      "analysis.summary",
      "artifact.summary",
    ]) || null
  );
}

function getVapiRecordingUrl(call) {
  return (
    getVapiNestedString(call, [
      "recordingUrl",
      "recording.url",
      "artifact.recordingUrl",
      "artifact.recording.url",
      "stereoRecordingUrl",
    ]) || null
  );
}

function getVapiTwilioCallSid(call) {
  return (
    getVapiNestedString(call, [
      "twilioCallSid",
      "twilio.callSid",
      "phoneCallProviderDetails.twilioCallSid",
      "phoneCallProviderDetails.callSid",
      "transport.callSid",
      "metadata.twilioCallSid",
    ]) || null
  );
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getVapiCostBreakdown(call) {
  const candidates = [
    call?.costBreakdown,
    call?.costs,
    call?.costsBreakdown,
    call?.analysis?.costBreakdown,
    call?.artifact?.costBreakdown,
  ];
  const found = candidates.find((item) => item && typeof item === "object");
  return found || null;
}

function getVapiCost(call) {
  const direct = numberOrNull(call?.cost || call?.totalCost || call?.costInUsd || call?.price);
  if (direct != null) return Math.abs(direct);

  const breakdown = getVapiCostBreakdown(call);
  if (!breakdown) return null;

  if (Array.isArray(breakdown)) {
    const total = breakdown.reduce((sum, item) => sum + Math.abs(numberOrNull(item?.cost || item?.amount || item?.price) || 0), 0);
    return total || null;
  }

  const total = Object.values(breakdown).reduce((sum, value) => {
    if (typeof value === "number" || typeof value === "string") return sum + Math.abs(numberOrNull(value) || 0);
    if (value && typeof value === "object") return sum + Math.abs(numberOrNull(value.cost || value.amount || value.price) || 0);
    return sum;
  }, 0);
  return total || null;
}

async function fetchVapiCalls({ limit = VAPI_CALL_LIMIT, createdAtGt } = {}) {
  if (!VAPI_API_KEY) {
    const err = new Error("VAPI_API_KEY is not configured.");
    err.statusCode = 503;
    throw err;
  }

  const url = new URL(`${VAPI_API_BASE_URL}/call`);
  url.searchParams.set("limit", String(Math.max(1, Math.min(1000, Number(limit) || VAPI_CALL_LIMIT))));
  if (createdAtGt) url.searchParams.set("createdAtGt", String(createdAtGt));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      Accept: "application/json",
    },
  });
  const rawText = await response.text();
  const data = parseJsonObject(rawText);

  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `Vapi call fetch failed with HTTP ${response.status}.`);
    err.statusCode = response.status;
    throw err;
  }

  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.calls)) return data.calls;
  if (Array.isArray(data?.results)) return data.results;
  return [];
}

async function syncVapiCalls(options = {}) {
  const calls = await fetchVapiCalls(options);
  const store = readVapiCallSyncStore();
  const results = [];

  for (const call of calls) {
    const vapiCallId = String(call?.id || call?.callId || "").trim();
    if (!vapiCallId) continue;

    const existing = store[vapiCallId] || {};
    const businessId = await resolveBusinessIdForVapiCall(call);
    const callerPhone =
      getVapiNestedString(call, ["customer.number", "customer.phoneNumber", "caller.number", "from", "fromNumber"]) ||
      `unknown-vapi-${vapiCallId}`;
    const callerName = getVapiNestedString(call, ["customer.name", "caller.name", "metadata.customerName"]);
    const startedAt = call.startedAt || call.started_at || call.createdAt || call.created_at || new Date().toISOString();
    const endedAt = call.endedAt || call.ended_at || call.completedAt || null;
    const vapiCost = getVapiCost(call);
    const twilioCallSid = getVapiTwilioCallSid(call);
    const localCall = await logCall({
      callId: existing.localCallId,
      businessId,
      callerPhone,
      callerName,
      startedAt,
      endedAt,
      durationSec: getVapiDurationSeconds(call),
      status: mapVapiStatus(call.status || call.endedReason),
      transcript: getVapiTranscript(call),
      recordingUrl: getVapiRecordingUrl(call),
      externalProvider: "vapi",
      externalId: vapiCallId,
      aiSummary: getVapiSummary(call),
      twilioCallSid,
      vapiCost,
      vapiCostBreakdown: getVapiCostBreakdown(call),
      totalInternalCost: vapiCost,
      costSyncedAt: vapiCost != null || twilioCallSid ? new Date().toISOString() : null,
      followUpNeeded: /follow|quote|estimate|book|schedule|urgent|emergency/i.test(
        [getVapiSummary(call), getVapiTranscript(call), call.endedReason].filter(Boolean).join(" ")
      ),
    });

    store[vapiCallId] = {
      ...existing,
      vapiCallId,
      localCallId: localCall.id,
      businessId,
      assistantId: call.assistantId || call.assistant?.id || "",
      phoneNumberId: call.phoneNumberId || call.phoneNumber?.id || "",
      twilioCallSid: twilioCallSid || existing.twilioCallSid || "",
      syncedAt: new Date().toISOString(),
    };
    results.push({ vapiCallId, localCallId: localCall.id, businessId });
  }

  writeVapiCallSyncStore(store);
  return { fetched: calls.length, synced: results.length, results };
}

async function fetchTwilioCalls({ days = 30, limit = 1000 } = {}) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    const err = new Error("Twilio credentials are not configured.");
    err.statusCode = 503;
    throw err;
  }

  const { start } = getDateRange(days);
  const url = new URL(`${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Calls.json`);
  url.searchParams.set("PageSize", String(Math.max(1, Math.min(1000, Number(limit) || 1000))));
  url.searchParams.set("StartTimeAfter", start.toISOString().slice(0, 10));

  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64");
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
    },
  });
  const rawText = await response.text();
  const data = parseJsonObject(rawText);

  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `Twilio call fetch failed with HTTP ${response.status}.`);
    err.statusCode = response.status;
    throw err;
  }

  return Array.isArray(data?.calls) ? data.calls : [];
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function getTwilioAuthHeader() {
  return `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`;
}

async function fetchTwilioIncomingPhoneNumbers() {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    const err = new Error("Twilio credentials are not configured.");
    err.statusCode = 503;
    throw err;
  }

  const records = [];
  let nextUrl = new URL(`${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/IncomingPhoneNumbers.json`);
  nextUrl.searchParams.set("PageSize", "1000");

  for (let page = 0; nextUrl && page < 10; page += 1) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: getTwilioAuthHeader(),
        Accept: "application/json",
      },
    });
    const rawText = await response.text();
    const data = parseJsonObject(rawText);

    if (!response.ok) {
      const err = new Error(data?.message || data?.error || `Twilio phone number fetch failed with HTTP ${response.status}.`);
      err.statusCode = response.status;
      throw err;
    }

    records.push(...(Array.isArray(data?.incoming_phone_numbers) ? data.incoming_phone_numbers : []));
    nextUrl = data?.next_page_uri ? new URL(data.next_page_uri, TWILIO_API_BASE_URL) : null;
  }

  return records;
}

async function fetchTwilioUsageRecords({ days = 30 } = {}) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    const err = new Error("Twilio credentials are not configured.");
    err.statusCode = 503;
    throw err;
  }

  const { start, end } = getDateRange(days);
  const url = new URL(`${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Usage/Records.json`);
  url.searchParams.set("StartDate", dateOnly(start));
  url.searchParams.set("EndDate", dateOnly(end));
  url.searchParams.set("PageSize", "1000");

  const response = await fetch(url, {
    headers: {
      Authorization: getTwilioAuthHeader(),
      Accept: "application/json",
    },
  });
  const rawText = await response.text();
  const data = parseJsonObject(rawText);

  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `Twilio usage fetch failed with HTTP ${response.status}.`);
    err.statusCode = response.status;
    throw err;
  }

  return Array.isArray(data?.usage_records) ? data.usage_records : [];
}

function normalizeTwilioUsageRecord(record) {
  const price = Math.abs(numberOrNull(record?.price) || 0);
  return {
    category: String(record?.category || "unknown").trim(),
    description: String(record?.description || record?.category || "Twilio usage").trim(),
    count: numberOrNull(record?.count),
    countUnit: String(record?.count_unit || "").trim() || null,
    usage: numberOrNull(record?.usage),
    usageUnit: String(record?.usage_unit || "").trim() || null,
    price,
    priceUnit: String(record?.price_unit || "USD").trim() || "USD",
  };
}

function getTwilioUsageCategoryKey(record) {
  return String(record?.category || "").trim().toLowerCase();
}

function getTwilioUsageComparableText(value) {
  return String(value || "").replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function isTwilioAccountTotalRecord(record) {
  return (
    getTwilioUsageComparableText(record?.category) === "totalprice" ||
    getTwilioUsageComparableText(record?.description) === "totalprice"
  );
}

function selectTwilioUsageTotalRecords(records) {
  const billableRecords = records.filter((record) => record.price);
  const totalRecord = billableRecords.find(isTwilioAccountTotalRecord);
  if (totalRecord) {
    return {
      totalSource: "accountTotal",
      includedRecords: [totalRecord],
      totalRecord,
    };
  }

  const categoryKeys = billableRecords.map(getTwilioUsageCategoryKey).filter(Boolean);
  const leafRecords = billableRecords.filter((record) => {
    const key = getTwilioUsageCategoryKey(record);
    if (!key) return true;
    return !categoryKeys.some((otherKey) => otherKey !== key && otherKey.startsWith(`${key}-`));
  });

  return {
    totalSource: "leafCategories",
    includedRecords: leafRecords.length ? leafRecords : billableRecords,
    totalRecord: null,
  };
}

function getFixedMonthlyCosts({ days = 30 } = {}) {
  const records = [];
  const addRecord = (label, monthlyCost) => {
    const cost = Math.abs(numberOrNull(monthlyCost) || 0);
    if (!cost) return;
    const proratedCost = Number((cost * (Math.max(1, Number(days) || 30) / 30.4375)).toFixed(4));
    records.push({
      label: String(label || "Fixed monthly cost").trim().slice(0, 120),
      monthlyCost: Number(cost.toFixed(4)),
      proratedCost,
      currency: "USD",
    });
  };

  if (FIXED_MONTHLY_COST_USD) addRecord("Manual fixed monthly costs", FIXED_MONTHLY_COST_USD);

  if (FIXED_MONTHLY_COSTS_JSON) {
    try {
      const parsed = JSON.parse(FIXED_MONTHLY_COSTS_JSON);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && typeof item === "object") addRecord(item.label || item.name || item.provider, item.monthlyCost ?? item.cost ?? item.amount);
        });
      } else if (parsed && typeof parsed === "object") {
        Object.entries(parsed).forEach(([label, cost]) => addRecord(label, cost));
      }
    } catch (error) {
      return {
        available: false,
        totalCost: 0,
        currency: "USD",
        records,
        warning: `FIXED_MONTHLY_COSTS_JSON is not valid JSON: ${error?.message || "parse failed"}`,
      };
    }
  }

  return {
    available: true,
    totalCost: Number(records.reduce((sum, record) => sum + Number(record.proratedCost || 0), 0).toFixed(4)),
    currency: "USD",
    records,
  };
}

async function getTwilioAccountUsage({ days = 30 } = {}) {
  const records = (await fetchTwilioUsageRecords({ days })).map(normalizeTwilioUsageRecord);
  const billableRecords = records.filter((record) => record.price);
  const selection = selectTwilioUsageTotalRecords(records);
  const includedRecords = new Set(selection.includedRecords);
  const totalCost = Number(selection.includedRecords.reduce((sum, record) => sum + Number(record.price || 0), 0).toFixed(4));
  const currency = records.find((record) => record.priceUnit)?.priceUnit || "USD";
  return {
    available: true,
    totalCost,
    totalSource: selection.totalSource,
    currency,
    billableRecords: billableRecords.length,
    includedRecords: selection.includedRecords.length,
    records: billableRecords
      .map((record) => ({
        ...record,
        includedInTotal: includedRecords.has(record),
        isAccountTotal: record === selection.totalRecord,
      }))
      .sort((a, b) => Number(b.includedInTotal) - Number(a.includedInTotal) || b.price - a.price),
  };
}

function normalizeTwilioCall(call) {
  const startedAt = call?.start_time || call?.date_created || call?.date_updated || null;
  const endedAt = call?.end_time || null;
  const rawPrice = numberOrNull(call?.price);
  return {
    sid: String(call?.sid || "").trim(),
    from: normalizePhoneForMatch(call?.from || ""),
    to: normalizePhoneForMatch(call?.to || ""),
    phoneNumberSid: String(call?.phone_number_sid || "").trim(),
    direction: String(call?.direction || "").trim(),
    status: String(call?.status || "").trim(),
    startedAt,
    startedAtMs: startedAt ? new Date(startedAt).getTime() : 0,
    endedAt,
    durationSec: numberOrNull(call?.duration),
    price: rawPrice == null ? null : Math.abs(rawPrice),
    priceUnit: String(call?.price_unit || "").trim() || null,
  };
}

function normalizeTwilioInventoryNumber(record) {
  return {
    sid: String(record?.sid || "").trim(),
    phoneNumber: normalizePhoneForMatch(record?.phone_number || ""),
    rawPhoneNumber: String(record?.phone_number || "").trim(),
    friendlyName: String(record?.friendly_name || "").trim(),
    dateCreated: record?.date_created || null,
    dateUpdated: record?.date_updated || null,
    voiceUrl: String(record?.voice_url || "").trim(),
    smsUrl: String(record?.sms_url || "").trim(),
    voiceApplicationSid: String(record?.voice_application_sid || "").trim(),
    smsApplicationSid: String(record?.sms_application_sid || "").trim(),
    trunkSid: String(record?.trunk_sid || "").trim(),
    capabilities: record?.capabilities || {},
  };
}

function addNumberEvidence(map, phoneNumber, evidence) {
  const normalized = normalizePhoneForMatch(phoneNumber || "");
  if (!normalized) return;
  const current = map.get(normalized) || [];
  current.push(evidence);
  map.set(normalized, current);
}

async function getTwilioNumberInventory({ days = 90 } = {}) {
  const windowDays = Math.max(1, Math.min(365, Number(days) || 90));
  const [numbers, twilioCalls, businesses, localCalls] = await Promise.all([
    fetchTwilioIncomingPhoneNumbers(),
    fetchTwilioCalls({ days: windowDays, limit: 1000 }).catch((error) => {
      console.warn("[admin:twilio-numbers] call fetch unavailable", { message: error?.message || "unknown" });
      return [];
    }),
    prisma.business.findMany({ include: { vapiMappings: true }, orderBy: { id: "asc" }, take: 1000 }),
    prisma.call.findMany({
      where: { startedAt: { gte: getDateRange(windowDays).start } },
      include: { business: true },
      orderBy: { startedAt: "desc" },
      take: 3000,
    }),
  ]);

  const appEvidence = new Map();
  for (const business of businesses) {
    addNumberEvidence(appEvidence, business.phone, `Business phone: ${business.name || `Business ${business.id}`}`);
    for (const mapping of business.vapiMappings || []) {
      if (/phone/i.test(mapping.matchType || "")) {
        addNumberEvidence(appEvidence, mapping.matchValue, `Vapi mapping: ${mapping.label || business.name || `Business ${business.id}`}`);
      }
    }
  }
  for (const signup of listSignupDashboardRecords()) {
    if (signup.twilioPhoneNumber) {
      addNumberEvidence(appEvidence, signup.twilioPhoneNumber, `Signup record: ${signup.businessName || signup.ownerEmail || "customer"}`);
    }
  }

  const inventory = numbers.map(normalizeTwilioInventoryNumber).filter((record) => record.phoneNumber);
  const inventoryNumbers = new Set(inventory.map((record) => record.phoneNumber));
  const twilioCallStats = new Map();
  for (const call of twilioCalls.map(normalizeTwilioCall)) {
    for (const phoneNumber of [call.to, call.from]) {
      if (!inventoryNumbers.has(phoneNumber)) continue;
      const stats = twilioCallStats.get(phoneNumber) || { count: 0, inbound: 0, outbound: 0, lastCallAt: null };
      stats.count += 1;
      if (/inbound/i.test(call.direction)) stats.inbound += 1;
      if (/outbound/i.test(call.direction)) stats.outbound += 1;
      stats.lastCallAt = stats.lastCallAt && new Date(stats.lastCallAt) > new Date(call.startedAt) ? stats.lastCallAt : call.startedAt;
      twilioCallStats.set(phoneNumber, stats);
    }
  }

  const localCallStats = new Map();
  for (const call of localCalls) {
    const phoneNumber = normalizePhoneForMatch(call.business?.phone || "");
    if (!phoneNumber) continue;
    const stats = localCallStats.get(phoneNumber) || { count: 0, lastCallAt: null };
    stats.count += 1;
    stats.lastCallAt = stats.lastCallAt && new Date(stats.lastCallAt) > new Date(call.startedAt) ? stats.lastCallAt : call.startedAt;
    localCallStats.set(phoneNumber, stats);
  }

  const rows = inventory.map((record) => {
    const evidence = appEvidence.get(record.phoneNumber) || [];
    const twilioStats = twilioCallStats.get(record.phoneNumber) || { count: 0, inbound: 0, outbound: 0, lastCallAt: null };
    const localStats = localCallStats.get(record.phoneNumber) || { count: 0, lastCallAt: null };
    const hasWebhookConfig = Boolean(record.voiceUrl || record.smsUrl || record.voiceApplicationSid || record.smsApplicationSid || record.trunkSid);
    const status = evidence.length
      ? "keep"
      : twilioStats.count || hasWebhookConfig
        ? "review"
        : "likelyUnused";
    const reasons = evidence.length
      ? evidence
      : [
          twilioStats.count ? `${twilioStats.count} Twilio calls in ${windowDays} days` : "",
          hasWebhookConfig ? "Has Twilio webhook/application configuration" : "",
          !twilioStats.count && !hasWebhookConfig ? `No app mapping and no Twilio calls in ${windowDays} days` : "",
        ].filter(Boolean);

    return {
      status,
      phoneNumber: record.rawPhoneNumber || record.phoneNumber,
      normalizedPhoneNumber: record.phoneNumber,
      sid: record.sid,
      friendlyName: record.friendlyName,
      dateCreated: record.dateCreated,
      dateUpdated: record.dateUpdated,
      twilioCalls: twilioStats.count,
      twilioInboundCalls: twilioStats.inbound,
      twilioOutboundCalls: twilioStats.outbound,
      twilioLastCallAt: twilioStats.lastCallAt,
      appCalls: localStats.count,
      appLastCallAt: localStats.lastCallAt,
      hasWebhookConfig,
      voiceUrlConfigured: Boolean(record.voiceUrl),
      smsUrlConfigured: Boolean(record.smsUrl),
      voiceApplicationConfigured: Boolean(record.voiceApplicationSid),
      smsApplicationConfigured: Boolean(record.smsApplicationSid),
      trunkConfigured: Boolean(record.trunkSid),
      capabilities: record.capabilities,
      reasons,
    };
  });

  return {
    days: windowDays,
    summary: {
      totalNumbers: rows.length,
      keep: rows.filter((row) => row.status === "keep").length,
      review: rows.filter((row) => row.status === "review").length,
      likelyUnused: rows.filter((row) => row.status === "likelyUnused").length,
      appMappedNumbers: appEvidence.size,
      twilioCallsAnalyzed: twilioCalls.length,
    },
    numbers: rows.sort((a, b) => {
      const rank = { keep: 0, review: 1, likelyUnused: 2 };
      return rank[a.status] - rank[b.status] || b.twilioCalls - a.twilioCalls || a.phoneNumber.localeCompare(b.phoneNumber);
    }),
  };
}

function scoreTwilioCallMatch(localCall, twilioCall, businessNumbers) {
  if (!localCall || !twilioCall?.sid) return -1;
  if (localCall.twilioCallSid && localCall.twilioCallSid === twilioCall.sid) return 10000;

  const startedAtMs = new Date(localCall.startedAt).getTime();
  if (!startedAtMs || !twilioCall.startedAtMs) return -1;

  const callerPhone = normalizePhoneForMatch(localCall.caller?.phone || "");
  const localDuration = Number(localCall.durationSec || 0);
  const timeDiffSec = Math.abs(startedAtMs - twilioCall.startedAtMs) / 1000;
  const durationDiff = localDuration && twilioCall.durationSec != null ? Math.abs(localDuration - twilioCall.durationSec) : 0;

  if (timeDiffSec > 15 * 60) return -1;
  if (localDuration && twilioCall.durationSec != null && durationDiff > 45) return -1;

  let score = 0;
  if (callerPhone && (callerPhone === twilioCall.from || callerPhone === twilioCall.to)) score += 60;
  if (businessNumbers.some((number) => number && (number === twilioCall.to || number === twilioCall.from))) score += 40;
  score += Math.max(0, 40 - timeDiffSec / 15);
  if (localDuration && twilioCall.durationSec != null) score += Math.max(0, 20 - durationDiff);
  return score;
}

async function syncTwilioCallCosts({ days = 30, limit = 1000 } = {}) {
  const twilioCalls = (await fetchTwilioCalls({ days, limit })).map(normalizeTwilioCall).filter((call) => call.sid);
  const { start } = getDateRange(days);
  const localCalls = await prisma.call.findMany({
    where: { startedAt: { gte: start } },
    include: { caller: true, business: { include: { vapiMappings: true } } },
    orderBy: { startedAt: "desc" },
    take: Math.max(1, Math.min(3000, Number(limit) * 3 || 3000)),
  });

  const usedTwilioSids = new Set();
  const updates = [];

  for (const localCall of localCalls) {
    const businessNumbers = [
      localCall.business?.phone,
      ...(localCall.business?.vapiMappings || []).map((mapping) => mapping.matchValue),
    ].map(normalizePhoneForMatch).filter(Boolean);

    let best = null;
    let bestScore = -1;

    for (const twilioCall of twilioCalls) {
      if (usedTwilioSids.has(twilioCall.sid) && localCall.twilioCallSid !== twilioCall.sid) continue;
      const score = scoreTwilioCallMatch(localCall, twilioCall, businessNumbers);
      if (score > bestScore) {
        best = twilioCall;
        bestScore = score;
      }
    }

    if (!best || bestScore < 70) continue;
    usedTwilioSids.add(best.sid);

    const vapiCost = numberOrNull(localCall.vapiCost) || 0;
    const twilioPrice = best.price;
    const totalInternalCost = (twilioPrice || 0) + vapiCost;
    const updated = await prisma.call.update({
      where: { id: localCall.id },
      data: {
        twilioCallSid: best.sid,
        twilioPrice,
        twilioPriceUnit: best.priceUnit,
        totalInternalCost: totalInternalCost || null,
        costSyncedAt: new Date(),
      },
      include: { caller: true, business: true },
    });
    updates.push({ call: sanitizeAdminCall(updated), twilio: best, score: Math.round(bestScore) });
  }

  return { fetched: twilioCalls.length, updated: updates.length, updates };
}

async function syncCallCosts({ days = 30, limit = 1000, includeVapi = false } = {}) {
  const result = { vapi: null, twilio: null };
  if (includeVapi) {
    result.vapi = await syncVapiCalls({ limit: Math.min(Number(limit) || VAPI_CALL_LIMIT, VAPI_CALL_LIMIT) });
  }
  result.twilio = await syncTwilioCallCosts({ days, limit });
  return result;
}

function getDateRange(days = 30) {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000);
  return { start, end };
}

async function getCompanyCallAnalytics({ days = 30 } = {}) {
  const { start, end } = getDateRange(days);
  const calls = await prisma.call.findMany({
    where: { startedAt: { gte: start, lte: end } },
    include: { business: true },
    orderBy: { startedAt: "desc" },
    take: 2000,
  });
  const byBusiness = new Map();

  for (const call of calls) {
    const key = call.businessId;
    const row = byBusiness.get(key) || {
      businessId: key,
      businessName: call.business?.name || `Business ${key}`,
      totalCalls: 0,
      missedCalls: 0,
      answeredCalls: 0,
      failedCalls: 0,
      bookedCalls: 0,
      followUps: 0,
      averageDurationSec: 0,
      totalDurationSec: 0,
      busiestHour: null,
      hours: {},
    };
    row.totalCalls += 1;
    if (call.status === "MISSED" || call.status === "ABANDONED") row.missedCalls += 1;
    if (call.status === "COMPLETED") row.answeredCalls += 1;
    if (call.status === "FAILED") row.failedCalls += 1;
    if (call.outcome === "BOOKED") row.bookedCalls += 1;
    if (call.followUpNeeded || call.outcome === "FOLLOW_UP" || call.outcome === "QUOTE_NEEDED") row.followUps += 1;
    row.totalDurationSec += Number(call.durationSec || 0);
    const hour = new Date(call.startedAt).getHours();
    row.hours[hour] = (row.hours[hour] || 0) + 1;
    byBusiness.set(key, row);
  }

  return Array.from(byBusiness.values()).map((row) => {
    const busiest = Object.entries(row.hours).sort((a, b) => b[1] - a[1])[0];
    return {
      ...row,
      averageDurationSec: row.totalCalls ? Math.round(row.totalDurationSec / row.totalCalls) : 0,
      missedRate: row.totalCalls ? Math.round((row.missedCalls / row.totalCalls) * 100) : 0,
      busiestHour: busiest ? `${String(busiest[0]).padStart(2, "0")}:00` : "—",
    };
  });
}

async function getCostAudit({ days = 30 } = {}) {
  const { start, end } = getDateRange(days);
  let databaseWarning = "";
  let twilioUsageWarning = "";
  let twilioAccountUsage = null;
  const fixedCosts = getFixedMonthlyCosts({ days });
  let calls = [];
  try {
    calls = await withTimeout(
      prisma.call.findMany({
        where: { startedAt: { gte: start, lte: end } },
        include: {
          caller: true,
          business: { include: { vapiMappings: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 2000,
      }),
      8000,
      "Database did not respond while loading cost audit."
    );
  } catch (error) {
    const rawMessage = error?.message || "";
    databaseWarning = /localhost:5432|database server|findMany|prisma/i.test(rawMessage)
      ? "Database is unavailable. Start Postgres locally or point DATABASE_URL at the live database."
      : rawMessage || "Database is unavailable.";
    console.warn("[admin:cost-audit] database unavailable", { message: databaseWarning });
    calls = [];
  }

  if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    try {
      twilioAccountUsage = await withTimeout(
        getTwilioAccountUsage({ days }),
        10000,
        "Twilio account usage did not respond while loading cost audit."
      );
    } catch (error) {
      twilioUsageWarning = error?.message || "Twilio account usage could not be loaded.";
      console.warn("[admin:cost-audit] Twilio account usage unavailable", { message: twilioUsageWarning });
    }
  }

  const groups = new Map();
  for (const call of calls) {
    const phoneMappings = (call.business?.vapiMappings || []).filter((mapping) => String(mapping.matchType || "").toLowerCase().includes("phone"));
    const phoneNumber = phoneMappings[0]?.matchValue || call.business?.phone || `Business ${call.businessId}`;
    const key = `${call.businessId}:${phoneNumber}`;
    const row = groups.get(key) || {
      businessId: call.businessId,
      businessName: call.business?.name || `Business ${call.businessId}`,
      phoneNumber,
      totalCalls: 0,
      pricedCalls: 0,
      twilioCost: 0,
      vapiCost: 0,
      totalInternalCost: 0,
      totalDurationSec: 0,
      currency: call.twilioPriceUnit || "USD",
      lastCallAt: null,
    };

    const twilioCost = Number(call.twilioPrice || 0);
    const vapiCost = Number(call.vapiCost || 0);
    const totalInternalCost = Number((twilioCost + vapiCost).toFixed(4));

    row.totalCalls += 1;
    if (call.costSyncedAt || twilioCost || vapiCost || totalInternalCost) row.pricedCalls += 1;
    row.twilioCost += twilioCost;
    row.vapiCost += vapiCost;
    row.totalInternalCost += totalInternalCost;
    row.totalDurationSec += Number(call.durationSec || 0);
    row.currency = call.twilioPriceUnit || row.currency;
    row.lastCallAt = row.lastCallAt && new Date(row.lastCallAt) > new Date(call.startedAt) ? row.lastCallAt : call.startedAt;
    groups.set(key, row);
  }

  const summary = Array.from(groups.values()).map((row) => ({
    ...row,
    twilioCost: Number(row.twilioCost.toFixed(4)),
    vapiCost: Number(row.vapiCost.toFixed(4)),
    totalInternalCost: Number(row.totalInternalCost.toFixed(4)),
    averageCost: row.totalCalls ? Number((row.totalInternalCost / row.totalCalls).toFixed(4)) : 0,
    averageDurationSec: row.totalCalls ? Math.round(row.totalDurationSec / row.totalCalls) : 0,
  }));

  const twilioCallCost = Number(calls.reduce((sum, call) => sum + Number(call.twilioPrice || 0), 0).toFixed(4));
  const vapiCost = Number(calls.reduce((sum, call) => sum + Number(call.vapiCost || 0), 0).toFixed(4));
  const callUsageCost = Number((twilioCallCost + vapiCost).toFixed(4));
  const twilioUsageCost = twilioAccountUsage?.available ? Number(twilioAccountUsage.totalCost || 0) : null;
  const effectiveTwilioCost = twilioUsageCost ?? twilioCallCost;
  const fixedCost = Number(fixedCosts.totalCost || 0);
  const estimatedProviderCost = Number((vapiCost + effectiveTwilioCost + fixedCost).toFixed(4));

  return {
    days: Number(days) || 30,
    totals: {
      totalCalls: calls.length,
      pricedCalls: calls.filter((call) => call.costSyncedAt || call.twilioPrice || call.vapiCost || call.totalInternalCost).length,
      twilioCallCost,
      twilioUsageCost,
      twilioCost: Number(effectiveTwilioCost.toFixed(4)),
      vapiCost,
      fixedCost,
      callUsageCost,
      totalInternalCost: estimatedProviderCost,
      estimatedProviderCost,
    },
    summary: summary.sort((a, b) => b.totalInternalCost - a.totalInternalCost),
    calls: calls.slice(0, 300).map((call) => sanitizeAdminCall({
      ...call,
      totalInternalCost: Number((Number(call.twilioPrice || 0) + Number(call.vapiCost || 0)).toFixed(4)),
    })),
    twilioAccountUsage,
    fixedCosts,
    env: {
      databaseAvailable: !databaseWarning,
      twilioConfigured: Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN),
      vapiConfigured: Boolean(VAPI_API_KEY),
    },
    warnings: [
      databaseWarning,
      !TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN ? "Twilio credentials are not configured, so Twilio per-call prices cannot sync." : "",
      twilioUsageWarning,
      fixedCosts.warning || "",
      !VAPI_API_KEY ? "VAPI_API_KEY is not configured, so Vapi call costs cannot refresh." : "",
    ].filter(Boolean),
  };
}

async function searchCallTranscripts({ q = "", businessId, limit = 100 } = {}) {
  const query = String(q || "").trim();
  const where = {};
  if (businessId) where.businessId = parsePositiveInt(businessId, 1);
  if (query) {
    where.OR = [
      { transcript: { contains: query, mode: "insensitive" } },
      { aiSummary: { contains: query, mode: "insensitive" } },
      { caller: { is: { phone: { contains: query, mode: "insensitive" } } } },
      { caller: { is: { name: { contains: query, mode: "insensitive" } } } },
      { business: { is: { name: { contains: query, mode: "insensitive" } } } },
    ];
  }
  return prisma.call.findMany({
    where,
    include: { caller: true, business: true, notes: { orderBy: { createdAt: "desc" } }, tasks: { orderBy: { createdAt: "desc" } } },
    orderBy: { startedAt: "desc" },
    take: Math.max(1, Math.min(300, Number(limit) || 100)),
  });
}

function getBillingReadinessForSignup(signup) {
  return [
    { key: "signup", label: "Signup submitted", done: Boolean(signup.signedUpAt || signup.createdAt) },
    { key: "email", label: "Email verified", done: Boolean(signup.emailVerified || !signup.emailVerificationRequired) },
    { key: "setup", label: "Agent setup started", done: ["setup_started", "checkout_started", "checkout_completed", "subscription_trialing", "subscription_active"].includes(String(signup.status || "")) },
    { key: "checkout", label: "Stripe checkout started", done: Boolean(signup.checkoutSessionId || signup.subscriptionId) },
    { key: "subscription", label: "Subscription/trial active", done: Boolean(signup.subscriptionId || signup.subscriptionStatus === "trialing" || signup.subscriptionStatus === "active") },
  ];
}

async function getTrialHealthDashboard() {
  const signups = listSignupDashboardRecords();
  const callsByEmail = new Map();
  const recentCalls = await prisma.call.findMany({
    include: { business: true },
    orderBy: { startedAt: "desc" },
    take: 1000,
  });
  for (const call of recentCalls) {
    const key = normalizeForKey(call.business?.name || "");
    if (key) callsByEmail.set(key, (callsByEmail.get(key) || 0) + 1);
  }

  return signups.map((signup) => {
    const checklist = getBillingReadinessForSignup(signup);
    const businessKey = normalizeForKey(signup.businessName || "");
    return {
      ...signup,
      callCount: callsByEmail.get(businessKey) || 0,
      readinessChecklist: checklist,
      readinessPercent: Math.round((checklist.filter((item) => item.done).length / checklist.length) * 100),
      needsAttention: checklist.some((item) => !item.done) || (signup.expiry?.color === "red"),
    };
  });
}

const CUSTOMER_SETUP_STEPS = [
  { key: "signup", label: "Signup received", nextAction: "Confirm the signup record exists with owner and business details." },
  { key: "email", label: "Email verified", nextAction: "Ask the owner to open the verification email, or manually review the signup if email verification is disabled." },
  { key: "stripe", label: "Stripe trial active", nextAction: "Send the customer through checkout or check the Stripe webhook configuration." },
  { key: "make", label: "Make handoff completed", nextAction: "Check the Make scenario run history, then rerun the setup handoff if needed." },
  { key: "vapi", label: "Vapi assistant mapped", nextAction: "Create or confirm the Vapi assistant/phone mapping for this business." },
  { key: "twilio", label: "Twilio number connected", nextAction: "Add the Twilio/Vapi phone number and confirm it maps to the right business." },
  { key: "first_call", label: "First call received", nextAction: "Place a test call after the number is connected." },
  { key: "dashboard", label: "Customer dashboard ready", nextAction: "Make sure the customer has signup email plus owner or business phone for dashboard access." },
];

function getCustomerSetupId(signup = {}, business = {}) {
  const source = [
    signup.subscriptionId,
    signup.checkoutSessionId,
    signup.ownerEmail,
    business.id ? `business:${business.id}` : "",
    signup.businessName,
    signup.businessPhone,
  ].filter(Boolean)[0] || `${signup.businessName || "unknown"}:${signup.ownerPhone || signup.businessPhone || ""}`;
  return hashKey(source);
}

function getCustomerSetupRuntimeKey(customerId) {
  return `customer-setup:${String(customerId || "").trim()}`;
}

async function readCustomerSetupOverrides(customerId) {
  if (!customerId) return {};
  try {
    const row = await prisma.runtimeStore.findUnique({ where: { key: getCustomerSetupRuntimeKey(customerId) } });
    return row?.data && typeof row.data === "object" ? row.data : {};
  } catch (error) {
    console.warn("[customer-setup] override read failed", { message: error?.message || String(error) });
    return {};
  }
}

async function writeCustomerSetupOverrides(customerId, data) {
  const key = getCustomerSetupRuntimeKey(customerId);
  return prisma.runtimeStore.upsert({
    where: { key },
    update: { data },
    create: { key, data },
  });
}

function setupStep(status, reason = "") {
  return { status, done: status === "done", reason };
}

function deriveCustomerSetupStep(stepKey, { signup, business, calls, envStatus }) {
  const status = String(signup.status || "").toLowerCase();
  const subscriptionStatus = String(signup.subscriptionStatus || signup.paymentStatus || signup.checkoutStatus || "").toLowerCase();
  const makeStatus = Number(signup.makeStatus || 0);
  const vapiMappings = business?.vapiMappings || [];
  const phoneMappings = vapiMappings.filter((mapping) => String(mapping.matchType || "").toLowerCase().includes("phone"));

  if (stepKey === "signup") {
    return signup.signedUpAt || signup.createdAt ? setupStep("done", "Signup record exists.") : setupStep("waiting", "No signup timestamp found.");
  }

  if (stepKey === "email") {
    if (signup.emailVerified || !signup.emailVerificationRequired) return setupStep("done", "Email verification is complete or not required.");
    return setupStep("waiting", "Owner email verification is still pending.");
  }

  if (stepKey === "stripe") {
    if (signup.subscriptionId || ["trialing", "active", "paid"].includes(subscriptionStatus)) return setupStep("done", "Stripe subscription or trial is active.");
    if (["canceled", "cancelled", "expired", "unpaid", "failed"].includes(subscriptionStatus)) return setupStep("failed", `Stripe status is ${subscriptionStatus}.`);
    if (!envStatus.stripeConfigured) return setupStep("manual", "Stripe is not configured on the backend.");
    return setupStep("waiting", "Stripe checkout or trial has not been confirmed yet.");
  }

  if (stepKey === "make") {
    if (signup.reviewRequired) return setupStep("manual", "Signup is held for manual review.");
    if (status === "setup_error" || signup.makeError) return setupStep("failed", signup.makeError || "Make handoff failed.");
    if (status.includes("setup_started") || status.includes("checkout") || status.includes("subscription") || (makeStatus >= 200 && makeStatus < 300)) {
      return setupStep("done", "Make handoff has started or completed.");
    }
    return setupStep("waiting", "Make handoff has not completed yet.");
  }

  if (stepKey === "vapi") {
    if (vapiMappings.length) return setupStep("done", "Vapi mapping exists for this business.");
    if (!envStatus.vapiApiKeyConfigured) return setupStep("manual", "Vapi API key is not configured.");
    return setupStep("waiting", "No Vapi mapping found for this business.");
  }

  if (stepKey === "twilio") {
    if (signup.twilioPhoneNumber || phoneMappings.length) return setupStep("done", "AI phone number is mapped.");
    return setupStep("waiting", "No AI/Twilio phone number is recorded yet.");
  }

  if (stepKey === "first_call") {
    if (calls.length) return setupStep("done", "At least one call is synced.");
    return setupStep("waiting", "No calls are synced for this business yet.");
  }

  if (stepKey === "dashboard") {
    if (signup.ownerEmail && (signup.ownerPhone || signup.businessPhone || business?.phone)) return setupStep("done", "Customer can open the dashboard with email and phone.");
    return setupStep("manual", "Dashboard lookup needs owner email plus owner or business phone.");
  }

  return setupStep("waiting", "Step has not been evaluated.");
}

function applyCustomerSetupOverride(derived, override) {
  if (!override?.status) return derived;
  const status = String(override.status || "").toLowerCase();
  if (!["done", "waiting", "failed", "manual"].includes(status)) return derived;
  return {
    status,
    done: status === "done",
    reason: override.note || derived.reason || "Manually updated by admin.",
    manualOverride: {
      status,
      note: override.note || "",
      updatedAt: override.updatedAt || null,
    },
  };
}

function getSetupRollup(steps) {
  const counts = steps.reduce(
    (acc, step) => {
      acc[step.status] = (acc[step.status] || 0) + 1;
      if (step.done) acc.done += 1;
      return acc;
    },
    { done: 0, waiting: 0, failed: 0, manual: 0 }
  );
  const readinessPercent = steps.length ? Math.round((counts.done / steps.length) * 100) : 0;
  const blocker = steps.find((step) => !step.done) || null;
  return {
    counts,
    readinessPercent,
    overallStatus: steps.every((step) => step.done) ? "ready" : steps.some((step) => step.status === "failed") ? "blocked" : steps.some((step) => step.status === "manual") ? "manual" : "waiting",
    nextAction: blocker?.nextAction || "Customer setup is ready.",
    blockerKey: blocker?.key || null,
    blockerLabel: blocker?.label || null,
  };
}

async function getCustomerSetupCommandCenter() {
  const signups = listSignupDashboardRecords();
  const envStatus = {
    databaseAvailable: true,
    stripeConfigured: Boolean(stripe && STRIPE_PRICE_ID),
    vapiApiKeyConfigured: Boolean(VAPI_API_KEY),
    twilioConfigured: Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN),
  };

  let businesses = [];
  let databaseWarning = "";
  try {
    businesses = await prisma.business.findMany({
      include: {
        settings: true,
        vapiMappings: { orderBy: { updatedAt: "desc" } },
        calls: {
          include: { caller: true },
          orderBy: { startedAt: "desc" },
          take: 10,
        },
      },
      orderBy: { name: "asc" },
      take: 300,
    });
  } catch (error) {
    envStatus.databaseAvailable = false;
    databaseWarning = error?.message || "Database is unavailable.";
    businesses = [];
  }

  const businessesByName = new Map(businesses.map((business) => [normalizeForKey(business.name || ""), business]).filter(([key]) => Boolean(key)));
  const businessesByPhone = new Map(businesses.map((business) => [normalizePhoneForMatch(business.phone || ""), business]).filter(([key]) => Boolean(key)));

  const customers = [];
  const usedBusinessIds = new Set();

  for (const signup of signups) {
    const business =
      businessesByName.get(normalizeForKey(signup.businessName || "")) ||
      businessesByPhone.get(normalizePhoneForMatch(signup.businessPhone || "")) ||
      null;
    if (business?.id) usedBusinessIds.add(business.id);
    const customerId = getCustomerSetupId(signup, business || {});
    const overrides = await readCustomerSetupOverrides(customerId);
    const calls = business?.calls || [];
    const steps = CUSTOMER_SETUP_STEPS.map((definition) => {
      const derived = deriveCustomerSetupStep(definition.key, { signup, business, calls, envStatus });
      return {
        ...definition,
        ...applyCustomerSetupOverride(derived, overrides.steps?.[definition.key]),
      };
    });
    const rollup = getSetupRollup(steps);

    customers.push({
      id: customerId,
      businessId: business?.id || null,
      businessName: signup.businessName || business?.name || "Unnamed business",
      ownerName: signup.ownerName || "",
      ownerEmail: signup.ownerEmail || "",
      ownerPhone: signup.ownerPhone || business?.settings?.ownerPhone || "",
      businessPhone: signup.businessPhone || business?.phone || "",
      signedUpAt: signup.signedUpAt || signup.createdAt || null,
      status: signup.status || "signup_received",
      subscriptionStatus: signup.subscriptionStatus || signup.paymentStatus || signup.checkoutStatus || "",
      twilioPhoneNumber: signup.twilioPhoneNumber || "",
      aiNumbers: (business?.vapiMappings || [])
        .filter((mapping) => String(mapping.matchType || "").toLowerCase().includes("phone"))
        .map((mapping) => mapping.matchValue),
      callCount: calls.length,
      lastCallAt: calls[0]?.startedAt || null,
      steps,
      ...rollup,
    });
  }

  for (const business of businesses) {
    if (usedBusinessIds.has(business.id)) continue;
    const signup = { businessName: business.name, businessPhone: business.phone };
    const customerId = getCustomerSetupId(signup, business);
    const overrides = await readCustomerSetupOverrides(customerId);
    const calls = business.calls || [];
    const steps = CUSTOMER_SETUP_STEPS.map((definition) => {
      const derived = deriveCustomerSetupStep(definition.key, { signup, business, calls, envStatus });
      return {
        ...definition,
        ...applyCustomerSetupOverride(derived, overrides.steps?.[definition.key]),
      };
    });
    const rollup = getSetupRollup(steps);
    customers.push({
      id: customerId,
      businessId: business.id,
      businessName: business.name,
      ownerName: "",
      ownerEmail: "",
      ownerPhone: business.settings?.ownerPhone || "",
      businessPhone: business.phone || "",
      signedUpAt: business.createdAt || null,
      status: "business_exists",
      subscriptionStatus: "",
      twilioPhoneNumber: "",
      aiNumbers: (business.vapiMappings || [])
        .filter((mapping) => String(mapping.matchType || "").toLowerCase().includes("phone"))
        .map((mapping) => mapping.matchValue),
      callCount: calls.length,
      lastCallAt: calls[0]?.startedAt || null,
      steps,
      ...rollup,
    });
  }

  const summary = customers.reduce(
    (acc, customer) => {
      acc.total += 1;
      acc[customer.overallStatus] = (acc[customer.overallStatus] || 0) + 1;
      return acc;
    },
    { total: 0, ready: 0, blocked: 0, manual: 0, waiting: 0 }
  );

  return {
    customers: customers.sort((a, b) => Number(new Date(b.signedUpAt || 0)) - Number(new Date(a.signedUpAt || 0))),
    summary,
    warnings: [
      databaseWarning ? "Database is unavailable, so setup rows may be incomplete." : "",
      !envStatus.stripeConfigured ? "Stripe is not configured." : "",
      !envStatus.vapiApiKeyConfigured ? "Vapi API key is not configured." : "",
      !envStatus.twilioConfigured ? "Twilio credentials are not configured." : "",
    ].filter(Boolean),
    env: envStatus,
  };
}

async function getAdminOpsOverview() {
  const signups = listSignupDashboardRecords();
  const signupByBusiness = new Map(
    signups
      .map((signup) => [normalizeForKey(signup.businessName || ""), signup])
      .filter(([key]) => Boolean(key))
  );
  const syncStore = readVapiCallSyncStore();
  const syncRows = Object.values(syncStore).filter(Boolean);
  const latestSyncByBusiness = new Map();

  for (const row of syncRows) {
    const businessId = Number(row.businessId || 0);
    if (!businessId) continue;
    const current = latestSyncByBusiness.get(businessId) || { count: 0, lastSyncedAt: null };
    const syncedAt = row.syncedAt || null;
    latestSyncByBusiness.set(businessId, {
      count: current.count + 1,
      lastSyncedAt:
        syncedAt && (!current.lastSyncedAt || new Date(syncedAt).getTime() > new Date(current.lastSyncedAt).getTime())
          ? syncedAt
          : current.lastSyncedAt,
    });
  }

  let databaseWarning = "";
  let businesses = [];
  try {
    businesses = await withTimeout(
      prisma.business.findMany({
        include: {
          settings: true,
          vapiMappings: { orderBy: { updatedAt: "desc" } },
          calls: {
            include: { caller: true },
            orderBy: { startedAt: "desc" },
            take: 25,
          },
        },
        orderBy: { name: "asc" },
        take: 300,
      }),
      8000,
      "Database did not respond while loading businesses."
    );
  } catch (error) {
    const rawMessage = error?.message || "";
    databaseWarning = /localhost:5432|database server|findMany|prisma/i.test(rawMessage)
      ? "Database is unavailable. Start Postgres locally or point DATABASE_URL at the live database."
      : rawMessage || "Database is unavailable.";
    console.warn("[admin:ops-overview] database unavailable", { message: databaseWarning });
    businesses = [];
  }

  const ownerRows = businesses.map((business) => {
    const signup = signupByBusiness.get(normalizeForKey(business.name || "")) || null;
    const calls = business.calls || [];
    const recentCalls = calls.slice(0, 5).map(sanitizeAdminCall);
    const vapiMappings = business.vapiMappings || [];
    const phoneMappings = vapiMappings.filter((mapping) => String(mapping.matchType || "").toLowerCase().includes("phone"));
    const syncInfo = latestSyncByBusiness.get(business.id) || { count: 0, lastSyncedAt: null };
    const missedCalls = calls.filter((call) => ["MISSED", "ABANDONED", "FAILED"].includes(call.status)).length;
    const followUps = calls.filter((call) => call.followUpNeeded || ["FOLLOW_UP", "QUOTE_NEEDED", "EMERGENCY"].includes(call.outcome)).length;

    return {
      businessId: business.id,
      businessName: business.name,
      businessPhone: signup?.businessPhone || business.phone || "",
      ownerName: signup?.ownerName || "",
      ownerEmail: signup?.ownerEmail || "",
      ownerPhone: business.settings?.ownerPhone || signup?.ownerPhone || "",
      aiNumbers: phoneMappings.map((mapping) => mapping.matchValue),
      settings: business.settings,
      vapiMappings,
      recentCalls,
      stats: {
        recentCallWindow: calls.length,
        missedCalls,
        followUps,
        completedCalls: calls.filter((call) => call.status === "COMPLETED").length,
        lastCallAt: calls[0]?.startedAt || null,
        syncedCallCount: syncInfo.count,
        lastSyncedAt: syncInfo.lastSyncedAt,
      },
      signup,
      needsSetup: !business.settings?.ownerPhone || !vapiMappings.length || !syncInfo.count,
    };
  });

  const envStatus = {
    databaseAvailable: !databaseWarning,
    vapiApiKeyConfigured: Boolean(VAPI_API_KEY),
    vapiAutoSyncEnabled: Boolean(VAPI_AUTO_SYNC_ENABLED),
    vapiAutoSyncIntervalMs: VAPI_AUTO_SYNC_INTERVAL_MS,
    vapiDefaultBusinessId: VAPI_DEFAULT_BUSINESS_ID,
    vapiBusinessMapEntries: Object.keys(parseVapiBusinessMap()).length,
    twilioConfigured: Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN),
    stripeConfigured: Boolean(stripe && STRIPE_PRICE_ID),
    exposeCallTranscriptsInAdmin: EXPOSE_CALL_TRANSCRIPTS_IN_ADMIN,
    exposeRecordingUrlsInAdmin: EXPOSE_RECORDING_URLS_IN_ADMIN,
    missedCallAlertsEnabled: MISSED_CALL_ALERT_ENABLED,
    dailyDigestEnabled: DAILY_DIGEST_ENABLED,
    adminPasswordLooksDefault: !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === "change-me",
  };

  const warnings = [];
  if (databaseWarning) warnings.push(databaseWarning);
  if (!envStatus.vapiApiKeyConfigured) warnings.push("VAPI_API_KEY is not configured, so live Vapi call sync cannot run.");
  if (!envStatus.twilioConfigured) warnings.push("Twilio credentials are not configured, so per-call Twilio cost sync cannot run.");
  if (!envStatus.stripeConfigured) warnings.push("Stripe checkout is not configured, so customers cannot start paid checkout yet.");
  if (!envStatus.vapiAutoSyncEnabled) warnings.push("VAPI_AUTO_SYNC_ENABLED is off; calls only sync when an admin presses Sync Vapi Calls.");
  if (!ownerRows.length) warnings.push("No businesses exist in the database yet.");
  if (ownerRows.length && !ownerRows.some((row) => row.vapiMappings.length)) warnings.push("No Vapi mappings exist yet, so calls may fall back to the default business.");
  if (envStatus.adminPasswordLooksDefault) warnings.push("ADMIN_PASSWORD is missing or still set to the default placeholder.");

  return {
    owners: ownerRows,
    sync: {
      env: envStatus,
      warnings,
      syncStoreCount: syncRows.length,
      mappedBusinessCount: ownerRows.filter((row) => row.vapiMappings.length).length,
      businessesWithSyncedCalls: ownerRows.filter((row) => row.stats.syncedCallCount > 0).length,
      lastSyncedAt: syncRows
        .map((row) => row.syncedAt)
        .filter(Boolean)
        .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null,
    },
  };
}

async function markMissedCallAlerts() {
  if (!MISSED_CALL_ALERT_ENABLED) return { sent: 0, skipped: true };
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const calls = await prisma.call.findMany({
    where: {
      status: { in: ["MISSED", "FAILED", "ABANDONED"] },
      startedAt: { gte: cutoff },
      lastAlertAt: null,
    },
    include: { business: { include: { settings: true } }, caller: true },
    take: 100,
  });
  let sent = 0;
  for (const call of calls) {
    console.warn("[missed-call-alert]", {
      business: call.business?.name,
      caller: call.caller?.phone,
      startedAt: call.startedAt,
      status: call.status,
      ownerPhone: call.business?.settings?.ownerPhone || null,
    });
    await prisma.call.update({ where: { id: call.id }, data: { lastAlertAt: new Date(), followUpNeeded: true } });
    sent += 1;
  }
  return { sent };
}

async function buildDailyDigest({ days = 1 } = {}) {
  const { start, end } = getDateRange(days);
  const analytics = await getCompanyCallAnalytics({ days });
  const followUps = await prisma.call.findMany({
    where: {
      startedAt: { gte: start, lte: end },
      OR: [{ followUpNeeded: true }, { outcome: { in: ["FOLLOW_UP", "QUOTE_NEEDED", "EMERGENCY"] } }],
    },
    include: { business: true, caller: true },
    orderBy: { startedAt: "desc" },
    take: 100,
  });
  return {
    from: start.toISOString(),
    to: end.toISOString(),
    analytics,
    followUps: followUps.map(sanitizeAdminCall),
  };
}

async function sendDailyDigest() {
  if (!DAILY_DIGEST_ENABLED) return { sent: false, skipped: true };
  const digest = await buildDailyDigest({ days: 1 });
  console.log("[daily-owner-digest]", JSON.stringify(digest, null, 2));
  return { sent: true, digest };
}

function getSignupDashboardKey(record = {}) {
  const subscriptionId = String(record.subscriptionId || "").trim();
  if (subscriptionId) return `sub:${subscriptionId}`;
  const ownerEmail = String(record.ownerEmail || "").trim().toLowerCase();
  if (ownerEmail) return `email:${ownerEmail}`;
  const checkoutSessionId = String(record.checkoutSessionId || "").trim();
  if (checkoutSessionId) return `checkout:${checkoutSessionId}`;
  return `signup:${crypto.randomUUID()}`;
}

function getSignupAliases(record = {}) {
  return [
    record.subscriptionId ? `sub:${String(record.subscriptionId).trim()}` : "",
    record.ownerEmail ? `email:${String(record.ownerEmail).trim().toLowerCase()}` : "",
    record.checkoutSessionId ? `checkout:${String(record.checkoutSessionId).trim()}` : "",
  ].filter(Boolean);
}

function upsertSignupDashboardRecord(record) {
  if (!record || typeof record !== "object") return null;
  const store = readSignupDashboardStore();
  const aliases = getSignupAliases(record);
  const existingKey = aliases.find((alias) => store[alias]) || getSignupDashboardKey(record);
  const existing = store[existingKey] || {};
  const signedUpAt = existing.signedUpAt || record.signedUpAt || record.createdAt || new Date().toISOString();
  const merged = compactObject({
    ...existing,
    ...record,
    signedUpAt,
    createdAt: existing.createdAt || record.createdAt || signedUpAt,
    updatedAt: new Date().toISOString(),
  });

  store[existingKey] = merged;
  for (const alias of aliases) {
    if (alias !== existingKey) delete store[alias];
  }
  writeSignupDashboardStore(store);
  return merged;
}

function upsertSignupDashboardFromPayload(payload, extra = {}) {
  const business = payload?.business || {};
  const owner = payload?.owner || {};
  return upsertSignupDashboardRecord({
    ownerName: String(owner.name || extra.ownerName || "").trim(),
    ownerEmail: String(owner.email || extra.ownerEmail || "").trim(),
    ownerPhone: String(owner.phone || extra.ownerPhone || "").trim(),
    businessName: String(business.name || extra.businessName || "").trim(),
    businessPhone: String(business.phone || "").trim(),
    businessAddress: String(business.address || "").trim(),
    businessWebsite: String(business.website || "").trim(),
    country: payload?.source?.country || "",
    signedUpAt: payload?.submittedAt || extra.signedUpAt || new Date().toISOString(),
    emailVerified: Boolean(payload?.verification?.emailVerified),
    smsVerified: Boolean(payload?.verification?.smsVerified),
    status: extra.status || "signup_received",
    reviewRequired: Boolean(extra.reviewRequired || payload?.security?.reviewRequired),
    reviewReasons: extra.reviewReasons || payload?.security?.reviewReasons || [],
    ...extra,
  });
}

function getUnixMs(value) {
  const n = Number(value || 0);
  return n ? n * 1000 : null;
}

function getSubscriptionPeriodEndMs(subscription) {
  return getUnixMs(subscription?.trial_end) || getUnixMs(subscription?.current_period_end) || null;
}

function upsertSignupDashboardFromCheckoutSession(session, extra = {}) {
  const metadata = session?.metadata || {};
  const details = session?.customer_details || {};
  return upsertSignupDashboardRecord({
    checkoutSessionId: session?.id || "",
    subscriptionId: typeof session?.subscription === "string" ? session.subscription : session?.subscription?.id || "",
    customerId: typeof session?.customer === "string" ? session.customer : session?.customer?.id || "",
    ownerEmail: String(details.email || session?.customer_email || metadata.ownerEmail || extra.ownerEmail || "").trim(),
    ownerName: String(details.name || metadata.ownerName || extra.ownerName || "").trim(),
    ownerPhone: String(metadata.ownerPhone || extra.ownerPhone || "").trim(),
    businessName: String(metadata.businessName || extra.businessName || "").trim(),
    checkoutStatus: session?.status || "",
    paymentStatus: session?.payment_status || "",
    checkoutCreatedAt: session?.created ? new Date(Number(session.created) * 1000).toISOString() : new Date().toISOString(),
    status: extra.status || (session?.payment_status === "paid" ? "subscription_started" : "checkout_started"),
    ...extra,
  });
}

function upsertSignupDashboardFromSubscription(subscription, extra = {}) {
  const metadata = subscription?.metadata || {};
  const periodStartMs = getUnixMs(subscription?.trial_start) || getUnixMs(subscription?.current_period_start);
  const periodEndMs = getSubscriptionPeriodEndMs(subscription);
  return upsertSignupDashboardRecord({
    subscriptionId: subscription?.id || "",
    customerId: typeof subscription?.customer === "string" ? subscription.customer : subscription?.customer?.id || "",
    ownerEmail: String(extra.ownerEmail || metadata.ownerEmail || metadata.email || subscription?.customer_email || "").trim(),
    ownerName: String(extra.ownerName || metadata.ownerName || "").trim(),
    ownerPhone: String(extra.ownerPhone || metadata.ownerPhone || "").trim(),
    businessName: String(extra.businessName || metadata.businessName || "").trim(),
    subscriptionStatus: subscription?.status || "",
    trialStartAt: getUnixMs(subscription?.trial_start),
    trialEndAt: getUnixMs(subscription?.trial_end),
    currentPeriodStartAt: getUnixMs(subscription?.current_period_start),
    currentPeriodEndAt: getUnixMs(subscription?.current_period_end),
    periodStartAt: periodStartMs,
    periodEndAt: periodEndMs,
    cancelAt: getUnixMs(subscription?.cancel_at),
    canceledAt: getUnixMs(subscription?.canceled_at),
    status: extra.status || (subscription?.status ? `subscription_${subscription.status}` : "subscription_updated"),
    ...extra,
  });
}

function getSignupExpiryStatus(record) {
  const now = Date.now();
  const start = Number(record.trialStartAt || record.currentPeriodStartAt || record.periodStartAt || 0);
  const end = Number(record.trialEndAt || record.currentPeriodEndAt || record.periodEndAt || 0);

  if (!end) {
    return { color: "unknown", label: "No end date", daysRemaining: null, percentUsed: null };
  }

  const daysRemaining = Math.ceil((end - now) / (24 * 60 * 60 * 1000));
  if (end <= now) {
    return { color: "red", label: "Expired", daysRemaining, percentUsed: 100 };
  }

  const effectiveStart = start && start < end ? start : Number(new Date(record.signedUpAt || record.createdAt || now).getTime());
  const duration = Math.max(1, end - effectiveStart);
  const percentUsed = Math.max(0, Math.min(100, Math.round(((now - effectiveStart) / duration) * 100)));
  const closeWindowMs = Math.max(2 * 24 * 60 * 60 * 1000, duration * 0.2);

  if (end - now <= closeWindowMs || percentUsed >= 80) {
    return { color: "red", label: "Close to end", daysRemaining, percentUsed };
  }
  if (percentUsed >= 50) {
    return { color: "yellow", label: "Past halfway", daysRemaining, percentUsed };
  }
  return { color: "green", label: "Before halfway", daysRemaining, percentUsed };
}

function listSignupDashboardRecords() {
  const reminderStore = readTrialReminderStore();

  for (const reminder of Object.values(reminderStore)) {
    if (!reminder?.subscriptionId) continue;
    upsertSignupDashboardRecord({
      subscriptionId: reminder.subscriptionId,
      customerId: reminder.customerId || "",
      ownerEmail: reminder.ownerEmail || "",
      ownerName: reminder.ownerName || "",
      businessName: reminder.businessName || "",
      trialStartAt: reminder.trialStartAt || null,
      trialEndAt: reminder.trialEndAt || null,
      periodStartAt: reminder.trialStartAt || null,
      periodEndAt: reminder.trialEndAt || null,
      trialReminderStatus: reminder.status || "",
      trialReminderDueAt: reminder.dueAt || null,
      trialReminderSentAt: reminder.sentAt || null,
      status: reminder.status === "cancelled" ? "subscription_cancelled" : "trial_reminder_scheduled",
    });
  }

  const freshStore = readSignupDashboardStore();
  return Object.values(freshStore)
    .filter(Boolean)
    .map((record) => ({
      ...record,
      expiry: getSignupExpiryStatus(record),
    }))
    .sort((a, b) => Number(new Date(b.signedUpAt || b.createdAt || 0)) - Number(new Date(a.signedUpAt || a.createdAt || 0)));
}

function sanitizeCustomerCall(call) {
  return {
    id: call.id,
    startedAt: call.startedAt,
    durationSec: call.durationSec,
    status: call.status,
    outcome: call.outcome,
    aiSummary: call.aiSummary || (call.transcript ? "Call summary is being prepared." : ""),
    followUpNeeded: Boolean(call.followUpNeeded || ["FOLLOW_UP", "QUOTE_NEEDED", "EMERGENCY"].includes(call.outcome)),
    caller: {
      phone: call.caller?.phone || "",
      name: call.caller?.name || "",
    },
  };
}

async function getCustomerDashboard({ email, phone }) {
  const ownerEmail = String(email || "").trim().toLowerCase();
  const phoneMatch = normalizePhoneForMatch(phone);
  if (!ownerEmail || !isValidEmailAddress(ownerEmail) || !phoneMatch) return null;

  const signup = listSignupDashboardRecords().find((record) => {
    const recordEmail = String(record.ownerEmail || "").trim().toLowerCase();
    if (recordEmail !== ownerEmail) return false;
    const phones = [record.ownerPhone, record.businessPhone].map(normalizePhoneForMatch).filter(Boolean);
    return phones.includes(phoneMatch);
  });

  if (!signup) return null;

  const businessName = String(signup.businessName || "").trim();
  const businessPhone = normalizePhoneForMatch(signup.businessPhone || "");
  const businessLookup = [
    businessName ? { name: { equals: businessName, mode: "insensitive" } } : undefined,
    businessPhone ? { phone: businessPhone } : undefined,
  ].filter(Boolean);
  const business = businessLookup.length
    ? await prisma.business.findFirst({
        where: { OR: businessLookup },
        include: {
          settings: true,
          vapiMappings: true,
          faqs: { orderBy: { updatedAt: "desc" }, take: 6 },
          calls: {
            include: { caller: true },
            orderBy: { startedAt: "desc" },
            take: 50,
          },
        },
      })
    : null;

  const calls = business?.calls || [];
  const completedCalls = calls.filter((call) => call.status === "COMPLETED").length;
  const missedCalls = calls.filter((call) => ["MISSED", "ABANDONED", "FAILED"].includes(call.status)).length;
  const followUps = calls.filter((call) => call.followUpNeeded || ["FOLLOW_UP", "QUOTE_NEEDED", "EMERGENCY"].includes(call.outcome)).length;
  const bookedCalls = calls.filter((call) => call.outcome === "BOOKED").length;
  const billingChecklist = getBillingReadinessForSignup(signup);
  const setupChecklist = [
    ...billingChecklist,
    { key: "owner-phone", label: "Owner phone added", done: Boolean(business?.settings?.ownerPhone || signup.ownerPhone) },
    { key: "ai-number", label: "AI number mapped", done: Boolean(signup.twilioPhoneNumber || business?.vapiMappings?.length) },
    { key: "faq", label: "Starter FAQs added", done: Boolean(business?.faqs?.length) },
  ];

  return {
    signup: {
      businessName: signup.businessName || business?.name || "Your business",
      ownerName: signup.ownerName || "",
      ownerEmail: signup.ownerEmail || "",
      ownerPhone: signup.ownerPhone || business?.settings?.ownerPhone || "",
      businessPhone: signup.businessPhone || business?.phone || "",
      businessAddress: signup.businessAddress || "",
      status: signup.status || "signup_received",
      signedUpAt: signup.signedUpAt || signup.createdAt || "",
      trialEndAt: signup.trialEndAt || signup.currentPeriodEndAt || signup.periodEndAt || null,
      subscriptionStatus: signup.subscriptionStatus || signup.checkoutStatus || signup.paymentStatus || "",
      twilioPhoneNumber: signup.twilioPhoneNumber || "",
      reviewRequired: Boolean(signup.reviewRequired),
      emailVerificationRequired: Boolean(signup.emailVerificationRequired),
      emailVerified: Boolean(signup.emailVerified),
    },
    assistant: {
      aiNumber: signup.twilioPhoneNumber || business?.vapiMappings?.find((mapping) => /phone/i.test(mapping.matchType))?.matchValue || "",
      answerAfterRings: business?.settings?.answerAfterRings ?? 3,
      afterHoursMode: business?.settings?.afterHoursMode || "AI_ALWAYS_ON",
      bookingLink: business?.settings?.bookingLink || "",
      mappedNumbers: (business?.vapiMappings || []).map((mapping) => ({
        type: mapping.matchType,
        value: mapping.matchValue,
        label: mapping.label || "",
      })),
    },
    stats: {
      totalCalls: calls.length,
      completedCalls,
      missedCalls,
      followUps,
      bookedCalls,
      averageDurationSec: calls.length ? Math.round(calls.reduce((sum, call) => sum + Number(call.durationSec || 0), 0) / calls.length) : 0,
      lastCallAt: calls[0]?.startedAt || null,
    },
    setup: {
      checklist: setupChecklist,
      readinessPercent: Math.round((setupChecklist.filter((item) => item.done).length / setupChecklist.length) * 100),
    },
    recentCalls: calls.slice(0, 8).map(sanitizeCustomerCall),
    faqs: (business?.faqs || []).map((faq) => ({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      tags: faq.tags,
      updatedAt: faq.updatedAt,
    })),
  };
}

function getTrialReminderDueAt(subscription) {
  const trialStartMs = Number(subscription?.trial_start || 0) * 1000;
  const trialEndMs = Number(subscription?.trial_end || 0) * 1000;
  if (!trialEndMs) return 0;

  const dueAt = trialStartMs
    ? trialStartMs + TRIAL_HALFWAY_REMINDER_DAYS * 24 * 60 * 60 * 1000
    : Date.now() + TRIAL_HALFWAY_REMINDER_DAYS * 24 * 60 * 60 * 1000;

  return Math.min(dueAt, trialEndMs);
}

function upsertTrialReminder(record) {
  if (!record?.subscriptionId || !record?.ownerEmail || !record?.dueAt) return;
  const store = readTrialReminderStore();
  const existing = store[record.subscriptionId] || {};

  store[record.subscriptionId] = {
    ...existing,
    ...record,
    status: existing.sentAt ? "sent" : record.status || "scheduled",
    updatedAt: new Date().toISOString(),
  };

  writeTrialReminderStore(store);
}

async function scheduleTrialReminderFromCheckoutSession(session) {
  const subscriptionId = typeof session?.subscription === "string"
    ? session.subscription
    : session?.subscription?.id;
  if (!subscriptionId || !stripe) return;

  let subscription = null;
  try {
    subscription = await stripe.subscriptions.retrieve(subscriptionId);
  } catch (error) {
    console.error("[stripe:trial-reminder] could not retrieve subscription", {
      subscriptionId,
      message: error?.message || String(error),
    });
    return;
  }

  scheduleTrialReminderFromSubscription(subscription, {
    ownerEmail: String(session?.customer_details?.email || session?.customer_email || "").trim(),
    businessName: String(session?.metadata?.businessName || "").trim(),
    ownerName: String(session?.metadata?.ownerName || "").trim(),
  });
}

function scheduleTrialReminderFromSubscription(subscription, fallback = {}) {
  if (!subscription?.id || !subscription?.trial_end) return;
  if (subscription.status && !["trialing", "active"].includes(String(subscription.status))) return;

  const dueAt = getTrialReminderDueAt(subscription);
  const trialEndAt = Number(subscription.trial_end || 0) * 1000;
  const metadata = subscription.metadata || {};
  const ownerEmail = String(
    fallback.ownerEmail ||
      metadata.ownerEmail ||
      metadata.email ||
      subscription.customer_email ||
      ""
  ).trim();

  if (!ownerEmail || !isValidEmailAddress(ownerEmail)) {
    console.warn("[stripe:trial-reminder] subscription has no owner email", {
      subscriptionId: subscription.id,
      customer: subscription.customer || null,
    });
    return;
  }

  upsertTrialReminder({
    subscriptionId: subscription.id,
    customerId: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || "",
    ownerEmail,
    ownerName: String(fallback.ownerName || metadata.ownerName || "").trim(),
    businessName: String(fallback.businessName || metadata.businessName || "").trim(),
    dueAt,
    trialEndAt,
    trialStartAt: Number(subscription.trial_start || 0) * 1000 || null,
    status: "scheduled",
    createdAt: new Date().toISOString(),
  });
}

function markTrialReminderCancelled(subscriptionId) {
  if (!subscriptionId) return;
  const store = readTrialReminderStore();
  if (!store[subscriptionId]) return;
  store[subscriptionId] = {
    ...store[subscriptionId],
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeTrialReminderStore(store);
}

async function sendTrialHalfwayReminder(record) {
  const emailConfig = getEmailTransportConfig();
  const businessName = record.businessName || "your My AI PA account";
  const ownerName = record.ownerName || "there";
  const trialEndDate = record.trialEndAt
    ? new Date(record.trialEndAt).toLocaleDateString("en-CA", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : "soon";
  const subject = `Your My AI PA free trial is halfway done`;
  const text = [
    `Hi ${ownerName},`,
    "",
    `Your 14-day My AI PA free trial for ${businessName} is halfway done.`,
    `Your trial is scheduled to end on ${trialEndDate}.`,
    "",
    "This is a good time to test your assistant, place a sample call, and make sure your missed-call forwarding is ready.",
    "",
    "Thanks,",
    "My AI PA",
  ].join("\n");
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:640px">
      <p style="font-size:13px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#2563eb">Trial reminder</p>
      <h1 style="font-size:30px;line-height:1.1;margin:0 0 16px">Your free trial is halfway done</h1>
      <p>Hi ${escapeHtml(ownerName)},</p>
      <p>Your 14-day My AI PA free trial for <strong>${escapeHtml(businessName)}</strong> is halfway done.</p>
      <p>Your trial is scheduled to end on <strong>${escapeHtml(trialEndDate)}</strong>.</p>
      <p>This is a good time to test your assistant, place a sample call, and make sure your missed-call forwarding is ready.</p>
      <p style="font-size:14px;color:#475569">Card details and billing are handled securely by Stripe.</p>
    </div>
  `;

  if (!emailConfig) {
    if (process.env.NODE_ENV !== "production" || isEnabled(process.env.EMAIL_VERIFICATION_DEV_MODE)) {
      console.warn("[stripe:trial-reminder] SMTP is not configured. Dev reminder email:", {
        to: record.ownerEmail,
        subject,
        text,
      });
      return { sent: false, devOnly: true };
    }
    const err = new Error("SMTP is not configured for trial reminders.");
    err.statusCode = 500;
    throw err;
  }

  const transporter = nodemailer.createTransport(emailConfig.transport);
  await transporter.sendMail({
    from: emailConfig.from,
    to: record.ownerEmail,
    subject,
    text,
    html,
  });

  return { sent: true };
}

async function processTrialReminders() {
  if (isEnabled(process.env.TRIAL_REMINDER_DISABLE)) return;

  const now = Date.now();
  const store = readTrialReminderStore();
  let changed = false;

  for (const [subscriptionId, record] of Object.entries(store)) {
    if (!record || record.status === "sent" || record.status === "cancelled") continue;
    if (Number(record.dueAt || 0) > now) continue;
    if (record.trialEndAt && Number(record.trialEndAt) <= now) {
      store[subscriptionId] = {
        ...record,
        status: "expired",
        updatedAt: new Date().toISOString(),
      };
      changed = true;
      continue;
    }

    try {
      await sendTrialHalfwayReminder(record);
      store[subscriptionId] = {
        ...record,
        status: "sent",
        sentAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      changed = true;
    } catch (error) {
      store[subscriptionId] = {
        ...record,
        status: "error",
        lastError: error?.message || String(error),
        lastAttemptAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      changed = true;
      console.error("[stripe:trial-reminder] reminder send failed", {
        subscriptionId,
        message: error?.message || String(error),
      });
    }
  }

  if (changed) writeTrialReminderStore(store);
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isValidEmailAddress(value) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isEnabled(value) {
  return /^(1|true|yes|on)$/i.test(String(value || ""));
}

function isLocalPageUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return /^(localhost|127\.0\.0\.1)$/.test(url.hostname);
  } catch {
    return false;
  }
}

function normalizeForKey(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function hashKey(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 32);
}

function getClientIp(req) {
  const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || req.socket?.remoteAddress || req.ip || "unknown";
}

function checkWindowLimit(store, key, maxRequests, windowMs) {
  const now = Date.now();
  const record = store.get(key);
  if (!record || record.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: Math.max(0, maxRequests - 1) };
  }

  record.count += 1;
  store.set(key, record);
  return {
    allowed: record.count <= maxRequests,
    remaining: Math.max(0, maxRequests - record.count),
    retryAfterMs: Math.max(0, record.resetAt - now),
  };
}

function rememberDuplicateSignup(key) {
  const now = Date.now();
  const previous = signupDuplicateSubmissions.get(key);
  signupDuplicateSubmissions.set(key, now + SIGNUP_DUPLICATE_WINDOW_MS);
  for (const [storedKey, expiresAt] of signupDuplicateSubmissions.entries()) {
    if (expiresAt <= now) signupDuplicateSubmissions.delete(storedKey);
  }
  return Boolean(previous && previous > now);
}

async function verifyTurnstileToken(token, ip) {
  const secret = String(process.env.TURNSTILE_SECRET_KEY || "").trim();
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: "missing_captcha" };

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip && ip !== "unknown") body.set("remoteip", ip);

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: Boolean(data?.success), reason: data?.["error-codes"]?.join(",") || "" };
  } catch (error) {
    console.error("[signup:security] captcha verification failed", { message: error?.message || String(error) });
    return { ok: false, reason: "captcha_unreachable" };
  }
}

async function verifyRecaptchaToken(token, ip, options = {}) {
  const secret = options.useTestSecret
    ? GOOGLE_RECAPTCHA_TEST_SECRET_KEY
    : String(process.env.RECAPTCHA_SECRET_KEY || process.env.GOOGLE_RECAPTCHA_SECRET_KEY || "").trim();
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, reason: "missing_captcha" };

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (ip && ip !== "unknown") body.set("remoteip", ip);

  try {
    const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      body,
    });
    const data = await response.json().catch(() => ({}));
    return { ok: Boolean(data?.success), reason: data?.["error-codes"]?.join(",") || "" };
  } catch (error) {
    console.error("[signup:security] recaptcha verification failed", { message: error?.message || String(error) });
    return { ok: false, reason: "captcha_unreachable" };
  }
}

async function verifySignupCaptcha(security, ip) {
  const provider = String(security.captchaProvider || "").trim().toLowerCase();
  const genericToken = String(security.captchaToken || "").trim();
  const recaptchaToken = String(security.recaptchaToken || "").trim();
  const turnstileToken = String(security.turnstileToken || "").trim();
  const useLocalRecaptchaTestKey = isLocalPageUrl(security.pageUrl);

  if (provider === "recaptcha" || recaptchaToken) {
    return verifyRecaptchaToken(recaptchaToken || genericToken, ip, { useTestSecret: useLocalRecaptchaTestKey });
  }

  if (provider === "turnstile" || turnstileToken) {
    return verifyTurnstileToken(turnstileToken || genericToken, ip);
  }

  if (process.env.RECAPTCHA_SECRET_KEY || process.env.GOOGLE_RECAPTCHA_SECRET_KEY) {
    return verifyRecaptchaToken(genericToken, ip, { useTestSecret: useLocalRecaptchaTestKey });
  }

  return verifyTurnstileToken(genericToken, ip);
}

async function getSignupSecurityDecision(req, body, fields) {
  const security = body.security || {};
  const ip = getClientIp(req);
  const reasons = [];
  const reviewReasons = [];

  if (String(security.companyWebsite || "").trim()) {
    reasons.push("bot_trap_filled");
  }

  const elapsedMs = Number(security.clientElapsedMs || 0);
  if (elapsedMs > 0 && elapsedMs < SIGNUP_MIN_ELAPSED_MS) {
    reviewReasons.push("submitted_too_fast");
  }

  const captcha = await verifySignupCaptcha(security, ip);
  if (!captcha.ok) {
    reasons.push(captcha.reason || "captcha_failed");
  }

  const ipLimit = checkWindowLimit(signupIpRateLimit, hashKey(ip), SIGNUP_IP_MAX_REQUESTS, SIGNUP_IP_WINDOW_MS);
  if (!ipLimit.allowed) {
    reasons.push("ip_rate_limit");
  }

  const identityKey = hashKey([fields.ownerEmail, fields.ownerPhone, fields.businessName].map(normalizeForKey).join("|"));
  const identityLimit = checkWindowLimit(signupIdentityRateLimit, identityKey, SIGNUP_IDENTITY_MAX_REQUESTS, SIGNUP_IDENTITY_WINDOW_MS);
  if (!identityLimit.allowed) {
    reasons.push("identity_rate_limit");
  }

  const duplicateKey = hashKey([fields.ownerEmail, fields.ownerPhone, fields.businessName, fields.businessPhone].map(normalizeForKey).join("|"));
  if (rememberDuplicateSignup(duplicateKey) && isEnabled(process.env.SIGNUP_REVIEW_DUPLICATES)) {
    reviewReasons.push("duplicate_submission");
  }

  const disposableDomains = new Set(["mailinator.com", "tempmail.com", "10minutemail.com", "guerrillamail.com", "yopmail.com"]);
  const emailDomain = normalizeForKey(fields.ownerEmail.split("@")[1] || "");
  if (disposableDomains.has(emailDomain)) {
    reviewReasons.push("disposable_email");
  }

  if (!fields.ownerPhone || !fields.businessPhone || !fields.businessAddress) {
    reviewReasons.push("missing_contact_detail");
  }

  if (isEnabled(process.env.SIGNUP_REQUIRE_MANUAL_APPROVAL)) {
    reviewReasons.push("manual_approval_enabled");
  }

  return {
    ip,
    blocked: reasons.length > 0,
    reviewRequired: reviewReasons.length > 0,
    reasons,
    reviewReasons,
    captchaSkipped: Boolean(captcha.skipped),
  };
}

function compactObject(value) {
  if (Array.isArray(value)) {
    const items = value
      .map((item) => compactObject(item))
      .filter((item) => item != null && item !== "" && !(typeof item === "object" && !Array.isArray(item) && !Object.keys(item).length));
    return items.length ? items : undefined;
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).reduce((acc, [key, item]) => {
      const compacted = compactObject(item);
      if (compacted == null || compacted === "") return acc;
      if (typeof compacted === "object" && !Array.isArray(compacted) && !Object.keys(compacted).length) {
        return acc;
      }
      acc[key] = compacted;
      return acc;
    }, {});
    return Object.keys(entries).length ? entries : undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }

  return value == null ? undefined : value;
}

function parseJsonObject(rawText) {
  try {
    const data = rawText ? JSON.parse(rawText) : {};
    return data && typeof data === "object" ? data : {};
  } catch (_err) {
    return {};
  }
}

function getMakeSignupSuccess(data) {
  if (data?.success === false || data?.ok === false) return false;
  return data?.success === true || data?.ok === true || !Object.keys(data || {}).length;
}

function getMakeTwilioPhoneNumber(data) {
  return String(
    data?.twilioPhoneNumber ||
      data?.twilio_phone_number ||
      data?.phoneNumber ||
      data?.assignedPhoneNumber ||
      data?.assigned_number ||
      data?.number ||
      data?.data?.twilioPhoneNumber ||
      data?.data?.phoneNumber ||
      ""
  ).trim();
}

function getMakeTwilioPhoneNumberFromText(rawText) {
  const text = String(rawText || "");
  const fieldMatch = text.match(/"twilioPhoneNumber"\s*:\s*"([^"\r\n]+)/i);
  if (fieldMatch?.[1]) return fieldMatch[1].trim();

  const phoneMatch = text.match(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  return phoneMatch?.[0]?.trim() || "";
}

async function sendMakeSignupCompleted(payload) {
  const { url, apiKey } = getMakeSignupWebhookConfig();
  if (!url) {
    const err = new Error("MAKE_SIGNUP_WEBHOOK_URL is not configured on the backend.");
    err.statusCode = 500;
    throw err;
  }

  const headers = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["x-make-apikey"] = apiKey;
  }

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("[make:signup] webhook request failed", { message: error?.message || String(error) });
    const err = new Error("Make webhook could not be reached.");
    err.statusCode = 502;
    throw err;
  }

  const rawText = await response.text();
  if (!response.ok) {
    console.error("[make:signup] webhook rejected request", {
      status: response.status,
      body: rawText.slice(0, 500),
    });
    const err = new Error("Make webhook rejected the signup handoff.");
    err.statusCode = 502;
    throw err;
  }

  return {
    status: response.status,
    body: rawText,
    data: parseJsonObject(rawText),
  };
}

function requireAdmin(req, res, next) {
  try {
    if (hasValidAdminSession(req) || hasValidAdminPassword(req)) {
      return next();
    }
    return res.status(401).json({ error: "Invalid admin password." });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || "Admin authentication failed." });
  }
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function sanitizeAdminCall(call) {
  if (!call) return call;
  const transcript = typeof call.transcript === "string" ? call.transcript : null;
  const recordingUrl = typeof call.recordingUrl === "string" ? call.recordingUrl : null;
  return {
    ...call,
    transcript: EXPOSE_CALL_TRANSCRIPTS_IN_ADMIN ? transcript : null,
    transcriptAvailable: Boolean(transcript),
    transcriptProtected: Boolean(transcript) && !EXPOSE_CALL_TRANSCRIPTS_IN_ADMIN,
    recordingUrl: EXPOSE_RECORDING_URLS_IN_ADMIN ? recordingUrl : null,
    recordingAvailable: Boolean(recordingUrl),
    recordingProtected: Boolean(recordingUrl) && !EXPOSE_RECORDING_URLS_IN_ADMIN,
  };
}

function sanitizeAdminLead(lead) {
  if (!lead) return lead;
  return {
    ...lead,
    call: sanitizeAdminCall(lead.call),
  };
}

async function cleanupSensitiveCallData() {
  const jobs = [];
  const now = Date.now();

  if (CALL_TRANSCRIPT_RETENTION_DAYS > 0) {
    const cutoff = new Date(now - CALL_TRANSCRIPT_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    jobs.push(
      prisma.call.updateMany({
        where: {
          transcript: { not: null },
          startedAt: { lt: cutoff },
        },
        data: { transcript: null },
      }).then((result) => ({ key: "transcripts", count: result?.count || 0 }))
    );
  }

  if (CALL_RECORDING_RETENTION_DAYS > 0) {
    const cutoff = new Date(now - CALL_RECORDING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    jobs.push(
      prisma.call.updateMany({
        where: {
          recordingUrl: { not: null },
          startedAt: { lt: cutoff },
        },
        data: { recordingUrl: null },
      }).then((result) => ({ key: "recordings", count: result?.count || 0 }))
    );
  }

  if (!jobs.length) return;
  const results = await Promise.all(jobs);
  const transcriptResult = results.find((item) => item.key === "transcripts");
  const recordingResult = results.find((item) => item.key === "recordings");
  console.log("[call-data-cleanup]", {
    transcriptsCleared: transcriptResult?.count || 0,
    recordingUrlsCleared: recordingResult?.count || 0,
  });
}

function enforceAssistantRateLimit(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const existing = assistantRateLimit.get(ip) || [];
  const recent = existing.filter((ts) => now - ts < ASSISTANT_WINDOW_MS);

  if (recent.length >= ASSISTANT_MAX_REQUESTS_PER_WINDOW) {
    return res.status(429).json({
      error: "Too many assistant requests. Please wait a minute and try again.",
    });
  }

  recent.push(now);
  assistantRateLimit.set(ip, recent);

  // Lightweight cleanup to avoid unbounded growth.
  if (assistantRateLimit.size > 500) {
    for (const [key, timestamps] of assistantRateLimit.entries()) {
      const kept = timestamps.filter((ts) => now - ts < ASSISTANT_WINDOW_MS);
      if (kept.length === 0) assistantRateLimit.delete(key);
      else assistantRateLimit.set(key, kept);
    }
  }

  next();
}

function normalizeWebsiteUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, "")}`;
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    });
}

function cleanText(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim()
  );
}

function stripHtml(html) {
  return cleanText(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h1|h2|h3|h4|h5|h6)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function uniqueStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const cleaned = cleanText(value);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function extractEmails(text) {
  return uniqueStrings(
    (String(text || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).filter(
      (email) => !/\.(png|jpg|jpeg|gif|webp|svg)$/i.test(email)
    )
  );
}

function formatPhone(rawPhone) {
  const raw = cleanText(rawPhone);
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return "";
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 ${digits.slice(1, 4)}-${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return raw;
}

function extractPhones(text) {
  const matches = String(text || "").match(/(?:\+?\d[\d\s().-]{7,}\d)/g) || [];
  return uniqueStrings(matches.map(formatPhone).filter(Boolean));
}

function extractMetaDescription(html) {
  const metaMatch = String(html || "").match(
    /<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["'][^>]*>/i
  );
  return cleanText(metaMatch?.[1] || "");
}

function extractJsonLdBlocks(html) {
  const blocks = [];
  const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(String(html || "")))) {
    const raw = cleanText(match[1]);
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch (_error) {
      // Ignore malformed structured data blocks.
    }
  }
  return blocks;
}

function formatAddress(addressNode) {
  if (!addressNode || typeof addressNode !== "object") return "";
  const parts = [
    addressNode.streetAddress,
    addressNode.addressLocality,
    addressNode.addressRegion,
    addressNode.postalCode,
    addressNode.addressCountry,
  ];
  return uniqueStrings(parts).join(", ");
}

function formatOpeningHours(spec) {
  if (!spec || typeof spec !== "object") return "";
  const days = Array.isArray(spec.dayOfWeek) ? spec.dayOfWeek : [spec.dayOfWeek];
  const shortDays = days
    .filter(Boolean)
    .map((day) => String(day).split("/").pop())
    .map((day) => day.replace(/^https?:/i, ""))
    .map((day) => day.replace(/^\/+/, ""))
    .map((day) => day.replace(/^([A-Z])/, (m) => m.toUpperCase()));
  const opens = cleanText(spec.opens || "");
  const closes = cleanText(spec.closes || "");
  if (!shortDays.length && !opens && !closes) return "";
  return `${shortDays.join(", ")}${opens || closes ? ` ${opens}-${closes}` : ""}`.trim();
}

function collectStructuredData(node, collector) {
  if (!node) return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectStructuredData(item, collector));
    return;
  }
  if (typeof node !== "object") return;

  if (node.email) collector.emails.push(node.email);
  if (node.telephone) collector.phones.push(node.telephone);
  if (node.description && !collector.description) collector.description = cleanText(node.description);
  if (node.address && !collector.address) collector.address = formatAddress(node.address);
  if (node.openingHours && !collector.hours) {
    collector.hours = Array.isArray(node.openingHours) ? node.openingHours.join(" | ") : cleanText(node.openingHours);
  }
  if (node.openingHoursSpecification && !collector.hours) {
    const specs = Array.isArray(node.openingHoursSpecification) ? node.openingHoursSpecification : [node.openingHoursSpecification];
    collector.hours = uniqueStrings(specs.map(formatOpeningHours).filter(Boolean)).join(" | ");
  }
  if (!collector.ownerName) {
    const ownerCandidate = node.founder?.name || node.founders?.[0]?.name || node.employee?.name || node.contactPoint?.name;
    if (ownerCandidate) collector.ownerName = cleanText(ownerCandidate);
  }

  for (const value of Object.values(node)) {
    collectStructuredData(value, collector);
  }
}

function extractRelevantLinks(html, websiteUrl) {
  const links = [];
  const baseUrl = new URL(websiteUrl);
  const regex = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(String(html || "")))) {
    const href = cleanText(match[1]);
    const text = cleanText(match[2]);
    if (!href || href.startsWith("#") || /^mailto:|^tel:/i.test(href)) continue;
    const relevance = `${href} ${text}`.toLowerCase();
    if (!/(contact|about|service|services|hours|location|team|staff)/.test(relevance)) continue;
    try {
      const absolute = new URL(href, websiteUrl);
      if (absolute.origin !== baseUrl.origin) continue;
      links.push(absolute.toString());
    } catch (_error) {
      // Ignore invalid URLs.
    }
  }
  return uniqueStrings(links).slice(0, WEBSITE_MAX_EXTRA_PAGES);
}

function extractHoursFromText(text) {
  const lines = uniqueStrings(
    String(text || "")
      .split(/\n+/)
      .map(cleanText)
      .filter((line) => /(mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday|hours)/i.test(line))
      .filter((line) => line.length >= 8 && line.length <= 120)
  );
  return lines.slice(0, 3).join(" | ");
}

function extractOwnerNameFromText(text) {
  const match = String(text || "").match(
    /(?:owner|founder|president|ceo|director)\s*[:\-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/
  );
  return cleanText(match?.[1] || "");
}

function extractServicesFromHtml(html, fallbackDescription) {
  const candidates = [];
  const headingRegex = /<(h1|h2|h3|li|p)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = headingRegex.exec(String(html || "")))) {
    const text = cleanText(match[2]);
    if (!text || text.length < 8 || text.length > 120) continue;
    if (/(contact|about|home|blog|login|read more|privacy|terms)/i.test(text)) continue;
    if (/(service|services|repair|install|installation|maintenance|cleaning|inspection|emergency|quote|appointment|support)/i.test(text)) {
      candidates.push(text);
    }
  }
  const uniqueCandidates = uniqueStrings(candidates);
  if (uniqueCandidates.length) return uniqueCandidates.slice(0, 5).join(", ");
  return cleanText(fallbackDescription || "");
}

async function fetchWebsiteHtml(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEBSITE_FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "MyAIPA/1.0 Website Enrichment",
      },
    });
    if (!response.ok) {
      throw new Error(`Website request failed (${response.status})`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (!/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      return "";
    }
    const html = await response.text();
    return html.slice(0, WEBSITE_MAX_HTML_CHARS);
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractWebsiteProfileFromHtml(html) {
  const text = stripHtml(html);
  const structuredData = { emails: [], phones: [], address: "", hours: "", description: "", ownerName: "" };
  extractJsonLdBlocks(html).forEach((block) => collectStructuredData(block, structuredData));

  return {
    emails: uniqueStrings([...structuredData.emails, ...extractEmails(html), ...extractEmails(text)]),
    phones: uniqueStrings([...structuredData.phones, ...extractPhones(html), ...extractPhones(text)]),
    address: structuredData.address,
    hours: structuredData.hours || extractHoursFromText(text),
    description: structuredData.description || extractMetaDescription(html),
    ownerName: structuredData.ownerName || extractOwnerNameFromText(text),
    services: extractServicesFromHtml(html, structuredData.description || extractMetaDescription(html)),
  };
}

function mergeEnrichmentProfiles(profiles) {
  const merged = {
    emails: [],
    phones: [],
    address: "",
    hours: "",
    description: "",
    ownerName: "",
    services: "",
    sourceUrls: [],
  };

  for (const profile of profiles) {
    if (!profile) continue;
    merged.emails = uniqueStrings([...merged.emails, ...(profile.emails || [])]);
    merged.phones = uniqueStrings([...merged.phones, ...(profile.phones || [])]);
    if (!merged.address && profile.address) merged.address = profile.address;
    if (!merged.hours && profile.hours) merged.hours = profile.hours;
    if (!merged.description && profile.description) merged.description = profile.description;
    if (!merged.ownerName && profile.ownerName) merged.ownerName = profile.ownerName;
    if (!merged.services && profile.services) merged.services = profile.services;
    merged.sourceUrls = uniqueStrings([...merged.sourceUrls, ...(profile.sourceUrls || [])]);
  }

  return merged;
}

async function enrichBusinessFromWebsite({ website }) {
  const normalizedWebsite = normalizeWebsiteUrl(website);
  if (!normalizedWebsite) {
    return { emails: [], phones: [], address: "", hours: "", services: "", description: "", ownerName: "", sourceUrls: [] };
  }

  const homepageHtml = await fetchWebsiteHtml(normalizedWebsite);
  const homepageProfile = extractWebsiteProfileFromHtml(homepageHtml);
  const extraUrls = extractRelevantLinks(homepageHtml, normalizedWebsite);
  const extraProfiles = [];

  for (const url of extraUrls) {
    try {
      const html = await fetchWebsiteHtml(url);
      extraProfiles.push({ ...extractWebsiteProfileFromHtml(html), sourceUrls: [url] });
    } catch (_error) {
      // Ignore secondary page failures.
    }
  }

  return mergeEnrichmentProfiles([{ ...homepageProfile, sourceUrls: [normalizedWebsite] }, ...extraProfiles]);
}

function logOpenAiProviderError(operation, response, data) {
  console.error(`[openai:${operation}] upstream request failed`, {
    status: response?.status || null,
    code: data?.error?.code || null,
    type: data?.error?.type || null,
    param: data?.error?.param || null,
    message: data?.error?.message || null,
  });
}

async function getOpenAiAssistantReply(message) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not configured on the server.");
    err.statusCode = 500;
    throw err;
  }

  const systemPrompt = [
    "You are “My AI PA”, a friendly, concise AI receptionist for small service businesses.",
    "Rules:",
    "- Ask 1 short question at a time.",
    "- Keep answers under 2-3 sentences.",
    "- Your goal is to capture: caller name, callback number, reason for calling, urgency, and preferred time.",
    "- If it’s an emergency, advise contacting local emergency services.",
    "- Never claim you performed actions you didn’t do.",
  ].join("\n");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini",
      temperature: 0.4,
      max_tokens: 180,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    logOpenAiProviderError("assistant", response, data);
    const providerCode = String(data?.error?.code || "").toLowerCase();
    const providerMessage = String(data?.error?.message || "");
    const isQuotaIssue =
      response.status === 429 ||
      providerCode === "insufficient_quota" ||
      /quota|billing|rate limit/i.test(providerMessage);
    const msg = isQuotaIssue
      ? "AI responses are temporarily unavailable right now. Please try again shortly."
      : `AI request failed (${response.status}).`;
    const err = new Error(msg);
    err.statusCode = 502;
    throw err;
  }

  const reply = data?.choices?.[0]?.message?.content;
  if (!reply || typeof reply !== "string") {
    const err = new Error("Assistant did not return a reply.");
    err.statusCode = 502;
    throw err;
  }

  return reply.trim();
}

async function getOpenAiTranscription({ audioBase64, mimeType, detailed = false }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not configured on the server.");
    err.statusCode = 500;
    throw err;
  }

  const cleaned = String(audioBase64 || "").replace(/^data:.*;base64,/, "").trim();
  if (!cleaned) {
    const err = new Error("audioBase64 is required");
    err.statusCode = 400;
    throw err;
  }

  const buffer = Buffer.from(cleaned, "base64");
  if (!buffer.length) {
    const err = new Error("Audio payload could not be decoded.");
    err.statusCode = 400;
    throw err;
  }
  if (buffer.length > 8 * 1024 * 1024) {
    const err = new Error("Audio payload is too large (max 8MB).");
    err.statusCode = 400;
    throw err;
  }

  const type = String(mimeType || "audio/webm");
  const ext = type.includes("ogg") ? "ogg" : type.includes("mp4") || type.includes("mpeg") ? "mp3" : "webm";
  const fileBlob = new Blob([buffer], { type });
  const form = new FormData();
  form.append("file", fileBlob, `speech.${ext}`);
  form.append("model", process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1");
  form.append("language", process.env.OPENAI_TRANSCRIBE_LANGUAGE || "en");
  if (detailed) {
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
  }

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    logOpenAiProviderError("transcription", response, data);
    const providerCode = String(data?.error?.code || "").toLowerCase();
    const providerMessage = String(data?.error?.message || "");
    const isQuotaIssue =
      response.status === 429 ||
      providerCode === "insufficient_quota" ||
      /quota|billing|rate limit/i.test(providerMessage);
    const msg = isQuotaIssue
      ? "Voice input is temporarily unavailable right now. Please type your answer instead."
      : `Voice transcription failed (${response.status}).`;
    const err = new Error(msg);
    err.statusCode = 502;
    throw err;
  }

  const text = typeof data?.text === "string"
    ? data.text.trim()
    : typeof data?.output_text === "string"
      ? data.output_text.trim()
      : typeof data?.transcript === "string"
        ? data.transcript.trim()
        : "";
  if (!text) {
    const err = new Error("No speech was detected. Try speaking a little louder and record for 1-2 seconds.");
    err.statusCode = 502;
    throw err;
  }
  if (detailed) {
    const segments = Array.isArray(data?.segments)
      ? data.segments
          .map((seg) => ({
            id: seg?.id,
            start: Number(seg?.start ?? 0),
            end: Number(seg?.end ?? 0),
            text: typeof seg?.text === "string" ? seg.text.trim() : "",
          }))
          .filter((seg) => seg.text)
      : [];
    return { text, segments };
  }
  return text;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "my-ai-pa-api", time: new Date().toISOString() });
});

app.post(
  "/api/business/enrich",
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const website = normalizeWebsiteUrl(body.website);

    if (!website) {
      return res.json({
        ok: true,
        enrichment: {
          website: "",
          phone: "",
          ownerPhone: "",
          email: "",
          ownerEmail: "",
          address: "",
          hours: "",
          services: "",
          ownerName: "",
          sourceUrls: [],
        },
      });
    }

    try {
      const enrichment = await enrichBusinessFromWebsite({ website });
      res.json({
        ok: true,
        enrichment: {
          website,
          phone: enrichment.phones[0] || "",
          ownerPhone: enrichment.phones[0] || "",
          email: enrichment.emails[0] || "",
          ownerEmail: enrichment.emails[0] || "",
          address: enrichment.address || "",
          hours: enrichment.hours || "",
          services: enrichment.services || enrichment.description || "",
          ownerName: enrichment.ownerName || "",
          sourceUrls: enrichment.sourceUrls || [],
        },
      });
    } catch (error) {
      res.json({
        ok: true,
        enrichment: {
          website,
          phone: "",
          ownerPhone: "",
          email: "",
          ownerEmail: "",
          address: "",
          hours: "",
          services: "",
          ownerName: "",
          sourceUrls: [],
        },
        warning: error?.message || "Website enrichment failed.",
      });
    }
  })
);

app.post(
  "/api/assistant",
  enforceAssistantRateLimit,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const message = typeof body.message === "string" ? body.message.trim() : "";

    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    if (message.length > ASSISTANT_MAX_CHARS) {
      return res.status(400).json({
        error: `message is too long (max ${ASSISTANT_MAX_CHARS} characters)`,
      });
    }

    const reply = await getOpenAiAssistantReply(message);
    res.json({ reply });
  })
);

app.post(
  "/api/assistant/transcribe",
  enforceAssistantRateLimit,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const detailed = Boolean(body.detailed);
    const transcriptResult = await getOpenAiTranscription({
      audioBase64: body.audioBase64,
      mimeType: body.mimeType,
      detailed,
    });
    if (detailed) {
      return res.json({
        transcript: transcriptResult?.text || "",
        segments: transcriptResult?.segments || [],
      });
    }
    res.json({ transcript: transcriptResult });
  })
);

app.post(
  "/api/leads/create",
  asyncRoute(async (req, res) => {
    const lead = await createLead(req.body || {});
    res.status(201).json({ ok: true, leadId: lead.id, lead });
  })
);

app.post(
  "/api/calls/log",
  asyncRoute(async (req, res) => {
    const call = await logCall(req.body || {});
    res.status(201).json({ ok: true, callId: call.id, call });
  })
);

app.get(
  "/api/faqs/search",
  asyncRoute(async (req, res) => {
    const q = String(req.query.q || "");
    if (!q.trim()) {
      return res.status(400).json({ error: "q is required" });
    }
    const results = await searchFaq({
      q,
      businessId: parsePositiveInt(req.query.businessId, 1),
      limit: parsePositiveInt(req.query.limit, 10),
    });
    res.json({ ok: true, count: results.length, results });
  })
);

app.post(
  "/api/notify/owner-sms",
  asyncRoute(async (req, res) => {
    const payload = req.body || {};
    const result = await sendOwnerSms({
      businessId: payload.businessId || 1,
      to: payload.to,
      message: payload.message,
    });
    res.status(201).json({ ok: true, result });
  })
);

app.post(
  "/api/webhooks/voice",
  asyncRoute(async (req, res) => {
    const payload = req.body || {};
    const eventType = String(payload.eventType || payload.type || "unknown").toLowerCase();
    const toolResults = [];

    if (eventType === "call.started") {
      toolResults.push({ tool: "logCall", result: await logCall({ status: "STARTED", ...payload }) });
    } else if (eventType === "call.completed") {
      toolResults.push({ tool: "logCall", result: await logCall({ status: payload.status || "COMPLETED", ...payload }) });
      if (payload.lead) {
        toolResults.push({ tool: "createLead", result: await createLead({ businessId: payload.businessId || 1, ...payload.lead }) });
      }
    } else if (eventType === "faq.lookup") {
      toolResults.push({
        tool: "searchFaq",
        result: await searchFaq({ q: payload.q || payload.query || "", businessId: payload.businessId || 1, limit: payload.limit || 5 }),
      });
    } else if (eventType === "lead.capture") {
      const lead = await createLead({ businessId: payload.businessId || 1, ...payload });
      toolResults.push({ tool: "createLead", result: lead });
      if (payload.notifyOwner !== false) {
        toolResults.push({
          tool: "sendOwnerSms",
          result: await sendOwnerSms({
            businessId: payload.businessId || 1,
            message: payload.smsMessage || `New ${lead.intent} lead from ${lead.name} (${lead.callbackNumber}).`,
          }),
        });
      }
    } else if (eventType === "booking.request") {
      toolResults.push({ tool: "createBooking", result: await createBooking(payload) });
    } else if (eventType === "human.escalation") {
      toolResults.push({ tool: "escalateToHuman", result: await escalateToHuman(payload) });
    } else {
      toolResults.push({
        tool: "noop",
        result: { ok: true, stub: true, note: `No router action for eventType '${eventType}' yet.` },
      });
    }

    res.json({ ok: true, eventType, toolResults });
  })
);

app.post(
  "/api/integrations/signup-complete",
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const businessProfile = body.businessProfile || {};
    const setupDetails = body.setupDetails || {};
    const businessName = String(businessProfile.businessName || "").trim();
    const businessPhone = String(businessProfile.phone || "").trim();
    const businessAddress = String(businessProfile.address || "").trim();
    const ownerName = String(setupDetails.ownerName || "").trim();
    const ownerEmail = String(setupDetails.ownerEmail || "").trim();
    const ownerPhone = String(setupDetails.ownerPhone || "").trim();
    const countryCode = String(body.country || "").trim().toLowerCase();
    const googlePlaceId = String(body.selectedPlace?.place_id || body.selectedPlace?.placeId || "").trim();

    if (!businessName) {
      return res.status(400).json({ error: "businessProfile.businessName is required." });
    }

    if (!ownerName || !ownerEmail) {
      return res.status(400).json({ error: "Owner name and owner email are required." });
    }

    if (!isValidEmailAddress(ownerEmail)) {
      return res.status(400).json({ error: "Owner email must be a valid email address." });
    }

    const securityDecision = await getSignupSecurityDecision(req, body, {
      businessName,
      businessPhone,
      businessAddress,
      ownerEmail,
      ownerPhone,
    });

    if (securityDecision.blocked) {
      console.warn("[signup:security] blocked signup", {
        reasons: securityDecision.reasons,
        ipHash: hashKey(securityDecision.ip),
        emailHash: hashKey(ownerEmail),
      });
      return res.status(429).json({ error: "Signup could not be completed right now. Please try again later." });
    }

    const payload = compactObject({
      event: "signup.completed",
      submittedAt: new Date().toISOString(),
      source: {
        app: "my-ai-pa-signup",
        countryCode,
        country: countryCode === "ca" ? "Canada" : countryCode === "us" ? "United States" : undefined,
        ipHash: hashKey(securityDecision.ip),
      },
      security: {
        captchaProvider: String(body.security?.captchaProvider || "").trim(),
        reviewRequired: securityDecision.reviewRequired,
        reviewReasons: securityDecision.reviewReasons,
        captchaSkipped: securityDecision.captchaSkipped,
        browserTimezone: String(body.security?.timezone || "").trim(),
      },
      verification: {
        emailVerified: false,
        smsVerified: false,
      },
      business: {
        name: businessName,
        phone: businessPhone,
        address: businessAddress,
        website: String(businessProfile.website || "").trim(),
        googlePlaceId,
        hours: String(businessProfile.hours || "").trim(),
        services: String(businessProfile.services || "").trim(),
      },
      owner: {
        name: ownerName,
        email: ownerEmail,
        phone: ownerPhone,
      },
      aiAssistant: {
        goals: String(setupDetails.aiGoals || "").trim(),
        businessType: String(setupDetails.businessType || "").trim(),
        serviceArea: String(setupDetails.serviceArea || "").trim(),
        callForwardingNumber: String(setupDetails.callForwardingNumber || "").trim(),
        bookingPreference: String(setupDetails.bookingPreference || "").trim(),
        notificationPreference: String(setupDetails.notificationPreference || "").trim(),
        tone: String(setupDetails.aiTone || "").trim(),
        assistantVoice: String(setupDetails.assistantVoice || setupDetails.voice || "").trim(),
        emergencyAfterHoursAvailable: Boolean(setupDetails.emergencyAfterHoursAvailable),
        emergencyRules: String(setupDetails.emergencyRules || "").trim(),
        faq: String(setupDetails.faq || "").trim(),
        greetingScript: String(setupDetails.greetingScript || "").trim(),
        intakeQuestions: String(setupDetails.intakeQuestions || "").trim(),
        escalationRules: String(setupDetails.escalationRules || "").trim(),
        doNotHandle: String(setupDetails.doNotHandle || "").trim(),
      },
    });

    upsertSignupDashboardFromPayload(payload, {
      status: "signup_received",
      reviewRequired: securityDecision.reviewRequired,
      reviewReasons: securityDecision.reviewReasons,
    });

    if (isEnabled(process.env.SIGNUP_REQUIRE_VERIFICATION)) {
      const token = createPendingSignupVerification({
        payload,
        ownerEmail,
        businessName,
        reviewReasons: securityDecision.reviewReasons,
        ipHash: hashKey(securityDecision.ip),
      });
      const emailResult = await sendSignupVerificationEmail({
        req,
        ownerEmail,
        ownerName,
        businessName,
        token,
      });

      upsertSignupDashboardFromPayload(payload, {
        status: "pending_email_verification",
        emailVerificationRequired: true,
        emailVerificationSentAt: new Date().toISOString(),
        reviewRequired: securityDecision.reviewRequired,
        reviewReasons: securityDecision.reviewReasons,
      });

      return res.status(202).json({
        success: true,
        ok: true,
        verificationRequired: true,
        emailVerificationRequired: true,
        emailSent: Boolean(emailResult.sent),
        devVerificationUrl: emailResult.devVerificationUrl,
        businessName,
        message: "Signup received. Verify your email before setup continues.",
      });
    }

    if (securityDecision.reviewRequired) {
      console.warn("[signup:security] held signup for review", {
        reviewReasons: securityDecision.reviewReasons,
        ipHash: hashKey(securityDecision.ip),
        emailHash: hashKey(ownerEmail),
      });
      upsertSignupDashboardFromPayload(payload, {
        status: "review_required",
        reviewRequired: true,
        reviewReasons: securityDecision.reviewReasons,
      });
      return res.status(202).json({
        success: true,
        ok: true,
        reviewRequired: true,
        businessName,
        message: "Signup received for review.",
      });
    }

    const makeResult = await sendMakeSignupCompleted(payload);
    const makeData = makeResult.data || {};
    if (!getMakeSignupSuccess(makeData)) {
      upsertSignupDashboardFromPayload(payload, {
        status: "setup_error",
        makeStatus: makeResult.status,
        makeError: makeData?.error || "Make webhook did not complete the signup.",
      });
      return res.status(502).json({ error: makeData?.error || "Make webhook did not complete the signup." });
    }

    upsertSignupDashboardFromPayload(payload, {
      status: "setup_started",
      makeStatus: makeResult.status,
      twilioPhoneNumber: getMakeTwilioPhoneNumber(makeData) || getMakeTwilioPhoneNumberFromText(makeResult.body),
    });

    res.json({
      success: true,
      ok: true,
      businessName,
      twilioPhoneNumber: getMakeTwilioPhoneNumber(makeData) || getMakeTwilioPhoneNumberFromText(makeResult.body),
      makeStatus: makeResult.status,
    });
  })
);

app.get(
  "/api/integrations/verify-signup-email",
  asyncRoute(async (req, res) => {
    const token = String(req.query.token || "").trim();
    const tokenHash = hashSignupVerificationToken(token);
    const store = prunePendingSignupStore(readPendingSignupStore());
    const record = store[tokenHash];

    function renderVerificationPage({ title, body, ok }) {
      res.status(ok ? 200 : 400).send(`<!doctype html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width,initial-scale=1" />
            <title>${escapeHtml(title)} | My AI PA</title>
            <style>
              body{margin:0;font-family:Arial,sans-serif;background:linear-gradient(135deg,#eef6ff,#fff);color:#07142a;display:grid;min-height:100vh;place-items:center;padding:24px}
              main{max-width:680px;border:1px solid #d7e7fb;background:rgba(255,255,255,.94);border-radius:28px;padding:34px;box-shadow:0 34px 100px -70px rgba(15,23,42,.86)}
              .badge{display:inline-flex;border-radius:999px;background:${ok ? "#dcfce7" : "#fee2e2"};color:${ok ? "#166534" : "#991b1b"};padding:8px 12px;font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}
              h1{font-size:clamp(32px,7vw,54px);line-height:1.02;margin:18px 0 12px;letter-spacing:-.05em}
              p{font-size:18px;line-height:1.6;color:#334155}
              a{display:inline-flex;margin-top:12px;border-radius:14px;background:#07142a;color:white;text-decoration:none;font-weight:900;padding:14px 18px}
            </style>
          </head>
          <body>
            <main>
              <span class="badge">${ok ? "Verified" : "Needs attention"}</span>
              <h1>${escapeHtml(title)}</h1>
              <p>${escapeHtml(body)}</p>
              <a href="/#/signup">Return to My AI PA</a>
            </main>
          </body>
        </html>`);
    }

    if (!token || !record) {
      writePendingSignupStore(store);
      return renderVerificationPage({
        ok: false,
        title: "Verification link is invalid or expired",
        body: "Please submit the signup form again to receive a fresh verification email.",
      });
    }

    if (Number(record.expiresAt || 0) <= Date.now()) {
      delete store[tokenHash];
      writePendingSignupStore(store);
      return renderVerificationPage({
        ok: false,
        title: "Verification link expired",
        body: "Please submit the signup form again to receive a fresh verification email.",
      });
    }

    const payload = compactObject({
      ...(record.payload || {}),
      verifiedAt: new Date().toISOString(),
      verification: {
        ...((record.payload || {}).verification || {}),
        emailVerified: true,
        smsVerified: Boolean((record.payload || {}).verification?.smsVerified),
      },
      security: {
        ...((record.payload || {}).security || {}),
        emailVerificationCompleted: true,
      },
    });

    if (Array.isArray(record.reviewReasons) && record.reviewReasons.length) {
      delete store[tokenHash];
      writePendingSignupStore(store);
      upsertSignupDashboardFromPayload(payload, {
        status: "review_required",
        emailVerified: true,
        emailVerifiedAt: new Date().toISOString(),
        reviewRequired: true,
        reviewReasons: record.reviewReasons,
      });
      console.warn("[signup:security] email verified but signup held for review", {
        reviewReasons: record.reviewReasons,
        emailHash: hashKey(record.ownerEmail),
      });
      return renderVerificationPage({
        ok: true,
        title: "Email verified",
        body: "Your email is verified. Your signup needs a quick manual review before the agent setup continues.",
      });
    }

    const makeResult = await sendMakeSignupCompleted(payload);
    const makeData = makeResult.data || {};
    if (!getMakeSignupSuccess(makeData)) {
      upsertSignupDashboardFromPayload(payload, {
        status: "setup_error",
        emailVerified: true,
        emailVerifiedAt: new Date().toISOString(),
        makeStatus: makeResult.status,
        makeError: makeData?.error || "Make webhook did not complete after email verification.",
      });
      console.error("[signup:verification] Make webhook did not complete after email verification", {
        status: makeResult.status,
        error: makeData?.error || null,
        emailHash: hashKey(record.ownerEmail),
      });
      return renderVerificationPage({
        ok: false,
        title: "Email verified, setup needs attention",
        body: "Your email was verified, but the automated setup handoff did not finish. Please contact My AI PA support.",
      });
    }

    delete store[tokenHash];
    writePendingSignupStore(store);
    upsertSignupDashboardFromPayload(payload, {
      status: "setup_started",
      emailVerified: true,
      emailVerifiedAt: new Date().toISOString(),
      makeStatus: makeResult.status,
      twilioPhoneNumber: getMakeTwilioPhoneNumber(makeData) || getMakeTwilioPhoneNumberFromText(makeResult.body),
    });
    return renderVerificationPage({
      ok: true,
      title: "Email verified",
      body: "Your email is verified and your My AI PA setup is now continuing.",
    });
  })
);

app.post(
  "/api/payments/create-checkout-session",
  asyncRoute(async (req, res) => {
    if (!stripe || !STRIPE_PRICE_ID) {
      return res.status(503).json({
        error: "Stripe checkout is not configured yet. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID on the server.",
      });
    }

    const body = req.body || {};
    const ownerEmail = String(body.ownerEmail || body.email || "").trim();
    const businessName = String(body.businessName || "").trim();
    const ownerName = String(body.ownerName || "").trim();
    const ownerPhone = String(body.ownerPhone || "").trim();

    if (!ownerEmail || !isValidEmailAddress(ownerEmail)) {
      return res.status(400).json({ error: "A valid owner email is required to start checkout." });
    }

    const { successUrl, cancelUrl } = getStripeReturnUrls(req);
    const subscriptionData = {
      metadata: compactObject({
        businessName,
        ownerName,
        ownerEmail,
        ownerPhone,
        source: "my-ai-pa-signup",
      }),
    };

    if (STRIPE_TRIAL_DAYS > 0) {
      subscriptionData.trial_period_days = STRIPE_TRIAL_DAYS;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer_email: ownerEmail,
      line_items: [
        {
          price: STRIPE_PRICE_ID,
          quantity: 1,
        },
      ],
      allow_promotion_codes: isEnabled(process.env.STRIPE_ALLOW_PROMOTION_CODES),
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: ownerEmail,
      metadata: compactObject({
        businessName,
        ownerName,
        ownerEmail,
        ownerPhone,
        source: "my-ai-pa-signup",
      }),
      subscription_data: subscriptionData,
    });

    upsertSignupDashboardFromCheckoutSession(session, {
      status: "checkout_started",
      businessName,
      ownerName,
      ownerEmail,
      ownerPhone,
    });

    res.json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  })
);

app.post(
  "/api/customer/dashboard",
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const email = String(body.email || body.ownerEmail || "").trim();
    const phone = String(body.phone || body.ownerPhone || body.businessPhone || "").trim();

    if (!email || !isValidEmailAddress(email) || !phone) {
      return res.status(400).json({ error: "Enter the signup email and phone number for this business." });
    }

    const dashboard = await getCustomerDashboard({ email, phone });
    if (!dashboard) {
      return res.status(404).json({ error: "No customer dashboard was found for that email and phone number." });
    }

    res.json({ ok: true, dashboard });
  })
);

app.post(
  "/api/admin/login",
  asyncRoute(async (req, res) => {
    if (!hasValidAdminPassword(req)) {
      return res.status(401).json({ error: "Invalid admin password." });
    }
    setAdminSessionCookie(res, createAdminSessionToken());
    res.json({ ok: true });
  })
);

app.get(
  "/api/admin/session",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true });
  })
);

app.post(
  "/api/admin/logout",
  asyncRoute(async (_req, res) => {
    clearAdminSessionCookie(res);
    res.json({ ok: true });
  })
);

app.get(
  "/api/admin/leads",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const where = {};
    if (req.query.status) where.status = String(req.query.status).toUpperCase();
    if (req.query.intent) where.intent = String(req.query.intent).toUpperCase();
    if (req.query.urgency) where.urgency = String(req.query.urgency).toUpperCase();
    const leads = await prisma.lead.findMany({
      where,
      include: { caller: true, call: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({ ok: true, leads: leads.map(sanitizeAdminLead) });
  })
);

app.get(
  "/api/admin/calls",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const where = {};
    if (req.query.status) where.status = String(req.query.status).toUpperCase();
    if (req.query.minDuration) {
      const minDuration = Math.max(0, Number(req.query.minDuration) || 0);
      where.durationSec = { gte: minDuration };
    }
    if (req.query.outcome) where.outcome = String(req.query.outcome).toUpperCase();
    if (req.query.businessId) where.businessId = parsePositiveInt(req.query.businessId, 1);
    const calls = await prisma.call.findMany({
      where,
      include: { caller: true, business: true, notes: { orderBy: { createdAt: "desc" } }, tasks: { orderBy: { createdAt: "desc" } } },
      orderBy: { startedAt: "desc" },
      take: 200,
    });
    res.json({ ok: true, calls: calls.map(sanitizeAdminCall) });
  })
);

app.get(
  "/api/admin/calls/analytics",
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json({ ok: true, analytics: await getCompanyCallAnalytics({ days: req.query.days || 30 }) });
  })
);

app.get(
  "/api/admin/calls/search",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const calls = await searchCallTranscripts({
      q: req.query.q || "",
      businessId: req.query.businessId || "",
      limit: req.query.limit || 100,
    });
    res.json({ ok: true, calls: calls.map(sanitizeAdminCall) });
  })
);

app.put(
  "/api/admin/calls/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const body = req.body || {};
    const allowedOutcomes = ["UNREVIEWED", "BOOKED", "QUOTE_NEEDED", "EMERGENCY", "SPAM", "FOLLOW_UP", "NOT_A_LEAD"];
    const data = {};
    if (body.outcome != null) {
      const outcome = String(body.outcome || "").toUpperCase();
      if (!allowedOutcomes.includes(outcome)) return res.status(400).json({ error: "Invalid outcome." });
      data.outcome = outcome;
    }
    if (body.qualityScore != null) data.qualityScore = Math.max(0, Math.min(100, Number(body.qualityScore) || 0));
    if (body.followUpNeeded != null) data.followUpNeeded = Boolean(body.followUpNeeded);
    if (body.aiSummary != null) data.aiSummary = String(body.aiSummary || "").trim().slice(0, 2000) || null;
    const call = await prisma.call.update({
      where: { id },
      data,
      include: { caller: true, business: true, notes: { orderBy: { createdAt: "desc" } }, tasks: { orderBy: { createdAt: "desc" } } },
    });
    res.json({ ok: true, call: sanitizeAdminCall(call) });
  })
);

app.post(
  "/api/admin/calls/:id/notes",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const callId = parsePositiveInt(req.params.id);
    const body = String((req.body || {}).body || "").trim();
    if (!body) return res.status(400).json({ error: "Note body is required." });
    const note = await prisma.callNote.create({ data: { callId, body: body.slice(0, 2000) } });
    res.status(201).json({ ok: true, note });
  })
);

app.post(
  "/api/admin/calls/:id/tasks",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const callId = parsePositiveInt(req.params.id);
    const body = req.body || {};
    const title = String(body.title || "").trim();
    if (!title) return res.status(400).json({ error: "Task title is required." });
    const dueAt = body.dueAt ? new Date(body.dueAt) : null;
    const task = await prisma.callTask.create({
      data: {
        callId,
        title: title.slice(0, 240),
        dueAt: dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt : null,
      },
    });
    res.status(201).json({ ok: true, task });
  })
);

app.put(
  "/api/admin/call-tasks/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const body = req.body || {};
    const allowed = ["OPEN", "DONE", "ARCHIVED"];
    const data = {};
    if (body.title != null) data.title = String(body.title || "").trim().slice(0, 240);
    if (body.status != null) {
      const status = String(body.status || "").toUpperCase();
      if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid task status." });
      data.status = status;
    }
    const task = await prisma.callTask.update({ where: { id }, data });
    res.json({ ok: true, task });
  })
);

app.get(
  "/api/admin/trial-health",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, accounts: await getTrialHealthDashboard() });
  })
);

app.get(
  "/api/admin/ops-overview",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, ...(await getAdminOpsOverview()) });
  })
);

app.get(
  "/api/admin/customer-setup",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, ...(await getCustomerSetupCommandCenter()) });
  })
);

app.post(
  "/api/admin/customer-setup/:customerId/steps/:stepKey",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const customerId = String(req.params.customerId || "").trim();
    const stepKey = String(req.params.stepKey || "").trim();
    const allowedStep = CUSTOMER_SETUP_STEPS.some((step) => step.key === stepKey);
    if (!/^[a-f0-9]{32}$/i.test(customerId) || !allowedStep) {
      return res.status(400).json({ error: "Invalid customer setup step." });
    }

    const body = req.body || {};
    const status = String(body.status || "").trim().toLowerCase();
    const allowedStatus = ["done", "waiting", "failed", "manual", "clear"];
    if (!allowedStatus.includes(status)) return res.status(400).json({ error: "Invalid setup step status." });

    const current = await readCustomerSetupOverrides(customerId);
    const steps = { ...(current.steps || {}) };
    if (status === "clear") {
      delete steps[stepKey];
    } else {
      steps[stepKey] = {
        status,
        note: String(body.note || "").trim().slice(0, 500),
        updatedAt: new Date().toISOString(),
      };
    }

    await writeCustomerSetupOverrides(customerId, {
      ...current,
      steps,
      updatedAt: new Date().toISOString(),
    });

    res.json({ ok: true, ...(await getCustomerSetupCommandCenter()) });
  })
);

app.get(
  "/api/admin/daily-digest",
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json({ ok: true, digest: await buildDailyDigest({ days: req.query.days || 1 }) });
  })
);

app.post(
  "/api/admin/daily-digest/send",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, ...(await sendDailyDigest()) });
  })
);

app.post(
  "/api/admin/vapi/sync-calls",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const result = await syncVapiCalls({
      limit: body.limit || req.query.limit || VAPI_CALL_LIMIT,
      createdAtGt: body.createdAtGt || req.query.createdAtGt || "",
    });
    res.json({ ok: true, ...result });
  })
);

app.get(
  "/api/admin/cost-audit",
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json({ ok: true, audit: await getCostAudit({ days: req.query.days || 30 }) });
  })
);

app.get(
  "/api/admin/twilio/numbers",
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json({ ok: true, inventory: await getTwilioNumberInventory({ days: req.query.days || 90 }) });
  })
);

app.post(
  "/api/admin/cost-sync",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const result = await syncCallCosts({
      days: body.days || req.query.days || 30,
      limit: body.limit || req.query.limit || 1000,
      includeVapi: Boolean(body.includeVapi || isEnabled(req.query.includeVapi)),
    });
    res.json({ ok: true, ...result, audit: await getCostAudit({ days: body.days || req.query.days || 30 }) });
  })
);

app.get(
  "/api/admin/vapi/mappings",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    const mappings = await prisma.vapiBusinessMapping.findMany({
      include: { business: true },
      orderBy: { updatedAt: "desc" },
      take: 300,
    });
    const businesses = await prisma.business.findMany({ orderBy: { name: "asc" }, take: 300 });
    res.json({ ok: true, mappings, businesses });
  })
);

app.post(
  "/api/admin/businesses",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const requestedId = parsePositiveInt(body.id, 0);
    const name = String(body.name || "").trim().slice(0, 160);
    const phone = String(body.phone || "").trim().slice(0, 80);
    const ownerPhone = String(body.ownerPhone || phone).trim().slice(0, 80);
    const timezone = String(body.timezone || "America/Toronto").trim().slice(0, 80);
    const bookingLink = String(body.bookingLink || "").trim().slice(0, 300) || null;

    if (!name) return res.status(400).json({ error: "Business name is required." });
    if (!phone) return res.status(400).json({ error: "Business phone is required." });

    const businessData = { name, phone, timezone };
    const business = requestedId
      ? await prisma.business.upsert({
          where: { id: requestedId },
          update: businessData,
          create: { id: requestedId, ...businessData },
        })
      : await prisma.business.create({ data: businessData });

    const settings = await prisma.settings.upsert({
      where: { businessId: business.id },
      update: {
        ownerPhone,
        bookingLink,
      },
      create: {
        businessId: business.id,
        answerAfterRings: 3,
        afterHoursMode: "AI_ALWAYS_ON",
        ownerPhone,
        bookingLink,
      },
    });

    let mapping = null;
    const rawMatchValue = String(body.vapiMatchValue || "").trim();
    if (rawMatchValue) {
      const matchType = String(body.vapiMatchType || "phoneNumber").trim().slice(0, 80);
      const matchValue = matchType.toLowerCase().includes("phone")
        ? normalizePhoneForMatch(rawMatchValue)
        : rawMatchValue.toLowerCase();
      mapping = await prisma.vapiBusinessMapping.upsert({
        where: { matchValue },
        update: {
          businessId: business.id,
          matchType,
          label: String(body.vapiLabel || name).trim().slice(0, 120) || null,
        },
        create: {
          businessId: business.id,
          matchType,
          matchValue,
          label: String(body.vapiLabel || name).trim().slice(0, 120) || null,
        },
      });
    }

    res.status(201).json({ ok: true, business, settings, mapping });
  })
);

app.post(
  "/api/admin/vapi/mappings",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const businessId = parsePositiveInt(body.businessId, 1);
    const matchType = String(body.matchType || "assistantId").trim().slice(0, 80);
    const rawValue = String(body.matchValue || "").trim();
    if (!rawValue) return res.status(400).json({ error: "matchValue is required." });
    const matchValue = matchType.toLowerCase().includes("phone") ? normalizePhoneForMatch(rawValue) : rawValue.toLowerCase();
    const mapping = await prisma.vapiBusinessMapping.upsert({
      where: { matchValue },
      update: { businessId, matchType, label: String(body.label || "").trim().slice(0, 120) || null },
      create: { businessId, matchType, matchValue, label: String(body.label || "").trim().slice(0, 120) || null },
      include: { business: true },
    });
    res.status(201).json({ ok: true, mapping });
  })
);

app.delete(
  "/api/admin/vapi/mappings/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    await prisma.vapiBusinessMapping.delete({ where: { id } });
    res.json({ ok: true });
  })
);

app.get(
  "/api/admin/signups",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, signups: listSignupDashboardRecords() });
  })
);

app.get(
  "/api/admin/faqs",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const businessId = parsePositiveInt(req.query.businessId, 1);
    const faqs = await prisma.fAQ.findMany({
      where: { businessId },
      orderBy: { updatedAt: "desc" },
      take: 300,
    });
    res.json({ ok: true, faqs });
  })
);

app.post(
  "/api/admin/faqs",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    if (!body.question || !body.answer) {
      return res.status(400).json({ error: "question and answer are required" });
    }
    const faq = await prisma.fAQ.create({
      data: {
        businessId: parsePositiveInt(body.businessId, 1),
        question: String(body.question).trim(),
        answer: String(body.answer).trim(),
        tags: String(body.tags || "").trim(),
      },
    });
    res.status(201).json({ ok: true, faq });
  })
);

app.put(
  "/api/admin/faqs/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid FAQ id" });
    const body = req.body || {};
    const faq = await prisma.fAQ.update({
      where: { id },
      data: {
        question: body.question == null ? undefined : String(body.question).trim(),
        answer: body.answer == null ? undefined : String(body.answer).trim(),
        tags: body.tags == null ? undefined : String(body.tags).trim(),
      },
    });
    res.json({ ok: true, faq });
  })
);

app.delete(
  "/api/admin/faqs/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    if (!id) return res.status(400).json({ error: "Invalid FAQ id" });
    await prisma.fAQ.delete({ where: { id } });
    res.json({ ok: true });
  })
);

app.get(
  "/api/admin/settings",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const businessId = parsePositiveInt(req.query.businessId, 1);
    let settings = await prisma.settings.findUnique({ where: { businessId } });
    if (!settings) {
      const business = await prisma.business.findUnique({ where: { id: businessId } });
      if (!business) return res.status(404).json({ error: "Business not found" });
      settings = await prisma.settings.create({
        data: {
          businessId,
          answerAfterRings: 3,
          afterHoursMode: "AI_ALWAYS_ON",
          ownerPhone: business.phone,
          bookingLink: null,
        },
      });
    }
    res.json({ ok: true, settings });
  })
);

app.put(
  "/api/admin/settings",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const businessId = parsePositiveInt(body.businessId, 1);
    const answerAfterRings = Math.min(10, Math.max(1, Number(body.answerAfterRings || 3)));
    const allowedModes = ["AI_ALWAYS_ON", "AI_BUSINESS_HOURS_ONLY", "VOICEMAIL_ONLY", "FORWARD_TO_OWNER"];
    const afterHoursMode = allowedModes.includes(String(body.afterHoursMode || "").toUpperCase())
      ? String(body.afterHoursMode).toUpperCase()
      : "AI_ALWAYS_ON";

    const settings = await prisma.settings.upsert({
      where: { businessId },
      update: {
        answerAfterRings,
        afterHoursMode,
        ownerPhone: String(body.ownerPhone || "").trim(),
        bookingLink: body.bookingLink ? String(body.bookingLink).trim() : null,
      },
      create: {
        businessId,
        answerAfterRings,
        afterHoursMode,
        ownerPhone: String(body.ownerPhone || "").trim(),
        bookingLink: body.bookingLink ? String(body.bookingLink).trim() : null,
      },
    });

    res.json({ ok: true, settings });
  })
);

app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  const message = err.message || "Internal server error";
  if (status >= 500) {
    console.error(err);
  }
  res.status(status).json({ error: message });
});

cleanupSensitiveCallData().catch((err) => {
  console.error("[call-data-cleanup] initial run failed", err);
});

processTrialReminders().catch((err) => {
  console.error("[stripe:trial-reminder] initial run failed", err);
});

setInterval(() => {
  cleanupSensitiveCallData().catch((err) => {
    console.error("[call-data-cleanup] scheduled run failed", err);
  });
}, SENSITIVE_CALL_CLEANUP_INTERVAL_MS);

setInterval(() => {
  processTrialReminders().catch((err) => {
    console.error("[stripe:trial-reminder] scheduled run failed", err);
  });
}, TRIAL_REMINDER_CHECK_INTERVAL_MS);

if (VAPI_AUTO_SYNC_ENABLED) {
  syncVapiCalls().catch((err) => {
    console.error("[vapi:sync] initial auto-sync failed", err);
  });
  setInterval(() => {
    syncVapiCalls().catch((err) => {
      console.error("[vapi:sync] scheduled auto-sync failed", err);
    });
  }, VAPI_AUTO_SYNC_INTERVAL_MS);
}

setInterval(() => {
  markMissedCallAlerts().catch((err) => {
    console.error("[missed-call-alert] scheduled run failed", err);
  });
}, 5 * 60 * 1000);

setInterval(() => {
  sendDailyDigest().catch((err) => {
    console.error("[daily-owner-digest] scheduled run failed", err);
  });
}, 24 * 60 * 60 * 1000);

app.listen(PORT, () => {
  console.log(`My AI PA API listening on http://localhost:${PORT}`);
});
