const dotenv = require("dotenv");
dotenv.config();
dotenv.config({ path: ".env.local", override: false });

const crypto = require("crypto");
const cors = require("cors");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const fs = require("fs");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const path = require("path");
const { Readable } = require("stream");
const Stripe = require("stripe");
const { prisma } = require("./prisma");
const { fetchPublicWebsite } = require("./safeWebsiteFetch");
const { sendSmsViaTwilio } = require("./twilioSms");
const {
  classifySmsPreference,
  forwardSmsToUpstream,
  getSmsSuppression,
  hasValidSuppressionApiKey,
  isSmsSuppressed,
  normalizeSmsPhone,
  recordSmsPreference,
  verifyTwilioWebhookRequest,
} = require("./smsSuppression");
const {
  formatAppointmentDate,
  createStaffMember,
  deactivateStaffMember,
  getAppointmentProposal,
  getCalendarInvite,
  getManagedAppointment,
  getSchedulingSettings,
  manageCustomerAppointment,
  processAppointmentReminders,
  respondToAppointment,
  respondToAppointmentProposal,
  updateSchedulingSettings,
} = require("./appointmentRequests");
const {
  buildCustomerCalendarLinks,
  completeOAuthConnection,
  disconnectCalendar,
  getAuthorizationUrl,
  isProviderConfigured,
  sanitizeCalendarConnection,
} = require("./calendarIntegrations");
const {
  createLead,
  logCall,
  searchFaq,
  createBooking,
  escalateToHuman,
} = require("./agentTools");
const {
  acknowledgeLeadByToken,
  applyProviderEvent,
  createAndDispatchLeadHandoff,
  dispatchLeadHandoff,
  getLeadHandoffDashboard,
  parseAcknowledgementToken,
  processDueLeadHandoffs,
  recordExternalOwnerSmsResult,
} = require("./leadHandoffs");
const {
  inspectIsolatedConfiguration,
  isManagedIsolatedTool,
  provisionIsolatedSmsRouting,
} = require("./vapiIsolatedSmsProvisioning");
const {
  buildTrustedVapiLeadInput,
  claimVapiToolExecution,
  completeVapiToolExecution,
  failVapiToolExecution,
  isVapiNotificationTool,
} = require("./vapiToolSecurity");
const {
  buildVapiAppointmentExecutionResult,
  normalizeVapiToolCall,
} = require("./vapiToolCalls");
const {
  recordLeadOutcome,
  summarizeRevenueRescue,
} = require("./revenueRescue");
const {
  DEFAULT_MAX_CALL_SECONDS,
  buildTrialFallbackDestination,
  buildTrialUsageNotification,
  decideTrialCall,
  getPendingTrialMilestone,
  getTrialLifecycle,
  getTrialUsage,
  sanitizeTransientAssistant,
} = require("./trialUsagePolicy");
const {
  completeOAuth: completeJobberOAuth,
  disconnectJobber,
  getAuthorizationUrl: getJobberAuthorizationUrl,
  isConfigured: isJobberConfigured,
  sanitizeConnection: sanitizeJobberConnection,
  syncLeadToJobber,
} = require("./jobberIntegration");
const { resolveVapiWebhookSecret } = require("./vapiWebhookAuth");
const {
  buildVoiceSignupPayload,
  isVapiVoiceSignupTool,
} = require("./voiceSignup");
const {
  claimWebhookReplay,
  completeWebhookReplay,
  consumeRateLimit,
  releaseWebhookReplay,
  storeDashboardLoginCode,
  verifyDashboardLoginCode,
} = require("./persistentSecurityState");
const {
  AUDIT_PREFIX,
  listAdminAuditEvents,
  recordAdminAuditEvent,
  verifyTotpCode,
} = require("./adminSecurity");
const {
  getOperationalAttentionInbox,
  hashTarget: hashOperationalTarget,
} = require("./operationalAttention");

loadPowerShellEnvAssignments(path.join(__dirname, "..", ".env.local"));

const app = express();
const PORT = Number(process.env.PORT || 8787);
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, "..", "data");
const signupDuplicateSubmissions = new Map();
const pendingSignupPath = path.join(dataDir, "pending-signup-verifications.json");
const pendingStripeSignupPath = path.join(dataDir, "pending-stripe-signups.json");
const trialReminderPath = path.join(dataDir, "trial-reminders.json");
const signupDashboardPath = path.join(dataDir, "signup-dashboard.json");
const vapiCallSyncPath = path.join(dataDir, "vapi-call-sync.json");
const GOOGLE_RECAPTCHA_TEST_SECRET_KEY = "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe";
const ASSISTANT_MAX_CHARS = 2000;
const ASSISTANT_WINDOW_MS = 60 * 1000;
const ASSISTANT_MAX_REQUESTS_PER_WINDOW = 12;
const PUBLIC_ROUTE_WINDOW_MS = parsePositiveInt(process.env.PUBLIC_ROUTE_WINDOW_MS, 15 * 60 * 1000);
const BUSINESS_ENRICH_IP_MAX_REQUESTS = parsePositiveInt(process.env.BUSINESS_ENRICH_IP_MAX_REQUESTS, 10);
const STRIPE_CHECKOUT_IP_MAX_REQUESTS = parsePositiveInt(process.env.STRIPE_CHECKOUT_IP_MAX_REQUESTS, 5);
const ADMIN_LOGIN_IP_MAX_REQUESTS = parsePositiveInt(process.env.ADMIN_LOGIN_IP_MAX_REQUESTS, 10);
const adminLoginProcessRateLimiter = rateLimit({
  windowMs: PUBLIC_ROUTE_WINDOW_MS,
  limit: ADMIN_LOGIN_IP_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Wait a few minutes and try again." },
});
const JSON_BODY_LIMIT = String(process.env.JSON_BODY_LIMIT || "1mb").trim() || "1mb";
const SIGNUP_IP_WINDOW_MS = parsePositiveInt(process.env.SIGNUP_IP_WINDOW_MS, 15 * 60 * 1000);
const SIGNUP_IP_MAX_REQUESTS = parsePositiveInt(process.env.SIGNUP_IP_MAX_REQUESTS, 5);
const SIGNUP_IDENTITY_WINDOW_MS = parsePositiveInt(process.env.SIGNUP_IDENTITY_WINDOW_MS, 60 * 60 * 1000);
const SIGNUP_IDENTITY_MAX_REQUESTS = parsePositiveInt(process.env.SIGNUP_IDENTITY_MAX_REQUESTS, 2);
const SIGNUP_DUPLICATE_WINDOW_MS = parsePositiveInt(process.env.SIGNUP_DUPLICATE_WINDOW_MS, 10 * 60 * 1000);
const SIGNUP_MIN_ELAPSED_MS = parsePositiveInt(process.env.SIGNUP_MIN_ELAPSED_MS, 2500);
const CUSTOMER_DASHBOARD_IP_WINDOW_MS = parsePositiveInt(process.env.CUSTOMER_DASHBOARD_IP_WINDOW_MS, 15 * 60 * 1000);
const CUSTOMER_DASHBOARD_IP_MAX_REQUESTS = parsePositiveInt(process.env.CUSTOMER_DASHBOARD_IP_MAX_REQUESTS, 30);
const CUSTOMER_DASHBOARD_LOOKUP_WINDOW_MS = parsePositiveInt(process.env.CUSTOMER_DASHBOARD_LOOKUP_WINDOW_MS, 60 * 60 * 1000);
const CUSTOMER_DASHBOARD_LOOKUP_MAX_REQUESTS = parsePositiveInt(process.env.CUSTOMER_DASHBOARD_LOOKUP_MAX_REQUESTS, 8);
const CUSTOMER_DASHBOARD_SESSION_COOKIE = "myaipa_customer_dashboard_session";
const CUSTOMER_DASHBOARD_SESSION_TTL_MS = parsePositiveInt(process.env.CUSTOMER_DASHBOARD_SESSION_TTL_MS, 12 * 60 * 60 * 1000);
const CUSTOMER_DASHBOARD_CODE_TTL_MS = parsePositiveInt(process.env.CUSTOMER_DASHBOARD_CODE_TTL_MS, 10 * 60 * 1000);
const CUSTOMER_DASHBOARD_CODE_MAX_ATTEMPTS = Math.max(1, Math.min(10, parsePositiveInt(process.env.CUSTOMER_DASHBOARD_CODE_MAX_ATTEMPTS, 5)));
const CUSTOMER_SUPPORT_SUGGESTION_WINDOW_MS = 15 * 60 * 1000;
const CUSTOMER_SUPPORT_SUGGESTION_MAX_REQUESTS = 6;
const CUSTOMER_SUPPORT_REPORT_WINDOW_MS = 60 * 60 * 1000;
const CUSTOMER_SUPPORT_REPORT_MAX_REQUESTS = 6;
const WEBSITE_FETCH_TIMEOUT_MS = 8000;
const WEBSITE_MAX_HTML_CHARS = 250000;
const WEBSITE_MAX_EXTRA_PAGES = 3;
const ADMIN_SESSION_COOKIE = "myaipa_admin_session";
const ADMIN_SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const ADMIN_TOTP_SECRET = String(process.env.ADMIN_TOTP_SECRET || "").trim();
const EXPOSE_CALL_TRANSCRIPTS_IN_ADMIN = /^(1|true|yes|on)$/i.test(String(process.env.EXPOSE_CALL_TRANSCRIPTS_IN_ADMIN || ""));
const EXPOSE_RECORDING_URLS_IN_ADMIN = /^(1|true|yes|on)$/i.test(String(process.env.EXPOSE_RECORDING_URLS_IN_ADMIN || ""));
const CALL_TRANSCRIPT_RETENTION_DAYS = Math.max(0, Number(process.env.CALL_TRANSCRIPT_RETENTION_DAYS || 0) || 0);
const CALL_RECORDING_RETENTION_DAYS = Math.max(0, Number(process.env.CALL_RECORDING_RETENTION_DAYS || 0) || 0);
const ADMIN_AUDIT_RETENTION_DAYS = Math.max(30, Number(process.env.ADMIN_AUDIT_RETENTION_DAYS || 365) || 365);
const SENSITIVE_CALL_CLEANUP_INTERVAL_MS = 1000 * 60 * 60 * 6;
const SIGNUP_VERIFICATION_TTL_MS = parsePositiveInt(process.env.SIGNUP_VERIFICATION_TTL_MS, 24 * 60 * 60 * 1000);
const TRIAL_REMINDER_CHECK_INTERVAL_MS = parsePositiveInt(process.env.TRIAL_REMINDER_CHECK_INTERVAL_MS, 60 * 60 * 1000);
const TRIAL_HALFWAY_REMINDER_DAYS = parsePositiveInt(process.env.TRIAL_HALFWAY_REMINDER_DAYS, 7);
const TRIAL_USAGE_LIMIT_ENABLED = isEnabled(process.env.TRIAL_USAGE_LIMIT_ENABLED);
const TRIAL_USAGE_WARNING_SECONDS = parsePositiveInt(process.env.TRIAL_USAGE_WARNING_SECONDS, 20 * 60);
const TRIAL_USAGE_LIMIT_SECONDS = Math.max(
  TRIAL_USAGE_WARNING_SECONDS,
  parsePositiveInt(process.env.TRIAL_USAGE_LIMIT_SECONDS, 60 * 60)
);
const TRIAL_USAGE_COMPLETION_RESERVE_SECONDS = Math.min(
  TRIAL_USAGE_LIMIT_SECONDS,
  parsePositiveInt(process.env.TRIAL_USAGE_COMPLETION_RESERVE_SECONDS, 5 * 60)
);
const TRIAL_USAGE_POLICY_INTERVAL_MS = parsePositiveInt(process.env.TRIAL_USAGE_POLICY_INTERVAL_MS, 5 * 60 * 1000);
const TRIAL_USAGE_MIN_CALL_SECONDS = parsePositiveInt(process.env.TRIAL_USAGE_MIN_CALL_SECONDS, 15);
const TRIAL_USAGE_RESERVATION_GRACE_SECONDS = parsePositiveInt(process.env.TRIAL_USAGE_RESERVATION_GRACE_SECONDS, 120);
const TRIAL_USAGE_GATE_WEBHOOK_URL = String(
  process.env.TRIAL_USAGE_GATE_WEBHOOK_URL
    || `${String(process.env.PUBLIC_APP_URL || "https://api.myaipa.ca").trim().replace(/\/+$/, "")}/api/webhooks/voice`
).trim();
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_PRICE_ID = String(process.env.STRIPE_PRICE_ID || "").trim();
const STRIPE_WEBHOOK_SECRET = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
const STRIPE_TRIAL_DAYS = Math.max(0, Number(process.env.STRIPE_TRIAL_DAYS || 14) || 0);
const STRIPE_ADMIN_SUBSCRIPTION_LIMIT = Math.max(1, Math.min(500, Number(process.env.STRIPE_ADMIN_SUBSCRIPTION_LIMIT || 100) || 100));
const WEBHOOK_REPLAY_RETENTION_MS = Math.min(
  30 * 24 * 60 * 60 * 1000,
  parsePositiveInt(process.env.WEBHOOK_REPLAY_RETENTION_MS, 7 * 24 * 60 * 60 * 1000)
);
const WEBHOOK_PROCESSING_LEASE_MS = Math.min(
  30 * 60 * 1000,
  parsePositiveInt(process.env.WEBHOOK_PROCESSING_LEASE_MS, 5 * 60 * 1000)
);
const WEBHOOK_REPLAY_MAX_ENTRIES = Math.min(50000, parsePositiveInt(process.env.WEBHOOK_REPLAY_MAX_ENTRIES, 5000));
const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;
const VAPI_API_KEY = String(process.env.VAPI_API_KEY || "").trim();
const VAPI_API_BASE_URL = String(process.env.VAPI_API_BASE_URL || "https://api.vapi.ai").trim().replace(/\/+$/, "");
const VAPI_PREVIEW_ASSISTANT_ID = String(process.env.VAPI_PREVIEW_ASSISTANT_ID || "").trim();
const VAPI_PREVIEW_MAX_DURATION_SECONDS = Math.max(
  15,
  Math.min(60, Number(process.env.VAPI_PREVIEW_MAX_DURATION_SECONDS || 60) || 60)
);
const VAPI_CALL_LIMIT = Math.max(1, Math.min(1000, Number(process.env.VAPI_CALL_LIMIT || 100) || 100));
const VAPI_DEFAULT_BUSINESS_ID = parsePositiveInt(process.env.VAPI_DEFAULT_BUSINESS_ID, 1);
const VAPI_VOICE_SIGNUP_PHONE = normalizePhoneForMatch(
  process.env.VAPI_VOICE_SIGNUP_PHONE || "+12495033301"
);
const VAPI_VOICE_SIGNUP_SMS_FROM = normalizePhoneForMatch(
  process.env.VAPI_VOICE_SIGNUP_SMS_FROM || VAPI_VOICE_SIGNUP_PHONE
);
const VAPI_VOICE_SIGNUP_PHONE_NUMBER_ID = String(
  process.env.VAPI_VOICE_SIGNUP_PHONE_NUMBER_ID || "236c7331-e3a4-4061-b304-8b551f1ca064"
).trim();
const VAPI_VOICE_SIGNUP_ASSISTANT_ID = String(
  process.env.VAPI_VOICE_SIGNUP_ASSISTANT_ID || "6f734a42-2d3a-47db-b883-e5d147dffb63"
).trim();
const VAPI_REQUIRE_BUSINESS_MAPPING = process.env.VAPI_REQUIRE_BUSINESS_MAPPING == null
  ? String(process.env.NODE_ENV || "").toLowerCase() === "production"
  : isEnabled(process.env.VAPI_REQUIRE_BUSINESS_MAPPING);
const VAPI_AUTO_SYNC_INTERVAL_MS = parsePositiveInt(process.env.VAPI_AUTO_SYNC_INTERVAL_MS, 15 * 60 * 1000);
const VAPI_AUTO_SYNC_ENABLED = isEnabled(process.env.VAPI_AUTO_SYNC_ENABLED);
const LEAD_HANDOFF_CHECK_INTERVAL_MS = parsePositiveInt(process.env.LEAD_HANDOFF_CHECK_INTERVAL_MS, 60 * 1000);
const TWILIO_ACCOUNT_SID = String(process.env.TWILIO_ACCOUNT_SID || "").trim();
const TWILIO_AUTH_TOKEN = String(process.env.TWILIO_AUTH_TOKEN || "").trim();
const TWILIO_API_KEY_SID = String(process.env.TWILIO_API_KEY_SID || "").trim();
const TWILIO_API_KEY_SECRET = String(process.env.TWILIO_API_KEY_SECRET || "").trim();
const TWILIO_STATUS_CALLBACK_URL = String(process.env.TWILIO_STATUS_CALLBACK_URL || "").trim();
const TWILIO_API_BASE_URL = String(process.env.TWILIO_API_BASE_URL || "https://api.twilio.com").trim().replace(/\/+$/, "");
const SMS_SUPPRESSION_API_KEY = String(process.env.SMS_SUPPRESSION_API_KEY || "").trim();
const SMS_SUPPRESSION_CHECK_URL = String(
  process.env.SMS_SUPPRESSION_CHECK_URL || "https://api.myaipa.ca/api/integrations/sms/suppression/check"
).trim();
const INTEGRATION_API_KEY = String(process.env.INTEGRATION_API_KEY || process.env.MAKE_SIGNUP_WEBHOOK_API_KEY || "").trim();
const MONITOR_API_KEY = String(process.env.MONITOR_API_KEY || "").trim();
const VAPI_WEBHOOK_SECRET = String(process.env.VAPI_WEBHOOK_SECRET || "").trim();
const FIXED_MONTHLY_COSTS_JSON = String(process.env.FIXED_MONTHLY_COSTS_JSON || "").trim();
const FIXED_MONTHLY_COST_USD = numberOrNull(process.env.FIXED_MONTHLY_COST_USD) || 0;
const MISSED_CALL_ALERT_ENABLED = isEnabled(process.env.MISSED_CALL_ALERT_ENABLED);
const DAILY_DIGEST_ENABLED = isEnabled(process.env.DAILY_DIGEST_ENABLED);
const FRONTEND_APP_URL = String(process.env.FRONTEND_APP_URL || "https://www.myaipa.ca").trim().replace(/\/+$/, "");
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || "").trim();
const GITHUB_SUPPORT_TOKEN = String(process.env.GITHUB_SUPPORT_TOKEN || "").trim();
const GITHUB_SUPPORT_REPO = String(process.env.GITHUB_SUPPORT_REPO || "OllieinCanada/MyA.I.PA").trim();
const GITHUB_SUPPORT_LABELS = parseCsv(process.env.GITHUB_SUPPORT_LABELS || "");
const DEFAULT_ALLOWED_ORIGINS = [
  "https://www.myaipa.ca",
  "https://myaipa.ca",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
];
const ALLOWED_ORIGINS = parseCsv(process.env.ALLOWED_ORIGINS || process.env.CORS_ORIGINS);
let vapiPreviewJwtMaterialCache = null;
const vapiPreviewCallLeases = new Map();
const VAPI_PREVIEW_MAX_CONCURRENT_CALLS = 2;

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

app.use(applySecurityHeaders);
app.use(noStoreSensitiveApiResponses);

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

  const replayClaim = await claimWebhookEvent({ provider: "stripe", eventId: event.id, eventType: event.type });
  if (replayClaim.duplicate) {
    return res.json({ received: true, duplicate: true });
  }
  if (!replayClaim.claimed) {
    const error = new Error("The webhook replay claim could not be established.");
    error.statusCode = 503;
    throw error;
  }

  try {
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
      const pendingSignup = takePendingStripeSignup(object.id);
      const checkoutRecord = upsertSignupDashboardFromCheckoutSession(object, {
        status: "checkout_completed",
        ...(pendingSignup?.summary || {}),
      });
      if (pendingSignup?.payload) {
        const makePayload = buildStripeSignupMakePayload(pendingSignup.payload, object);
        try {
          const makeResult = await sendMakeSignupCompleted(makePayload);
          const makeData = makeResult.data || {};
          if (!getMakeSignupSuccess(makeData)) {
            upsertSignupDashboardRecord({
              ...checkoutRecord,
              ...(pendingSignup.summary || {}),
              status: "setup_error",
              makeStatus: makeResult.status,
              makeError: makeData?.error || "Make webhook did not complete after Stripe checkout.",
            });
          } else {
            upsertSignupDashboardRecord({
              ...checkoutRecord,
              ...(pendingSignup.summary || {}),
              status: "setup_started",
              makeStatus: makeResult.status,
              twilioPhoneNumber: getMakeTwilioPhoneNumber(makeData) || getMakeTwilioPhoneNumberFromText(makeResult.body),
            });
          }
        } catch (error) {
          console.error("[stripe:webhook] Make handoff after checkout failed", {
            checkoutSessionId: object.id,
            message: error?.message || String(error),
          });
          upsertSignupDashboardRecord({
            ...checkoutRecord,
            ...(pendingSignup.summary || {}),
            status: "setup_error",
            makeError: error?.message || "Make handoff failed after Stripe checkout.",
          });
        }
      }
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

    const replayCompleted = await completeWebhookEvent(replayClaim);
    if (!replayCompleted) {
      const error = new Error("The webhook replay claim could not be completed.");
      error.statusCode = 503;
      throw error;
    }
    res.json({ received: true, duplicate: false });
  } catch (error) {
    await releaseWebhookEvent(replayClaim);
    throw error;
  }
}));

app.use(express.json({ limit: JSON_BODY_LIMIT }));

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

function loadPowerShellEnvAssignments(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*\$env:([A-Z][A-Z0-9_]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/);
    if (!match) continue;
    const key = match[1];
    if (process.env[key]) continue;
    process.env[key] = String(match[2] ?? match[3] ?? match[4] ?? "").trim();
  }
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

function applySecurityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
  if (String(req.path || "").startsWith("/api/")) {
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
  }
  next();
}

function noStoreSensitiveApiResponses(req, res, next) {
  if (/^\/api\/(admin|customer|leads\/acknowledge)\b/.test(String(req.path || ""))) {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }
  next();
}

function acknowledgementPage({ token, state = "confirm" }) {
  const safeToken = String(token || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const states = {
    confirm: { eyebrow: "New lead", title: "Confirm you received this lead", body: "This records that a person has seen the lead. It will stop the backup-contact escalation.", action: true },
    success: { eyebrow: "Lead acknowledged", title: "You’re all set", body: "My AI PA recorded your acknowledgement. You can close this page.", action: false },
    already: { eyebrow: "Already acknowledged", title: "This lead is already confirmed", body: "No further action is required.", action: false },
    invalid: { eyebrow: "Link unavailable", title: "This acknowledgement link is invalid", body: "Open the original owner text again or contact your administrator.", action: false },
    expired: { eyebrow: "Link expired", title: "This acknowledgement link has expired", body: "Contact your administrator so the lead can be reviewed manually.", action: false },
  };
  const copy = states[state] || states.invalid;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${copy.title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07142d;color:#fff;font:18px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}.card{width:min(560px,calc(100% - 40px));box-sizing:border-box;padding:38px;border:1px solid #29436e;border-radius:24px;background:#0d1e3d;box-shadow:0 24px 80px #0007}.eyebrow{color:#70d7ff;font-size:14px;font-weight:800;letter-spacing:.14em;text-transform:uppercase}h1{font-size:clamp(30px,7vw,46px);line-height:1.05;margin:12px 0 18px}p{color:#d9e7ff;margin:0 0 28px}button{width:100%;border:0;border-radius:14px;padding:17px 20px;background:#16a765;color:white;font:800 18px system-ui;cursor:pointer}small{display:block;margin-top:18px;color:#9eb2d2}</style></head><body><main class="card"><div class="eyebrow">${copy.eyebrow}</div><h1>${copy.title}</h1><p>${copy.body}</p>${copy.action ? `<form method="post" action="/api/leads/acknowledge"><input type="hidden" name="token" value="${safeToken}"><button type="submit">Acknowledge lead</button></form><small>Opening this page does not confirm the lead. Only the button does.</small>` : ""}</main></body></html>`;
}

function sendAcknowledgementPage(res, { token = "", state, statusCode = 200 }) {
  res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'");
  return res.status(statusCode).type("html").send(acknowledgementPage({ token, state }));
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
    "SameSite=Lax",
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
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isProduction) {
    cookie.push("Secure");
  }
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function getCustomerDashboardSessionSecret() {
  const secret = String(process.env.CUSTOMER_DASHBOARD_SESSION_SECRET || process.env.ADMIN_SESSION_SECRET || "").trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    const err = new Error("CUSTOMER_DASHBOARD_SESSION_SECRET or ADMIN_SESSION_SECRET must be configured.");
    err.statusCode = 500;
    throw err;
  }
  return "myaipa-local-customer-dashboard-session";
}

function getCustomerDashboardLookupHash(email, phone) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPhone = normalizePhoneForMatch(phone);
  if (!normalizedEmail || !normalizedPhone) return "";
  return hashKey(`${normalizedEmail}|${normalizedPhone}`);
}

function hashCustomerDashboardCode(lookupHash, code) {
  return crypto
    .createHmac("sha256", getCustomerDashboardSessionSecret())
    .update(`customer-dashboard-code:${lookupHash}:${String(code || "")}`)
    .digest("hex");
}

async function createCustomerDashboardLoginCode(lookupHash, now = Date.now()) {
  const normalizedLookupHash = String(lookupHash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalizedLookupHash)) return "";
  const code = String(crypto.randomInt(100000, 1000000));
  await storeDashboardLoginCode({
    lookupHash: normalizedLookupHash,
    codeHash: hashCustomerDashboardCode(normalizedLookupHash, code),
    expiresAt: now + CUSTOMER_DASHBOARD_CODE_TTL_MS,
    now,
  });
  return code;
}

async function verifyCustomerDashboardLoginCode(lookupHash, code, now = Date.now()) {
  const normalizedLookupHash = String(lookupHash || "").trim().toLowerCase();
  const suppliedHash = hashCustomerDashboardCode(normalizedLookupHash, String(code || "").replace(/\D/g, ""));
  return verifyDashboardLoginCode({
    lookupHash: normalizedLookupHash,
    codeHash: suppliedHash,
    maxAttempts: CUSTOMER_DASHBOARD_CODE_MAX_ATTEMPTS,
    now,
  });
}

function maskCustomerDashboardPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits.length >= 4 ? `••• ••• ${digits.slice(-4)}` : "your registered phone";
}

function signCustomerDashboardSessionPayload(payload) {
  return crypto
    .createHmac("sha256", getCustomerDashboardSessionSecret())
    .update(`customer-dashboard:${payload}`)
    .digest("hex");
}

function createCustomerDashboardSessionToken({ email, phone }) {
  const lookupHash = getCustomerDashboardLookupHash(email, phone);
  if (!lookupHash) return "";
  const payload = Buffer.from(
    JSON.stringify({
      v: 1,
      lookupHash,
      exp: Date.now() + CUSTOMER_DASHBOARD_SESSION_TTL_MS,
    })
  ).toString("base64url");
  return `${payload}.${signCustomerDashboardSessionPayload(payload)}`;
}

function getCustomerDashboardSessionLookupHash(req) {
  const token = parseCookies(req)[CUSTOMER_DASHBOARD_SESSION_COOKIE];
  if (!token || !token.includes(".")) return "";
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return "";

  const expectedSignature = signCustomerDashboardSessionPayload(payload);
  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return "";
  }

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data?.v !== 1 || Number(data?.exp || 0) <= Date.now()) return "";
    return /^[a-f0-9]{32}$/.test(String(data?.lookupHash || "")) ? data.lookupHash : "";
  } catch (_err) {
    return "";
  }
}

function setCustomerDashboardSessionCookie(res, token) {
  const isProduction = process.env.NODE_ENV === "production";
  const cookie = [
    `${CUSTOMER_DASHBOARD_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/api/customer/dashboard",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(CUSTOMER_DASHBOARD_SESSION_TTL_MS / 1000)}`,
  ];
  if (isProduction) cookie.push("Secure");
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function clearCustomerDashboardSessionCookie(res) {
  const isProduction = process.env.NODE_ENV === "production";
  const cookie = [
    `${CUSTOMER_DASHBOARD_SESSION_COOKIE}=`,
    "Path=/api/customer/dashboard",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (isProduction) cookie.push("Secure");
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function hasValidAdminPassword(req, { allowBody = false } = {}) {
  const supplied = req.headers["x-admin-password"] || (allowBody ? req.body?.password : "");
  return safeEqualString(supplied, getAdminPassword());
}

function getMakeSignupWebhookConfig() {
  return {
    url: String(process.env.MAKE_SIGNUP_WEBHOOK_URL || "").trim(),
    apiKey: String(process.env.MAKE_SIGNUP_WEBHOOK_API_KEY || "").trim(),
  };
}

function getMakeSignupWebhookToken() {
  try {
    const url = new URL(getMakeSignupWebhookConfig().url);
    return url.pathname.split("/").filter(Boolean).pop() || "";
  } catch (_err) {
    return "";
  }
}

function safeEqualString(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function hasValidIntegrationKey(req) {
  if (!INTEGRATION_API_KEY) return false;
  const authHeader = String(req.headers.authorization || "").trim();
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const supplied =
    String(req.headers["x-myaipa-integration-key"] || "").trim() ||
    String(req.headers["x-vapi-secret"] || "").trim() ||
    String(req.headers["x-api-key"] || "").trim() ||
    String(req.headers["x-make-apikey"] || "").trim() ||
    String(bearerMatch?.[1] || "").trim();
  return safeEqualString(supplied, INTEGRATION_API_KEY);
}

function getVapiWebhookSecret() {
  const resolved = resolveVapiWebhookSecret({
    configuredSecret: VAPI_WEBHOOK_SECRET,
    apiKey: VAPI_API_KEY,
    nodeEnv: process.env.NODE_ENV,
  });
  if (resolved.secret) return resolved.secret;
  return String(process.env.NODE_ENV || "").toLowerCase() === "production" ? "" : INTEGRATION_API_KEY;
}

function hasValidVapiWebhookKey(req) {
  const expected = getVapiWebhookSecret();
  if (!expected) return false;
  const authHeader = String(req.headers.authorization || "").trim();
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const supplied = String(req.headers["x-vapi-secret"] || "").trim()
    || String(bearerMatch?.[1] || "").trim();
  return safeEqualString(supplied, expected);
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

function ensurePendingStripeSignupStore() {
  fs.mkdirSync(path.dirname(pendingStripeSignupPath), { recursive: true });
  if (!fs.existsSync(pendingStripeSignupPath)) {
    fs.writeFileSync(pendingStripeSignupPath, "{}\n");
  }
}

function readPendingStripeSignupStore() {
  ensurePendingStripeSignupStore();
  try {
    const data = JSON.parse(fs.readFileSync(pendingStripeSignupPath, "utf8"));
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

function writePendingStripeSignupStore(store) {
  ensurePendingStripeSignupStore();
  fs.writeFileSync(pendingStripeSignupPath, `${JSON.stringify(store, null, 2)}\n`);
}

function prunePendingStripeSignupStore(store, now = Date.now()) {
  const ttlMs = Math.max(SIGNUP_VERIFICATION_TTL_MS, 7 * 24 * 60 * 60 * 1000);
  for (const [sessionId, record] of Object.entries(store)) {
    if (record?.completedAt || Number(record?.createdAt || 0) + ttlMs <= now) {
      delete store[sessionId];
    }
  }
  return store;
}

function savePendingStripeSignup(session, record) {
  const sessionId = String(session?.id || "").trim();
  if (!sessionId) return;
  const store = prunePendingStripeSignupStore(readPendingStripeSignupStore());
  store[sessionId] = {
    ...record,
    sessionId,
    checkoutUrl: session?.url || "",
    createdAt: Date.now(),
  };
  writePendingStripeSignupStore(store);
}

function takePendingStripeSignup(sessionId) {
  const key = String(sessionId || "").trim();
  if (!key) return null;
  const store = prunePendingStripeSignupStore(readPendingStripeSignupStore());
  const record = store[key] || null;
  if (record) {
    delete store[key];
    writePendingStripeSignupStore(store);
  }
  return record;
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

function removePendingSignupVerification(token) {
  const tokenHash = hashSignupVerificationToken(token);
  const store = prunePendingSignupStore(readPendingSignupStore());
  if (!store[tokenHash]) return;
  delete store[tokenHash];
  writePendingSignupStore(store);
}

async function beginVoiceSignupVerification({ req, parameters, call }) {
  const payload = buildVoiceSignupPayload(parameters, {
    callId: call?.id || call?.callId || call?.externalId || "",
  });
  const owner = payload.owner || {};
  const business = payload.business || {};
  const token = createPendingSignupVerification({
    payload,
    ownerEmail: owner.email,
    businessName: business.name,
    reviewReasons: [],
    ipHash: hashKey(`voice:${payload.source?.callId || owner.phone || owner.email}`),
  });
  const verificationUrl = getSignupVerificationUrl(req, token);
  let emailResult = null;
  let emailError = null;
  let smsResult = null;
  let smsError = null;

  try {
    emailResult = await sendSignupVerificationEmail({
      req,
      ownerEmail: owner.email,
      ownerName: owner.name,
      businessName: business.name,
      token,
    });
  } catch (error) {
    emailError = error;
  }

  try {
    smsResult = await sendSmsViaTwilio({
      to: owner.phone,
      message: `My AI PA signup for ${business.name}: verify your contact details to continue setup. ${verificationUrl} This link expires in 24 hours.`,
      env: getVapiVoiceSignupSmsEnvironment(),
    });
  } catch (error) {
    smsError = error;
  }

  const emailSent = emailResult?.sent === true;
  const smsSent = Boolean(smsResult && smsResult.mocked !== true);
  if (!emailSent && !smsSent) {
    removePendingSignupVerification(token);
    const error = new Error("The signup details were valid, but the verification link could not be delivered.");
    error.statusCode = 503;
    error.code = "VOICE_SIGNUP_VERIFICATION_DELIVERY_FAILED";
    error.deliveryErrors = {
      email: emailError?.code || emailError?.message || "not_sent",
      sms: smsError?.code || smsError?.message || "not_sent",
    };
    throw error;
  }

  upsertSignupDashboardFromPayload(payload, {
    status: "pending_email_verification",
    emailVerificationRequired: true,
    emailVerificationSentAt: emailSent ? new Date().toISOString() : undefined,
    smsVerificationSentAt: smsSent ? new Date().toISOString() : undefined,
    signupSource: "voice",
    vapiCallId: payload.source?.callId || "",
    reviewRequired: false,
    reviewReasons: [],
  });

  const deliveryChannels = [
    ...(emailSent ? ["email"] : []),
    ...(smsSent ? ["text message"] : []),
  ];
  const deliveryMessage = emailSent && smsSent
    ? "We got your email. The verification link is being sent there and by text from the number you called."
    : emailSent
      ? "We got your email, and the verification link is being sent there now."
      : "We got your email. The verification link was sent by text from the number you called.";
  return {
    ok: true,
    businessName: business.name,
    verificationRequired: true,
    deliveryChannels,
    message: `${deliveryMessage} Once you verify it, we'll finish setup and send your assistant number.`,
  };
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

function getWebhookReplayKey(provider, eventId) {
  const normalizedProvider = String(provider || "").trim().toLowerCase().slice(0, 80);
  const normalizedEventId = String(eventId || "").trim().slice(0, 240);
  if (!normalizedProvider || !normalizedEventId) return "";
  return hashKey(`${normalizedProvider}:${normalizedEventId}`);
}

function pruneWebhookReplayStore(store, now = Date.now(), maxEntries = WEBHOOK_REPLAY_MAX_ENTRIES) {
  const result = store && typeof store === "object" && !Array.isArray(store) ? store : {};
  for (const [key, record] of Object.entries(result)) {
    if (!record || Number(record.expiresAt || 0) <= now) delete result[key];
  }

  const entries = Object.entries(result);
  if (entries.length > maxEntries) {
    entries
      .sort((a, b) => Number(a[1]?.claimedAt || 0) - Number(b[1]?.claimedAt || 0))
      .slice(0, entries.length - maxEntries)
      .forEach(([key]) => delete result[key]);
  }
  return result;
}

function claimWebhookReplayStore(store, { provider, eventId, eventType = "", now = Date.now(), claimToken = "" } = {}) {
  const key = getWebhookReplayKey(provider, eventId);
  if (!key) return { claimed: false, duplicate: false, skipped: true, key: "" };

  const normalizedStore = pruneWebhookReplayStore(store, now);
  const existing = normalizedStore[key];
  if (
    existing?.status === "completed" ||
    (existing?.status === "processing" && Number(existing.leaseExpiresAt || 0) > now)
  ) {
    return {
      claimed: false,
      duplicate: true,
      skipped: false,
      key,
      status: existing.status,
    };
  }

  const token = claimToken || crypto.randomBytes(18).toString("base64url");
  normalizedStore[key] = {
    provider: String(provider || "").trim().toLowerCase().slice(0, 80),
    eventIdHash: hashKey(String(eventId || "").trim()),
    eventType: String(eventType || "").trim().slice(0, 160),
    status: "processing",
    claimToken: token,
    claimedAt: now,
    leaseExpiresAt: now + WEBHOOK_PROCESSING_LEASE_MS,
    expiresAt: now + WEBHOOK_REPLAY_RETENTION_MS,
  };
  pruneWebhookReplayStore(normalizedStore, now);
  return { claimed: true, duplicate: false, skipped: false, key, claimToken: token };
}

async function claimWebhookEvent(details) {
  const key = getWebhookReplayKey(details?.provider, details?.eventId);
  return claimWebhookReplay({
    key,
    provider: details?.provider,
    eventIdHash: hashKey(String(details?.eventId || "").trim()),
    eventType: details?.eventType,
    now: details?.now,
    claimToken: details?.claimToken,
    leaseMs: WEBHOOK_PROCESSING_LEASE_MS,
    retentionMs: WEBHOOK_REPLAY_RETENTION_MS,
  });
}

async function completeWebhookEvent(claim, now = Date.now()) {
  if (!claim?.claimed || !claim.key || !claim.claimToken) return false;
  return completeWebhookReplay({
    key: claim.key,
    claimToken: claim.claimToken,
    retentionMs: WEBHOOK_REPLAY_RETENTION_MS,
    now,
  });
}

async function releaseWebhookEvent(claim) {
  if (!claim?.claimed || !claim.key || !claim.claimToken) return false;
  return releaseWebhookReplay({ key: claim.key, claimToken: claim.claimToken });
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
    const cursor = getVapiNestedValue(value, pathKey);
    if (cursor != null && String(cursor).trim()) return String(cursor).trim();
  }
  return "";
}

function getVapiNestedValue(value, pathKey) {
  const parts = String(pathKey || "").split(".");
  let cursor = value;
  for (const part of parts) {
    cursor = cursor && typeof cursor === "object" ? cursor[part] : undefined;
  }
  return cursor;
}

function formatVapiTranscriptValue(value) {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (!item || typeof item !== "object") return "";
      const role = item.role || item.speaker || item.name || item.type || "speaker";
      const message = item.message || item.content || item.text || item.transcript || "";
      if (!String(message || "").trim()) return "";
      const time = Number(item.time ?? item.start ?? item.startTime);
      const timePrefix = Number.isFinite(time) ? `[${Math.floor(time / 60)}:${String(Math.round(time % 60)).padStart(2, "0")}] ` : "";
      return `${timePrefix}${String(role).trim()}: ${String(message).trim()}`;
    })
    .filter(Boolean)
    .join("\n");
}

function summarizeVapiToolCalls(call) {
  const names = [];
  const visited = new Set();

  function visit(value) {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);

    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    for (const key of ["toolCallList", "toolCalls", "tool_calls"]) {
      const calls = Array.isArray(value[key]) ? value[key] : [];
      for (const toolCall of calls) {
        const name = getVapiNestedString(toolCall, ["function.name", "name"]);
        if (name) names.push(name);
        visit(toolCall);
      }
    }

    const eventType = String(value.type || value.role || "").trim().toLowerCase();
    if (/tool[-_ ]?call/.test(eventType)) {
      const name = getVapiNestedString(value, ["function.name", "name"]);
      if (name) names.push(name);
    }

    for (const nested of Object.values(value)) visit(nested);
  }

  visit(call);
  const toolNames = [...new Set(names)];
  return { count: names.length, toolNames };
}

function summarizeVapiToolEnvironmentVariables(tool) {
  const variables = tool?.environmentVariables;
  if (Array.isArray(variables)) {
    return variables
      .map((variable) => {
        const name = String(variable?.name || variable?.key || "").trim();
        const configured = Boolean(
          typeof variable === "string"
            ? variable.trim()
            : variable?.value || variable?.secret || variable?.secretId || variable?.credentialId
        );
        return name ? { name, configured } : null;
      })
      .filter(Boolean);
  }
  if (variables && typeof variables === "object") {
    return Object.entries(variables)
      .map(([name, value]) => ({
        name: String(name).trim(),
        configured: Boolean(
          typeof value === "string"
            ? value.trim()
            : value?.value || value?.secret || value?.secretId || value?.credentialId || value?.id
        ),
      }))
      .filter((variable) => variable.name);
  }
  return [];
}

function getVapiToolEnvironmentVariableValue(tool, variableName) {
  const variables = tool?.environmentVariables;
  if (Array.isArray(variables)) {
    const variable = variables.find(
      (item) => String(item?.name || item?.key || "").trim() === variableName
    );
    if (typeof variable === "string") return variable.trim();
    return String(variable?.value || variable?.secret || "").trim();
  }
  if (variables && typeof variables === "object") {
    const variable = variables[variableName];
    if (typeof variable === "string") return variable.trim();
    return String(variable?.value || variable?.secret || "").trim();
  }
  return "";
}

function summarizeVapiToolResults(call) {
  const callNames = new Map();
  const results = [];
  const visited = new Set();

  function safeResult(value) {
    let parsed = value;
    if (typeof value === "string") parsed = parseJsonObject(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return {
      ok: typeof parsed.ok === "boolean" ? parsed.ok : null,
      sent: typeof parsed.sent === "boolean" ? parsed.sent : null,
      skipped: typeof parsed.skipped === "boolean" ? parsed.skipped : null,
      status: String(parsed.status || "").trim().slice(0, 80),
      error: String(parsed.error || parsed.message || "").trim().slice(0, 240),
      owner: parsed.owner && typeof parsed.owner === "object" ? {
        sent: parsed.owner.sent === true,
        status: String(parsed.owner.status || "").trim().slice(0, 80),
        errorCode: String(parsed.owner.errorCode || "").trim().slice(0, 80),
        toLast4: String(parsed.owner.toLast4 || "").replace(/\D/g, "").slice(-4),
        fromLast4: String(parsed.owner.fromLast4 || "").replace(/\D/g, "").slice(-4),
      } : null,
      customer: parsed.customer && typeof parsed.customer === "object" ? {
        sent: parsed.customer.sent === true,
        status: String(parsed.customer.status || "").trim().slice(0, 80),
        errorCode: String(parsed.customer.errorCode || "").trim().slice(0, 80),
        toLast4: String(parsed.customer.toLast4 || "").replace(/\D/g, "").slice(-4),
        fromLast4: String(parsed.customer.fromLast4 || "").replace(/\D/g, "").slice(-4),
      } : null,
    };
  }

  function visit(value) {
    if (!value || typeof value !== "object" || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }

    for (const key of ["toolCallList", "toolCalls", "tool_calls"]) {
      const calls = Array.isArray(value[key]) ? value[key] : [];
      for (const toolCall of calls) {
        const id = String(toolCall?.id || toolCall?.toolCallId || toolCall?.tool_call_id || "").trim();
        const name = getVapiNestedString(toolCall, ["function.name", "name"]);
        if (id && name) callNames.set(id, name);
      }
    }

    const eventType = String(value.type || value.role || "").trim().toLowerCase();
    const toolCallId = String(value.toolCallId || value.tool_call_id || "").trim();
    if (toolCallId || /tool[-_ ]?(call[-_ ]?)?result/.test(eventType)) {
      const rawResult = value.result ?? value.content ?? value.output ?? value.message;
      const result = safeResult(rawResult);
      if (result) {
        results.push({
          name: getVapiNestedString(value, ["name", "function.name"]) || callNames.get(toolCallId) || "unknown",
          ...result,
        });
      }
    }

    for (const nested of Object.values(value)) visit(nested);
  }

  visit(call);
  return results.filter(
    (result, index, items) =>
      index === items.findIndex((item) => JSON.stringify(item) === JSON.stringify(result))
  );
}

function summarizeCompositeNotificationHealth({ toolResults = [], aiNumber, ownerNumber, customerNumber } = {}) {
  const result = toolResults.find((item) => /^send_call_summaries_/i.test(String(item?.name || "")));
  if (!result) {
    return {
      status: "critical",
      code: "COMPOSITE_TOOL_RESULT_MISSING",
      summary: "No combined owner/customer notification result was recorded.",
    };
  }
  const expectedAi = normalizePhoneForMatch(aiNumber).slice(-4);
  const expectedOwner = normalizePhoneForMatch(ownerNumber).slice(-4);
  const expectedCustomer = normalizePhoneForMatch(customerNumber).slice(-4);
  const routingMismatch = Boolean(
    (expectedAi && [result.owner?.fromLast4, result.customer?.fromLast4].filter(Boolean).some((value) => value !== expectedAi)) ||
    (expectedOwner && result.owner?.toLast4 && result.owner.toLast4 !== expectedOwner) ||
    (expectedCustomer && result.customer?.toLast4 && result.customer.toLast4 !== expectedCustomer)
  );
  if (routingMismatch) {
    return {
      status: "critical",
      code: "SMS_ROUTING_MISMATCH",
      summary: "A notification sender or destination did not match the assigned business routing.",
    };
  }
  if (result.owner?.sent !== true) {
    return {
      status: "critical",
      code: "OWNER_SMS_FAILED",
      summary: "The owner notification was not accepted by Twilio.",
      errorCode: result.owner?.errorCode || "",
    };
  }
  if (result.customer?.sent !== true) {
    return {
      status: "warning",
      code: "CUSTOMER_SMS_FAILED",
      summary: "The owner notification succeeded, but the caller confirmation did not.",
      errorCode: result.customer?.errorCode || "",
    };
  }
  return {
    status: "healthy",
    code: "BOTH_SMS_ACCEPTED",
    summary: "Both owner and caller notifications were accepted with the expected routing.",
  };
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

  if (VAPI_REQUIRE_BUSINESS_MAPPING) {
    const error = new Error("No trusted business mapping matched this Vapi call.");
    error.statusCode = 422;
    error.code = "VAPI_BUSINESS_ROUTE_REQUIRED";
    throw error;
  }
  return VAPI_DEFAULT_BUSINESS_ID;
}

function getVapiVoiceSignupExecutionBusinessId(call = {}) {
  const calledNumber = normalizePhoneForMatch(
    call.phoneNumber?.number ||
      call.phoneNumber?.twilioPhoneNumber ||
      call.destination?.number ||
      call.to ||
      ""
  );
  const phoneNumberId = String(call.phoneNumberId || call.phoneNumber?.id || "").trim();
  const assistantId = String(call.assistantId || call.assistant?.id || "").trim();
  const trusted = Boolean(
    (VAPI_VOICE_SIGNUP_PHONE && calledNumber === VAPI_VOICE_SIGNUP_PHONE) ||
      (VAPI_VOICE_SIGNUP_PHONE_NUMBER_ID && phoneNumberId === VAPI_VOICE_SIGNUP_PHONE_NUMBER_ID) ||
      (VAPI_VOICE_SIGNUP_ASSISTANT_ID && assistantId === VAPI_VOICE_SIGNUP_ASSISTANT_ID)
  );
  if (!trusted) {
    const error = new Error("Voice signup is allowed only on the dedicated My AI PA signup line.");
    error.statusCode = 422;
    error.code = "VAPI_VOICE_SIGNUP_ROUTE_REQUIRED";
    throw error;
  }
  return VAPI_DEFAULT_BUSINESS_ID;
}

function getVapiVoiceSignupSmsEnvironment(env = process.env) {
  return {
    ...env,
    TWILIO_FROM_NUMBER: VAPI_VOICE_SIGNUP_SMS_FROM,
  };
}

function mapVapiStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("failed") || normalized.includes("error")) return "FAILED";
  if (normalized.includes("missed") || normalized.includes("no-answer") || normalized.includes("no_answer")) return "MISSED";
  if (["abandoned", "canceled", "cancelled"].includes(normalized)) return "ABANDONED";
  if (normalized.includes("ended") || normalized.includes("hangup")) return "COMPLETED";
  if (["ended", "completed", "complete", "success", "successful"].includes(normalized)) return "COMPLETED";
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
  const direct = getVapiNestedString(call, ["transcript", "analysis.transcript"]);
  if (direct) return direct;
  const artifactTranscript = formatVapiTranscriptValue(getVapiNestedValue(call, "artifact.transcript"));
  if (artifactTranscript) return artifactTranscript;
  const messages = formatVapiTranscriptValue(getVapiNestedValue(call, "artifact.messages"));
  if (messages) return messages;
  const openAiMessages = formatVapiTranscriptValue(getVapiNestedValue(call, "artifact.messagesOpenAIFormatted"));
  if (openAiMessages) return openAiMessages;
  const fallbackMessages = formatVapiTranscriptValue(call.messages || call.messagesOpenAIFormatted);
  if (fallbackMessages) return fallbackMessages;
  return getVapiNestedString(call, ["summary", "analysis.summary"]) || null;
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
      "artifact.recording.stereoUrl",
      "artifact.recording.mono.combinedUrl",
      "artifact.recording.mono.customerUrl",
      "artifact.recording.mono.url",
      "artifact.recording.stereo.url",
      "artifact.recording",
      "stereoRecordingUrl",
    ]) || null
  );
}

function getVapiCustomerSafeMessages(call) {
  const candidates = [
    getVapiNestedValue(call, "artifact.messages"),
    call?.messages,
  ];
  const messages = candidates.find(Array.isArray) || [];
  return messages.slice(0, 500).map((item) => ({
    role: String(item?.role || item?.speaker || item?.speakerLabel || "speaker").trim().slice(0, 40),
    message: String(item?.message || item?.text || item?.content || item?.transcript || "").trim().slice(0, 5000),
    secondsFromStart: numberOrNull(item?.secondsFromStart ?? item?.time ?? item?.startTime),
    duration: numberOrNull(item?.duration),
  })).filter((item) => item.message);
}

function getVapiArtifactMetrics(call) {
  const candidates = [
    getVapiNestedValue(call, "artifact.performanceMetrics"),
    getVapiNestedValue(call, "artifact.metrics"),
    getVapiNestedValue(call, "performanceMetrics"),
  ];
  const metrics = candidates.find((item) => item && typeof item === "object" && !Array.isArray(item));
  if (!metrics) return null;
  const allowed = [
    "modelLatencyAverage",
    "voiceLatencyAverage",
    "transcriberLatencyAverage",
    "endpointingLatencyAverage",
    "turnLatencyAverage",
    "fromTransportLatencyAverage",
    "toTransportLatencyAverage",
    "numUserInterrupted",
    "numAssistantInterrupted",
  ];
  return Object.fromEntries(
    allowed.map((key) => [key, numberOrNull(metrics[key])]).filter(([, value]) => value != null)
  );
}

function getVapiRecordingConsent(call) {
  const consent = getVapiNestedValue(call, "compliance.recordingConsent") || {};
  return {
    type: String(consent?.type || "").trim().slice(0, 80),
    grantedAt: consent?.grantedAt || null,
  };
}

function getSensitiveArtifactExpiry(days, basis = Date.now()) {
  const retentionDays = Math.max(0, Number(days || 0));
  if (!retentionDays) return null;
  const basisMs = new Date(basis || Date.now()).getTime();
  return new Date((Number.isFinite(basisMs) ? basisMs : Date.now()) + retentionDays * 24 * 60 * 60 * 1000).toISOString();
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

async function fetchVapiCallDetail(callId) {
  if (!VAPI_API_KEY) {
    const err = new Error("VAPI_API_KEY is not configured.");
    err.statusCode = 503;
    throw err;
  }
  const id = String(callId || "").trim();
  if (!id) {
    const err = new Error("Vapi call id is required.");
    err.statusCode = 400;
    throw err;
  }

  const response = await fetch(`${VAPI_API_BASE_URL}/call/${encodeURIComponent(id)}`, {
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      Accept: "application/json",
    },
  });
  const rawText = await response.text();
  const data = parseJsonObject(rawText);

  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `Vapi call detail fetch failed with HTTP ${response.status}.`);
    err.statusCode = response.status;
    throw err;
  }

  return data && typeof data === "object" ? data : null;
}

async function patchVapiAssistant(assistantId, patch) {
  if (!VAPI_API_KEY) {
    const err = new Error("VAPI_API_KEY is not configured.");
    err.statusCode = 503;
    throw err;
  }
  const id = String(assistantId || "").trim();
  if (!id) {
    const err = new Error("Vapi assistant id is required.");
    err.statusCode = 400;
    throw err;
  }

  const response = await fetch(`${VAPI_API_BASE_URL}/assistant/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch || {}),
  });
  const rawText = await response.text();
  const data = parseJsonObject(rawText);
  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `Vapi assistant update failed with HTTP ${response.status}.`);
    err.statusCode = response.status;
    throw err;
  }
  return data && typeof data === "object" ? data : null;
}

async function fetchVapiCollection(resourcePath, collectionKeys = []) {
  if (!VAPI_API_KEY) {
    const err = new Error("VAPI_API_KEY is not configured.");
    err.statusCode = 503;
    throw err;
  }

  const url = new URL(`${VAPI_API_BASE_URL}/${String(resourcePath || "").replace(/^\/+/, "")}`);
  url.searchParams.set("limit", "1000");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      Accept: "application/json",
    },
  });
  const rawText = await response.text();
  const data = parseJsonObject(rawText);

  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `Vapi ${resourcePath} fetch failed with HTTP ${response.status}.`);
    err.statusCode = response.status;
    throw err;
  }

  if (Array.isArray(data)) return data;
  for (const key of ["data", "items", "results", ...collectionKeys]) {
    if (Array.isArray(data?.[key])) return data[key];
  }
  return [];
}

async function requestVapiResource(resourcePath, { method = "GET", body } = {}) {
  if (!VAPI_API_KEY) {
    const err = new Error("VAPI_API_KEY is not configured.");
    err.statusCode = 503;
    throw err;
  }
  const response = await fetch(`${VAPI_API_BASE_URL}/${String(resourcePath || "").replace(/^\/+/, "")}`, {
    method,
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const rawText = await response.text();
  const data = parseJsonObject(rawText);
  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `Vapi ${method} request failed with HTTP ${response.status}.`);
    err.statusCode = response.status;
    throw err;
  }
  return data && typeof data === "object" ? data : {};
}

async function provisionIsolatedSmsForAssistant({ assistantId, aiNumber, ownerNumber }) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    const err = new Error("Twilio credentials are not configured.");
    err.statusCode = 503;
    throw err;
  }
  const id = String(assistantId || "").trim();
  if (!id) {
    const err = new Error("Vapi assistant id is required.");
    err.statusCode = 400;
    throw err;
  }
  const [assistant, tools] = await Promise.all([
    requestVapiResource(`assistant/${encodeURIComponent(id)}`),
    fetchVapiCollection("tool", ["tools"]),
  ]);
  const result = await provisionIsolatedSmsRouting({
    assistant,
    tools,
    aiNumber,
    ownerNumber,
    twilioAccountSid: TWILIO_ACCOUNT_SID,
    twilioAuthToken: TWILIO_AUTH_TOKEN,
    statusCallbackUrl: TWILIO_STATUS_CALLBACK_URL,
    suppressionCheckUrl: SMS_SUPPRESSION_CHECK_URL,
    suppressionApiKey: SMS_SUPPRESSION_API_KEY,
    createTool: (payload) => requestVapiResource("tool", { method: "POST", body: payload }),
    patchTool: (toolId, payload) => requestVapiResource(`tool/${encodeURIComponent(toolId)}`, { method: "PATCH", body: payload }),
    patchAssistant: patchVapiAssistant,
    fetchAssistant: (targetId) => requestVapiResource(`assistant/${encodeURIComponent(targetId)}`),
    fetchTool: (toolId) => requestVapiResource(`tool/${encodeURIComponent(toolId)}`),
    deleteTool: (toolId) => requestVapiResource(`tool/${encodeURIComponent(toolId)}`, { method: "DELETE" }),
  });
  return {
    created: result.created,
    reused: result.reused,
    updated: result.updated,
    assistantId: String(result.assistant?.id || id),
    toolId: String(result.tool?.id || ""),
    toolName: String(result.tool?.function?.name || result.tool?.name || ""),
    audit: result.audit,
  };
}

async function provisionIsolatedSmsForSignup({ ownerEmail, assistantId, aiNumber, ownerNumber }) {
  const email = String(ownerEmail || "").trim().toLowerCase();
  const signup = email && isValidEmailAddress(email)
    ? listSignupDashboardRecords().find((record) => String(record.ownerEmail || "").trim().toLowerCase() === email)
    : null;
  const resolvedOwnerNumber = normalizeVapiImportPhone(ownerNumber || signup?.ownerPhone || signup?.businessPhone);
  const resolvedAiNumber = normalizeVapiImportPhone(aiNumber || signup?.twilioPhoneNumber);
  const resolvedAssistantId = String(assistantId || signup?.vapiAssistantId || "").trim();
  if (!resolvedOwnerNumber || !resolvedAiNumber || !resolvedAssistantId) {
    return {
      skipped: true,
      reason: !resolvedOwnerNumber ? "owner_phone_missing" : !resolvedAiNumber ? "ai_phone_missing" : "assistant_missing",
    };
  }
  const result = await provisionIsolatedSmsForAssistant({
    assistantId: resolvedAssistantId,
    aiNumber: resolvedAiNumber,
    ownerNumber: resolvedOwnerNumber,
  });
  return {
    skipped: false,
    created: result.created,
    reused: result.reused,
    updated: result.updated,
    toolId: result.toolId,
    toolName: result.toolName,
    healthy: result.audit?.healthy === true,
    checks: result.audit?.checks || {},
    aiNumberLast4: resolvedAiNumber.slice(-4),
    ownerNumberLast4: resolvedOwnerNumber.slice(-4),
  };
}

async function safelyProvisionIsolatedSmsForSignup(input) {
  try {
    return await provisionIsolatedSmsForSignup(input);
  } catch (error) {
    return {
      skipped: false,
      failed: true,
      healthy: false,
      reason: "isolated_sms_provisioning_failed",
      error: String(error?.message || "Vapi isolated SMS provisioning failed.").slice(0, 240),
    };
  }
}

function normalizeVapiImportPhone(value) {
  const normalized = normalizePhoneForMatch(value);
  if (/^\+\d{10,15}$/.test(normalized)) return normalized;
  if (/^1\d{10}$/.test(normalized)) return `+${normalized}`;
  if (/^\d{10}$/.test(normalized)) return `+1${normalized}`;
  return "";
}

function sanitizeVapiImportName(value, fallback) {
  return String(value || fallback || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function summarizeVapiPhoneNumberImport(data, fallbackPhoneNumber) {
  return {
    id: String(data?.id || "").trim(),
    number: String(data?.number || data?.twilioPhoneNumber || fallbackPhoneNumber || "").trim(),
    name: String(data?.name || "").trim(),
    provider: String(data?.provider || "twilio").trim(),
    status: String(data?.status || "").trim(),
    assistantId: String(data?.assistantId || data?.assistant?.id || "").trim(),
    createdAt: data?.createdAt || null,
    updatedAt: data?.updatedAt || null,
  };
}

async function importTwilioPhoneNumberToVapi({ twilioPhoneNumber, assistantId, name }) {
  if (!VAPI_API_KEY) {
    const err = new Error("VAPI_API_KEY is not configured.");
    err.statusCode = 503;
    throw err;
  }

  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    const err = new Error("Twilio credentials are not configured.");
    err.statusCode = 503;
    throw err;
  }

  const phoneNumber = normalizeVapiImportPhone(twilioPhoneNumber);
  const vapiAssistantId = String(assistantId || "").trim();

  if (!phoneNumber) {
    const err = new Error("twilioPhoneNumber must be a valid E.164 phone number.");
    err.statusCode = 400;
    throw err;
  }

  if (!vapiAssistantId) {
    const err = new Error("assistantId is required.");
    err.statusCode = 400;
    throw err;
  }

  const payload = {
    twilioPhoneNumber: phoneNumber,
    twilioAccountSid: TWILIO_ACCOUNT_SID,
    twilioAuthToken: TWILIO_AUTH_TOKEN,
    name: sanitizeVapiImportName(name, `${phoneNumber} Number`),
    assistantId: vapiAssistantId,
  };

  const response = await fetch(`${VAPI_API_BASE_URL}/phone-number/import/twilio`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${VAPI_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const rawText = await response.text();
  const data = parseJsonObject(rawText);

  if (!response.ok) {
    const err = new Error(data?.message || data?.error || `Vapi Twilio import failed with HTTP ${response.status}.`);
    err.statusCode = response.status;
    throw err;
  }

  return summarizeVapiPhoneNumberImport(data, phoneNumber);
}

function getVapiPhoneNumber(record) {
  return (
    getVapiNestedString(record, [
      "number",
      "phoneNumber",
      "twilioPhoneNumber",
      "providerResourceId",
      "sipUri",
      "sip.uri",
    ]) || ""
  );
}

function getVapiAssistantName(record) {
  return getVapiNestedString(record, ["name", "assistant.name", "metadata.name"]) || "";
}

function getVapiAssistantId(record) {
  return getVapiNestedString(record, ["assistantId", "assistant.id"]) || "";
}

function findVapiInventoryMapping(record, mappings, type) {
  const rawCandidates = [
    record?.id,
    record?.phoneNumberId,
    record?.assistantId,
    getVapiAssistantId(record),
    getVapiPhoneNumber(record),
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean);
  const normalizedCandidates = new Set([
    ...rawCandidates.map((item) => item.toLowerCase()),
    ...rawCandidates.map((item) => normalizePhoneForMatch(item)).filter(Boolean),
  ]);
  const typeNeedle = type === "assistant" ? "assistant" : "phone";

  return mappings.find((mapping) => {
    const value = String(mapping.matchValue || "").trim().toLowerCase();
    if (!normalizedCandidates.has(value)) return false;
    const matchType = String(mapping.matchType || "").toLowerCase();
    return !matchType || matchType.includes(typeNeedle);
  });
}

async function getVapiAccountInventory() {
  const warnings = [];
  const [phoneResult, assistantResult, mappings] = await Promise.all([
    fetchVapiCollection("phone-number", ["phoneNumbers", "phone_numbers"]).catch((error) => {
      warnings.push(`Could not load Vapi phone numbers: ${error.message}`);
      return [];
    }),
    fetchVapiCollection("assistant", ["assistants", "agents"]).catch((error) => {
      warnings.push(`Could not load Vapi agents: ${error.message}`);
      return [];
    }),
    prisma.vapiBusinessMapping.findMany({ include: { business: true }, orderBy: { updatedAt: "desc" }, take: 500 }),
  ]);

  const assistantsById = new Map(
    assistantResult
      .map((assistant) => [String(assistant?.id || "").trim(), assistant])
      .filter(([id]) => id)
  );

  const phoneNumbers = phoneResult.map((phone) => {
    const assistantId = getVapiAssistantId(phone);
    const assistant = assistantId ? assistantsById.get(assistantId) : null;
    const mapping = findVapiInventoryMapping(phone, mappings, "phone");
    return {
      id: phone.id || phone.phoneNumberId || "",
      name: phone.name || phone.label || "",
      number: getVapiPhoneNumber(phone),
      provider: phone.provider || phone.providerName || phone.type || "",
      status: phone.status || phone.state || "",
      assistantId,
      assistantName: getVapiAssistantName(assistant || phone),
      createdAt: phone.createdAt || phone.created_at || "",
      updatedAt: phone.updatedAt || phone.updated_at || "",
      mappedBusiness: mapping?.business ? { id: mapping.business.id, name: mapping.business.name } : null,
      mapping: mapping ? { id: mapping.id, matchType: mapping.matchType, label: mapping.label } : null,
    };
  });

  const assistants = assistantResult.map((assistant) => {
    const mapping = findVapiInventoryMapping(assistant, mappings, "assistant");
    const id = String(assistant?.id || "").trim();
    return {
      id,
      name: getVapiAssistantName(assistant) || id || "Unnamed agent",
      model: getVapiNestedString(assistant, ["model.model", "model.provider", "model.name"]) || "",
      voice: getVapiNestedString(assistant, ["voice.voiceId", "voice.provider", "voice.name"]) || "",
      firstMessage: getVapiNestedString(assistant, ["firstMessage"]) || "",
      phoneNumbers: phoneNumbers.filter((phone) => phone.assistantId && phone.assistantId === id).map((phone) => phone.number || phone.id),
      createdAt: assistant.createdAt || assistant.created_at || "",
      updatedAt: assistant.updatedAt || assistant.updated_at || "",
      mappedBusiness: mapping?.business ? { id: mapping.business.id, name: mapping.business.name } : null,
      mapping: mapping ? { id: mapping.id, matchType: mapping.matchType, label: mapping.label } : null,
    };
  });

  return {
    phoneNumbers,
    assistants,
    warnings,
    totals: {
      phoneNumbers: phoneNumbers.length,
      assistants: assistants.length,
      mappedPhoneNumbers: phoneNumbers.filter((phone) => phone.mappedBusiness).length,
      mappedAssistants: assistants.filter((assistant) => assistant.mappedBusiness).length,
    },
    fetchedAt: new Date().toISOString(),
  };
}

function mergeVapiEndOfCallReport(message) {
  const call = message?.call && typeof message.call === "object" ? message.call : {};
  return {
    ...call,
    ...message,
    id: call.id || message?.callId || message?.id || "",
    artifact: {
      ...(call.artifact || {}),
      ...(message?.artifact || {}),
    },
    analysis: {
      ...(call.analysis || {}),
      ...(message?.analysis || {}),
    },
    metadata: {
      ...(call.metadata || {}),
      ...(message?.metadata || {}),
    },
  };
}

async function upsertVapiCall(fullCall, store) {
  const vapiCallId = String(fullCall?.id || fullCall?.callId || "").trim();
  if (!vapiCallId) {
    const err = new Error("Vapi call id is required.");
    err.statusCode = 400;
    throw err;
  }

  const existingStore = store[vapiCallId] || {};
  const existingCall = await prisma.call.findUnique({
    where: { externalProvider_externalId: { externalProvider: "vapi", externalId: vapiCallId } },
    include: { caller: true },
  });
  const businessId = await resolveBusinessIdForVapiCall(fullCall);
  const callerPhone =
    getVapiNestedString(fullCall, ["customer.number", "customer.phoneNumber", "caller.number", "from", "fromNumber"]) ||
    existingCall?.caller?.phone ||
    `unknown-vapi-${vapiCallId}`;
  const callerName =
    getVapiNestedString(fullCall, ["customer.name", "caller.name", "metadata.customerName"]) ||
    existingCall?.caller?.name ||
    "";
  const startedAt =
    fullCall.startedAt ||
    fullCall.started_at ||
    fullCall.createdAt ||
    fullCall.created_at ||
    existingCall?.startedAt ||
    new Date().toISOString();
  const endedAt = fullCall.endedAt || fullCall.ended_at || fullCall.completedAt || existingCall?.endedAt || null;
  const vapiCost = getVapiCost(fullCall);
  const twilioCallSid = getVapiTwilioCallSid(fullCall) || existingCall?.twilioCallSid || null;
  const transcript = getVapiTranscript(fullCall);
  const summary = getVapiSummary(fullCall);
  const recordingUrl = getVapiRecordingUrl(fullCall);
  const recordingConsent = getVapiRecordingConsent(fullCall);
  const toolCalls = summarizeVapiToolCalls(fullCall);
  const toolResults = summarizeVapiToolResults(fullCall);
  const artifactMessages = getVapiCustomerSafeMessages(fullCall);
  const artifactBasis = endedAt || startedAt || Date.now();
  const localCall = await logCall({
    callId: existingStore.localCallId || existingCall?.id,
    businessId,
    callerPhone,
    callerName,
    startedAt,
    endedAt,
    durationSec: getVapiDurationSeconds(fullCall),
    status: mapVapiStatus(fullCall.status || fullCall.endedReason || "ended"),
    transcript: transcript || undefined,
    recordingUrl: recordingUrl || undefined,
    externalProvider: "vapi",
    externalId: vapiCallId,
    aiSummary: summary || undefined,
    endedReason: fullCall.endedReason || fullCall.ended_reason || undefined,
    endedMessage: fullCall.endedMessage || fullCall.ended_message || undefined,
    successEvaluation: getVapiNestedString(fullCall, ["analysis.successEvaluation"]) || undefined,
    structuredData: getVapiNestedValue(fullCall, "analysis.structuredData") || undefined,
    structuredOutputs: getVapiNestedValue(fullCall, "artifact.structuredOutputs") || undefined,
    artifactMessages: artifactMessages.length ? artifactMessages : undefined,
    artifactMetrics: getVapiArtifactMetrics(fullCall) || undefined,
    toolCallSummary: { ...toolCalls, results: toolResults },
    recordingConsentType: recordingConsent.type || undefined,
    recordingConsentGrantedAt: recordingConsent.grantedAt || undefined,
    transcriptExpiresAt: transcript ? getSensitiveArtifactExpiry(CALL_TRANSCRIPT_RETENTION_DAYS, artifactBasis) : undefined,
    recordingExpiresAt: recordingUrl ? getSensitiveArtifactExpiry(CALL_RECORDING_RETENTION_DAYS, artifactBasis) : undefined,
    providerLogUrl: getVapiNestedString(fullCall, ["artifact.logUrl"]) || undefined,
    twilioCallSid,
    vapiCost,
    vapiCostBreakdown: getVapiCostBreakdown(fullCall),
    totalInternalCost: vapiCost,
    costSyncedAt: vapiCost != null || twilioCallSid ? new Date().toISOString() : null,
    followUpNeeded: /follow|quote|estimate|book|schedule|urgent|emergency/i.test(
      [summary, transcript, fullCall.endedReason].filter(Boolean).join(" ")
    ),
  });

  store[vapiCallId] = {
    ...existingStore,
    vapiCallId,
    localCallId: localCall.id,
    businessId,
    assistantId: fullCall.assistantId || fullCall.assistant?.id || existingStore.assistantId || "",
    phoneNumberId: fullCall.phoneNumberId || fullCall.phoneNumber?.id || existingStore.phoneNumberId || "",
    twilioCallSid: twilioCallSid || existingStore.twilioCallSid || "",
    transcriptAvailable: Boolean(transcript || existingStore.transcriptAvailable),
    recordingAvailable: Boolean(recordingUrl || existingStore.recordingAvailable),
    syncedAt: new Date().toISOString(),
  };

  return {
    duplicate: Boolean(existingCall),
    vapiCallId,
    localCallId: localCall.id,
    businessId,
    durationSec: localCall.durationSec,
    transcriptAvailable: Boolean(transcript),
    recordingAvailable: Boolean(recordingUrl),
  };
}

async function ingestVapiEndOfCallReport(message) {
  const fullCall = mergeVapiEndOfCallReport(message);
  const store = readVapiCallSyncStore();
  const result = await upsertVapiCall(fullCall, store);
  writeVapiCallSyncStore(store);
  await reconcileTrialUsageAfterCall(result);
  return result;
}

async function syncVapiCalls(options = {}) {
  const calls = await fetchVapiCalls(options);
  const store = readVapiCallSyncStore();
  const results = [];
  const detailErrors = [];
  const routingErrors = [];
  let detailsFetched = 0;

  for (const call of calls) {
    const vapiCallId = String(call?.id || call?.callId || "").trim();
    if (!vapiCallId) continue;

    let fullCall = call;
    try {
      const detail = await fetchVapiCallDetail(vapiCallId);
      if (detail) {
        detailsFetched += 1;
        fullCall = {
          ...call,
          ...detail,
          artifact: { ...(call.artifact || {}), ...(detail.artifact || {}) },
          analysis: { ...(call.analysis || {}), ...(detail.analysis || {}) },
          metadata: { ...(call.metadata || {}), ...(detail.metadata || {}) },
        };
      }
    } catch (error) {
      detailErrors.push({ vapiCallId, message: error?.message || "Could not fetch Vapi call detail." });
    }

    try {
      const result = await upsertVapiCall(fullCall, store);
      results.push(result);
      await reconcileTrialUsageAfterCall(result);
    } catch (error) {
      if (error?.code !== "VAPI_BUSINESS_ROUTE_REQUIRED") throw error;
      routingErrors.push({
        vapiCallId,
        code: error.code,
        assistantId: String(fullCall?.assistantId || fullCall?.assistant?.id || "").trim(),
        phoneNumberId: String(fullCall?.phoneNumberId || fullCall?.phoneNumber?.id || "").trim(),
        destinationLast4: normalizePhoneForMatch(
          fullCall?.phoneNumber?.number ||
            fullCall?.phoneNumber?.twilioPhoneNumber ||
            fullCall?.destination?.number ||
            fullCall?.to ||
            ""
        ).slice(-4),
      });
    }
  }

  writeVapiCallSyncStore(store);
  if (routingErrors.length) {
    console.warn("[vapi:sync] calls skipped because no trusted business mapping matched", {
      skipped: routingErrors.length,
      callIds: routingErrors.slice(0, 20).map((item) => item.vapiCallId),
    });
  }
  return {
    fetched: calls.length,
    detailsFetched,
    detailErrors,
    routingErrors,
    synced: results.length,
    skippedUnmapped: routingErrors.length,
    results,
  };
}

async function fetchTwilioCalls({ days = 30, limit = 1000 } = {}) {
  if (!TWILIO_REST_AUTH.configured) {
    const err = new Error(TWILIO_REST_AUTH.warning || "Twilio reporting credentials are not configured.");
    err.statusCode = 503;
    throw err;
  }

  const { start } = getDateRange(days);
  const url = new URL(`${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Calls.json`);
  url.searchParams.set("PageSize", String(Math.max(1, Math.min(1000, Number(limit) || 1000))));
  url.searchParams.set("StartTimeAfter", start.toISOString().slice(0, 10));

  const response = await fetch(url, {
    headers: {
      Authorization: getTwilioAuthHeader(),
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

function resolveTwilioRestAuth(env = process.env) {
  const accountSid = String(env.TWILIO_ACCOUNT_SID || "").trim();
  const authToken = String(env.TWILIO_AUTH_TOKEN || "").trim();
  const apiKeySid = String(env.TWILIO_API_KEY_SID || "").trim();
  const apiKeySecret = String(env.TWILIO_API_KEY_SECRET || "").trim();

  if (accountSid && apiKeySid && apiKeySecret) {
    return {
      configured: true,
      accountSid,
      username: apiKeySid,
      password: apiKeySecret,
      mode: "api-key",
      warning: "",
    };
  }
  if (accountSid && authToken) {
    return {
      configured: true,
      accountSid,
      username: accountSid,
      password: authToken,
      mode: "auth-token",
      warning: apiKeySid || apiKeySecret
        ? "The Twilio reporting API key is incomplete, so reporting is using the account Auth Token."
        : "",
    };
  }

  const missing = [];
  if (!accountSid) missing.push("TWILIO_ACCOUNT_SID");
  if (!(apiKeySid && apiKeySecret) && !authToken) {
    missing.push("TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET (preferred) or TWILIO_AUTH_TOKEN");
  }
  return {
    configured: false,
    accountSid,
    username: "",
    password: "",
    mode: "none",
    warning: `Twilio reporting credentials are incomplete: ${missing.join(", ")}.`,
  };
}

const TWILIO_REST_AUTH = resolveTwilioRestAuth({
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_API_KEY_SID,
  TWILIO_API_KEY_SECRET,
});

function getTwilioAuthHeader() {
  if (!TWILIO_REST_AUTH.configured) {
    const err = new Error(TWILIO_REST_AUTH.warning || "Twilio reporting credentials are not configured.");
    err.statusCode = 503;
    throw err;
  }
  return `Basic ${Buffer.from(`${TWILIO_REST_AUTH.username}:${TWILIO_REST_AUTH.password}`).toString("base64")}`;
}

async function fetchTwilioIncomingPhoneNumbers() {
  if (!TWILIO_REST_AUTH.configured) {
    const err = new Error(TWILIO_REST_AUTH.warning || "Twilio reporting credentials are not configured.");
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

function normalizeTwilioProvisioningAreaCode(value) {
  const areaCode = String(value || "249").replace(/\D/g, "");
  if (!/^\d{3}$/.test(areaCode)) {
    const err = new Error("areaCode must contain exactly three digits.");
    err.statusCode = 400;
    throw err;
  }
  return areaCode;
}

function normalizeTwilioProvisioningVoiceUrl(value) {
  let url;
  try {
    url = new URL(String(value || "").trim());
  } catch (_err) {
    const err = new Error("voiceUrl must be a valid Make webhook URL.");
    err.statusCode = 400;
    throw err;
  }

  const hostname = url.hostname.toLowerCase();
  const isMakeWebhook = hostname === "hook.make.com" || /^hook\.[a-z0-9-]+\.make\.com$/.test(hostname);
  if (url.protocol !== "https:" || !isMakeWebhook || url.username || url.password) {
    const err = new Error("voiceUrl must be an HTTPS Make webhook URL.");
    err.statusCode = 400;
    throw err;
  }
  return url.toString();
}

async function purchaseTwilioPhoneNumber({ areaCode = "249", voiceUrl, voiceMethod = "POST" } = {}, { fetchImpl = fetch } = {}) {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    const err = new Error("Twilio credentials are not configured.");
    err.statusCode = 503;
    throw err;
  }

  const normalizedAreaCode = normalizeTwilioProvisioningAreaCode(areaCode);
  const normalizedVoiceUrl = normalizeTwilioProvisioningVoiceUrl(voiceUrl);
  const normalizedVoiceMethod = String(voiceMethod || "POST").trim().toUpperCase();
  if (!new Set(["GET", "POST"]).has(normalizedVoiceMethod)) {
    const err = new Error("voiceMethod must be GET or POST.");
    err.statusCode = 400;
    throw err;
  }

  const ownedNumbersUrl = new URL(
    `${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/IncomingPhoneNumbers.json`
  );
  ownedNumbersUrl.searchParams.set("PageSize", "1000");
  const ownedNumbersResponse = await fetchImpl(ownedNumbersUrl, {
    headers: { Authorization: getTwilioAuthHeader(), Accept: "application/json" },
  });
  const ownedNumbersData = parseJsonObject(await ownedNumbersResponse.text());
  if (!ownedNumbersResponse.ok) {
    const err = new Error(ownedNumbersData?.message || ownedNumbersData?.error || `Twilio phone number lookup failed with HTTP ${ownedNumbersResponse.status}.`);
    err.statusCode = ownedNumbersResponse.status;
    throw err;
  }

  const existingNumber = (ownedNumbersData?.incoming_phone_numbers || []).find((record) => {
    const recordVoiceUrl = String(record?.voice_url || "").trim();
    return recordVoiceUrl && recordVoiceUrl === normalizedVoiceUrl;
  });
  if (existingNumber) {
    const phoneNumber = normalizeVapiImportPhone(existingNumber.phone_number);
    return {
      sid: String(existingNumber.sid || "").trim(),
      phone_number: phoneNumber,
      phoneNumber,
      friendly_name: String(existingNumber.friendly_name || phoneNumber).trim(),
      voice_url: String(existingNumber.voice_url || normalizedVoiceUrl).trim(),
      voice_method: String(existingNumber.voice_method || normalizedVoiceMethod).trim(),
      capabilities: existingNumber.capabilities || { voice: true, sms: true },
      reused: true,
    };
  }

  const availableUrl = new URL(
    `${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/AvailablePhoneNumbers/CA/Local.json`
  );
  availableUrl.searchParams.set("AreaCode", normalizedAreaCode);
  availableUrl.searchParams.set("SmsEnabled", "true");
  availableUrl.searchParams.set("VoiceEnabled", "true");
  availableUrl.searchParams.set("PageSize", "1");

  const availableResponse = await fetchImpl(availableUrl, {
    headers: { Authorization: getTwilioAuthHeader(), Accept: "application/json" },
  });
  const availableData = parseJsonObject(await availableResponse.text());
  if (!availableResponse.ok) {
    const err = new Error(availableData?.message || availableData?.error || `Twilio number search failed with HTTP ${availableResponse.status}.`);
    err.statusCode = availableResponse.status;
    throw err;
  }

  const availableNumber = normalizeVapiImportPhone(availableData?.available_phone_numbers?.[0]?.phone_number);
  if (!availableNumber) {
    const err = new Error(`No SMS and voice-capable Canadian number is currently available in area code ${normalizedAreaCode}.`);
    err.statusCode = 409;
    throw err;
  }

  const purchaseUrl = new URL(
    `${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/IncomingPhoneNumbers.json`
  );
  const form = new URLSearchParams({
    PhoneNumber: availableNumber,
    VoiceUrl: normalizedVoiceUrl,
    VoiceMethod: normalizedVoiceMethod,
  });
  const purchaseResponse = await fetchImpl(purchaseUrl, {
    method: "POST",
    headers: {
      Authorization: getTwilioAuthHeader(),
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });
  const purchaseData = parseJsonObject(await purchaseResponse.text());
  if (!purchaseResponse.ok) {
    const err = new Error(purchaseData?.message || purchaseData?.error || `Twilio number purchase failed with HTTP ${purchaseResponse.status}.`);
    err.statusCode = purchaseResponse.status;
    throw err;
  }

  const phoneNumber = normalizeVapiImportPhone(purchaseData?.phone_number || availableNumber);
  return {
    sid: String(purchaseData?.sid || "").trim(),
    phone_number: phoneNumber,
    phoneNumber,
    friendly_name: String(purchaseData?.friendly_name || phoneNumber).trim(),
    voice_url: String(purchaseData?.voice_url || normalizedVoiceUrl).trim(),
    voice_method: String(purchaseData?.voice_method || normalizedVoiceMethod).trim(),
    capabilities: purchaseData?.capabilities || { voice: true, sms: true },
  };
}

async function fetchTwilioUsageRecords({ days = 30 } = {}) {
  if (!TWILIO_REST_AUTH.configured) {
    const err = new Error(TWILIO_REST_AUTH.warning || "Twilio reporting credentials are not configured.");
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

async function fetchTwilioMessages({ days = 30, limit = 3000 } = {}) {
  if (!TWILIO_REST_AUTH.configured) {
    const err = new Error(TWILIO_REST_AUTH.warning || "Twilio reporting credentials are not configured.");
    err.statusCode = 503;
    throw err;
  }

  const { start } = getDateRange(days);
  const records = [];
  let nextUrl = new URL(`${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`);
  nextUrl.searchParams.set("DateSent>", dateOnly(start));
  nextUrl.searchParams.set("PageSize", String(Math.max(1, Math.min(1000, Number(limit) || 1000))));

  for (let page = 0; nextUrl && page < 10 && records.length < limit; page += 1) {
    const response = await fetch(nextUrl, {
      headers: {
        Authorization: getTwilioAuthHeader(),
        Accept: "application/json",
      },
    });
    const rawText = await response.text();
    const data = parseJsonObject(rawText);

    if (!response.ok) {
      const err = new Error(data?.message || data?.error || `Twilio message fetch failed with HTTP ${response.status}.`);
      err.statusCode = response.status;
      throw err;
    }

    records.push(...(Array.isArray(data?.messages) ? data.messages : []));
    nextUrl = data?.next_page_uri ? new URL(data.next_page_uri, TWILIO_API_BASE_URL) : null;
  }

  return records.slice(0, limit);
}

function normalizeTwilioMessage(message) {
  const rawPrice = numberOrNull(message?.price);
  return {
    sid: String(message?.sid || "").trim(),
    from: normalizePhoneForMatch(message?.from || ""),
    to: normalizePhoneForMatch(message?.to || ""),
    direction: String(message?.direction || "").trim(),
    status: String(message?.status || "").trim(),
    sentAt: message?.date_sent || message?.date_created || null,
    segments: Math.max(0, Number(message?.num_segments || 0) || 0),
    price: rawPrice == null ? null : Math.abs(rawPrice),
    priceUnit: String(message?.price_unit || "").trim() || null,
  };
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

function getTwilioUsageCostByPrefix(accountUsage, prefix) {
  const normalizedPrefix = String(prefix || "").trim().toLowerCase();
  if (!normalizedPrefix || !Array.isArray(accountUsage?.records)) return 0;
  const matching = accountUsage.records.filter((record) => {
    const key = getTwilioUsageCategoryKey(record);
    return key === normalizedPrefix || key.startsWith(`${normalizedPrefix}-`);
  });
  if (!matching.length) return 0;
  const exact = matching.find((record) => getTwilioUsageCategoryKey(record) === normalizedPrefix);
  if (exact) return Number(exact.price || 0);
  const keys = matching.map(getTwilioUsageCategoryKey);
  return matching.reduce((sum, record) => {
    const key = getTwilioUsageCategoryKey(record);
    const hasChild = keys.some((otherKey) => otherKey !== key && otherKey.startsWith(`${key}-`));
    return hasChild ? sum : sum + Number(record.price || 0);
  }, 0);
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

function addUtcMonthsPreservingAnniversary(value, monthsToAdd) {
  const source = new Date(value);
  if (Number.isNaN(source.getTime())) return null;
  const targetMonthIndex = source.getUTCMonth() + Number(monthsToAdd || 0);
  const targetYear = source.getUTCFullYear() + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    targetYear,
    targetMonth,
    Math.min(source.getUTCDate(), lastDay),
    source.getUTCHours(),
    source.getUTCMinutes(),
    source.getUTCSeconds(),
    source.getUTCMilliseconds()
  ));
}

function getNextMonthlyAnniversary(value, now = new Date()) {
  const source = new Date(value);
  const current = new Date(now);
  if (Number.isNaN(source.getTime()) || Number.isNaN(current.getTime())) return null;
  const elapsedMonths = Math.max(
    0,
    (current.getUTCFullYear() - source.getUTCFullYear()) * 12 + current.getUTCMonth() - source.getUTCMonth()
  );
  let candidate = addUtcMonthsPreservingAnniversary(source, elapsedMonths);
  if (!candidate || candidate.getTime() <= current.getTime()) {
    candidate = addUtcMonthsPreservingAnniversary(source, elapsedMonths + 1);
  }
  return candidate;
}

async function getTwilioPhoneBillingSchedule() {
  const numbers = (await fetchTwilioIncomingPhoneNumbers())
    .map(normalizeTwilioInventoryNumber)
    .filter((record) => record.phoneNumber);
  const signupByNumber = new Map();
  for (const signup of listSignupDashboardRecords()) {
    const phoneNumber = normalizePhoneForMatch(signup.twilioPhoneNumber || "");
    if (phoneNumber && !signupByNumber.has(phoneNumber)) signupByNumber.set(phoneNumber, signup);
  }
  const now = new Date();
  const records = numbers.map((record) => {
    const signup = signupByNumber.get(record.phoneNumber);
    const nextRenewal = getNextMonthlyAnniversary(record.dateCreated, now);
    return {
      sid: record.sid,
      phoneNumber: record.rawPhoneNumber || record.phoneNumber,
      normalizedPhoneNumber: record.phoneNumber,
      customer: String(signup?.businessName || signup?.ownerEmail || "Unmapped number").trim(),
      acquiredAt: record.dateCreated,
      nextEstimatedRenewalAt: nextRenewal?.toISOString() || null,
      billingDayOfMonth: record.dateCreated ? new Date(record.dateCreated).getUTCDate() : null,
      estimateAvailable: Boolean(nextRenewal),
    };
  });
  return {
    available: true,
    fetchedAt: now.toISOString(),
    billingConsoleUrl: "https://console.twilio.com/us1/billing/manage-billing/billing-overview",
    activeNumbersUrl: "https://console.twilio.com/us1/develop/phone-numbers/manage/incoming",
    basis: "Estimated from each Twilio number's acquisition timestamp. Confirm the account payment date and invoice status in Twilio Billing.",
    totalNumbers: records.length,
    records: records.sort(
      (left, right) =>
        new Date(left.nextEstimatedRenewalAt || 8640000000000000).getTime() -
          new Date(right.nextEstimatedRenewalAt || 8640000000000000).getTime() ||
        left.phoneNumber.localeCompare(right.phoneNumber)
    ),
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
  const { start } = getDateRange(windowDays);
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
  const recentTwilioCalls = twilioCalls
    .map(normalizeTwilioCall)
    .filter((call) => call.startedAtMs && call.startedAtMs >= start.getTime());
  for (const call of recentTwilioCalls) {
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
      : twilioStats.count
        ? "review"
        : "likelyUnused";
    const reasons = evidence.length
      ? evidence
      : [
          twilioStats.count ? `${twilioStats.count} Twilio calls in ${windowDays} days` : "",
          hasWebhookConfig ? "Has Twilio webhook/application configuration" : "",
          !twilioStats.count ? `No app mapping and no Twilio calls in ${windowDays} days` : "",
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
      twilioCallsFetched: twilioCalls.length,
      twilioCallsAnalyzed: recentTwilioCalls.length,
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
  let twilioPhoneBillingWarning = "";
  let twilioMessagesWarning = "";
  let twilioAccountUsage = null;
  let twilioPhoneBilling = null;
  let twilioMessages = [];
  const fixedCosts = getFixedMonthlyCosts({ days });
  let calls = [];
  let businesses = [];
  try {
    [calls, businesses] = await withTimeout(
      Promise.all([
        prisma.call.findMany({
          where: { startedAt: { gte: start, lte: end } },
          include: {
            caller: true,
            business: { include: { vapiMappings: true } },
          },
          orderBy: { startedAt: "desc" },
          take: 2000,
        }),
        prisma.business.findMany({
          include: { vapiMappings: true },
          orderBy: { id: "asc" },
          take: 1000,
        }),
      ]),
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

  if (TWILIO_REST_AUTH.configured) {
    const [usageResult, phoneBillingResult, messagesResult] = await Promise.allSettled([
      withTimeout(
        getTwilioAccountUsage({ days }),
        10000,
        "Twilio account usage did not respond while loading cost audit."
      ),
      withTimeout(
        getTwilioPhoneBillingSchedule(),
        10000,
        "Twilio phone billing schedule did not respond while loading cost audit."
      ),
      withTimeout(
        fetchTwilioMessages({ days, limit: 3000 }),
        15000,
        "Twilio text-message costs did not respond while loading cost audit."
      ),
    ]);
    if (usageResult.status === "fulfilled") {
      twilioAccountUsage = usageResult.value;
    } else {
      const error = usageResult.reason;
      twilioUsageWarning = error?.message || "Twilio account usage could not be loaded.";
      console.warn("[admin:cost-audit] Twilio account usage unavailable", { message: twilioUsageWarning });
    }
    if (phoneBillingResult.status === "fulfilled") {
      twilioPhoneBilling = phoneBillingResult.value;
    } else {
      const error = phoneBillingResult.reason;
      twilioPhoneBillingWarning = error?.message || "Twilio phone billing schedule could not be loaded.";
      console.warn("[admin:cost-audit] Twilio phone billing unavailable", { message: twilioPhoneBillingWarning });
    }
    if (messagesResult.status === "fulfilled") {
      twilioMessages = messagesResult.value.map(normalizeTwilioMessage).filter((message) => message.sid);
    } else {
      const error = messagesResult.reason;
      twilioMessagesWarning = error?.message || "Twilio text-message costs could not be loaded.";
      console.warn("[admin:cost-audit] Twilio message costs unavailable", { message: twilioMessagesWarning });
    }
  }

  const groups = new Map();
  const ensureGroup = ({ businessId, businessName, phoneNumber }) => {
    const normalizedPhone = normalizePhoneForMatch(phoneNumber || "");
    const key = `${businessId}:${normalizedPhone || phoneNumber || "unmapped"}`;
    const row = groups.get(key) || {
      businessId,
      businessName: businessName || `Business ${businessId}`,
      phoneNumber: normalizedPhone || phoneNumber || "Unmapped number",
      totalCalls: 0,
      pricedCalls: 0,
      messageCount: 0,
      pricedMessages: 0,
      twilioCallCost: 0,
      twilioMessageCost: 0,
      phoneNumberCost: 0,
      twilioCost: 0,
      vapiCost: 0,
      totalInternalCost: 0,
      totalDurationSec: 0,
      currency: "USD",
      lastCallAt: null,
      lastMessageAt: null,
    };
    groups.set(key, row);
    return row;
  };

  for (const call of calls) {
    const phoneMappings = (call.business?.vapiMappings || []).filter((mapping) => String(mapping.matchType || "").toLowerCase().includes("phone"));
    const phoneNumber = phoneMappings[0]?.matchValue || call.business?.phone || `Business ${call.businessId}`;
    const row = ensureGroup({
      businessId: call.businessId,
      businessName: call.business?.name || `Business ${call.businessId}`,
      phoneNumber,
    });

    const twilioCost = Number(call.twilioPrice || 0);
    const vapiCost = Number(call.vapiCost || 0);
    const totalInternalCost = Number((twilioCost + vapiCost).toFixed(4));

    row.totalCalls += 1;
    if (call.costSyncedAt || twilioCost || vapiCost || totalInternalCost) row.pricedCalls += 1;
    row.twilioCallCost += twilioCost;
    row.twilioCost += twilioCost;
    row.vapiCost += vapiCost;
    row.totalInternalCost += totalInternalCost;
    row.totalDurationSec += Number(call.durationSec || 0);
    row.currency = call.twilioPriceUnit || row.currency;
    row.lastCallAt = row.lastCallAt && new Date(row.lastCallAt) > new Date(call.startedAt) ? row.lastCallAt : call.startedAt;
  }

  const signupRecords = listSignupDashboardRecords();
  const businessByNumber = new Map();
  const inventoryNumbers = new Set(
    (twilioPhoneBilling?.records || [])
      .map((record) => normalizePhoneForMatch(record.normalizedPhoneNumber || record.phoneNumber))
      .filter(Boolean)
  );

  for (const business of businesses) {
    const signup = findSignupForBusiness(business, signupRecords);
    const phoneNumbers = [
      ...(business.vapiMappings || [])
        .filter((mapping) => /phone/i.test(String(mapping.matchType || "")))
        .map((mapping) => mapping.matchValue),
      signup?.twilioPhoneNumber,
      inventoryNumbers.has(normalizePhoneForMatch(business.phone)) ? business.phone : "",
    ].map(normalizePhoneForMatch).filter(Boolean);

    for (const phoneNumber of new Set(phoneNumbers)) {
      businessByNumber.set(phoneNumber, {
        businessId: business.id,
        businessName: business.name || signup?.businessName || `Business ${business.id}`,
        phoneNumber,
      });
    }
  }

  for (const message of twilioMessages) {
    const match = businessByNumber.get(message.from) || businessByNumber.get(message.to);
    if (!match) continue;
    const row = ensureGroup(match);
    const messageCost = Number(message.price || 0);
    row.messageCount += 1;
    if (message.price != null) row.pricedMessages += 1;
    row.twilioMessageCost += messageCost;
    row.twilioCost += messageCost;
    row.totalInternalCost += messageCost;
    row.currency = message.priceUnit || row.currency;
    row.lastMessageAt = row.lastMessageAt && new Date(row.lastMessageAt) > new Date(message.sentAt)
      ? row.lastMessageAt
      : message.sentAt;
  }

  const phoneNumberCostTotal = Number(getTwilioUsageCostByPrefix(twilioAccountUsage, "phonenumbers").toFixed(4));
  const phoneNumberCostShare = inventoryNumbers.size
    ? Number((phoneNumberCostTotal / inventoryNumbers.size).toFixed(6))
    : 0;
  if (phoneNumberCostShare) {
    for (const phoneNumber of inventoryNumbers) {
      const match = businessByNumber.get(phoneNumber);
      if (!match) continue;
      const row = ensureGroup(match);
      row.phoneNumberCost += phoneNumberCostShare;
      row.twilioCost += phoneNumberCostShare;
      row.totalInternalCost += phoneNumberCostShare;
    }
  }

  const summary = Array.from(groups.values()).map((row) => ({
    ...row,
    twilioCallCost: Number(row.twilioCallCost.toFixed(4)),
    twilioMessageCost: Number(row.twilioMessageCost.toFixed(4)),
    phoneNumberCost: Number(row.phoneNumberCost.toFixed(4)),
    twilioCost: Number(row.twilioCost.toFixed(4)),
    vapiCost: Number(row.vapiCost.toFixed(4)),
    totalInternalCost: Number(row.totalInternalCost.toFixed(4)),
    averageCost: row.totalCalls ? Number((row.totalInternalCost / row.totalCalls).toFixed(4)) : 0,
    averageDurationSec: row.totalCalls ? Math.round(row.totalDurationSec / row.totalCalls) : 0,
  }));

  const twilioCallCost = Number(calls.reduce((sum, call) => sum + Number(call.twilioPrice || 0), 0).toFixed(4));
  const twilioMessageCost = Number(
    twilioMessages.reduce((sum, message) => sum + Number(message.price || 0), 0).toFixed(4)
  );
  const matchedTwilioMessageCost = Number(
    summary.reduce((sum, row) => sum + Number(row.twilioMessageCost || 0), 0).toFixed(4)
  );
  const matchedPhoneNumberCost = Number(
    summary.reduce((sum, row) => sum + Number(row.phoneNumberCost || 0), 0).toFixed(4)
  );
  const vapiCost = Number(calls.reduce((sum, call) => sum + Number(call.vapiCost || 0), 0).toFixed(4));
  const callUsageCost = Number((twilioCallCost + matchedTwilioMessageCost + matchedPhoneNumberCost + vapiCost).toFixed(4));
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
      twilioMessageCost,
      matchedTwilioMessageCost,
      phoneNumberCost: phoneNumberCostTotal,
      matchedPhoneNumberCost,
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
    twilioPhoneBilling,
    fixedCosts,
    env: {
      databaseAvailable: !databaseWarning,
      twilioConfigured: TWILIO_REST_AUTH.configured,
      twilioCredentialMode: TWILIO_REST_AUTH.mode,
      vapiConfigured: Boolean(VAPI_API_KEY),
    },
    warnings: [...new Set([
      databaseWarning,
      TWILIO_REST_AUTH.warning,
      twilioUsageWarning,
      twilioPhoneBillingWarning,
      twilioMessagesWarning,
      fixedCosts.warning || "",
      !VAPI_API_KEY ? "VAPI_API_KEY is not configured, so Vapi call costs cannot refresh." : "",
    ].filter(Boolean))],
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
  { key: "sms_routing", label: "Owner and caller texts protected", nextAction: "Run the isolated SMS routing repair and verify the protected owner and caller destinations." },
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

  if (stepKey === "sms_routing") {
    if (signup.smsRoutingStatus === "healthy") return setupStep("done", "Protected per-business owner and caller routing is verified.");
    if (signup.smsRoutingStatus === "failed") return setupStep("failed", signup.smsRoutingError || "SMS routing verification failed.");
    if (!envStatus.vapiApiKeyConfigured || !envStatus.twilioConfigured) return setupStep("manual", "Vapi and Twilio credentials are required to isolate SMS routing.");
    return setupStep("waiting", "Protected per-business SMS routing has not been verified yet.");
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

    const aiNumbers = uniqueStrings([
      signup.twilioPhoneNumber,
      ...(business?.vapiMappings || [])
        .filter((mapping) => String(mapping.matchType || "").toLowerCase().includes("phone"))
        .map((mapping) => mapping.matchValue),
    ]);

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
      aiNumbers,
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
  if (record.makeError === "") delete merged.makeError;
  if (record.smsRoutingStatus === "healthy") delete merged.smsRoutingError;

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

function stripeUnixIso(value) {
  const ms = getUnixMs(value);
  return ms ? new Date(ms).toISOString() : null;
}

function getStripeCustomerId(subscription) {
  return typeof subscription?.customer === "string" ? subscription.customer : subscription?.customer?.id || "";
}

function getStripeCustomer(subscription) {
  return subscription?.customer && typeof subscription.customer === "object" ? subscription.customer : {};
}

function getStripePrice(subscription) {
  return subscription?.items?.data?.[0]?.price || {};
}

function getStripePriceAmount(price) {
  const decimal = Number(price?.unit_amount_decimal);
  if (Number.isFinite(decimal) && decimal > 0) return decimal;
  const amount = Number(price?.unit_amount);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function summarizeStripeSubscriptionForAdmin(subscription) {
  const metadata = subscription?.metadata || {};
  const customer = getStripeCustomer(subscription);
  const customerMetadata = customer?.metadata || {};
  const price = getStripePrice(subscription);
  const amountCents = getStripePriceAmount(price);
  const trialStartAt = getUnixMs(subscription?.trial_start);
  const trialEndAt = getUnixMs(subscription?.trial_end);
  const currentPeriodStartAt = getUnixMs(subscription?.current_period_start);
  const currentPeriodEndAt = getUnixMs(subscription?.current_period_end);
  const dashboardMode = STRIPE_SECRET_KEY.startsWith("sk_test_") ? "test/" : "";

  return {
    subscriptionId: subscription?.id || "",
    customerId: getStripeCustomerId(subscription),
    customerEmail: String(customer?.email || metadata.ownerEmail || metadata.email || "").trim(),
    customerName: String(customer?.name || metadata.ownerName || "").trim(),
    businessName: String(metadata.businessName || metadata.company || customerMetadata.businessName || customer?.description || "").trim(),
    status: subscription?.status || "",
    trialStartAt: stripeUnixIso(subscription?.trial_start),
    trialEndAt: stripeUnixIso(subscription?.trial_end),
    currentPeriodEndAt: stripeUnixIso(subscription?.current_period_end),
    cancelAt: stripeUnixIso(subscription?.cancel_at),
    canceledAt: stripeUnixIso(subscription?.canceled_at),
    cancelAtPeriodEnd: Boolean(subscription?.cancel_at_period_end),
    createdAt: stripeUnixIso(subscription?.created),
    priceId: price?.id || "",
    priceAmount: amountCents,
    priceCurrency: String(price?.currency || "").toUpperCase(),
    priceInterval: price?.recurring?.interval || "",
    dashboardUrl: subscription?.id ? `https://dashboard.stripe.com/${dashboardMode}subscriptions/${subscription.id}` : "",
    expiry: getSignupExpiryStatus({
      trialStartAt,
      trialEndAt,
      currentPeriodStartAt,
      currentPeriodEndAt,
      createdAt: stripeUnixIso(subscription?.created),
      subscriptionStatus: subscription?.status || "",
    }),
  };
}

async function getStripeTrialsDashboard() {
  if (!stripe) {
    return {
      configured: false,
      fetchedAt: new Date().toISOString(),
      account: null,
      totals: {
        subscriptionsAllStatuses: 0,
        statusCounts: {},
        activeTrialCount: 0,
        trialRelatedCount: 0,
        endingSoonWithin3DaysCount: 0,
        recentlyEndedTrialCountLast30Days: 0,
      },
      activeTrials: [],
      recentlyEndedTrialsLast30Days: [],
      warnings: ["STRIPE_SECRET_KEY is not configured on the backend."],
    };
  }

  const warnings = [];
  let account = null;
  try {
    const stripeAccount = await stripe.accounts.retrieve();
    account = {
      id: stripeAccount.id,
      country: stripeAccount.country || "",
      chargesEnabled: Boolean(stripeAccount.charges_enabled),
      payoutsEnabled: Boolean(stripeAccount.payouts_enabled),
    };
    if (!stripeAccount.payouts_enabled) warnings.push("Stripe payouts are not enabled yet.");
  } catch (error) {
    warnings.push(`Stripe account read failed: ${error?.message || "Unknown Stripe error"}`);
  }

  const subscriptions = [];
  try {
    for await (const subscription of stripe.subscriptions.list({
      status: "all",
      limit: 100,
      expand: ["data.customer", "data.items.data.price"],
    })) {
      subscriptions.push(subscription);
      if (subscriptions.length >= STRIPE_ADMIN_SUBSCRIPTION_LIMIT) break;
    }
  } catch (error) {
    return {
      configured: true,
      fetchedAt: new Date().toISOString(),
      account,
      totals: {
        subscriptionsAllStatuses: 0,
        statusCounts: {},
        activeTrialCount: 0,
        trialRelatedCount: 0,
        endingSoonWithin3DaysCount: 0,
        recentlyEndedTrialCountLast30Days: 0,
      },
      activeTrials: [],
      recentlyEndedTrialsLast30Days: [],
      warnings: [`Stripe subscription read failed: ${error?.message || "Unknown Stripe error"}`],
    };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const activeTrials = subscriptions.filter((subscription) => subscription.status === "trialing" && (!subscription.trial_end || subscription.trial_end > nowSec));
  const trialRelated = subscriptions.filter((subscription) => subscription.trial_start || subscription.trial_end || subscription.status === "trialing");
  const recentlyEndedTrials = trialRelated.filter((subscription) => subscription.trial_end && subscription.trial_end <= nowSec && subscription.trial_end >= nowSec - 30 * 24 * 60 * 60);
  const endingSoon = activeTrials.filter((subscription) => subscription.trial_end && subscription.trial_end <= nowSec + 3 * 24 * 60 * 60);
  const statusCounts = subscriptions.reduce((acc, subscription) => {
    const status = subscription.status || "unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});

  return {
    configured: true,
    fetchedAt: new Date().toISOString(),
    mode: STRIPE_SECRET_KEY.startsWith("sk_live_") ? "live" : STRIPE_SECRET_KEY.startsWith("sk_test_") ? "test" : "unknown",
    account,
    totals: {
      subscriptionsAllStatuses: subscriptions.length,
      statusCounts,
      activeTrialCount: activeTrials.length,
      trialRelatedCount: trialRelated.length,
      endingSoonWithin3DaysCount: endingSoon.length,
      recentlyEndedTrialCountLast30Days: recentlyEndedTrials.length,
      resultLimit: STRIPE_ADMIN_SUBSCRIPTION_LIMIT,
      resultLimitReached: subscriptions.length >= STRIPE_ADMIN_SUBSCRIPTION_LIMIT,
    },
    activeTrials: activeTrials
      .sort((a, b) => (a.trial_end || Number.MAX_SAFE_INTEGER) - (b.trial_end || Number.MAX_SAFE_INTEGER))
      .map(summarizeStripeSubscriptionForAdmin),
    recentlyEndedTrialsLast30Days: recentlyEndedTrials
      .sort((a, b) => (b.trial_end || 0) - (a.trial_end || 0))
      .slice(0, 20)
      .map(summarizeStripeSubscriptionForAdmin),
    warnings,
  };
}

function mergeSignupDashboardWithTrialReminders(dashboardStore = {}, reminderStore = {}) {
  const combinedStore = { ...dashboardStore };

  // Reading the dashboard must not mutate signup state. Previously this loop
  // called upsertSignupDashboardRecord(), which rewrote updatedAt on every
  // health check and replaced the real provisioning state with a reminder
  // status. Merge reminder metadata in memory and preserve the signup status.
  for (const reminder of Object.values(reminderStore)) {
    if (!reminder?.subscriptionId) continue;
    const aliases = getSignupAliases(reminder);
    const existingKey = aliases.find((alias) => combinedStore[alias]) || `sub:${String(reminder.subscriptionId).trim()}`;
    const existing = combinedStore[existingKey] || {};
    const legacyReminderStatus = String(existing.status || "") === "trial_reminder_scheduled";
    const restoredStatus = legacyReminderStatus
      ? existing.makeError
        ? "setup_error"
        : existing.vapiAssistantId && existing.twilioPhoneNumber
          ? "setup_ready"
          : existing.makeStatus
            ? "setup_started"
            : "subscription_trialing"
      : existing.status || (reminder.status === "cancelled" ? "subscription_cancelled" : "subscription_trialing");
    combinedStore[existingKey] = compactObject({
      ...existing,
      subscriptionId: reminder.subscriptionId,
      customerId: reminder.customerId || existing.customerId || "",
      ownerEmail: reminder.ownerEmail || existing.ownerEmail || "",
      ownerName: reminder.ownerName || existing.ownerName || "",
      businessName: reminder.businessName || existing.businessName || "",
      trialStartAt: reminder.trialStartAt || existing.trialStartAt || null,
      trialEndAt: reminder.trialEndAt || existing.trialEndAt || null,
      periodStartAt: reminder.trialStartAt || existing.periodStartAt || null,
      periodEndAt: reminder.trialEndAt || existing.periodEndAt || null,
      trialReminderStatus: reminder.status || "",
      trialReminderDueAt: reminder.dueAt || null,
      trialReminderSentAt: reminder.sentAt || null,
      status: reminder.status === "cancelled" ? "subscription_cancelled" : restoredStatus,
      updatedAt: existing.updatedAt || existing.signedUpAt || existing.createdAt || reminder.createdAt || reminder.dueAt,
    });
  }

  return combinedStore;
}

function listSignupDashboardRecords() {
  const combinedStore = mergeSignupDashboardWithTrialReminders(
    readSignupDashboardStore(),
    readTrialReminderStore()
  );

  return Object.values(combinedStore)
    .filter(Boolean)
    .map((record) => ({
      ...record,
      expiry: getSignupExpiryStatus(record),
    }))
    .sort((a, b) => Number(new Date(b.signedUpAt || b.createdAt || 0)) - Number(new Date(a.signedUpAt || a.createdAt || 0)));
}

function findPendingSignupForDashboardRecord(signup, pendingStore = prunePendingSignupStore(readPendingSignupStore())) {
  const ownerEmail = String(signup?.ownerEmail || "").trim().toLowerCase();
  const businessName = String(signup?.businessName || "").trim().toLowerCase();
  return Object.entries(pendingStore).find(([, pending]) => {
    const pendingEmail = String(pending?.ownerEmail || pending?.payload?.owner?.email || "").trim().toLowerCase();
    const pendingBusiness = String(pending?.businessName || pending?.payload?.business?.name || "").trim().toLowerCase();
    return Boolean((ownerEmail && ownerEmail === pendingEmail) || (businessName && businessName === pendingBusiness));
  }) || null;
}

function findSignupByOperationalTarget(targetId, signups = listSignupDashboardRecords()) {
  const expected = String(targetId || "").trim().toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(expected)) return null;
  return signups.find((record) => {
    const identity = String(record.subscriptionId || record.checkoutSessionId || record.ownerEmail || record.businessName || record.signedUpAt || "unknown");
    return hashOperationalTarget(identity) === expected;
  }) || null;
}

function getSignupProviderRecoveryDiagnostics({ signup = {}, pendingSignup = null, vapiNumbers = [], twilioNumbers = [], providerLookup = "not_needed" } = {}) {
  const assignedPhone = normalizePhoneForMatch(signup.twilioPhoneNumber || "");
  const vapiPhone = assignedPhone
    ? vapiNumbers.find((record) => normalizePhoneForMatch(getVapiPhoneNumber(record)) === assignedPhone)
    : null;
  const twilioPhone = assignedPhone
    ? twilioNumbers.find((record) => normalizePhoneForMatch(record?.phone_number || record?.phoneNumber) === assignedPhone)
    : null;
  return {
    retryPayloadAvailable: Boolean(pendingSignup?.[1]?.payload),
    providerLookup,
    assignedPhoneKnownToTwilio: assignedPhone ? Boolean(twilioPhone) : false,
    assignedPhoneKnownToVapi: assignedPhone ? Boolean(vapiPhone) : false,
    vapiAssistantAssigned: Boolean(getVapiAssistantId(vapiPhone)),
  };
}

function getVoiceSignupToolArguments(call = {}) {
  const messages = Array.isArray(call?.artifact?.messages) && call.artifact.messages.length
    ? call.artifact.messages
    : Array.isArray(call?.messages)
      ? call.messages
      : [];
  for (const message of messages) {
    const toolCalls = Array.isArray(message?.toolCalls)
      ? message.toolCalls
      : Array.isArray(message?.tool_calls)
        ? message.tool_calls
        : [];
    for (const toolCall of toolCalls) {
      const name = String(toolCall?.function?.name || toolCall?.name || "").trim();
      if (!isVapiVoiceSignupTool(name)) continue;
      const rawArguments = toolCall?.function?.arguments ?? toolCall?.arguments;
      if (rawArguments && typeof rawArguments === "object") return rawArguments;
      const parsed = parseJsonObject(rawArguments);
      if (parsed && Object.keys(parsed).length) return parsed;
    }
  }
  return null;
}

function buildRecoveredVoiceSignupPayload(signup = {}, call = {}) {
  if (!signup.vapiCallId || !signup.emailVerified || !/(error|failed)/i.test(String(signup.status || ""))) return null;
  const parameters = getVoiceSignupToolArguments(call);
  if (!parameters) return null;
  const payload = buildVoiceSignupPayload(parameters, {
    callId: signup.vapiCallId,
    submittedAt: signup.signedUpAt || signup.createdAt || new Date().toISOString(),
  });
  const sameEmail = String(payload?.owner?.email || "").trim().toLowerCase()
    === String(signup.ownerEmail || "").trim().toLowerCase();
  const sameBusiness = String(payload?.business?.name || "").trim().toLowerCase()
    === String(signup.businessName || "").trim().toLowerCase();
  const sameOwnerPhone = normalizePhoneForMatch(payload?.owner?.phone)
    === normalizePhoneForMatch(signup.ownerPhone || signup.businessPhone);
  if (!sameEmail || !sameBusiness || !sameOwnerPhone) {
    const error = new Error("The retained voice call does not match the signup record.");
    error.statusCode = 409;
    throw error;
  }
  return compactObject({
    ...payload,
    verifiedAt: signup.emailVerifiedAt || new Date().toISOString(),
    verification: {
      ...(payload.verification || {}),
      emailVerified: true,
      smsVerified: Boolean(signup.smsVerified),
    },
    security: {
      ...(payload.security || {}),
      emailVerificationCompleted: true,
    },
  });
}

function findUniqueVapiPhoneForAssistant(vapiNumbers = [], assistantId = "", twilioNumbers = []) {
  const expectedAssistantId = String(assistantId || "").trim();
  if (!expectedAssistantId) return null;
  const matches = vapiNumbers.filter((record) => getVapiAssistantId(record) === expectedAssistantId);
  if (matches.length !== 1) return null;
  const aiNumber = normalizePhoneForMatch(getVapiPhoneNumber(matches[0]));
  if (!aiNumber) return null;
  const knownToTwilio = twilioNumbers.some(
    (record) => normalizePhoneForMatch(record?.phone_number || record?.phoneNumber) === aiNumber
  );
  return knownToTwilio ? matches[0] : null;
}

function isSyntheticPausedTestSignupArchiveEligible({ signup = {}, diagnostics = {} } = {}) {
  return Boolean(
    /^Codex Pricing Test \d{14}$/i.test(String(signup.businessName || "").trim()) &&
    /@example\.com$/i.test(String(signup.ownerEmail || "").trim()) &&
    String(signup.subscriptionStatus || "").trim().toLowerCase() === "paused" &&
    diagnostics.providerLookup === "complete" &&
    !diagnostics.assignedPhoneKnownToTwilio &&
    !diagnostics.assignedPhoneKnownToVapi &&
    !signup.vapiAssistantId
  );
}

function isStaleSignupArchiveEligible({ signup = {}, diagnostics = {}, now = new Date(), minimumAgeDays = 7 } = {}) {
  const updatedAt = new Date(signup.updatedAt || signup.signedUpAt || signup.createdAt || 0).getTime();
  const ageMs = Number.isFinite(updatedAt) && updatedAt > 0 ? now.getTime() - updatedAt : 0;
  return Boolean(
    diagnostics.providerLookup === "complete" &&
    signup.twilioPhoneNumber &&
    !diagnostics.assignedPhoneKnownToTwilio &&
    !diagnostics.assignedPhoneKnownToVapi &&
    !signup.vapiAssistantId &&
    !signup.subscriptionId &&
    !signup.checkoutSessionId &&
    !signup.emailVerified &&
    !signup.smsVerified &&
    ageMs >= Math.max(1, Number(minimumAgeDays) || 7) * 24 * 60 * 60 * 1000
  );
}

async function inspectSignupRecoveryState(signup) {
  const pendingSignup = findPendingSignupForDashboardRecord(signup);
  if (!signup?.twilioPhoneNumber) {
    return getSignupProviderRecoveryDiagnostics({ signup, pendingSignup });
  }
  const [vapiResult, twilioResult] = await Promise.allSettled([
    fetchVapiCollection("phone-number", ["phoneNumbers", "phone_numbers"]),
    fetchTwilioIncomingPhoneNumbers(),
  ]);
  const providerLookup = vapiResult.status === "fulfilled" && twilioResult.status === "fulfilled"
    ? "complete"
    : vapiResult.status === "fulfilled" || twilioResult.status === "fulfilled"
      ? "partial"
      : "unavailable";
  const diagnostics = getSignupProviderRecoveryDiagnostics({
    signup,
    pendingSignup,
    vapiNumbers: vapiResult.status === "fulfilled" ? vapiResult.value : [],
    twilioNumbers: twilioResult.status === "fulfilled" ? twilioResult.value : [],
    providerLookup,
  });
  return {
    ...diagnostics,
    staleArchiveEligible: isStaleSignupArchiveEligible({ signup, diagnostics }),
  };
}

async function recoverSignupByOperationalTarget(targetId) {
  const signup = findSignupByOperationalTarget(targetId);
  if (!signup) {
    const error = new Error("The signup alert no longer matches an active signup record.");
    error.statusCode = 404;
    throw error;
  }

  const pendingStore = prunePendingSignupStore(readPendingSignupStore());
  const pendingSignup = findPendingSignupForDashboardRecord(signup, pendingStore);
  if (pendingSignup?.[1]?.payload) {
    const [tokenHash, pending] = pendingSignup;
    const makeResult = await sendMakeSignupCompleted(pending.payload);
    const makeData = makeResult.data || {};
    if (!getMakeSignupSuccess(makeData)) {
      upsertSignupDashboardRecord({
        ...signup,
        status: "setup_error",
        makeStatus: makeResult.status,
        makeError: makeData?.error || "Make webhook did not complete the signup recovery.",
      });
      const error = new Error("The Make.com handoff still did not complete.");
      error.statusCode = 502;
      throw error;
    }
    delete pendingStore[tokenHash];
    writePendingSignupStore(pendingStore);
    const twilioPhoneNumber = getMakeTwilioPhoneNumber(makeData) || getMakeTwilioPhoneNumberFromText(makeResult.body);
    const updated = upsertSignupDashboardFromPayload(pending.payload, {
      ...signup,
      status: "setup_started",
      emailVerified: true,
      makeStatus: makeResult.status,
      makeError: "",
      twilioPhoneNumber: twilioPhoneNumber || signup.twilioPhoneNumber || "",
      provisioningRetriedAt: new Date().toISOString(),
    });
    await attachNoCardStripeTrialToSignup(pending.payload, {
      makeStatus: makeResult.status,
      twilioPhoneNumber: updated.twilioPhoneNumber || "",
    });
    return {
      ok: true,
      action: "make_handoff_retried",
      makeStatus: makeResult.status,
      assignedPhone: Boolean(updated.twilioPhoneNumber),
      assistantAssigned: Boolean(updated.vapiAssistantId),
    };
  }

  if (signup.vapiCallId && signup.emailVerified && /(error|failed)/i.test(String(signup.status || ""))) {
    const call = await fetchVapiCallDetail(signup.vapiCallId);
    const recoveredPayload = buildRecoveredVoiceSignupPayload(signup, call);
    if (recoveredPayload) {
      const makeResult = await sendMakeSignupCompleted(recoveredPayload);
      const makeData = makeResult.data || {};
      if (!getMakeSignupSuccess(makeData)) {
        upsertSignupDashboardRecord({
          ...signup,
          status: "setup_error",
          makeStatus: makeResult.status,
          makeError: makeData?.error || "Make webhook did not complete the recovered voice signup.",
        });
        const error = new Error("The recovered voice signup handoff still did not complete.");
        error.statusCode = 502;
        throw error;
      }
      const twilioPhoneNumber = getMakeTwilioPhoneNumber(makeData) || getMakeTwilioPhoneNumberFromText(makeResult.body);
      const updated = upsertSignupDashboardFromPayload(recoveredPayload, {
        ...signup,
        status: "setup_started",
        emailVerified: true,
        makeStatus: makeResult.status,
        makeError: "",
        twilioPhoneNumber: twilioPhoneNumber || "",
        provisioningRetriedAt: new Date().toISOString(),
        recoveredFromVoiceCall: true,
      });
      return {
        ok: true,
        action: "voice_signup_replayed_from_provider_call",
        makeStatus: makeResult.status,
        assignedPhone: Boolean(updated.twilioPhoneNumber),
        assistantAssigned: Boolean(updated.vapiAssistantId),
      };
    }
  }

  if (!signup.twilioPhoneNumber && signup.vapiAssistantId) {
    const [vapiNumbers, twilioNumbers] = await Promise.all([
      fetchVapiCollection("phone-number", ["phoneNumbers", "phone_numbers"]),
      fetchTwilioIncomingPhoneNumbers(),
    ]);
    const vapiPhone = findUniqueVapiPhoneForAssistant(vapiNumbers, signup.vapiAssistantId, twilioNumbers);
    if (vapiPhone) {
      const aiNumber = normalizePhoneForMatch(getVapiPhoneNumber(vapiPhone));
      const smsRouting = await safelyProvisionIsolatedSmsForSignup({
        ownerEmail: signup.ownerEmail,
        assistantId: signup.vapiAssistantId,
        aiNumber,
        ownerNumber: signup.ownerPhone || signup.businessPhone,
      });
      upsertSignupDashboardRecord({
        ...signup,
        status: "setup_ready",
        makeError: "",
        twilioPhoneNumber: aiNumber,
        vapiPhoneNumberId: String(vapiPhone?.id || "").trim(),
        smsRoutingStatus: smsRouting.healthy ? "healthy" : smsRouting.skipped ? "waiting" : "failed",
        smsRoutingToolId: smsRouting.toolId || "",
        smsRoutingToolName: smsRouting.toolName || "",
        smsRoutingVerifiedAt: smsRouting.healthy ? new Date().toISOString() : "",
        smsRoutingError: smsRouting.skipped ? smsRouting.reason : smsRouting.healthy ? "" : smsRouting.error || "Vapi read-back did not verify isolated routing.",
        provisioningReconciledAt: new Date().toISOString(),
      });
      return {
        ok: true,
        action: "assistant_phone_reconciled",
        assignedPhone: true,
        assistantAssigned: true,
        smsRoutingStatus: smsRouting.healthy ? "healthy" : smsRouting.skipped ? "waiting" : "failed",
      };
    }
  }

  if (signup.twilioPhoneNumber) {
    const [vapiNumbers, twilioNumbers] = await Promise.all([
      fetchVapiCollection("phone-number", ["phoneNumbers", "phone_numbers"]),
      fetchTwilioIncomingPhoneNumbers(),
    ]);
    const aiNumber = normalizePhoneForMatch(signup.twilioPhoneNumber);
    const vapiPhone = vapiNumbers.find((record) => normalizePhoneForMatch(getVapiPhoneNumber(record)) === aiNumber);
    const assistantId = getVapiAssistantId(vapiPhone);
    if (assistantId) {
      const smsRouting = await safelyProvisionIsolatedSmsForSignup({
        ownerEmail: signup.ownerEmail,
        assistantId,
        aiNumber,
        ownerNumber: signup.ownerPhone || signup.businessPhone,
      });
      upsertSignupDashboardRecord({
        ...signup,
        status: "setup_ready",
        makeError: "",
        vapiPhoneNumberId: String(vapiPhone?.id || "").trim(),
        vapiAssistantId: assistantId,
        smsRoutingStatus: smsRouting.healthy ? "healthy" : smsRouting.skipped ? "waiting" : "failed",
        smsRoutingToolId: smsRouting.toolId || "",
        smsRoutingToolName: smsRouting.toolName || "",
        smsRoutingVerifiedAt: smsRouting.healthy ? new Date().toISOString() : "",
        smsRoutingError: smsRouting.skipped ? smsRouting.reason : smsRouting.healthy ? "" : smsRouting.error || "Vapi read-back did not verify isolated routing.",
        provisioningReconciledAt: new Date().toISOString(),
      });
      return {
        ok: true,
        action: "provider_assignment_reconciled",
        assignedPhone: true,
        assistantAssigned: true,
        smsRoutingStatus: smsRouting.healthy ? "healthy" : smsRouting.skipped ? "waiting" : "failed",
      };
    }

    const diagnostics = getSignupProviderRecoveryDiagnostics({
      signup,
      vapiNumbers,
      twilioNumbers,
      providerLookup: "complete",
    });
    if (isSyntheticPausedTestSignupArchiveEligible({ signup, diagnostics })) {
      upsertSignupDashboardRecord({
        ...signup,
        status: "abandoned_archived",
        makeError: "",
        archivedAt: new Date().toISOString(),
        archivedReason: "synthetic_paused_test_without_provider_resources",
      });
      return {
        ok: true,
        action: "synthetic_paused_test_archived",
        assignedPhone: false,
        assistantAssigned: false,
      };
    }
    if (isStaleSignupArchiveEligible({ signup, diagnostics })) {
      upsertSignupDashboardRecord({
        ...signup,
        status: "abandoned_archived",
        makeError: "",
        archivedAt: new Date().toISOString(),
        archivedReason: "provider_resource_absent_after_retention_window",
      });
      return {
        ok: true,
        action: "stale_setup_archived",
        assignedPhone: false,
        assistantAssigned: false,
      };
    }
  }

  const error = new Error("No safe automatic recovery path is available for this signup.");
  error.statusCode = 409;
  throw error;
}

let publicNetworkStatsLoader = async () => {
  const [callsAnswered, followUpOpportunities] = await prisma.$transaction([
    prisma.call.count({ where: { status: "COMPLETED" } }),
    prisma.call.count({
      where: {
        OR: [
          { followUpNeeded: true },
          { outcome: { in: ["FOLLOW_UP", "QUOTE_NEEDED", "EMERGENCY"] } },
        ],
      },
    }),
  ]);
  return { callsAnswered, followUpOpportunities };
};

function setPublicNetworkStatsLoaderForTests(loader) {
  if (process.env.NODE_ENV !== "test") throw new Error("Public network stats loader can only be replaced in tests.");
  if (typeof loader !== "function") throw new TypeError("Public network stats loader must be a function.");
  publicNetworkStatsLoader = loader;
}

async function getPublicSignupNetworkStats(now = new Date(), loadStats = publicNetworkStatsLoader) {
  const currentTime = now instanceof Date ? now : new Date(now);
  const { callsAnswered, followUpOpportunities } = await loadStats();

  return {
    callsAnswered,
    followUpOpportunities,
    updatedAt: currentTime.toISOString(),
  };
}

function getTrialPolicyIdentity(signup = {}) {
  const source = String(
    signup.subscriptionId
      || signup.checkoutSessionId
      || signup.ownerEmail
      || `${signup.businessName || ""}:${signup.ownerPhone || signup.businessPhone || ""}`
  ).trim();
  return hashKey(source || "unknown-trial");
}

function getTrialGateRuntimeKeys({ phoneNumberId, phoneNumber } = {}) {
  return [
    String(phoneNumberId || "").trim() ? `trial-voice-gate:phone-id:${String(phoneNumberId).trim()}` : "",
    normalizePhoneForMatch(phoneNumber) ? `trial-voice-gate:number:${normalizePhoneForMatch(phoneNumber)}` : "",
  ].filter(Boolean);
}

function getTrialUsageStateKey(signup = {}) {
  return `trial-usage-state:${getTrialPolicyIdentity(signup)}`;
}

function getTrialReservationKey(signup = {}, businessId) {
  return `trial-call-reservations:${getTrialPolicyIdentity(signup)}:${Number(businessId || 0)}`;
}

function getTrialCallIndexKey(callId) {
  return `trial-call-index:${hashKey(String(callId || ""))}`;
}

function findSignupForBusiness(business, signups = listSignupDashboardRecords()) {
  if (!business) return null;
  const businessName = normalizeForKey(business.name || "");
  const businessPhone = normalizePhoneForMatch(business.phone || "");
  const mappedValues = new Set((business.vapiMappings || []).map((mapping) => normalizePhoneForMatch(mapping.matchValue)).filter(Boolean));
  return signups.find((record) => {
    const sameName = businessName && normalizeForKey(record.businessName || "") === businessName;
    const samePhone = businessPhone && [
      record.businessPhone,
      record.ownerPhone,
      record.twilioPhoneNumber,
    ].some((value) => normalizePhoneForMatch(value) === businessPhone);
    const sameAiNumber = normalizePhoneForMatch(record.twilioPhoneNumber)
      && mappedValues.has(normalizePhoneForMatch(record.twilioPhoneNumber));
    return sameName || samePhone || sameAiNumber;
  }) || null;
}

async function findBusinessForSignup(signup = {}) {
  const aiNumber = normalizePhoneForMatch(signup.twilioPhoneNumber || "");
  if (aiNumber) {
    const mapping = await prisma.vapiBusinessMapping.findUnique({
      where: { matchValue: aiNumber },
      include: { business: { include: { settings: true, vapiMappings: true } } },
    });
    if (mapping?.business) return mapping.business;
  }

  const lookup = [
    signup.businessName ? { name: { equals: String(signup.businessName).trim(), mode: "insensitive" } } : undefined,
    normalizePhoneForMatch(signup.businessPhone || "") ? { phone: normalizePhoneForMatch(signup.businessPhone) } : undefined,
  ].filter(Boolean);
  return lookup.length
    ? prisma.business.findFirst({
        where: { OR: lookup },
        include: { settings: true, vapiMappings: true },
      })
    : null;
}

function getTrialFallbackPhone(signup = {}, aiNumber = "") {
  const normalizedAiNumber = normalizePhoneForMatch(aiNumber);
  return [signup.ownerPhone, signup.businessPhone]
    .map((value) => String(value || "").trim())
    .find((value) => value && normalizePhoneForMatch(value) !== normalizedAiNumber) || "";
}

async function ensureTrialBusinessAndMappings(signup, vapiPhone) {
  let business = await findBusinessForSignup(signup);
  const aiNumber = normalizePhoneForMatch(getVapiPhoneNumber(vapiPhone) || signup.twilioPhoneNumber || "");
  const fallbackPhone = normalizePhoneForMatch(signup.businessPhone || signup.ownerPhone || aiNumber);
  if (!business) {
    business = await prisma.business.create({
      data: {
        name: String(signup.businessName || signup.ownerName || "My AI PA Trial").trim().slice(0, 160),
        phone: fallbackPhone,
        timezone: "America/Toronto",
      },
      include: { settings: true, vapiMappings: true },
    });
  }

  const ownerPhone = String(signup.ownerPhone || signup.businessPhone || fallbackPhone).trim();
  if (!business.settings) {
    await prisma.settings.create({
      data: {
        businessId: business.id,
        ownerPhone,
        answerAfterRings: 3,
        afterHoursMode: "AI_ALWAYS_ON",
      },
    });
  } else if (ownerPhone && ownerPhone !== business.settings.ownerPhone) {
    await prisma.settings.update({ where: { businessId: business.id }, data: { ownerPhone } });
  }

  const mappings = [
    { matchType: "phoneNumber", matchValue: aiNumber },
    { matchType: "phoneNumberId", matchValue: String(vapiPhone?.id || "").trim().toLowerCase() },
    { matchType: "assistantId", matchValue: getVapiAssistantId(vapiPhone).toLowerCase() },
  ].filter((mapping) => mapping.matchValue);
  for (const mapping of mappings) {
    await prisma.vapiBusinessMapping.upsert({
      where: { matchValue: mapping.matchValue },
      update: {
        businessId: business.id,
        matchType: mapping.matchType,
        label: String(signup.businessName || business.name).slice(0, 120),
      },
      create: {
        businessId: business.id,
        ...mapping,
        label: String(signup.businessName || business.name).slice(0, 120),
      },
    });
  }
  return prisma.business.findUnique({
    where: { id: business.id },
    include: { settings: true, vapiMappings: true },
  });
}

async function getTrialCallUsage(signup, businessId, db = prisma) {
  const lifecycle = getTrialLifecycle(signup);
  if (!businessId || !lifecycle.startAt) {
    return { usedSeconds: 0, callCount: 0, averageCallSeconds: 0 };
  }
  const startedAt = {
    gte: new Date(lifecycle.startAt),
    ...(lifecycle.endAt ? { lte: new Date(lifecycle.endAt) } : {}),
  };
  const aggregate = await db.call.aggregate({
    where: {
      businessId: Number(businessId),
      externalProvider: "vapi",
      startedAt,
    },
    _sum: { durationSec: true },
    _count: { _all: true },
  });
  const usedSeconds = Math.max(0, Math.floor(Number(aggregate?._sum?.durationSec || 0)));
  const callCount = Math.max(0, Math.floor(Number(aggregate?._count?._all || 0)));
  return {
    usedSeconds,
    callCount,
    averageCallSeconds: callCount ? Math.max(1, Math.round(usedSeconds / callCount)) : 0,
  };
}

async function getTrialUsedSeconds(signup, businessId, db = prisma) {
  return (await getTrialCallUsage(signup, businessId, db)).usedSeconds;
}

async function getTrialUsageSnapshot(signup, businessId) {
  const lifecycle = getTrialLifecycle(signup);
  const callUsage = businessId
    ? await getTrialCallUsage(signup, businessId)
    : { usedSeconds: 0, callCount: 0, averageCallSeconds: 0 };
  const usage = getTrialUsage({
    usedSeconds: callUsage.usedSeconds,
    warningSeconds: TRIAL_USAGE_WARNING_SECONDS,
    limitSeconds: TRIAL_USAGE_LIMIT_SECONDS,
    completionReserveSeconds: TRIAL_USAGE_COMPLETION_RESERVE_SECONDS,
  });
  const planningCallSeconds = callUsage.averageCallSeconds || 96;
  const estimatedCallsRemaining = usage.newCallsPaused
    ? 0
    : Math.max(0, Math.floor(usage.newCallSecondsRemaining / planningCallSeconds));
  const state = await prisma.runtimeStore.findUnique({ where: { key: getTrialUsageStateKey(signup) } }).catch(() => null);
  return {
    enabled: TRIAL_USAGE_LIMIT_ENABLED,
    lifecycle: lifecycle.state,
    subscriptionStatus: lifecycle.status,
    trialStartAt: lifecycle.startAt ? new Date(lifecycle.startAt).toISOString() : null,
    trialEndAt: lifecycle.endAt ? new Date(lifecycle.endAt).toISOString() : null,
    ...usage,
    callCount: callUsage.callCount,
    averageCallMinutes: callUsage.averageCallSeconds
      ? Number((callUsage.averageCallSeconds / 60).toFixed(1))
      : 1.6,
    estimatedCallsRemaining,
    fallbackRoutingReady: Boolean(getTrialFallbackPhone(signup, signup.twilioPhoneNumber)),
    warningSentAt: state?.data?.warningSentAt || null,
    fifteenRemainingSentAt: state?.data?.fifteenRemainingSentAt || null,
    fiveRemainingSentAt: state?.data?.fiveRemainingSentAt || null,
    limitSentAt: state?.data?.limitSentAt || null,
  };
}

async function writeTrialGateConfiguration(config) {
  const keys = getTrialGateRuntimeKeys(config);
  if (!keys.length) throw new Error("Trial gate configuration requires a Vapi phone number id or phone number.");
  for (const key of keys) {
    await prisma.runtimeStore.upsert({
      where: { key },
      update: { data: config },
      create: { key, data: config },
    });
  }
  return config;
}

async function readTrialGateConfiguration(call = {}) {
  const keys = getTrialGateRuntimeKeys({
    phoneNumberId: call.phoneNumberId || call.phoneNumber?.id,
    phoneNumber: call.phoneNumber?.number || call.phoneNumber?.twilioPhoneNumber || call.destination?.number || call.to,
  });
  if (!keys.length) return null;
  const row = await prisma.runtimeStore.findFirst({ where: { key: { in: keys } } });
  return row?.data && typeof row.data === "object" ? row.data : null;
}

async function configureTrialGateForSignup(signup, phoneInventory = null) {
  if (!TRIAL_USAGE_LIMIT_ENABLED) return { configured: false, skipped: true, reason: "disabled" };
  const lifecycle = getTrialLifecycle(signup);
  if (lifecycle.state !== "trial") return { configured: false, skipped: true, reason: lifecycle.state };
  const aiNumber = normalizePhoneForMatch(signup.twilioPhoneNumber || "");
  if (!aiNumber) return { configured: false, skipped: true, reason: "missing-ai-number" };

  const phones = phoneInventory || await fetchVapiCollection("phone-number", ["phoneNumbers", "phone_numbers"]);
  const phone = phones.find((record) => normalizePhoneForMatch(getVapiPhoneNumber(record)) === aiNumber);
  if (!phone?.id) return { configured: false, skipped: true, reason: "vapi-phone-not-found" };

  const existingConfig = await readTrialGateConfiguration({
    phoneNumberId: phone.id,
    phoneNumber: { id: phone.id, number: aiNumber },
  });
  const currentAssistantId = getVapiAssistantId(phone);
  if (!currentAssistantId && existingConfig?.assistantId) {
    const currentServerUrl = getVapiNestedString(phone, ["server.url", "serverUrl"]);
    if (currentServerUrl !== TRIAL_USAGE_GATE_WEBHOOK_URL) {
      await requestVapiResource(`phone-number/${encodeURIComponent(String(phone.id))}`, {
        method: "PATCH",
        body: {
          assistantId: null,
          squadId: null,
          server: {
            url: TRIAL_USAGE_GATE_WEBHOOK_URL,
            secret: getVapiWebhookSecret(),
          },
        },
      });
    }
    const business = await ensureTrialBusinessAndMappings(signup, {
      ...phone,
      assistantId: existingConfig.assistantId,
    });
    const current = {
      ...existingConfig,
      businessId: business.id,
      subscriptionId: signup.subscriptionId || existingConfig.subscriptionId || "",
      ownerEmail: signup.ownerEmail || existingConfig.ownerEmail || "",
      fallbackPhone: getTrialFallbackPhone(signup, aiNumber) || existingConfig.fallbackPhone || "",
      status: "active",
      verifiedAt: new Date().toISOString(),
    };
    await writeTrialGateConfiguration(current);
    return { configured: true, reused: true, businessId: business.id, phoneNumberId: phone.id };
  }
  if (!currentAssistantId) {
    return { configured: false, skipped: true, reason: "dynamic-phone-missing-gate-backup" };
  }

  const assistant = await requestVapiResource(`assistant/${encodeURIComponent(currentAssistantId)}`);
  const assistantMaxSeconds = Math.min(
    DEFAULT_MAX_CALL_SECONDS,
    Math.max(TRIAL_USAGE_MIN_CALL_SECONDS, Number(assistant.maxDurationSeconds || DEFAULT_MAX_CALL_SECONDS))
  );
  const assistantSnapshot = sanitizeTransientAssistant(assistant, {
    maxDurationSeconds: assistantMaxSeconds,
  });
  if (assistantSnapshot.server && typeof assistantSnapshot.server === "object") {
    delete assistantSnapshot.server.secret;
  }
  const business = await ensureTrialBusinessAndMappings(signup, phone);
  const config = {
    version: 1,
    status: "prepared",
    businessId: business.id,
    subscriptionId: signup.subscriptionId || "",
    ownerEmail: signup.ownerEmail || "",
    phoneNumberId: String(phone.id),
    phoneNumber: aiNumber,
    fallbackPhone: getTrialFallbackPhone(signup, aiNumber),
    assistantId: currentAssistantId,
    assistantMaxSeconds,
    assistantSnapshot,
    preparedAt: new Date().toISOString(),
  };
  await writeTrialGateConfiguration(config);

  const webhookSecret = getVapiWebhookSecret();
  if (!webhookSecret) throw new Error("Vapi webhook authentication must be configured before enabling trial limits.");
  await requestVapiResource(`phone-number/${encodeURIComponent(String(phone.id))}`, {
    method: "PATCH",
    body: {
      assistantId: null,
      squadId: null,
      server: {
        url: TRIAL_USAGE_GATE_WEBHOOK_URL,
        secret: webhookSecret,
      },
    },
  });

  const activated = { ...config, status: "active", activatedAt: new Date().toISOString() };
  await writeTrialGateConfiguration(activated);
  upsertSignupDashboardRecord({
    subscriptionId: signup.subscriptionId || "",
    ownerEmail: signup.ownerEmail || "",
    trialUsageGateStatus: "active",
    trialUsageGateActivatedAt: activated.activatedAt,
    trialUsageLimitMinutes: Number((TRIAL_USAGE_LIMIT_SECONDS / 60).toFixed(1)),
    trialUsageWarningMinutes: Number((TRIAL_USAGE_WARNING_SECONDS / 60).toFixed(1)),
    trialUsageCompletionReserveMinutes: Number((TRIAL_USAGE_COMPLETION_RESERVE_SECONDS / 60).toFixed(1)),
  });
  return { configured: true, reused: false, businessId: business.id, phoneNumberId: phone.id };
}

async function claimTrialUsageMilestone(signup, milestone, usage) {
  const key = getTrialUsageStateKey(signup);
  const fields = {
    warning: ["warningSentAt", "warningClaimedAt", "warningLastError"],
    "fifteen-remaining": ["fifteenRemainingSentAt", "fifteenRemainingClaimedAt", "fifteenRemainingLastError"],
    "five-remaining": ["fiveRemainingSentAt", "fiveRemainingClaimedAt", "fiveRemainingLastError"],
    limit: ["limitSentAt", "limitClaimedAt", "limitLastError"],
  };
  const [field, claimField] = fields[milestone] || fields.warning;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const row = await tx.runtimeStore.findUnique({ where: { key } });
    const data = row?.data && typeof row.data === "object" ? row.data : {};
    if (data[field]) return { claimed: false, reason: "already-sent" };
    const claimedAt = Number(new Date(data[claimField] || 0).getTime());
    if (claimedAt && claimedAt > Date.now() - 10 * 60 * 1000) {
      return { claimed: false, reason: "already-processing" };
    }
    const next = {
      ...data,
      [claimField]: new Date().toISOString(),
      lastUsageSeconds: usage.usedSeconds,
      updatedAt: new Date().toISOString(),
    };
    await tx.runtimeStore.upsert({
      where: { key },
      update: { data: next },
      create: { key, data: next },
    });
    return { claimed: true, key, data: next };
  });
}

async function finishTrialUsageMilestone({ key, milestone, result, error }) {
  const fields = {
    warning: ["warningSentAt", "warningLastError"],
    "fifteen-remaining": ["fifteenRemainingSentAt", "fifteenRemainingLastError"],
    "five-remaining": ["fiveRemainingSentAt", "fiveRemainingLastError"],
    limit: ["limitSentAt", "limitLastError"],
  };
  const [field, errorField] = fields[milestone] || fields.warning;
  const row = await prisma.runtimeStore.findUnique({ where: { key } });
  const data = row?.data && typeof row.data === "object" ? row.data : {};
  const next = {
    ...data,
    ...(result?.sent ? { [field]: new Date().toISOString(), [errorField]: "" } : { [errorField]: error?.message || "Notification was not sent." }),
    lastNotificationChannels: result?.channels || [],
    updatedAt: new Date().toISOString(),
  };
  await prisma.runtimeStore.upsert({
    where: { key },
    update: { data: next },
    create: { key, data: next },
  });
}

async function deliverTrialUsageNotification(signup, milestone, usage) {
  const notification = buildTrialUsageNotification({
    milestone,
    businessName: signup.businessName,
    trialEndAt: signup.trialEndAt || signup.currentPeriodEndAt || signup.periodEndAt,
    usage,
    dashboardUrl: `${FRONTEND_APP_URL}/#/dashboard`,
  });
  const channels = [];
  const errors = [];
  const ownerPhone = String(signup.ownerPhone || signup.businessPhone || "").trim();
  if (ownerPhone) {
    try {
      const sms = await sendSmsViaTwilio({ to: ownerPhone, message: notification.text });
      if (!sms.mocked) channels.push("sms");
    } catch (error) {
      errors.push(`SMS: ${error?.message || "failed"}`);
    }
  }

  const emailConfig = getEmailTransportConfig();
  if (signup.ownerEmail && emailConfig) {
    try {
      const transporter = nodemailer.createTransport(emailConfig.transport);
      await transporter.sendMail({
        from: emailConfig.from,
        to: signup.ownerEmail,
        subject: notification.subject,
        text: notification.text,
        html: `<div style="font-family:Arial,sans-serif;line-height:1.55;color:#0f172a;max-width:640px"><h1>${escapeHtml(notification.subject)}</h1><p>${escapeHtml(notification.text)}</p></div>`,
      });
      channels.push("email");
    } catch (error) {
      errors.push(`Email: ${error?.message || "failed"}`);
    }
  }

  if (!channels.length) {
    const error = new Error(errors.join("; ") || "No trial notification channel is configured.");
    error.code = "TRIAL_NOTIFICATION_NOT_SENT";
    throw error;
  }
  return { sent: true, channels };
}

async function evaluateTrialUsageForSignup(signup, businessId) {
  if (!TRIAL_USAGE_LIMIT_ENABLED || !signup || !businessId) return null;
  const lifecycle = getTrialLifecycle(signup);
  if (!["trial", "ended"].includes(lifecycle.state)) return null;
  const snapshot = await getTrialUsageSnapshot(signup, businessId);
  const pending = getPendingTrialMilestone({
    usedSeconds: snapshot.usedSeconds,
    callCount: snapshot.callCount,
    estimatedCallsRemaining: snapshot.estimatedCallsRemaining,
    warningSentAt: snapshot.warningSentAt,
    fifteenRemainingSentAt: snapshot.fifteenRemainingSentAt,
    fiveRemainingSentAt: snapshot.fiveRemainingSentAt,
    limitSentAt: snapshot.limitSentAt,
    warningSeconds: TRIAL_USAGE_WARNING_SECONDS,
    limitSeconds: TRIAL_USAGE_LIMIT_SECONDS,
    completionReserveSeconds: TRIAL_USAGE_COMPLETION_RESERVE_SECONDS,
  });
  if (!pending.milestone) return snapshot;
  const claim = await claimTrialUsageMilestone(signup, pending.milestone, pending.usage);
  if (!claim.claimed) return snapshot;
  try {
    const result = await deliverTrialUsageNotification(signup, pending.milestone, pending.usage);
    await finishTrialUsageMilestone({ key: claim.key, milestone: pending.milestone, result });
  } catch (error) {
    await finishTrialUsageMilestone({ key: claim.key, milestone: pending.milestone, error }).catch(() => {});
    console.error("[trial-usage] milestone notification failed", {
      milestone: pending.milestone,
      businessId,
      message: error?.message || String(error),
    });
  }
  return getTrialUsageSnapshot(signup, businessId);
}

async function processTrialUsagePolicies() {
  if (!TRIAL_USAGE_LIMIT_ENABLED) return { enabled: false, processed: 0, configured: 0, errors: [] };
  const signups = listSignupDashboardRecords().filter((signup) => getTrialLifecycle(signup).state === "trial");
  if (!signups.length) return { enabled: true, processed: 0, configured: 0, errors: [] };
  const phones = await fetchVapiCollection("phone-number", ["phoneNumbers", "phone_numbers"]);
  const results = [];
  const errors = [];
  for (const signup of signups) {
    try {
      const gate = await configureTrialGateForSignup(signup, phones);
      const business = gate.businessId ? { id: gate.businessId } : await findBusinessForSignup(signup);
      const usage = business?.id ? await evaluateTrialUsageForSignup(signup, business.id) : null;
      results.push({ ownerEmailHash: hashKey(signup.ownerEmail || ""), gate, usage });
    } catch (error) {
      errors.push({
        ownerEmailHash: hashKey(signup.ownerEmail || ""),
        message: error?.message || String(error),
      });
    }
  }
  return {
    enabled: true,
    processed: signups.length,
    configured: results.filter((result) => result.gate?.configured).length,
    results,
    errors,
  };
}

async function getTrialUsageDashboard() {
  const signups = listSignupDashboardRecords().filter((signup) => {
    const lifecycle = getTrialLifecycle(signup);
    return lifecycle.state === "trial" || lifecycle.state === "ended";
  });
  const accounts = [];
  for (const signup of signups) {
    const business = await findBusinessForSignup(signup);
    const usage = await getTrialUsageSnapshot(signup, business?.id || null);
    const gate = signup.twilioPhoneNumber
      ? await readTrialGateConfiguration({ phoneNumber: { number: signup.twilioPhoneNumber } })
      : null;
    accounts.push({
      businessId: business?.id || null,
      businessName: signup.businessName || business?.name || "Unnamed business",
      ownerEmail: signup.ownerEmail || "",
      aiNumberLast4: normalizePhoneForMatch(signup.twilioPhoneNumber).slice(-4),
      subscriptionId: signup.subscriptionId || "",
      gateStatus: gate?.status || signup.trialUsageGateStatus || "not-configured",
      ...usage,
    });
  }
  return {
    enabled: TRIAL_USAGE_LIMIT_ENABLED,
    warningMinutes: Number((TRIAL_USAGE_WARNING_SECONDS / 60).toFixed(1)),
    limitMinutes: Number((TRIAL_USAGE_LIMIT_SECONDS / 60).toFixed(1)),
    completionReserveMinutes: Number((TRIAL_USAGE_COMPLETION_RESERVE_SECONDS / 60).toFixed(1)),
    newCallCutoffMinutes: Number(((TRIAL_USAGE_LIMIT_SECONDS - TRIAL_USAGE_COMPLETION_RESERVE_SECONDS) / 60).toFixed(1)),
    accounts,
    totals: {
      accounts: accounts.length,
      warningReached: accounts.filter((account) => account.warningReached).length,
      limitReached: accounts.filter((account) => account.limitReached).length,
      gated: accounts.filter((account) => account.gateStatus === "active").length,
    },
  };
}

async function reserveTrialCall({ signup, config, callId }) {
  const businessId = Number(config.businessId || 0);
  const key = getTrialReservationKey(signup, businessId);
  const callIndexKey = getTrialCallIndexKey(callId);
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
    const [reservationRow, usedSeconds] = await Promise.all([
      tx.runtimeStore.findUnique({ where: { key } }),
      getTrialUsedSeconds(signup, businessId, tx),
    ]);
    const reservationData = reservationRow?.data && typeof reservationRow.data === "object" ? reservationRow.data : {};
    const now = Date.now();
    const reservations = Object.fromEntries(
      Object.entries(reservationData.reservations || {}).filter(([, record]) => Number(record?.expiresAt || 0) > now)
    );
    if (reservations[callId]) {
      const allowanceSeconds = Number(reservations[callId].allowanceSeconds || 0);
      return {
        action: allowanceSeconds < Number(config.assistantMaxSeconds || DEFAULT_MAX_CALL_SECONDS)
          ? "allow-transient"
          : "allow-saved",
        allowanceSeconds,
        duplicateReservation: true,
      };
    }
    const reservedSeconds = Object.values(reservations).reduce(
      (sum, record) => sum + Math.max(0, Number(record?.allowanceSeconds || 0)),
      0
    );
    const lifecycle = getTrialLifecycle(signup);
    const decision = decideTrialCall({
      lifecycle,
      usedSeconds,
      reservedSeconds,
      assistantMaxSeconds: config.assistantMaxSeconds || DEFAULT_MAX_CALL_SECONDS,
      warningSeconds: TRIAL_USAGE_WARNING_SECONDS,
      limitSeconds: TRIAL_USAGE_LIMIT_SECONDS,
      completionReserveSeconds: TRIAL_USAGE_COMPLETION_RESERVE_SECONDS,
      minCallSeconds: TRIAL_USAGE_MIN_CALL_SECONDS,
    });
    if (!decision.action.startsWith("allow") || lifecycle.state === "paid") return decision;

    reservations[callId] = {
      allowanceSeconds: decision.allowanceSeconds,
      createdAt: new Date(now).toISOString(),
      expiresAt: now + (decision.allowanceSeconds + TRIAL_USAGE_RESERVATION_GRACE_SECONDS) * 1000,
    };
    const next = {
      ...reservationData,
      reservations,
      updatedAt: new Date().toISOString(),
    };
    await tx.runtimeStore.upsert({
      where: { key },
      update: { data: next },
      create: { key, data: next },
    });
    await tx.runtimeStore.upsert({
      where: { key: callIndexKey },
      update: { data: { reservationKey: key, callId, businessId } },
      create: { key: callIndexKey, data: { reservationKey: key, callId, businessId } },
    });
    return decision;
  });
}

async function releaseTrialCallReservation(callId) {
  if (!callId) return;
  const callIndexKey = getTrialCallIndexKey(callId);
  const index = await prisma.runtimeStore.findUnique({ where: { key: callIndexKey } });
  const reservationKey = String(index?.data?.reservationKey || "");
  if (!reservationKey) return;
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${reservationKey}))`;
    const row = await tx.runtimeStore.findUnique({ where: { key: reservationKey } });
    const data = row?.data && typeof row.data === "object" ? row.data : {};
    const reservations = { ...(data.reservations || {}) };
    delete reservations[callId];
    await tx.runtimeStore.upsert({
      where: { key: reservationKey },
      update: { data: { ...data, reservations, updatedAt: new Date().toISOString() } },
      create: { key: reservationKey, data: { reservations, updatedAt: new Date().toISOString() } },
    });
    await tx.runtimeStore.delete({ where: { key: callIndexKey } }).catch(() => {});
  });
}

async function handleTrialAssistantRequest(message) {
  if (!TRIAL_USAGE_LIMIT_ENABLED) {
    return { error: "This phone assistant is not available right now. Please try again later." };
  }
  const call = message?.call && typeof message.call === "object" ? message.call : {};
  const config = await readTrialGateConfiguration(call);
  if (!config?.assistantId || !config?.businessId) {
    return { error: "This phone assistant is temporarily unavailable. Please try again later." };
  }
  const signups = listSignupDashboardRecords();
  const signup = signups.find((record) => (
    (config.subscriptionId && record.subscriptionId === config.subscriptionId)
    || (config.ownerEmail && String(record.ownerEmail || "").toLowerCase() === String(config.ownerEmail).toLowerCase())
    || normalizePhoneForMatch(record.twilioPhoneNumber) === normalizePhoneForMatch(config.phoneNumber)
  ));
  if (!signup) {
    return { error: "This phone assistant is temporarily unavailable. Please try again later." };
  }

  const lifecycle = getTrialLifecycle(signup);
  if (lifecycle.state === "paid") return { assistantId: config.assistantId };
  const callId = String(call.id || call.callId || "").trim();
  if (!callId) return { error: "This phone assistant is temporarily unavailable. Please try again later." };
  const decision = await reserveTrialCall({ signup, config, callId });
  if (decision.action === "block") {
    setImmediate(() => {
      evaluateTrialUsageForSignup(signup, config.businessId).catch((error) => {
        console.error("[trial-usage] blocked-call evaluation failed", { message: error?.message || String(error) });
      });
    });
    const fallback = buildTrialFallbackDestination({
      fallbackPhone: config.fallbackPhone || getTrialFallbackPhone(signup, config.phoneNumber),
      aiPhone: config.phoneNumber,
    });
    if (fallback) return fallback;
    return { error: "The team is unavailable right now. Please try again shortly." };
  }
  if (decision.action === "allow-saved") return { assistantId: config.assistantId };
  if (!config.assistantSnapshot) {
    await releaseTrialCallReservation(callId);
    return { error: "This phone assistant is temporarily unavailable. Please try again later." };
  }
  return {
    assistant: sanitizeTransientAssistant(config.assistantSnapshot, {
      maxDurationSeconds: decision.allowanceSeconds,
      serverUrl: TRIAL_USAGE_GATE_WEBHOOK_URL,
      serverSecret: getVapiWebhookSecret(),
    }),
  };
}

async function reconcileTrialUsageAfterCall(result) {
  if (!TRIAL_USAGE_LIMIT_ENABLED || !result?.businessId) return;
  await releaseTrialCallReservation(result.vapiCallId).catch((error) => {
    console.warn("[trial-usage] reservation release failed", { message: error?.message || String(error) });
  });
  const business = await prisma.business.findUnique({
    where: { id: Number(result.businessId) },
    include: { vapiMappings: true },
  });
  const signup = findSignupForBusiness(business);
  if (signup) await evaluateTrialUsageForSignup(signup, result.businessId);
}

function findCustomerDashboardSignup({ email, phone }) {
  const ownerEmail = String(email || "").trim().toLowerCase();
  const phoneMatch = normalizePhoneForMatch(phone);
  if (!ownerEmail || !isValidEmailAddress(ownerEmail) || !phoneMatch) return null;
  return listSignupDashboardRecords().find((record) => {
    const recordEmail = String(record.ownerEmail || "").trim().toLowerCase();
    if (recordEmail !== ownerEmail) return false;
    const phones = [record.ownerPhone, record.businessPhone].map(normalizePhoneForMatch).filter(Boolean);
    return phones.includes(phoneMatch);
  }) || null;
}

function findCustomerDashboardSignupByLookupHash(lookupHash) {
  const normalizedLookupHash = String(lookupHash || "").trim().toLowerCase();
  if (!/^[a-f0-9]{32}$/.test(normalizedLookupHash)) return null;
  for (const record of listSignupDashboardRecords()) {
    const email = String(record.ownerEmail || "").trim().toLowerCase();
    if (!email) continue;
    const matchingPhone = [record.ownerPhone, record.businessPhone]
      .filter(Boolean)
      .find((phone) => getCustomerDashboardLookupHash(email, phone) === normalizedLookupHash);
    if (matchingPhone) return { signup: record, matchingPhone };
  }
  return null;
}

function sanitizeCustomerStructuredData(value, depth = 0) {
  if (value == null || depth > 3) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.slice(0, 30).map((item) => sanitizeCustomerStructuredData(item, depth + 1)).filter((item) => item != null);
  if (typeof value !== "object") return null;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/(?:secret|token|password|authorization|api.?key|credential|system.?prompt)/i.test(key))
      .slice(0, 60)
      .map(([key, item]) => [key, sanitizeCustomerStructuredData(item, depth + 1)])
      .filter(([, item]) => item != null)
  );
}

function getCustomerNotificationSummary(call) {
  const attempts = (call.leadHandoffs || []).flatMap((handoff) => handoff.attempts || []);
  return attempts.map((attempt) => ({
    recipient: String(attempt.recipientRole || "").toLowerCase(),
    status: String(attempt.status || "").toLowerCase(),
    requestedAt: attempt.requestedAt || null,
    sentAt: attempt.sentAt || attempt.acceptedAt || null,
    deliveredAt: attempt.deliveredAt || null,
    failedAt: attempt.failedAt || null,
    problem: attempt.failedAt ? "Message delivery failed" : "",
  }));
}

function buildCustomerCallTimeline(call, notifications) {
  const events = [
    { type: "call_started", label: "Call received", at: call.startedAt },
    call.endedAt ? { type: "call_ended", label: "Call completed", at: call.endedAt } : null,
    call.aiSummary || call.transcript ? { type: "summary_ready", label: "Call summary ready", at: call.endedAt || call.startedAt } : null,
    ...notifications.map((item) => ({
      type: `${item.recipient || "message"}_text_${item.status || "updated"}`,
      label: `${item.recipient === "owner" ? "Owner" : item.recipient === "customer" ? "Customer" : "Backup"} text ${item.failedAt ? "needs attention" : item.deliveredAt ? "delivered" : item.sentAt ? "sent" : "requested"}`,
      at: item.deliveredAt || item.failedAt || item.sentAt || item.requestedAt,
    })),
  ].filter(Boolean);
  return events.sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0));
}

function sanitizeCustomerCall(call) {
  const now = Date.now();
  const transcriptAvailable = Boolean(call.transcript) && (!call.transcriptExpiresAt || new Date(call.transcriptExpiresAt).getTime() > now);
  const recordingConsentGranted = Boolean(call.recordingConsentGrantedAt);
  const recordingAvailable = Boolean(call.recordingUrl) && recordingConsentGranted && (!call.recordingExpiresAt || new Date(call.recordingExpiresAt).getTime() > now);
  const notifications = getCustomerNotificationSummary(call);
  return {
    id: call.id,
    startedAt: call.startedAt,
    durationSec: call.durationSec,
    status: call.status,
    outcome: call.outcome,
    endedReason: call.endedReason || "",
    endedMessage: call.endedMessage || "",
    aiSummary: call.aiSummary || (call.transcript ? "Call summary is being prepared." : ""),
    followUpNeeded: Boolean(call.followUpNeeded || ["FOLLOW_UP", "QUOTE_NEEDED", "EMERGENCY"].includes(call.outcome)),
    transcript: transcriptAvailable ? call.transcript : "",
    transcriptAvailable,
    transcriptExpiresAt: call.transcriptExpiresAt || null,
    recordingAvailable,
    recordingPath: recordingAvailable ? `/api/customer/dashboard/calls/${call.id}/recording` : "",
    recordingExpiresAt: call.recordingExpiresAt || null,
    recordingConsent: {
      type: call.recordingConsentType || "",
      grantedAt: call.recordingConsentGrantedAt || null,
    },
    lead: call.lead ? {
      id: call.lead.id,
      name: call.lead.name || "",
      callbackNumber: call.lead.callbackNumber || "",
      summary: call.lead.summary || "",
      intent: call.lead.intent || "",
      urgency: call.lead.urgency || "",
      status: call.lead.status || "",
      estimatedValueCents: call.lead.estimatedValueCents ?? null,
      actualRevenueCents: call.lead.actualRevenueCents ?? null,
      outcomeReason: call.lead.outcomeReason || "",
      outcomeRecordedAt: call.lead.outcomeRecordedAt || null,
    } : null,
    details: sanitizeCustomerStructuredData(call.structuredData || call.structuredOutputs || {}),
    successEvaluation: call.successEvaluation || "",
    quality: {
      score: call.qualityScore ?? null,
      metrics: sanitizeCustomerStructuredData(call.artifactMetrics || {}),
    },
    notifications,
    timeline: buildCustomerCallTimeline(call, notifications),
    caller: {
      phone: call.caller?.phone || "",
      name: call.caller?.name || "",
    },
  };
}

function sanitizeCustomerLead(lead) {
  return {
    id: lead.id,
    callId: lead.callId || null,
    name: lead.name || "",
    callbackNumber: lead.callbackNumber || "",
    summary: lead.summary || "",
    intent: lead.intent || "",
    urgency: lead.urgency || "",
    status: lead.status || "NEW",
    estimatedValueCents: lead.estimatedValueCents ?? null,
    actualRevenueCents: lead.actualRevenueCents ?? null,
    outcomeReason: lead.outcomeReason || "",
    outcomeRecordedAt: lead.outcomeRecordedAt || null,
    createdAt: lead.createdAt,
    handoff: lead.handoff ? {
      status: lead.handoff.status,
      ownerAcceptedAt: lead.handoff.ownerAcceptedAt,
      acknowledgedAt: lead.handoff.acknowledgedAt,
      acknowledgementDueAt: lead.handoff.acknowledgementDueAt,
      acknowledgementSlaMinutes: lead.handoff.acknowledgementSlaMinutes,
      escalatedAt: lead.handoff.escalatedAt,
    } : null,
  };
}

function sanitizeCustomerAppointment(appointment) {
  return {
    id: appointment.id,
    customerName: appointment.customerName,
    customerEmail: appointment.customerEmail || "",
    customerPhone: appointment.customerPhone,
    service: appointment.service,
    address: appointment.address || "",
    requestedStart: appointment.requestedStart,
    confirmedStart: appointment.confirmedStart,
    durationMinutes: appointment.durationMinutes,
    timezone: appointment.timezone,
    status: appointment.status,
    ownerNote: appointment.ownerNote || "",
    customerNote: appointment.customerNote || "",
    proposalSentAt: appointment.proposalSentAt,
    customerRespondedAt: appointment.customerRespondedAt,
    inviteSentAt: appointment.inviteSentAt,
    reminder24hSentAt: appointment.reminder24hSentAt,
    reminder2hSentAt: appointment.reminder2hSentAt,
    cancelledAt: appointment.cancelledAt,
    rescheduledAt: appointment.rescheduledAt,
    staffMember: appointment.staffMember ? {
      id: appointment.staffMember.id,
      name: appointment.staffMember.name,
      color: appointment.staffMember.color,
    } : null,
    calendarPath: appointment.status === "CONFIRMED"
      ? `/api/appointments/${encodeURIComponent(appointment.id)}/calendar?token=${encodeURIComponent(appointment.calendarToken)}`
      : "",
    createdAt: appointment.createdAt,
  };
}

async function getCustomerDashboard({ email, phone }) {
  const signup = findCustomerDashboardSignup({ email, phone });

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
          staffMembers: { where: { active: true }, orderBy: { name: "asc" } },
          calendarConnections: {
            where: { status: { not: "REVOKED" } },
            include: { staffMember: true },
            orderBy: { connectedAt: "desc" },
          },
          vapiMappings: true,
          leads: {
            include: { handoff: true },
            orderBy: { createdAt: "desc" },
            take: 200,
          },
          fieldServiceConnections: true,
          fieldServiceSyncs: {
            include: { lead: { select: { id: true, name: true } } },
            orderBy: { createdAt: "desc" },
            take: 25,
          },
          faqs: { orderBy: { updatedAt: "desc" }, take: 6 },
          calls: {
            include: {
              caller: true,
              lead: true,
              leadHandoffs: { include: { attempts: { orderBy: { createdAt: "asc" } } } },
            },
            orderBy: { startedAt: "desc" },
            take: 50,
          },
          appointmentRequests: {
            include: { staffMember: true },
            orderBy: [{ status: "asc" }, { requestedStart: "asc" }],
            take: 100,
          },
          supportReports: {
            orderBy: { createdAt: "desc" },
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
  const leads = business?.leads || [];
  const revenueRescue = summarizeRevenueRescue({
    leads,
    handoffs: leads.map((lead) => lead.handoff).filter(Boolean),
    averageJobValueCents: business?.settings?.averageJobValueCents || 0,
  });
  const jobberConnection = business?.fieldServiceConnections?.find((connection) => connection.provider === "JOBBER");
  const ownerTextPhone = business?.settings?.ownerPhone || signup.ownerPhone || "";
  const ownerTextSuppression = ownerTextPhone ? await getSmsSuppression(ownerTextPhone) : null;
  const ownerTextsPaused = Boolean(ownerTextSuppression?.suppressed);
  const billingChecklist = getBillingReadinessForSignup(signup);
  const setupChecklist = [
    ...billingChecklist,
    { key: "owner-phone", label: "Owner phone added", done: Boolean(business?.settings?.ownerPhone || signup.ownerPhone) },
    { key: "ai-number", label: "AI number mapped", done: Boolean(signup.twilioPhoneNumber || business?.vapiMappings?.length) },
    { key: "faq", label: "Starter FAQs added", done: Boolean(business?.faqs?.length) },
  ];
  const trialUsage = await getTrialUsageSnapshot(signup, business?.id || null);

  return {
    businessId: business?.id || null,
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
    messaging: {
      status: ownerTextPhone ? (ownerTextsPaused ? "PAUSED" : "ACTIVE") : "NOT_CONFIGURED",
      serviceTextsActive: Boolean(ownerTextPhone && !ownerTextsPaused),
      pausedAt: ownerTextsPaused ? ownerTextSuppression?.suppressedAt || ownerTextSuppression?.updatedAt || null : null,
      resumedAt: !ownerTextsPaused ? ownerTextSuppression?.resumedAt || null : null,
      guidance: !ownerTextPhone
        ? "Add an owner phone number to receive service text updates."
        : ownerTextsPaused
          ? "Reply START in the business text thread to resume service text updates."
          : "Service text updates are active for the owner phone.",
    },
    trialUsage,
    stats: {
      totalCalls: calls.length,
      completedCalls,
      missedCalls,
      followUps,
      bookedCalls,
      averageDurationSec: calls.length ? Math.round(calls.reduce((sum, call) => sum + Number(call.durationSec || 0), 0) / calls.length) : 0,
      totalMinutes: Number((calls.reduce((sum, call) => sum + Number(call.durationSec || 0), 0) / 60).toFixed(1)),
      lastCallAt: calls[0]?.startedAt || null,
    },
    revenueRescue: {
      ...revenueRescue,
      averageJobValueCents: business?.settings?.averageJobValueCents || 0,
      leads: leads.map(sanitizeCustomerLead),
    },
    integrations: {
      jobber: {
        ...sanitizeJobberConnection(jobberConnection, isJobberConfigured()),
        recentSyncs: (business?.fieldServiceSyncs || []).filter((sync) => sync.provider === "JOBBER").map((sync) => ({
          id: sync.id,
          leadId: sync.leadId,
          leadName: sync.lead?.name || "",
          entityType: sync.entityType,
          status: sync.status,
          externalId: sync.externalId || "",
          attempts: sync.attempts,
          lastError: sync.lastError || "",
          syncedAt: sync.syncedAt,
          createdAt: sync.createdAt,
        })),
      },
    },
    playbook: {
      tradeType: business?.settings?.tradeType || "ELECTRICAL",
      version: business?.settings?.playbookVersion || "electrician-v1",
    },
    setup: {
      checklist: setupChecklist,
      readinessPercent: Math.round((setupChecklist.filter((item) => item.done).length / setupChecklist.length) * 100),
    },
    recentCalls: calls.slice(0, 8).map(sanitizeCustomerCall),
    calls: calls.map(sanitizeCustomerCall),
    appointments: (business?.appointmentRequests || []).map(sanitizeCustomerAppointment),
    scheduling: getSchedulingSettings(business?.settings || {}),
    calendarProviders: {
      googleConfigured: isProviderConfigured("GOOGLE"),
      microsoftConfigured: isProviderConfigured("MICROSOFT"),
    },
    calendarConnections: (business?.calendarConnections || []).map(sanitizeCalendarConnection),
    staffMembers: (business?.staffMembers || []).map((staff) => ({
      id: staff.id,
      name: staff.name,
      email: staff.email || "",
      phone: staff.phone || "",
      color: staff.color,
    })),
    supportReports: (business?.supportReports || []).map(sanitizeCustomerSupportReport),
    faqs: (business?.faqs || []).map((faq) => ({
      id: faq.id,
      question: faq.question,
      answer: faq.answer,
      tags: faq.tags,
      updatedAt: faq.updatedAt,
    })),
  };
}

async function getCustomerDashboardByLookupHash(lookupHash) {
  const match = findCustomerDashboardSignupByLookupHash(lookupHash);
  if (!match) return null;
  return getCustomerDashboard({ email: match.signup.ownerEmail, phone: match.matchingPhone });
}

function sanitizeSupportDescription(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 1200);
}

function redactSupportTextForAi(value) {
  return sanitizeSupportDescription(value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email removed]")
    .replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, "[phone removed]")
    .replace(/\b\d{6,}\b/g, "[number removed]");
}

function buildCustomerSupportDiagnostics(dashboard, callId, includeSensitiveCallData = false) {
  const normalizedCallId = Number(callId);
  const call = Number.isInteger(normalizedCallId)
    ? (dashboard?.calls || []).find((item) => Number(item.id) === normalizedCallId)
    : null;
  const diagnostics = {
    capturedAt: new Date().toISOString(),
    page: "customer-dashboard",
    businessId: dashboard?.businessId || null,
    setupReadinessPercent: Number(dashboard?.setup?.readinessPercent || 0),
    aiNumberAssigned: Boolean(dashboard?.assistant?.aiNumber),
    totalCallsVisible: Number(dashboard?.stats?.totalCalls || 0),
    lastCallAt: dashboard?.stats?.lastCallAt || null,
    call: call ? {
      id: call.id,
      startedAt: call.startedAt || null,
      durationSec: Number(call.durationSec || 0),
      status: call.status || "",
      outcome: call.outcome || "",
      endedReason: call.endedReason || "",
      transcriptAvailable: Boolean(call.transcriptAvailable),
      recordingAvailable: Boolean(call.recordingAvailable),
      notifications: (call.notifications || []).map((item) => ({
        recipient: item.recipient || "",
        status: item.status || "",
        problem: item.problem || "",
      })),
    } : null,
  };

  if (call && includeSensitiveCallData) {
    diagnostics.callDetails = {
      caller: call.caller || null,
      lead: call.lead || null,
      summary: call.aiSummary || "",
      transcript: call.transcriptAvailable ? call.transcript || "" : "",
      details: call.details || null,
    };
  }
  return diagnostics;
}

function getRuleBasedSupportAnalysis({ description, diagnostics }) {
  const issue = sanitizeSupportDescription(description).toLowerCase();
  const call = diagnostics?.call || null;
  const notificationProblems = (call?.notifications || []).filter((item) => item.problem || item.status === "failed");
  const textIssue = /\b(text|sms|message|notification)\b/.test(issue);
  const callMissing = /\b(call|calls)\b/.test(issue) && /\b(missing|not showing|cannot see|can't see|didn't show|doesn't show|not updating)\b/.test(issue);
  const transcriptIssue = /\b(transcript|summary|log)\b/.test(issue);
  const recordingIssue = /\b(recording|audio|playback)\b/.test(issue);
  const outageLanguage = /\b(nothing works|all calls|every call|down|offline|cannot receive calls|can't receive calls)\b/.test(issue);

  if (textIssue && notificationProblems.length) {
    return {
      summary: "A linked text delivery attempt shows a failure.",
      likelyCause: "The message provider rejected or could not deliver at least one notification for this call.",
      severity: "HIGH",
      suggestions: [
        "Confirm the owner or customer cellphone number shown for this call is correct.",
        "Refresh the dashboard once to see whether the provider posted a newer delivery result.",
        "If it still shows failed, send the report so support can inspect the provider error without changing your assistant.",
      ],
    };
  }
  if (textIssue) {
    return {
      summary: "No confirmed text-delivery failure is attached to the selected call yet.",
      likelyCause: "The text may still be processing, or the selected call is not the one connected to the missing message.",
      severity: "MEDIUM",
      suggestions: [
        "Open the affected call and check Text delivery for owner and customer status.",
        "Refresh once after a minute because delivery updates can arrive after the call ends.",
        "If the text is still missing, send the report with the affected call selected.",
      ],
    };
  }
  if (callMissing) {
    return {
      summary: "The dashboard may be waiting for the completed call to sync.",
      likelyCause: "Calls normally appear after the provider posts its end-of-call data; an unfinished call or delayed provider event can postpone that update.",
      severity: outageLanguage ? "HIGH" : "MEDIUM",
      suggestions: [
        "Wait one minute after hanging up, then select Refresh now.",
        "Confirm the call was made to the AI number displayed at the top of this dashboard.",
        "If the call still does not appear, send the report with the call time in your description.",
      ],
    };
  }
  if (transcriptIssue) {
    return {
      summary: "The transcript or call summary is unavailable or incomplete.",
      likelyCause: call?.transcriptAvailable === false
        ? "The transcript has not arrived, was not produced, or has passed its retention period."
        : "The call data is present, but the transcript or summary may still be processing.",
      severity: "MEDIUM",
      suggestions: [
        "Refresh the dashboard once after the call has fully ended.",
        "Check whether the selected call says the transcript is unavailable or expired.",
        "Send the report if a recent completed call still has no transcript.",
      ],
    };
  }
  if (recordingIssue) {
    return {
      summary: "The selected call recording is not available for playback.",
      likelyCause: call?.recordingAvailable === false
        ? "A recording can be hidden when consent was not captured, the recording has not arrived, or its retention period ended."
        : "The browser may be unable to load the available audio file.",
      severity: "LOW",
      suggestions: [
        "Check whether the call card says a consent-backed recording is available.",
        "Refresh once, then try the download link if playback does not start.",
        "Send the report if a recent consented recording still cannot be opened.",
      ],
    };
  }
  if (!diagnostics?.aiNumberAssigned) {
    return {
      summary: "Your AI phone number is not shown as assigned yet.",
      likelyCause: "The business setup or phone-number mapping is incomplete.",
      severity: "HIGH",
      suggestions: [
        "Check the Setup checklist for the unfinished AI number step.",
        "Do not forward customer calls until the AI number appears at the top of the dashboard.",
        "Send the report so support can finish or repair the number mapping.",
      ],
    };
  }
  return {
    summary: "The dashboard did not find a confirmed provider failure from the available status information.",
    likelyCause: "More context or the affected call is needed to isolate the problem safely.",
    severity: outageLanguage ? "HIGH" : "MEDIUM",
    suggestions: [
      "Select the affected call if this happened during or after a call.",
      "Refresh the dashboard once and try the same action again.",
      "If the issue continues, send the report so support receives the diagnostic snapshot.",
    ],
  };
}

function normalizeSupportAnalysis(value, fallback) {
  const severity = ["LOW", "MEDIUM", "HIGH"].includes(String(value?.severity || "").toUpperCase())
    ? String(value.severity).toUpperCase()
    : fallback.severity;
  const suggestions = Array.isArray(value?.suggestions)
    ? value.suggestions.map((item) => sanitizeSupportDescription(item)).filter(Boolean).slice(0, 3)
    : [];
  return {
    summary: sanitizeSupportDescription(value?.summary) || fallback.summary,
    likelyCause: sanitizeSupportDescription(value?.likelyCause) || fallback.likelyCause,
    severity,
    suggestions: suggestions.length >= 2 ? suggestions : fallback.suggestions,
  };
}

async function getSupportSuggestionRateLimitDecision(lookupHash, now = Date.now()) {
  const state = await consumeNamedRateLimit(
    "customer-support-suggestion",
    lookupHash,
    CUSTOMER_SUPPORT_SUGGESTION_MAX_REQUESTS,
    CUSTOMER_SUPPORT_SUGGESTION_WINDOW_MS,
    now
  );
  return {
    blocked: !state.allowed,
    retryAfterMs: state.retryAfterMs,
  };
}

function normalizeSubmittedSupportAnalysis(value, fallback) {
  return {
    ...normalizeSupportAnalysis(value, fallback),
    severity: fallback.severity,
  };
}

async function getSupportReportRateLimitDecision(lookupHash, now = Date.now()) {
  const state = await consumeNamedRateLimit(
    "customer-support-report",
    lookupHash,
    CUSTOMER_SUPPORT_REPORT_MAX_REQUESTS,
    CUSTOMER_SUPPORT_REPORT_WINDOW_MS,
    now
  );
  return {
    blocked: !state.allowed,
    retryAfterMs: state.retryAfterMs,
  };
}

function extractOpenAiResponseText(data) {
  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text.trim();
  for (const item of data?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text.trim();
    }
  }
  return "";
}

async function getCustomerSupportAnalysis({ description, diagnostics }) {
  const fallback = getRuleBasedSupportAnalysis({ description, diagnostics });
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return { ...fallback, source: "rules" };

  const safeContext = {
    issue: redactSupportTextForAi(description),
    diagnostics: {
      setupReadinessPercent: diagnostics?.setupReadinessPercent,
      aiNumberAssigned: diagnostics?.aiNumberAssigned,
      totalCallsVisible: diagnostics?.totalCallsVisible,
      call: diagnostics?.call || null,
    },
    ruleBasedFinding: fallback,
  };
  try {
    const response = await withTimeout(fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_SUPPORT_MODEL || process.env.OPENAI_ASSISTANT_MODEL || "gpt-4o-mini",
        store: false,
        max_output_tokens: 450,
        input: [
          {
            role: "system",
            content: "You explain customer-dashboard troubleshooting for My AI PA. Use only the supplied facts. Never invent provider errors, promise a repair, change settings, or advise exposing secrets. Give short, plain-language steps a non-technical business owner can follow. Preserve the rule-based finding unless the supplied diagnostics clearly support a more precise explanation.",
          },
          { role: "user", content: JSON.stringify(safeContext) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "customer_support_suggestion",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                summary: { type: "string" },
                likelyCause: { type: "string" },
                severity: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
                suggestions: { type: "array", minItems: 2, maxItems: 3, items: { type: "string" } },
              },
              required: ["summary", "likelyCause", "severity", "suggestions"],
            },
          },
        },
      }),
    }), 12000, "AI support suggestions timed out.");
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      logOpenAiProviderError("customer-support", response, data);
      return { ...fallback, source: "rules" };
    }
    const parsed = JSON.parse(extractOpenAiResponseText(data));
    return { ...normalizeSupportAnalysis(parsed, fallback), source: "ai" };
  } catch (error) {
    console.warn("[openai:customer-support] using rule-based fallback", { message: error?.message || String(error) });
    return { ...fallback, source: "rules" };
  }
}

function getSupportTicketNumber(id) {
  return `MYAIPA-${String(id || "").replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase()}`;
}

function sanitizeCustomerSupportReport(report) {
  return {
    id: report.id,
    ticketNumber: getSupportTicketNumber(report.id),
    callId: report.callId || null,
    description: report.description,
    status: report.status,
    severity: report.severity,
    customerMessage: report.customerMessage || "",
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    resolvedAt: report.resolvedAt || null,
  };
}

function sanitizeAdminSupportReport(report) {
  return {
    ...report,
    ticketNumber: getSupportTicketNumber(report.id),
    githubConfigured: Boolean(GITHUB_SUPPORT_TOKEN && /^[^/\s]+\/[^/\s]+$/.test(GITHUB_SUPPORT_REPO)),
    telegramConfigured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID),
  };
}

function getSafeRepairDiagnostics(report) {
  const diagnostics = report?.diagnostics && typeof report.diagnostics === "object" ? report.diagnostics : {};
  return {
    capturedAt: diagnostics.capturedAt || null,
    page: diagnostics.page || "customer-dashboard",
    businessId: diagnostics.businessId || report?.businessId || null,
    setupReadinessPercent: diagnostics.setupReadinessPercent ?? null,
    aiNumberAssigned: Boolean(diagnostics.aiNumberAssigned),
    totalCallsVisible: diagnostics.totalCallsVisible ?? null,
    lastCallAt: diagnostics.lastCallAt || null,
    call: diagnostics.call || null,
  };
}

function buildSupportRepairBrief(report) {
  const ticketNumber = getSupportTicketNumber(report?.id);
  const suggestions = Array.isArray(report?.suggestions) ? report.suggestions : [];
  const diagnostics = getSafeRepairDiagnostics(report);
  const redact = (value) => redactSupportTextForAi(value);
  return [
    `# Codex repair task: ${ticketNumber}`,
    "",
    `Repository: ${GITHUB_SUPPORT_REPO}`,
    `Business: ${report?.business?.name || `Business ${report?.businessId || "unknown"}`}`,
    `Severity: ${report?.severity || "MEDIUM"}`,
    `Affected call: ${report?.callId || "Not linked"}`,
    "",
    "## Objective",
    redact(report?.description),
    "",
    "## Current diagnosis",
    `Summary: ${redact(report?.aiSummary) || "No AI summary"}`,
    `Likely cause: ${redact(report?.likelyCause) || "Not established"}`,
    "",
    "## Suggested checks",
    ...(suggestions.length ? suggestions.map((item) => `- ${redact(item)}`) : ["- Reproduce and isolate the failure before changing code."]),
    "",
    "## Safe diagnostic snapshot",
    "```json",
    JSON.stringify(diagnostics, null, 2),
    "```",
    "",
    "## Required workflow",
    "1. Reproduce or verify the reported behavior from repository evidence and tests.",
    "2. State the root cause before making changes.",
    "3. Implement the smallest business-scoped fix and preserve unrelated work.",
    "4. Add or update regression tests.",
    "5. Run the relevant build and test commands.",
    "6. Do not change live Vapi, Twilio, Make, DNS, billing, or customer data without separate explicit approval.",
    "7. Do not commit, push, merge, or deploy unless separately requested.",
    "",
    "## Completion evidence",
    "Report changed files, tests run, results, remaining risks, and any live verification still required.",
  ].join("\n");
}

function buildGithubSupportIssue(report) {
  const ticketNumber = getSupportTicketNumber(report?.id);
  const brief = buildSupportRepairBrief(report);
  return {
    title: `[${ticketNumber}] ${redactSupportTextForAi(report?.aiSummary || report?.description).slice(0, 120)}`,
    body: `${brief}\n\n---\nCreated from the My AI PA admin support inbox. Sensitive transcript and caller details are intentionally excluded.`,
  };
}

async function createGithubSupportIssue(report, { fetchImpl = fetch, token = GITHUB_SUPPORT_TOKEN, repo = GITHUB_SUPPORT_REPO } = {}) {
  const normalizedRepo = String(repo || "").trim();
  if (!token || !/^[^/\s]+\/[^/\s]+$/.test(normalizedRepo)) {
    const err = new Error("GitHub issue creation is not configured. Add GITHUB_SUPPORT_TOKEN and GITHUB_SUPPORT_REPO on Render.");
    err.statusCode = 503;
    throw err;
  }
  const draft = buildGithubSupportIssue(report);
  const response = await withTimeout(fetchImpl(`https://api.github.com/repos/${normalizedRepo}/issues`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "MyAIPA-Support-Inbox",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({
      ...draft,
      ...(GITHUB_SUPPORT_LABELS.length ? { labels: GITHUB_SUPPORT_LABELS } : {}),
    }),
  }), 12000, "GitHub issue creation timed out.");
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.html_url) {
    const err = new Error(data?.message ? `GitHub rejected the issue: ${data.message}` : `GitHub issue creation failed (${response.status}).`);
    err.statusCode = 502;
    throw err;
  }
  return { number: Number(data.number), url: String(data.html_url), title: draft.title };
}

async function sendSupportTelegramAlert(report, { fetchImpl = fetch } = {}) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || report?.severity !== "HIGH") return { sent: false, skipped: true };
  const ticketNumber = getSupportTicketNumber(report.id);
  const safeDescription = redactSupportTextForAi(report.description).slice(0, 500);
  const adminUrl = `${FRONTEND_APP_URL}/#/admin?tab=support&ticket=${encodeURIComponent(ticketNumber)}`;
  const response = await withTimeout(fetchImpl(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      disable_web_page_preview: true,
      text: [
        `HIGH priority My AI PA report: ${ticketNumber}`,
        `Business: ${report.business?.name || `Business ${report.businessId}`}`,
        `Problem: ${safeDescription}`,
        `Review: ${adminUrl}`,
      ].join("\n"),
    }),
  }), 10000, "Telegram support alert timed out.");
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data?.ok === false) throw new Error(data?.description || `Telegram support alert failed (${response.status}).`);
  return { sent: true, skipped: false };
}

async function getAppointmentOwnerContact(businessId) {
  const business = await prisma.business.findUnique({
    where: { id: Number(businessId) },
    include: { settings: true },
  });
  if (!business) return { ownerEmail: "", ownerPhone: "" };
  const businessPhone = normalizePhoneForMatch(business.phone);
  const signup = listSignupDashboardRecords().find((record) => {
    const sameName = String(record.businessName || "").trim().toLowerCase() === String(business.name || "").trim().toLowerCase();
    const samePhone = businessPhone && normalizePhoneForMatch(record.businessPhone) === businessPhone;
    return sameName || samePhone;
  });
  return {
    ownerEmail: String(signup?.ownerEmail || "").trim(),
    ownerPhone: String(signup?.ownerPhone || business.settings?.ownerPhone || "").trim(),
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

function renderCustomerCalendarButtons(appointment) {
  if (!appointment?.id || appointment.status !== "CONFIRMED") return "";
  const links = buildCustomerCalendarLinks(appointment, "");
  return `<section class="calendar-actions" aria-label="Add this appointment to a calendar"><strong>Add to your calendar</strong><div><a href="${escapeHtml(links.google)}" target="_blank" rel="noopener">Google Calendar</a><a href="${escapeHtml(links.outlook)}" target="_blank" rel="noopener">Outlook or Hotmail</a><a href="${escapeHtml(links.apple)}">Apple / calendar file</a></div><small>No account connection is required.</small></section>`;
}

function sendAppointmentProposalPage(res, { appointment, state = "review", statusCode = 200 }) {
  const businessName = appointment?.business?.name || "the business";
  const when = appointment?.confirmedStart
    ? formatAppointmentDate(appointment.confirmedStart, appointment.timezone)
    : "the proposed time";
  const title = state === "accepted"
    ? "Your appointment is confirmed"
    : state === "change_requested"
      ? "Your reply was sent"
      : "Does this new time work?";
  const intro = state === "accepted"
    ? `${businessName} has been notified. Your calendar invitation is on its way.`
    : state === "change_requested"
      ? `${businessName} will review your request and send you another time. Nothing is booked yet.`
      : `${businessName} proposed a different time. The appointment will only be booked after you accept it.`;
  const token = escapeHtml(appointment?.calendarToken || "");
  const appointmentId = encodeURIComponent(appointment?.id || "");
  const controls = state === "review" ? `
    <form method="post" action="/api/appointments/${appointmentId}/customer-response">
      <input type="hidden" name="token" value="${token}">
      <button class="accept" type="submit" name="action" value="ACCEPT">Accept this time</button>
    </form>
    <details>
      <summary>I need another time</summary>
      <form class="change-form" method="post" action="/api/appointments/${appointmentId}/customer-response">
        <input type="hidden" name="token" value="${token}">
        <input type="hidden" name="action" value="REQUEST_CHANGE">
        <label for="customer-note">What time would work better? <span>(optional)</span></label>
        <textarea id="customer-note" name="customerNote" maxlength="500" placeholder="For example: Any weekday after 3 PM"></textarea>
        <button class="change" type="submit">Request another time</button>
      </form>
    </details>` : "";
  const icon = state === "accepted" ? "✓" : state === "change_requested" ? "↗" : "?";
  const calendarButtons = state === "accepted" ? renderCustomerCalendarButtons(appointment) : "";
  res.status(statusCode);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} | My AI PA</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f2f7fc;color:#07142a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(100%,590px);background:#fff;border:1px solid #cfe0f2;border-radius:22px;padding:clamp(24px,6vw,46px);box-shadow:0 24px 70px rgba(18,72,126,.14)}.brand{color:#126dff;font-size:14px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}.icon{display:grid;place-items:center;width:52px;height:52px;margin:28px 0 18px;border-radius:50%;background:#eaf3ff;color:#126dff;font-size:28px;font-weight:900}h1{margin:0;font-size:clamp(30px,7vw,45px);line-height:1.02;letter-spacing:-.045em}p{color:#526b85;line-height:1.6}.details{display:grid;gap:12px;margin:26px 0;padding:20px;border-radius:15px;background:#f7faff;border:1px solid #dbe8f5}.details div{display:grid;gap:4px}.details span,label{color:#62788f;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.details strong{font-size:17px}form{margin:0}button{width:100%;min-height:52px;border-radius:12px;padding:12px 18px;font:inherit;font-weight:900;cursor:pointer}.accept{border:1px solid #126dff;background:#126dff;color:#fff}.accept:hover{background:#075dda}details{margin-top:14px;border-top:1px solid #e2ebf4;padding-top:14px}summary{cursor:pointer;color:#35516f;font-weight:800;text-align:center;list-style:none}.change-form{display:grid;gap:11px;margin-top:18px}.change-form label span{font-weight:700;text-transform:none;letter-spacing:0}.change-form textarea{min-height:96px;resize:vertical;border:1px solid #bdcee1;border-radius:10px;padding:12px;font:inherit}.change{border:1px solid #9bb2ca;background:#fff;color:#193652}.fine{margin:18px 0 0;font-size:12px;text-align:center}.confirmed .icon{background:#e6f8ef;color:#067647}.calendar-actions{display:grid;gap:12px;margin:20px 0;padding:18px;border:1px solid #cfe0f2;border-radius:15px;background:#f7faff}.calendar-actions>div{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.calendar-actions a{display:grid;place-items:center;min-height:46px;padding:9px;border:1px solid #126dff;border-radius:10px;color:#075dda;font-size:13px;font-weight:900;text-align:center;text-decoration:none}.calendar-actions small{color:#62788f}@media(max-width:560px){.calendar-actions>div{grid-template-columns:1fr}}
</style></head><body><main class="page"><section class="card ${state === "accepted" ? "confirmed" : ""}"><div class="brand">My AI PA appointment reply</div><div class="icon" aria-hidden="true">${icon}</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(intro)}</p><div class="details"><div><span>Business</span><strong>${escapeHtml(businessName)}</strong></div><div><span>${state === "review" ? "Proposed time" : state === "accepted" ? "Confirmed time" : "Time offered"}</span><strong>${escapeHtml(when)}</strong></div>${appointment?.service ? `<div><span>Service</span><strong>${escapeHtml(appointment.service)}</strong></div>` : ""}${appointment?.address ? `<div><span>Location</span><strong>${escapeHtml(appointment.address)}</strong></div>` : ""}</div>${calendarButtons}${controls}<p class="fine">This private link is for this appointment only.</p></section></main></body></html>`);
}

function sendAppointmentManagePage(res, { appointment, state = "manage", statusCode = 200 }) {
  const businessName = appointment?.business?.name || "the business";
  const when = appointment?.confirmedStart
    ? formatAppointmentDate(appointment.confirmedStart, appointment.timezone)
    : "the proposed time";
  const title = state === "cancelled" ? "Appointment cancelled" : state === "rescheduled" ? "New time requested" : "Manage your appointment";
  const intro = state === "cancelled"
    ? `${businessName} has been notified that you cancelled.`
    : state === "rescheduled"
      ? `Your new requested time was sent to ${businessName}. It is not booked until the business confirms it.`
      : "Need to make a change? You can request another time or cancel here.";
  const token = escapeHtml(appointment?.calendarToken || "");
  const appointmentId = encodeURIComponent(appointment?.id || "");
  const controls = state === "manage" ? `
    <details open><summary>Request another time</summary>
      <form method="post" action="/api/appointments/${appointmentId}/manage">
        <input type="hidden" name="token" value="${token}"><input type="hidden" name="action" value="RESCHEDULE">
        <label for="requested-start">New preferred date and time</label><input id="requested-start" name="requestedStart" type="datetime-local" required>
        <label for="customer-note">Note <span>(optional)</span></label><textarea id="customer-note" name="customerNote" maxlength="500" placeholder="For example: Any time after 3 PM"></textarea>
        <button class="primary" type="submit">Send new time request</button>
      </form>
    </details>
    <details><summary>Cancel appointment</summary>
      <form method="post" action="/api/appointments/${appointmentId}/manage">
        <input type="hidden" name="token" value="${token}"><input type="hidden" name="action" value="CANCEL">
        <p class="warning">This tells the business you will not attend this appointment.</p>
        <button class="danger" type="submit">Cancel appointment</button>
      </form>
    </details>` : "";
  const calendarButtons = state === "manage" ? renderCustomerCalendarButtons(appointment) : "";
  res.status(statusCode);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store, max-age=0");
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} | My AI PA</title><style>
*{box-sizing:border-box}body{margin:0;background:#f2f7fc;color:#07142a;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.page{min-height:100vh;display:grid;place-items:center;padding:24px}.card{width:min(100%,620px);background:#fff;border:1px solid #cfe0f2;border-radius:22px;padding:clamp(24px,6vw,46px);box-shadow:0 24px 70px rgba(18,72,126,.14)}.brand{color:#126dff;font-size:14px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}h1{margin:26px 0 8px;font-size:clamp(30px,7vw,44px);line-height:1.04;letter-spacing:-.04em}p{color:#526b85;line-height:1.55}.details{display:grid;gap:12px;margin:24px 0;padding:20px;border-radius:15px;background:#f7faff;border:1px solid #dbe8f5}.details div,form{display:grid;gap:9px}.details span,label{color:#62788f;font-size:12px;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.details strong{font-size:17px}details{margin-top:12px;border:1px solid #dbe8f5;border-radius:13px;padding:15px}summary{cursor:pointer;font-weight:900;color:#193652}form{margin-top:16px}input,textarea{width:100%;border:1px solid #bdcee1;border-radius:10px;padding:12px;font:inherit}textarea{min-height:88px;resize:vertical}button{min-height:50px;border-radius:10px;padding:12px 16px;font:inherit;font-weight:900;cursor:pointer}.primary{border:1px solid #126dff;background:#126dff;color:#fff}.danger{border:1px solid #d92d20;background:#fff;color:#b42318}.warning{font-size:13px}.fine{margin-top:18px;font-size:12px;text-align:center}.calendar-actions{display:grid;gap:12px;margin:20px 0;padding:18px;border:1px solid #cfe0f2;border-radius:15px;background:#f7faff}.calendar-actions>div{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.calendar-actions a{display:grid;place-items:center;min-height:46px;padding:9px;border:1px solid #126dff;border-radius:10px;color:#075dda;font-size:13px;font-weight:900;text-align:center;text-decoration:none}.calendar-actions small{color:#62788f}@media(max-width:560px){.calendar-actions>div{grid-template-columns:1fr}}
</style></head><body><main class="page"><section class="card"><div class="brand">My AI PA appointment</div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(intro)}</p><div class="details"><div><span>Business</span><strong>${escapeHtml(businessName)}</strong></div><div><span>${state === "manage" ? "Current time" : "Previous time"}</span><strong>${escapeHtml(when)}</strong></div>${appointment?.service ? `<div><span>Service</span><strong>${escapeHtml(appointment.service)}</strong></div>` : ""}${appointment?.staffMember?.name ? `<div><span>Assigned to</span><strong>${escapeHtml(appointment.staffMember.name)}</strong></div>` : ""}</div>${calendarButtons}${controls}<p class="fine">This private link is for this appointment only.</p></section></main></body></html>`);
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
  return String(req.ip || req.socket?.remoteAddress || "unknown").trim() || "unknown";
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

function consumeNamedRateLimit(namespace, rawKey, maxRequests, windowMs, now = Date.now()) {
  const key = `security-rate:${String(namespace || "general").slice(0, 80)}:${hashKey(rawKey)}`;
  return consumeRateLimit({ key, maxRequests, windowMs, now });
}

function setRetryAfterHeader(res, retryAfterMs) {
  if (!retryAfterMs) return;
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
}

async function getCustomerDashboardRateLimitDecision(req, { email, phone }) {
  const ip = getClientIp(req);
  const limits = [];
  const ipLimit = await consumeNamedRateLimit(
    "customer-dashboard-ip",
    ip,
    CUSTOMER_DASHBOARD_IP_MAX_REQUESTS,
    CUSTOMER_DASHBOARD_IP_WINDOW_MS
  );
  if (!ipLimit.allowed) limits.push(ipLimit);

  const lookupKeySource = [email, normalizePhoneForMatch(phone)].map(normalizeForKey).join("|");
  if (lookupKeySource.trim() !== "|") {
    const lookupLimit = await consumeNamedRateLimit(
      "customer-dashboard-lookup",
      lookupKeySource,
      CUSTOMER_DASHBOARD_LOOKUP_MAX_REQUESTS,
      CUSTOMER_DASHBOARD_LOOKUP_WINDOW_MS
    );
    if (!lookupLimit.allowed) limits.push(lookupLimit);
  }

  return {
    blocked: limits.length > 0,
    retryAfterMs: Math.max(...limits.map((limit) => limit.retryAfterMs || 0), 0),
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

  const ipLimit = await consumeNamedRateLimit(
    "signup-ip",
    ip,
    SIGNUP_IP_MAX_REQUESTS,
    SIGNUP_IP_WINDOW_MS
  );
  if (!ipLimit.allowed) {
    reasons.push("ip_rate_limit");
  }

  const identityKey = hashKey([fields.ownerEmail, fields.ownerPhone, fields.businessName].map(normalizeForKey).join("|"));
  const identityLimit = await consumeNamedRateLimit(
    "signup-identity",
    identityKey,
    SIGNUP_IDENTITY_MAX_REQUESTS,
    SIGNUP_IDENTITY_WINDOW_MS
  );
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

function getSignupBillingIdentity(payload, extra = {}) {
  const business = payload?.business || {};
  const owner = payload?.owner || {};
  return {
    businessName: String(extra.businessName || business.name || "").trim(),
    ownerName: String(extra.ownerName || owner.name || "").trim(),
    ownerEmail: String(extra.ownerEmail || owner.email || "").trim(),
    ownerPhone: String(extra.ownerPhone || owner.phone || "").trim(),
    businessPhone: String(extra.businessPhone || business.phone || "").trim(),
    businessAddress: String(extra.businessAddress || business.address || "").trim(),
  };
}

async function createNoCardStripeTrialForSignup(payload, extra = {}) {
  if (!stripe || !STRIPE_PRICE_ID || STRIPE_TRIAL_DAYS <= 0) {
    return { ok: false, skipped: true, reason: "stripe_not_configured" };
  }

  const identity = getSignupBillingIdentity(payload, extra);
  if (!identity.ownerEmail || !isValidEmailAddress(identity.ownerEmail)) {
    return { ok: false, skipped: true, reason: "invalid_owner_email" };
  }

  const metadata = compactObject({
    businessName: identity.businessName,
    ownerName: identity.ownerName,
    ownerEmail: identity.ownerEmail,
    ownerPhone: identity.ownerPhone,
    businessPhone: identity.businessPhone,
    source: "my-ai-pa-signup",
    trialType: "no-card",
  });

  const existingCustomers = await stripe.customers.list({
    email: identity.ownerEmail,
    limit: 1,
  });
  const existingCustomer = existingCustomers.data?.[0] || null;
  const customer = existingCustomer
    ? await stripe.customers.update(existingCustomer.id, {
        name: identity.ownerName || identity.businessName || undefined,
        phone: identity.ownerPhone || identity.businessPhone || undefined,
        metadata,
      })
    : await stripe.customers.create({
        email: identity.ownerEmail,
        name: identity.ownerName || identity.businessName || undefined,
        phone: identity.ownerPhone || identity.businessPhone || undefined,
        metadata,
      });

  const subscriptions = await stripe.subscriptions.list({
    customer: customer.id,
    status: "all",
    limit: 20,
  });
  const existingSubscription = subscriptions.data.find((subscription) => {
    const status = String(subscription.status || "");
    if (["canceled", "incomplete_expired", "unpaid"].includes(status)) return false;
    const subMetadata = subscription.metadata || {};
    if (subMetadata.source !== "my-ai-pa-signup") return false;
    if (!identity.businessName) return true;
    return String(subMetadata.businessName || "").trim().toLowerCase() === identity.businessName.toLowerCase();
  });

  if (existingSubscription) {
    return { ok: true, customer, subscription: existingSubscription, reused: true };
  }

  const subscription = await stripe.subscriptions.create({
    customer: customer.id,
    items: [{ price: STRIPE_PRICE_ID }],
    trial_period_days: STRIPE_TRIAL_DAYS,
    trial_settings: {
      end_behavior: {
        missing_payment_method: "pause",
      },
    },
    metadata,
  });

  return { ok: true, customer, subscription, reused: false };
}

async function attachNoCardStripeTrialToSignup(payload, extra = {}) {
  try {
    const trialResult = await createNoCardStripeTrialForSignup(payload, extra);
    if (!trialResult.subscription) return trialResult;

    const identity = getSignupBillingIdentity(payload, extra);
    upsertSignupDashboardFromSubscription(trialResult.subscription, {
      ...identity,
      makeStatus: extra.makeStatus,
      twilioPhoneNumber: extra.twilioPhoneNumber,
      stripeTrialType: "no-card",
      stripeTrialReused: Boolean(trialResult.reused),
    });
    if (TRIAL_USAGE_LIMIT_ENABLED) {
      setImmediate(() => {
        processTrialUsagePolicies().catch((error) => {
          console.error("[trial-usage] post-signup policy run failed", { message: error?.message || String(error) });
        });
      });
    }

    return trialResult;
  } catch (error) {
    const identity = getSignupBillingIdentity(payload, extra);
    console.error("[stripe:no-card-trial] could not create trial subscription", {
      emailHash: hashKey(identity.ownerEmail),
      businessName: identity.businessName,
      error: error?.message || String(error),
    });
    upsertSignupDashboardFromPayload(payload, {
      ...identity,
      makeStatus: extra.makeStatus,
      twilioPhoneNumber: extra.twilioPhoneNumber,
      stripeTrialError: error?.message || "Stripe trial subscription could not be created.",
    });
    return { ok: false, error: error?.message || "Stripe trial subscription could not be created." };
  }
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

function buildStripeSignupMakePayload(signupPayload, checkoutSession) {
  const body = signupPayload && typeof signupPayload === "object" ? signupPayload : {};
  const countryCode = String(body.country || "").trim().toLowerCase();
  return compactObject({
    ...body,
    event: "signup.completed",
    submittedAt: new Date().toISOString(),
    source: {
      app: "my-ai-pa-signup",
      countryCode,
      country: countryCode === "ca" ? "Canada" : countryCode === "us" ? "United States" : undefined,
      stripeCheckoutSessionId: checkoutSession?.id || "",
    },
    security: {
      ...(body.security || {}),
      checkoutCompleted: true,
    },
    verification: {
      emailVerified: false,
      smsVerified: false,
    },
    stripe: {
      checkoutSessionId: checkoutSession?.id || "",
      customerId: typeof checkoutSession?.customer === "string" ? checkoutSession.customer : checkoutSession?.customer?.id || "",
      subscriptionId: typeof checkoutSession?.subscription === "string" ? checkoutSession.subscription : checkoutSession?.subscription?.id || "",
      paymentStatus: checkoutSession?.payment_status || "",
      status: checkoutSession?.status || "",
    },
  });
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
    err.code = "MAKE_SIGNUP_UNREACHABLE";
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
    err.code = "MAKE_SIGNUP_REJECTED";
    err.upstreamStatus = response.status;
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
    if (hasValidAdminSession(req) || (!ADMIN_TOTP_SECRET && hasValidAdminPassword(req))) {
      return next();
    }
    return res.status(401).json({ error: "Invalid admin password." });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ error: err.message || "Admin authentication failed." });
  }
}

function getAdminActorHash(req) {
  return hashKey(`admin:${getClientIp(req)}`).slice(0, 32);
}

function hasValidMonitorKey(req) {
  if (!MONITOR_API_KEY) return false;
  const authorization = String(req.headers.authorization || "").trim();
  const bearer = authorization.slice(0, 7).toLowerCase() === "bearer "
    ? authorization.slice(7).trim()
    : "";
  const supplied = String(req.headers["x-monitor-api-key"] || bearer).trim();
  return safeEqualString(supplied, MONITOR_API_KEY);
}

function requireMonitorKey(req, res, next) {
  if (!MONITOR_API_KEY) return res.status(503).json({ error: "Production monitoring is not configured." });
  if (!hasValidMonitorKey(req)) return res.status(401).json({ error: "Invalid monitor key." });
  return next();
}

function requireIntegrationKey(req, res, next) {
  if (!INTEGRATION_API_KEY) {
    return res.status(503).json({ error: "INTEGRATION_API_KEY is not configured." });
  }
  if (!hasValidIntegrationKey(req)) {
    return res.status(401).json({ error: "Invalid integration key." });
  }
  return next();
}

function requireVapiWebhookKey(req, res, next) {
  if (!getVapiWebhookSecret()) {
    return res.status(503).json({ error: "Vapi webhook authentication is not configured." });
  }
  if (!hasValidVapiWebhookKey(req)) {
    return res.status(401).json({ error: "Invalid Vapi webhook secret." });
  }
  return next();
}

function requireProvisioningKey(req, res, next) {
  const makeSignupKey = getMakeSignupWebhookConfig().apiKey;
  const suppliedMakeKey = String(req.headers["x-make-apikey"] || "").trim();
  const makeWebhookToken = getMakeSignupWebhookToken();
  const suppliedWebhookToken = String(req.headers["x-make-webhook-token"] || "").trim();
  if (
    hasValidIntegrationKey(req)
    || safeEqualString(suppliedMakeKey, makeSignupKey)
    || safeEqualString(suppliedWebhookToken, makeWebhookToken)
  ) {
    return next();
  }
  if (!INTEGRATION_API_KEY && !makeSignupKey && !makeWebhookToken) {
    return res.status(503).json({ error: "Provisioning authentication is not configured." });
  }
  return res.status(401).json({ error: "Invalid provisioning key." });
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

  jobs.push(
    prisma.runtimeStore.deleteMany({
      where: {
        key: { startsWith: AUDIT_PREFIX },
        createdAt: { lt: new Date(now - ADMIN_AUDIT_RETENTION_DAYS * 24 * 60 * 60 * 1000) },
      },
    }).then((result) => ({ key: "adminAudit", count: result?.count || 0 }))
  );

  if (!jobs.length) return;
  const results = await Promise.all(jobs);
  const transcriptResult = results.find((item) => item.key === "transcripts");
  const recordingResult = results.find((item) => item.key === "recordings");
  const auditResult = results.find((item) => item.key === "adminAudit");
  console.log("[call-data-cleanup]", {
    transcriptsCleared: transcriptResult?.count || 0,
    recordingUrlsCleared: recordingResult?.count || 0,
    adminAuditEventsCleared: auditResult?.count || 0,
  });
}

async function enforceAssistantRateLimit(req, res, next) {
  const ip = getClientIp(req);
  try {
    const decision = await consumeNamedRateLimit(
      "public-assistant",
      ip,
      ASSISTANT_MAX_REQUESTS_PER_WINDOW,
      ASSISTANT_WINDOW_MS
    );
    if (!decision.allowed) {
      setRetryAfterHeader(res, decision.retryAfterMs);
      return res.status(429).json({
        error: "Too many assistant requests. Please wait a minute and try again.",
      });
    }
    return next();
  } catch (error) {
    return next(error);
  }
}

function enforcePublicRouteRateLimit(routeKey, maxRequests) {
  return async (req, res, next) => {
    try {
      const decision = await consumeNamedRateLimit(
        `public-route:${routeKey}`,
        getClientIp(req),
        maxRequests,
        PUBLIC_ROUTE_WINDOW_MS
      );
      if (!decision.allowed) {
        setRetryAfterHeader(res, decision.retryAfterMs);
        return res.status(429).json({ error: "Too many requests. Wait a few minutes and try again." });
      }
      return next();
    } catch (error) {
      return next(error);
    }
  };
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
    const response = await fetchPublicWebsite(url, {
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

app.get(
  "/api/public/signup-network-stats",
  enforcePublicRouteRateLimit("signup-network-stats", 90),
  async (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=20");
    try {
      res.json({ ok: true, ...(await getPublicSignupNetworkStats()) });
    } catch (error) {
      console.error("Unable to load public call network stats", error);
      res.status(503).json({ error: "Live call totals are temporarily unavailable." });
    }
  }
);

async function getVapiPreviewJwtMaterial() {
  const now = Date.now();
  if (vapiPreviewJwtMaterialCache && vapiPreviewJwtMaterialCache.expiresAt > now) {
    return vapiPreviewJwtMaterialCache;
  }
  const assistant = await requestVapiResource(`assistant/${encodeURIComponent(VAPI_PREVIEW_ASSISTANT_ID)}`);
  if (!assistant?.orgId) {
    const error = new Error("Vapi preview assistant organization is unavailable.");
    error.statusCode = 503;
    throw error;
  }
  vapiPreviewJwtMaterialCache = {
    orgId: String(assistant.orgId),
    jwtSecret: VAPI_API_KEY,
    expiresAt: now + 10 * 60 * 1000,
  };
  return vapiPreviewJwtMaterialCache;
}

function reserveVapiPreviewCallSlot(now = Date.now()) {
  for (const [sessionId, expiresAt] of vapiPreviewCallLeases.entries()) {
    if (expiresAt <= now) vapiPreviewCallLeases.delete(sessionId);
  }
  if (vapiPreviewCallLeases.size >= VAPI_PREVIEW_MAX_CONCURRENT_CALLS) return null;
  const sessionId = crypto.randomBytes(18).toString("hex");
  vapiPreviewCallLeases.set(sessionId, now + (VAPI_PREVIEW_MAX_DURATION_SECONDS + 15) * 1000);
  return sessionId;
}

app.get(
  "/api/public/vapi-preview-config",
  enforcePublicRouteRateLimit("vapi-preview-config", 30),
  (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=60");
    res.json({
      enabled: Boolean(VAPI_API_KEY && VAPI_PREVIEW_ASSISTANT_ID),
      assistantId: VAPI_PREVIEW_ASSISTANT_ID || "",
      maxDurationSeconds: VAPI_PREVIEW_MAX_DURATION_SECONDS,
      maxConcurrentCalls: VAPI_PREVIEW_MAX_CONCURRENT_CALLS,
    });
  }
);

app.post(
  "/api/public/vapi-preview-session",
  enforcePublicRouteRateLimit("vapi-preview-session", 8),
  asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store, max-age=0");
    if (!VAPI_API_KEY || !VAPI_PREVIEW_ASSISTANT_ID) {
      return res.status(503).json({ error: "The live preview is not configured." });
    }
    const sessionId = reserveVapiPreviewCallSlot();
    if (!sessionId) {
      return res.status(429).json({ error: "The live preview is busy. Try again in a moment." });
    }
    try {
      const signingMaterial = await getVapiPreviewJwtMaterial();
      const requestOrigin = String(req.headers.origin || "").trim();
      const allowedOrigin = requestOrigin && isAllowedOrigin(requestOrigin) ? requestOrigin : FRONTEND_APP_URL;
      const token = jwt.sign(
        {
          orgId: signingMaterial.orgId,
          token: {
            tag: "public",
            restrictions: {
              enabled: true,
              allowedOrigins: [allowedOrigin],
              allowedAssistantIds: [VAPI_PREVIEW_ASSISTANT_ID],
              allowTransientAssistant: false,
            },
          },
        },
        signingMaterial.jwtSecret,
        {
          algorithm: "HS256",
          expiresIn: "5m",
          jwtid: sessionId,
        }
      );
      return res.json({
        token,
        assistantId: VAPI_PREVIEW_ASSISTANT_ID,
        maxDurationSeconds: VAPI_PREVIEW_MAX_DURATION_SECONDS,
        sessionId,
      });
    } catch (error) {
      vapiPreviewCallLeases.delete(sessionId);
      throw error;
    }
  })
);

app.post(
  "/api/public/vapi-preview-session/release",
  enforcePublicRouteRateLimit("vapi-preview-release", 20),
  (req, res) => {
    const sessionId = String(req.body?.sessionId || "").trim();
    if (/^[a-f0-9]{36}$/.test(sessionId)) vapiPreviewCallLeases.delete(sessionId);
    res.status(204).end();
  }
);

app.get("/api/health/ready", async (_req, res) => {
  const startedAt = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      ok: true,
      service: "my-ai-pa-api",
      dependencies: { database: "reachable" },
      responseTimeMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[health-readiness] database check failed", {
      code: String(error?.code || "DATABASE_UNAVAILABLE").slice(0, 80),
    });
    res.status(503).json({
      ok: false,
      service: "my-ai-pa-api",
      dependencies: { database: "unavailable" },
      responseTimeMs: Date.now() - startedAt,
      time: new Date().toISOString(),
    });
  }
});

app.get(
  "/api/internal/operations/health",
  requireMonitorKey,
  asyncRoute(async (_req, res) => {
    const signups = listSignupDashboardRecords();
    const inbox = await getOperationalAttentionInbox({ prisma, signups });
    const signupRecovery = new Map();
    await Promise.all(inbox.items
      .filter((item) => item.targetType === "signup")
      .map(async (item) => {
        const signup = findSignupByOperationalTarget(item.targetId, signups);
        if (signup) signupRecovery.set(item.targetId, await inspectSignupRecoveryState(signup));
      }));
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json({
      ok: inbox.summary.bySeverity.critical === 0,
      service: "my-ai-pa-operations",
      generatedAt: inbox.generatedAt,
      attention: inbox.summary,
      issues: inbox.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        severity: item.severity,
        title: item.title,
        summary: item.summary,
        detectedAt: item.detectedAt,
        ageMinutes: item.ageMinutes,
        targetType: item.targetType,
        targetId: item.targetId,
        actions: item.actions,
        ...(item.diagnostics ? {
          diagnostics: {
            ...item.diagnostics,
            ...(signupRecovery.get(item.targetId) || {}),
          },
        } : {}),
      })),
    });
  })
);

app.post(
  "/api/internal/operations/recover-signup",
  requireMonitorKey,
  express.json({ limit: "4kb" }),
  asyncRoute(async (req, res) => {
    const targetId = String(req.body?.targetId || "").trim().toLowerCase();
    if (!/^[a-f0-9]{24}$/.test(targetId)) {
      return res.status(400).json({ error: "A valid redacted signup target ID is required." });
    }
    if (String(req.body?.confirmation || "") !== "RECOVER_SIGNUP") {
      return res.status(400).json({ error: "Explicit recovery confirmation is required." });
    }
    const result = await recoverSignupByOperationalTarget(targetId);
    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json(result);
  })
);

app.post(
  "/api/webhooks/sms",
  express.urlencoded({ extended: false, limit: "8kb" }),
  asyncRoute(async (req, res) => {
    if (!verifyTwilioWebhookRequest(req)) {
      return res.status(401).json({ error: "Invalid messaging webhook signature." });
    }
    const preference = classifySmsPreference(req.body?.Body);
    if (["SUPPRESS", "RESUME"].includes(preference.action)) {
      const result = await recordSmsPreference({
        phoneNumber: req.body?.From,
        keyword: preference.keyword,
        messageSid: req.body?.MessageSid,
      });
      console.log("[sms:preference] recorded", {
        action: result.action,
        phoneLast4: result.phoneNumber.slice(-4),
      });
    }
    if (preference.action === "NONE") {
      const forwarded = await forwardSmsToUpstream({
        phoneNumber: req.body?.To,
        params: req.body || {},
        authToken: TWILIO_AUTH_TOKEN,
      });
      console.log("[sms:inbound] forwarded", {
        toLast4: normalizeSmsPhone(req.body?.To, "To").slice(-4),
        upstreamHost: forwarded.upstreamHost,
      });
      return res
        .status(forwarded.status)
        .type(forwarded.contentType)
        .send(forwarded.body);
    }
    res.type("application/xml").send("<Response></Response>");
  })
);

app.post(
  "/api/integrations/sms/suppression/check",
  asyncRoute(async (req, res) => {
    if (!SMS_SUPPRESSION_API_KEY) {
      return res.status(503).json({ error: "SMS consent checks are not configured." });
    }
    if (!hasValidSuppressionApiKey(req)) {
      return res.status(401).json({ error: "Invalid SMS consent credential." });
    }
    const phoneNumber = normalizeSmsPhone(req.body?.phoneNumber);
    const suppressed = await isSmsSuppressed(phoneNumber);
    res.json({ allowed: !suppressed, suppressed });
  })
);

app.get(
  "/api/appointments/:id/proposal",
  enforcePublicRouteRateLimit("appointment-proposal-view", 60),
  asyncRoute(async (req, res) => {
    const appointment = await getAppointmentProposal({
      appointmentId: req.params.id,
      token: req.query.token,
    });
    sendAppointmentProposalPage(res, { appointment });
  })
);

app.post(
  "/api/appointments/:id/customer-response",
  express.urlencoded({ extended: false, limit: "8kb" }),
  enforcePublicRouteRateLimit("appointment-proposal-response", 20),
  asyncRoute(async (req, res) => {
    const result = await respondToAppointmentProposal({
      appointmentId: req.params.id,
      token: req.body?.token,
      action: req.body?.action,
      customerNote: req.body?.customerNote,
      publicBaseUrl: getPublicBaseUrl(req),
    });
    sendAppointmentProposalPage(res, {
      appointment: result.appointment,
      state: result.action === "ACCEPT" ? "accepted" : "change_requested",
    });
  })
);

app.get(
  "/api/appointments/:id/manage",
  enforcePublicRouteRateLimit("appointment-manage-view", 60),
  asyncRoute(async (req, res) => {
    const appointment = await getManagedAppointment({ appointmentId: req.params.id, token: req.query.token });
    sendAppointmentManagePage(res, { appointment });
  })
);

app.post(
  "/api/appointments/:id/manage",
  express.urlencoded({ extended: false, limit: "8kb" }),
  enforcePublicRouteRateLimit("appointment-manage-submit", 20),
  asyncRoute(async (req, res) => {
    const result = await manageCustomerAppointment({
      appointmentId: req.params.id,
      token: req.body?.token,
      action: req.body?.action,
      requestedStart: req.body?.requestedStart,
      customerNote: req.body?.customerNote,
      publicBaseUrl: getPublicBaseUrl(req),
    });
    sendAppointmentManagePage(res, {
      appointment: result.appointment,
      state: result.action === "CANCEL" ? "cancelled" : "rescheduled",
    });
  })
);

app.get(
  "/api/appointments/:id/calendar",
  asyncRoute(async (req, res) => {
    const { appointment, calendar } = await getCalendarInvite({
      appointmentId: req.params.id,
      token: req.query.token,
    });
    const filename = `${String(appointment.business?.name || "appointment").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "appointment"}-confirmed.ics`;
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    res.send(calendar);
  })
);

app.post(
  "/api/appointments/request",
  requireIntegrationKey,
  asyncRoute(async (req, res) => {
    const businessId = Number(req.body?.businessId || 1);
    const ownerContact = await getAppointmentOwnerContact(businessId);
    const result = await createBooking({
      ...(req.body || {}),
      businessId,
      ...ownerContact,
      publicBaseUrl: getPublicBaseUrl(req),
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  })
);

app.post(
  "/api/business/enrich",
  enforcePublicRouteRateLimit("business-enrich", BUSINESS_ENRICH_IP_MAX_REQUESTS),
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
  requireIntegrationKey,
  asyncRoute(async (req, res) => {
    const lead = await createLead(req.body || {});
    res.status(201).json({ ok: true, leadId: lead.id, lead });
  })
);

app.get(
  "/api/leads/acknowledge",
  enforcePublicRouteRateLimit("lead-ack-view", 60),
  asyncRoute(async (req, res) => {
    const token = String(req.query.token || "").trim();
    const result = await acknowledgeLeadByTokenPreview(token);
    sendAcknowledgementPage(res, { token, state: result.state, statusCode: result.statusCode });
  })
);

app.post(
  "/api/leads/acknowledge",
  express.urlencoded({ extended: false, limit: "8kb" }),
  enforcePublicRouteRateLimit("lead-ack-submit", 20),
  asyncRoute(async (req, res) => {
    const token = String((req.body || {}).token || "").trim();
    const result = await acknowledgeLeadByToken({ token, ip: getClientIp(req) });
    const state = result.ok ? (result.alreadyAcknowledged ? "already" : "success") : (result.code === "EXPIRED" ? "expired" : "invalid");
    sendAcknowledgementPage(res, { state, statusCode: result.ok ? 200 : result.statusCode || 400 });
  })
);

async function acknowledgeLeadByTokenPreview(token) {
  const key = parseAcknowledgementToken(token);
  if (!key) return { state: "invalid", statusCode: 400 };
  const handoff = await prisma.leadHandoff.findUnique({ where: { acknowledgementKey: key } });
  if (!handoff) return { state: "invalid", statusCode: 404 };
  if (handoff.acknowledgedAt) return { state: "already", statusCode: 200 };
  if (handoff.acknowledgementExpiresAt.getTime() < Date.now()) return { state: "expired", statusCode: 410 };
  return { state: "confirm", statusCode: 200 };
}

app.post(
  "/api/calls/log",
  requireIntegrationKey,
  asyncRoute(async (req, res) => {
    const call = await logCall(req.body || {});
    res.status(201).json({ ok: true, callId: call.id, call });
  })
);

app.get(
  "/api/faqs/search",
  requireIntegrationKey,
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
  requireIntegrationKey,
  asyncRoute(async (_req, res) => {
    res.status(410).json({
      error: "Direct backend owner SMS is disabled. The existing Vapi tool remains the sender; report its result to the integration endpoint.",
      replacement: "/api/integrations/vapi/owner-sms-results",
    });
  })
);

app.post(
  "/api/integrations/vapi/owner-sms-results",
  requireIntegrationKey,
  asyncRoute(async (req, res) => {
    const payload = req.body || {};
    const sourceEventId = String(payload.eventId || payload.idempotencyKey || "").trim().slice(0, 180);
    if (!sourceEventId) return res.status(400).json({ error: "eventId or idempotencyKey is required" });
    const existing = await prisma.leadHandoff.findUnique({ where: { sourceEventId } });
    if (existing) return res.json({ ok: true, duplicate: true, handoffId: existing.id, status: existing.status });

    const leadPayload = payload.lead && typeof payload.lead === "object" ? payload.lead : payload;
    const callbackNumber = leadPayload.callbackNumber || leadPayload.rawPhoneNumber || leadPayload.phone;
    const lead = await createLead({
      businessId: payload.businessId || leadPayload.businessId || 1,
      name: leadPayload.name || leadPayload.callerName || "Unknown caller",
      callerPhone: callbackNumber,
      callbackNumber,
      summary: leadPayload.summary || leadPayload.jobDetails || leadPayload.message || "New service request",
      intent: leadPayload.intent || "QUOTE",
      urgency: leadPayload.urgency || "MEDIUM",
    });
    const result = await recordExternalOwnerSmsResult({
      lead,
      businessId: payload.businessId || lead.businessId || 1,
      callId: payload.callId || lead.callId || null,
      sourceEventId,
      payload,
    });
    res.status(201).json({ ok: true, leadId: lead.id, ...result });
  })
);

app.post(
  "/api/integrations/vapi/lead-handoffs/events",
  requireIntegrationKey,
  asyncRoute(async (req, res) => {
    const result = await applyProviderEvent(req.body || {});
    res.status(result.duplicate ? 200 : 201).json({ ok: true, ...result });
  })
);

app.post(
  "/api/webhooks/voice",
  requireVapiWebhookKey,
  asyncRoute(async (req, res) => {
    const payload = req.body || {};
    const vapiMessage = payload.message && typeof payload.message === "object" ? payload.message : null;
    const vapiMessageType = String(vapiMessage?.type || "").toLowerCase();
    if (vapiMessageType === "assistant-request") {
      return res.json(await handleTrialAssistantRequest(vapiMessage));
    }
    if (vapiMessageType === "end-of-call-report") {
      const result = await ingestVapiEndOfCallReport(vapiMessage);
      return res.status(result.duplicate ? 200 : 201).json({
        ok: true,
        eventType: vapiMessageType,
        ...result,
      });
    }
    if (vapiMessageType === "tool-calls") {
      const calls = Array.isArray(vapiMessage.toolCallList) ? vapiMessage.toolCallList : [];
      const results = [];
      for (const rawToolCall of calls) {
        const toolCall = normalizeVapiToolCall(rawToolCall);
        const toolName = String(toolCall.name || "").toLowerCase();
        const parameters = toolCall.parameters;
        if (isVapiNotificationTool(toolName)) {
          const routedBusinessId = await resolveBusinessIdForVapiCall(vapiMessage.call || vapiMessage);
          const claim = await claimVapiToolExecution({
            prisma,
            toolCall,
            businessId: routedBusinessId,
            call: vapiMessage.call || vapiMessage,
          });
          if (!claim.claimed) {
            results.push({
              name: toolCall.name,
              toolCallId: toolCall.id,
              result: JSON.stringify({
                ok: claim.execution.status === "COMPLETED",
                duplicate: true,
                status: claim.execution.status,
                ...(claim.execution.result && typeof claim.execution.result === "object" ? claim.execution.result : {}),
              }),
            });
            continue;
          }
          try {
            const lead = await createLead(buildTrustedVapiLeadInput(parameters, routedBusinessId));
            const handoff = await createAndDispatchLeadHandoff({
              lead,
              businessId: routedBusinessId,
              sourceEventId: `vapi-tool:${claim.identity.idempotencyKey}`,
              message: parameters.message || "",
            });
            const executionResult = { ok: true, leadId: lead.id, handoffId: handoff.handoffId, status: handoff.status };
            await completeVapiToolExecution({ prisma, id: claim.execution.id, result: executionResult });
            results.push({ name: toolCall.name, toolCallId: toolCall.id, result: JSON.stringify(executionResult) });
          } catch (error) {
            await failVapiToolExecution({ prisma, id: claim.execution.id, error }).catch(() => {});
            throw error;
          }
        } else if (isVapiVoiceSignupTool(toolName)) {
          const routedBusinessId = getVapiVoiceSignupExecutionBusinessId(vapiMessage.call || vapiMessage);
          const claim = await claimVapiToolExecution({
            prisma,
            toolCall,
            businessId: routedBusinessId,
            call: vapiMessage.call || vapiMessage,
          });
          if (!claim.claimed) {
            results.push({
              name: toolCall.name,
              toolCallId: toolCall.id,
              result: JSON.stringify({
                ok: claim.execution.status === "COMPLETED",
                duplicate: true,
                status: claim.execution.status,
                ...(claim.execution.result && typeof claim.execution.result === "object" ? claim.execution.result : {}),
              }),
            });
            continue;
          }
          try {
            const executionResult = await beginVoiceSignupVerification({
              req,
              parameters,
              call: vapiMessage.call || vapiMessage,
            });
            await completeVapiToolExecution({ prisma, id: claim.execution.id, result: executionResult });
            results.push({
              name: toolCall.name,
              toolCallId: toolCall.id,
              result: JSON.stringify(executionResult),
            });
          } catch (error) {
            await failVapiToolExecution({ prisma, id: claim.execution.id, error }).catch(() => {});
            throw error;
          }
        } else if (["request_appointment", "create_appointment_request"].includes(toolName)) {
          const routedBusinessId = await resolveBusinessIdForVapiCall(vapiMessage.call || vapiMessage);
          const claim = await claimVapiToolExecution({ prisma, toolCall, businessId: routedBusinessId, call: vapiMessage.call || vapiMessage });
          if (!claim.claimed) {
            results.push({
              name: toolCall.name,
              toolCallId: toolCall.id,
              result: JSON.stringify({ ok: claim.execution.status === "COMPLETED", duplicate: true, status: claim.execution.status, ...(claim.execution.result || {}) }),
            });
            continue;
          }
          try {
            const ownerContact = await getAppointmentOwnerContact(routedBusinessId);
            const booking = await createBooking({
              ...parameters,
              businessId: routedBusinessId,
              ...ownerContact,
              sourceEventId: `vapi-appointment:${claim.identity.idempotencyKey}`,
              publicBaseUrl: getPublicBaseUrl(req),
            });
            const executionResult = buildVapiAppointmentExecutionResult(booking);
            await completeVapiToolExecution({ prisma, id: claim.execution.id, result: executionResult });
            results.push({ name: toolCall.name, toolCallId: toolCall.id, result: JSON.stringify(executionResult) });
          } catch (error) {
            await failVapiToolExecution({ prisma, id: claim.execution.id, error }).catch(() => {});
            throw error;
          }
        } else {
          results.push({ name: toolCall.name, toolCallId: toolCall.id, result: JSON.stringify({ ok: false, error: `Unsupported tool '${toolCall.name}'.` }) });
        }
      }
      return res.json({ results });
    }
    const eventType = String(payload.eventType || payload.type || "unknown").toLowerCase();
    const toolResults = [];
    const routedBusinessId = await resolveBusinessIdForVapiCall(payload.call || payload);

    if (eventType === "call.started") {
      toolResults.push({ tool: "logCall", result: await logCall({ status: "STARTED", ...payload }) });
    } else if (eventType === "call.completed") {
      toolResults.push({ tool: "logCall", result: await logCall({ status: payload.status || "COMPLETED", ...payload }) });
      if (payload.lead) {
        const sourceEventId = payload.eventId || payload.id || null;
        const existingHandoff = sourceEventId ? await prisma.leadHandoff.findUnique({ where: { sourceEventId: String(sourceEventId).slice(0, 180) } }) : null;
        if (existingHandoff) return res.json({ ok: true, eventType, duplicate: true, handoffId: existingHandoff.id, toolResults });
        const lead = await createLead({ ...payload.lead, businessId: routedBusinessId });
        toolResults.push({ tool: "createLead", result: lead });
        if (payload.notifyOwner !== false) {
          toolResults.push({
            tool: "sendOwnerViaVapi",
            result: await createAndDispatchLeadHandoff({ lead, businessId: routedBusinessId, callId: lead.callId || null, sourceEventId, message: payload.smsMessage || "" }),
          });
        }
      }
    } else if (eventType === "faq.lookup") {
      toolResults.push({
        tool: "searchFaq",
        result: await searchFaq({ q: payload.q || payload.query || "", businessId: routedBusinessId, limit: payload.limit || 5 }),
      });
    } else if (eventType === "lead.capture") {
      const sourceEventId = payload.eventId || payload.id || null;
      const existingHandoff = sourceEventId ? await prisma.leadHandoff.findUnique({ where: { sourceEventId: String(sourceEventId).slice(0, 180) } }) : null;
      if (existingHandoff) return res.json({ ok: true, eventType, duplicate: true, handoffId: existingHandoff.id, toolResults });
      const lead = await createLead({ ...payload, businessId: routedBusinessId });
      toolResults.push({ tool: "createLead", result: lead });
      if (payload.notifyOwner !== false) {
        toolResults.push({
          tool: "sendOwnerViaVapi",
          result: await createAndDispatchLeadHandoff({
            lead,
            businessId: routedBusinessId,
            callId: lead.callId || null,
            sourceEventId,
            message: payload.smsMessage || "",
          }),
        });
      }
    } else if (eventType === "booking.request") {
      const businessId = routedBusinessId;
      const ownerContact = await getAppointmentOwnerContact(businessId);
      toolResults.push({
        tool: "createBooking",
        result: await createBooking({ ...payload, businessId, ...ownerContact, publicBaseUrl: getPublicBaseUrl(req) }),
      });
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
  "/api/integrations/provisioning/audit-latest-call",
  requireProvisioningKey,
  asyncRoute(async (req, res) => {
    const ownerEmail = String(req.headers["x-signup-owner-email"] || req.body?.ownerEmail || "").trim().toLowerCase();
    if (!ownerEmail || !isValidEmailAddress(ownerEmail)) {
      return res.status(400).json({ error: "A valid ownerEmail is required." });
    }
    const signup = listSignupDashboardRecords().find((record) => String(record.ownerEmail || "").trim().toLowerCase() === ownerEmail);
    if (!signup) return res.status(404).json({ error: "Signup record not found." });

    const businessName = String(signup.businessName || "").trim();
    const businessPhone = normalizePhoneForMatch(signup.businessPhone || "");
    const lookup = [
      businessName ? { name: { equals: businessName, mode: "insensitive" } } : undefined,
      businessPhone ? { phone: businessPhone } : undefined,
    ].filter(Boolean);
    const business = lookup.length ? await prisma.business.findFirst({ where: { OR: lookup } }) : null;
    const latestCall = business
      ? await prisma.call.findFirst({ where: { businessId: business.id }, include: { caller: true }, orderBy: { startedAt: "desc" } })
      : null;

    let matchingMessages = [];
    let twilioMessageAudit = { ownerNumberLast4: "", aiNumberLast4: "", recentToOwnerCount: 0, recentFromAiCount: 0, recentToOwner: [] };
    if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && latestCall) {
      const url = new URL(`${TWILIO_API_BASE_URL}/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`);
      url.searchParams.set("PageSize", "100");
      const response = await fetch(url, {
        headers: { Authorization: getTwilioAuthHeader(), Accept: "application/json" },
      });
      const data = parseJsonObject(await response.text());
      if (!response.ok) {
        const err = new Error(data?.message || data?.error || `Twilio message audit failed with HTTP ${response.status}.`);
        err.statusCode = response.status;
        throw err;
      }
      const aiNumber = normalizePhoneForMatch(signup.twilioPhoneNumber);
      const ownerNumber = normalizePhoneForMatch(signup.ownerPhone || signup.businessPhone);
      const startedAtMs = new Date(latestCall.startedAt || 0).getTime();
      const recentMessages = (data.messages || []).filter((message) => {
        const sentAtMs = new Date(message.date_sent || message.date_created || 0).getTime();
        return sentAtMs >= startedAtMs - 5 * 60 * 1000;
      });
      matchingMessages = recentMessages
        .filter((message) => {
          const from = normalizePhoneForMatch(message.from);
          const to = normalizePhoneForMatch(message.to);
          const matchesNumbers = [from, to].includes(aiNumber) && [from, to].includes(ownerNumber);
          return matchesNumbers;
        })
        .map((message) => ({
          sid: String(message.sid || "").trim(),
          status: String(message.status || "").trim(),
          direction: String(message.direction || "").trim(),
          sentAt: message.date_sent || message.date_created || null,
          errorCode: message.error_code || null,
          bodyLength: String(message.body || "").length,
        }));
      const recentToOwner = recentMessages.filter((message) => normalizePhoneForMatch(message.to) === ownerNumber);
      twilioMessageAudit = {
        ownerNumberLast4: ownerNumber.slice(-4),
        aiNumberLast4: aiNumber.slice(-4),
        recentToOwnerCount: recentToOwner.length,
        recentFromAiCount: recentMessages.filter((message) => normalizePhoneForMatch(message.from) === aiNumber).length,
        recentToOwner: recentToOwner.map((message) => ({
          sidSet: Boolean(String(message.sid || "").trim()),
          fromLast4: normalizePhoneForMatch(message.from).slice(-4),
          status: String(message.status || "").trim(),
          errorCode: message.error_code || null,
          sentAt: message.date_sent || message.date_created || null,
        })),
      };
    }

    let toolAudit = { assistantIdSet: false, attachedToolCount: 0, tools: [], routingHealth: { status: "unknown", issues: ["assistant_not_audited"] } };
    let vapiCallAudit = { available: false, endedReason: "", toolCallCount: 0, toolNames: [], toolResults: [] };
    let notificationHealth = { status: "unknown", code: "NO_VAPI_CALL_AUDITED", summary: "No Vapi call was available for notification reconciliation." };
    if (signup.twilioPhoneNumber) {
      const [vapiNumbers, assistants, tools] = await Promise.all([
        fetchVapiCollection("phone-number", ["phoneNumbers", "phone_numbers"]),
        fetchVapiCollection("assistant", ["assistants", "agents"]),
        fetchVapiCollection("tool", ["tools"]),
      ]);
      const aiNumber = normalizePhoneForMatch(signup.twilioPhoneNumber);
      const vapiNumber = vapiNumbers.find((record) => normalizePhoneForMatch(getVapiPhoneNumber(record)) === aiNumber);
      const assistantId = getVapiAssistantId(vapiNumber);
      const assistantSummary = assistants.find((record) => String(record?.id || "").trim() === assistantId);
      const assistant = assistantId
        ? await requestVapiResource(`assistant/${encodeURIComponent(assistantId)}`).catch(() => assistantSummary)
        : assistantSummary;
      const toolIds = Array.isArray(assistant?.model?.toolIds) ? assistant.model.toolIds.map((id) => String(id || "").trim()).filter(Boolean) : [];
      const auditedTools = toolIds.map((toolId) => {
        const tool = tools.find((record) => String(record?.id || "").trim() === toolId) || {};
        const code = String(tool.code || "");
        const toolName = getVapiNestedString(tool, ["function.name", "name"]) || "unknown";
        const isLegacySmsTool = ["send_customer_sms_dynamic", "send_owner_sms_dynamic"].includes(toolName);
        const isIsolatedSmsTool = isManagedIsolatedTool(tool);
        const isolatedConfiguration = isIsolatedSmsTool
          ? inspectIsolatedConfiguration({ assistant, tool, aiNumber, ownerNumber: signup.ownerPhone || signup.businessPhone })
          : null;
        return {
          id: toolId,
          name: toolName,
          type: getVapiNestedString(tool, ["type", "function.type"]) || "unknown",
          serverUrlConfigured: Boolean(getVapiNestedString(tool, ["server.url", "function.server.url", "url"])),
          codeConfigured: Boolean(code.trim()),
          legacySharedSmsTool: isLegacySmsTool,
          isolatedSmsTool: isIsolatedSmsTool,
          isolatedConfiguration,
          twilioEnvironmentReferences: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "DEFAULT_FROM_NUMBER", "DEFAULT_OWNER_TO_NUMBER", "CALLER_NUMBER", "CALL_ID"]
            .filter((name) => code.includes(`env.${name}`)),
          environmentVariables: summarizeVapiToolEnvironmentVariables(tool),
          matchesBackendEnvironment: (isLegacySmsTool || isIsolatedSmsTool)
            ? {
                twilioAccountSid: getVapiToolEnvironmentVariableValue(tool, "TWILIO_ACCOUNT_SID") === TWILIO_ACCOUNT_SID,
                twilioAuthToken: getVapiToolEnvironmentVariableValue(tool, "TWILIO_AUTH_TOKEN") === TWILIO_AUTH_TOKEN,
                defaultFromNumber:
                  normalizePhoneForMatch(getVapiToolEnvironmentVariableValue(tool, "DEFAULT_FROM_NUMBER")) ===
                  normalizePhoneForMatch(signup.twilioPhoneNumber),
                defaultOwnerNumber:
                  normalizePhoneForMatch(getVapiToolEnvironmentVariableValue(tool, "DEFAULT_OWNER_TO_NUMBER")) ===
                  normalizePhoneForMatch(signup.ownerPhone || signup.businessPhone),
              }
            : null,
          configurationKeys: Object.keys(tool).filter((key) => !["code", "function"].includes(key)).sort(),
        };
      });
      const isolatedTools = auditedTools.filter((tool) => tool.isolatedSmsTool);
      const routingIssues = [
        ...(!assistantId ? ["assistant_missing"] : []),
        ...(auditedTools.some((tool) => tool.legacySharedSmsTool) ? ["legacy_shared_sms_tool_attached"] : []),
        ...(isolatedTools.length === 0 ? ["isolated_sms_tool_missing"] : []),
        ...(isolatedTools.length > 1 ? ["multiple_isolated_sms_tools_attached"] : []),
        ...(isolatedTools.some((tool) => tool.isolatedConfiguration?.healthy !== true) ? ["isolated_sms_routing_mismatch"] : []),
      ];
      toolAudit = {
        assistantIdSet: Boolean(assistantId),
        attachedToolCount: toolIds.length,
        tools: auditedTools,
        routingHealth: {
          status: routingIssues.length ? "critical" : "healthy",
          issues: routingIssues,
        },
      };
    }

    if (latestCall?.externalProvider === "vapi" && latestCall.externalId) {
      const fullCall = await fetchVapiCallDetail(latestCall.externalId);
      const toolCalls = summarizeVapiToolCalls(fullCall);
      const toolResults = summarizeVapiToolResults(fullCall);
      vapiCallAudit = {
        available: true,
        endedReason: String(fullCall?.endedReason || "").trim(),
        toolCallCount: toolCalls.count,
        toolNames: toolCalls.toolNames,
        toolResults,
      };
      notificationHealth = summarizeCompositeNotificationHealth({
        toolResults,
        aiNumber: signup.twilioPhoneNumber,
        ownerNumber: signup.ownerPhone || signup.businessPhone,
        customerNumber: latestCall.caller?.phone,
      });
    }

    res.json({
      success: true,
      ok: true,
      businessId: business?.id || null,
      latestCall: latestCall
        ? {
            id: latestCall.id,
            status: latestCall.status,
            startedAt: latestCall.startedAt,
            durationSec: latestCall.durationSec,
            transcriptAvailable: Boolean(latestCall.transcript),
            recordingAvailable: Boolean(latestCall.recordingUrl),
            summaryAvailable: Boolean(latestCall.aiSummary),
            twilioCallSidSet: Boolean(latestCall.twilioCallSid),
            vapiCost: latestCall.vapiCost,
            totalInternalCost: latestCall.totalInternalCost,
          }
        : null,
      sms: {
        matchingCount: matchingMessages.length,
        messages: matchingMessages,
        audit: twilioMessageAudit,
      },
      toolAudit,
      vapiCallAudit,
      notificationHealth,
    });
  })
);

app.post(
  "/api/integrations/vapi/repair-sms-routing",
  requireProvisioningKey,
  asyncRoute(async (req, res) => {
    const ownerEmail = String(req.headers["x-signup-owner-email"] || req.body?.ownerEmail || "").trim().toLowerCase();
    if (!ownerEmail || !isValidEmailAddress(ownerEmail)) {
      return res.status(400).json({ error: "A valid ownerEmail is required." });
    }
    const signup = listSignupDashboardRecords().find(
      (record) => String(record.ownerEmail || "").trim().toLowerCase() === ownerEmail
    );
    if (!signup) return res.status(404).json({ error: "Signup record not found." });

    const aiNumber = normalizeVapiImportPhone(signup.twilioPhoneNumber);
    const ownerNumber = normalizeVapiImportPhone(signup.ownerPhone || signup.businessPhone);
    if (!aiNumber || !ownerNumber) {
      return res.status(409).json({ error: "The assigned AI number and owner notification number are required." });
    }

    const vapiNumbers = await fetchVapiCollection("phone-number", ["phoneNumbers", "phone_numbers"]);
    const vapiNumber = vapiNumbers.find(
      (record) => normalizePhoneForMatch(getVapiPhoneNumber(record)) === normalizePhoneForMatch(aiNumber)
    );
    const assistantId = getVapiAssistantId(vapiNumber);
    if (!assistantId) {
      return res.status(404).json({ error: "The Vapi assistant assigned to this phone number was not found." });
    }

    const result = await provisionIsolatedSmsForAssistant({ assistantId, aiNumber, ownerNumber });
    upsertSignupDashboardRecord({
      ownerEmail,
      smsRoutingStatus: result.audit?.healthy ? "healthy" : "failed",
      smsRoutingToolId: result.toolId,
      smsRoutingToolName: result.toolName,
      smsRoutingVerifiedAt: result.audit?.healthy ? new Date().toISOString() : "",
      smsRoutingError: result.audit?.healthy ? "" : "Vapi read-back did not verify isolated routing.",
    });
    res.json({
      success: true,
      ok: true,
      assistantId: result.assistantId,
      toolId: result.toolId,
      toolName: result.toolName,
      created: result.created,
      reused: result.reused,
      updated: result.updated,
      aiNumberLast4: aiNumber.slice(-4),
      ownerNumberLast4: ownerNumber.slice(-4),
      isolatedRoutingConfigured: result.audit?.healthy === true,
      checks: result.audit?.checks || {},
    });
  })
);

/*
 * Legacy prompt-only routing was removed here. Phone numbers in a system prompt
 * are model instructions, not a security boundary, and caused a real owner SMS
 * to be sent to the wrong destination. The route now provisions one protected
 * tool per business through provisionIsolatedSmsForAssistant().
 */

app.post(
  "/api/integrations/vapi/sync-now",
  requireProvisioningKey,
  asyncRoute(async (req, res) => {
    const limit = Math.max(1, Math.min(VAPI_CALL_LIMIT, Number(req.body?.limit || 100) || 100));
    const ownerEmail = String(req.headers["x-signup-owner-email"] || req.body?.ownerEmail || "").trim().toLowerCase();
    let linkedBusinessId = null;

    if (ownerEmail && isValidEmailAddress(ownerEmail)) {
      const signup = listSignupDashboardRecords().find((record) => String(record.ownerEmail || "").trim().toLowerCase() === ownerEmail);
      if (signup?.twilioPhoneNumber) {
        const normalizedBusinessPhone = normalizePhoneForMatch(signup.businessPhone || signup.ownerPhone || signup.twilioPhoneNumber);
        const businessName = String(signup.businessName || signup.ownerName || "My AI PA Customer").trim();
        const lookup = [
          businessName ? { name: { equals: businessName, mode: "insensitive" } } : undefined,
          normalizedBusinessPhone ? { phone: normalizedBusinessPhone } : undefined,
        ].filter(Boolean);
        let business = lookup.length ? await prisma.business.findFirst({ where: { OR: lookup } }) : null;
        if (!business) {
          const businessData = { name: businessName, phone: normalizedBusinessPhone, timezone: "America/Toronto" };
          try {
            business = await prisma.business.create({ data: businessData });
          } catch (error) {
            if (error?.code !== "P2002") throw error;
            const current = await prisma.business.aggregate({ _max: { id: true } });
            business = await prisma.business.create({
              data: { id: Number(current?._max?.id || 0) + 1, ...businessData },
            });
            await prisma.$queryRaw`SELECT setval(pg_get_serial_sequence('"Business"', 'id'), COALESCE(MAX(id), 1), true) FROM "Business"`;
          }
        }
        linkedBusinessId = business.id;
        await prisma.settings.upsert({
          where: { businessId: business.id },
          update: { ownerPhone: String(signup.ownerPhone || signup.businessPhone || "").trim() },
          create: {
            businessId: business.id,
            ownerPhone: String(signup.ownerPhone || signup.businessPhone || "").trim(),
            answerAfterRings: 3,
            afterHoursMode: "AI_ALWAYS_ON",
          },
        });

        const aiNumber = normalizePhoneForMatch(signup.twilioPhoneNumber);
        const vapiNumbers = await fetchVapiCollection("phone-number", ["phoneNumbers", "phone_numbers"]);
        const vapiNumber = vapiNumbers.find((record) => normalizePhoneForMatch(getVapiPhoneNumber(record)) === aiNumber);
        const mappingValues = [
          { matchType: "phoneNumber", matchValue: aiNumber },
          { matchType: "phoneNumberId", matchValue: String(vapiNumber?.id || "").trim().toLowerCase() },
          { matchType: "assistantId", matchValue: getVapiAssistantId(vapiNumber).toLowerCase() },
        ].filter((mapping) => mapping.matchValue);
        for (const mapping of mappingValues) {
          await prisma.vapiBusinessMapping.upsert({
            where: { matchValue: mapping.matchValue },
            update: { businessId: business.id, matchType: mapping.matchType, label: businessName.slice(0, 120) },
            create: { businessId: business.id, ...mapping, label: businessName.slice(0, 120) },
          });
        }
      }
    }

    const result = await syncVapiCalls({ limit });
    res.json({
      success: true,
      ok: true,
      fetched: result.fetched,
      detailsFetched: result.detailsFetched,
      synced: result.synced,
      detailErrorCount: result.detailErrors.length,
      linkedBusinessId,
    });
  })
);

app.post(
  "/api/integrations/provisioning/complete-existing",
  requireProvisioningKey,
  asyncRoute(async (req, res) => {
    const body = { ...(req.query || {}), ...(req.body || {}) };
    const voiceUrl = normalizeTwilioProvisioningVoiceUrl(body.voiceUrl);
    const ownerEmail = String(req.headers["x-signup-owner-email"] || body.ownerEmail || "").trim();
    const assistantName = sanitizeVapiImportName(body.assistantName, "My AI PA Agent");

    const twilioNumbers = await fetchTwilioIncomingPhoneNumbers();
    const twilioNumber = twilioNumbers.find((record) => String(record?.voice_url || "").trim() === voiceUrl);
    const phoneNumber = normalizeVapiImportPhone(twilioNumber?.phone_number);
    if (!phoneNumber) {
      const err = new Error("No existing Twilio number is assigned to this Make voice webhook.");
      err.statusCode = 404;
      throw err;
    }

    const existingVapiNumbers = await fetchVapiCollection("phone-number", ["phoneNumbers", "phone_numbers"]);
    const existingVapiNumber = existingVapiNumbers.find((record) => normalizeVapiImportPhone(getVapiPhoneNumber(record)) === phoneNumber);
    let result;
    let reused = false;
    if (existingVapiNumber) {
      result = summarizeVapiPhoneNumberImport(existingVapiNumber, phoneNumber);
      reused = true;
    } else {
      const assistants = await fetchVapiCollection("assistant", ["assistants", "agents"]);
      const assistant = assistants
        .filter((record) => getVapiAssistantName(record) === assistantName)
        .sort((left, right) => Date.parse(right?.createdAt || right?.created_at || 0) - Date.parse(left?.createdAt || left?.created_at || 0))[0];
      const assistantId = String(assistant?.id || "").trim();
      if (!assistantId) {
        const err = new Error(`No existing Vapi assistant named ${assistantName} was found.`);
        err.statusCode = 404;
        throw err;
      }
      result = await importTwilioPhoneNumberToVapi({ twilioPhoneNumber: phoneNumber, assistantId, name: `${assistantName} Number` });
    }

    if (ownerEmail && isValidEmailAddress(ownerEmail)) {
      upsertSignupDashboardRecord({
        ownerEmail,
        twilioPhoneNumber: result.number || phoneNumber,
        vapiPhoneNumberId: result.id,
        vapiAssistantId: result.assistantId,
        makeStatus: 200,
        status: "setup_started",
      });
    }

    const smsRouting = await safelyProvisionIsolatedSmsForSignup({
      ownerEmail,
      assistantId: result.assistantId,
      aiNumber: result.number || phoneNumber,
      ownerNumber: body.ownerPhone,
    });
    if (ownerEmail && isValidEmailAddress(ownerEmail)) {
      upsertSignupDashboardRecord({
        ownerEmail,
        smsRoutingStatus: smsRouting.healthy ? "healthy" : smsRouting.skipped ? "waiting" : "failed",
        smsRoutingToolId: smsRouting.toolId || "",
        smsRoutingToolName: smsRouting.toolName || "",
        smsRoutingVerifiedAt: smsRouting.healthy ? new Date().toISOString() : "",
        smsRoutingError: smsRouting.skipped ? smsRouting.reason : smsRouting.healthy ? "" : smsRouting.error || "Vapi read-back did not verify isolated routing.",
      });
    }

    res.status(reused ? 200 : 201).json({
      success: true,
      ok: true,
      reused,
      twilioPhoneNumber: result.number || phoneNumber,
      phoneNumberId: result.id,
      assistantId: result.assistantId,
      smsRouting,
    });
  })
);

app.post(
  "/api/integrations/twilio/purchase-number",
  requireProvisioningKey,
  asyncRoute(async (req, res) => {
    const input = { ...(req.query || {}), ...(req.body || {}) };
    const result = await purchaseTwilioPhoneNumber({
      areaCode: input.areaCode,
      voiceUrl: input.voiceUrl,
      voiceMethod: input.voiceMethod,
    });

    res.status(201).json({ success: true, ok: true, ...result });
  })
);

app.post(
  "/api/integrations/vapi/import-twilio-number",
  requireProvisioningKey,
  asyncRoute(async (req, res) => {
    const body = { ...(req.query || {}), ...(req.body || {}) };
    const result = await importTwilioPhoneNumberToVapi({
      twilioPhoneNumber: body.twilioPhoneNumber || body.phoneNumber || body.number,
      assistantId: body.assistantId,
      name: body.name,
    });

    const ownerEmail = String(req.headers["x-signup-owner-email"] || body.ownerEmail || "").trim();
    if (ownerEmail && isValidEmailAddress(ownerEmail)) {
      upsertSignupDashboardRecord({
        ownerEmail,
        twilioPhoneNumber: result.number,
        vapiPhoneNumberId: result.id,
        vapiAssistantId: result.assistantId || String(body.assistantId || "").trim(),
        makeStatus: 200,
        status: "setup_started",
      });
    }

    const smsRouting = await safelyProvisionIsolatedSmsForSignup({
      ownerEmail,
      assistantId: result.assistantId || String(body.assistantId || "").trim(),
      aiNumber: result.number,
      ownerNumber: body.ownerPhone,
    });
    if (ownerEmail && isValidEmailAddress(ownerEmail)) {
      upsertSignupDashboardRecord({
        ownerEmail,
        smsRoutingStatus: smsRouting.healthy ? "healthy" : smsRouting.skipped ? "waiting" : "failed",
        smsRoutingToolId: smsRouting.toolId || "",
        smsRoutingToolName: smsRouting.toolName || "",
        smsRoutingVerifiedAt: smsRouting.healthy ? new Date().toISOString() : "",
        smsRoutingError: smsRouting.skipped ? smsRouting.reason : smsRouting.healthy ? "" : smsRouting.error || "Vapi read-back did not verify isolated routing.",
      });
    }

    res.status(201).json({
      success: true,
      ok: true,
      twilioPhoneNumber: result.number,
      phoneNumberId: result.id,
      smsRouting,
      result,
    });
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
    const pricingDetails = body.pricing && typeof body.pricing === "object" ? body.pricing : setupDetails.pricing || {};
    const installationFreeEstimate = pricingDetails.installationFreeEstimate !== false;
    const repairVisitFee = String(pricingDetails.repairVisitFee || "").trim();
    const repairHourlyRate = String(pricingDetails.repairHourlyRate || "").trim();
    const freeEstimateAnswer = String(pricingDetails.freeEstimateAnswer || (installationFreeEstimate ? "yes we do" : "no we don't")).trim();
    const pricingScript = String(body.pricingScript || setupDetails.pricingScript || "").trim();
    const rawSpecializations = Array.isArray(body.specializations)
      ? body.specializations
      : Array.isArray(setupDetails.specializations)
        ? setupDetails.specializations
        : String(body.specializationList || body.specialityList || body.specialtyList || setupDetails.specializationList || setupDetails.specialityList || setupDetails.specialtyList || setupDetails.specializations || "")
            .split(",");
    const specializations = rawSpecializations
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const specializationList = String(
      body.specializationList
        || setupDetails.specializationList
        || specializations.join(", ")
    ).trim();
    const specialityList = String(body.specialityList || setupDetails.specialityList || specializationList).trim();
    const specialtyList = String(body.specialtyList || setupDetails.specialtyList || specializationList).trim();
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
      pricing: {
        installationFreeEstimate,
        freeEstimateAnswer,
        repairVisitFee,
        repairHourlyRate,
        repairVisitFeeText: repairVisitFee ? `${repairVisitFee} dollars` : undefined,
        repairHourlyRateText: repairHourlyRate ? `${repairHourlyRate} dollars per hour` : undefined,
        pricingScript,
      },
      specializations,
      specializationList,
      specialityList,
      specialtyList,
      aiAssistant: {
        goals: String(setupDetails.aiGoals || "").trim(),
        businessType: String(setupDetails.businessType || "").trim(),
        serviceArea: String(setupDetails.serviceArea || "").trim(),
        specializations,
        specializationList,
        specialityList,
        specialtyList,
        callForwardingNumber: String(setupDetails.callForwardingNumber || "").trim(),
        bookingPreference: String(setupDetails.bookingPreference || "").trim(),
        notificationPreference: String(setupDetails.notificationPreference || "").trim(),
        tone: String(setupDetails.aiTone || "").trim(),
        assistantVoice: String(setupDetails.assistantVoice || setupDetails.voice || "").trim(),
        emergencyAfterHoursAvailable: Boolean(setupDetails.emergencyAfterHoursAvailable),
        emergencyRules: String(setupDetails.emergencyRules || "").trim(),
        pricingScript,
        freeEstimateAnswer,
        repairVisitFee,
        repairHourlyRate,
        faq: String(setupDetails.faq || "").trim(),
        greetingScript: String(setupDetails.greetingScript || "").trim(),
        intakeQuestions: String(setupDetails.intakeQuestions || "").trim(),
        escalationRules: String(setupDetails.escalationRules || "").trim(),
        doNotHandle: String(setupDetails.doNotHandle || "").trim(),
      },
    });
    const makePayload = compactObject({
      ...body,
      event: payload.event,
      submittedAt: payload.submittedAt,
      source: payload.source,
      security: {
        ...(body.security || {}),
        ...(payload.security || {}),
      },
      verification: payload.verification,
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

    let makeResult;
    try {
      makeResult = await sendMakeSignupCompleted(makePayload);
    } catch (error) {
      upsertSignupDashboardFromPayload(payload, {
        status: "setup_error",
        makeStatus: Number(error?.upstreamStatus) || 0,
        makeError: error?.code || "MAKE_SIGNUP_FAILED",
      });
      throw error;
    }
    const makeData = makeResult.data || {};
    if (!getMakeSignupSuccess(makeData)) {
      upsertSignupDashboardFromPayload(payload, {
        status: "setup_error",
        makeStatus: makeResult.status,
        makeError: makeData?.error || "Make webhook did not complete the signup.",
      });
      return res.status(502).json({ error: makeData?.error || "Make webhook did not complete the signup." });
    }

    const twilioPhoneNumber = getMakeTwilioPhoneNumber(makeData) || getMakeTwilioPhoneNumberFromText(makeResult.body);
    upsertSignupDashboardFromPayload(payload, {
      status: "setup_started",
      makeStatus: makeResult.status,
      twilioPhoneNumber,
    });
    const stripeTrial = await attachNoCardStripeTrialToSignup(payload, {
      makeStatus: makeResult.status,
      twilioPhoneNumber,
    });

    res.json({
      success: true,
      ok: true,
      businessName,
      twilioPhoneNumber,
      makeStatus: makeResult.status,
      stripeCustomerId: stripeTrial.customer?.id || "",
      subscriptionId: stripeTrial.subscription?.id || "",
      subscriptionStatus: stripeTrial.subscription?.status || "",
      trialStartAt: getUnixMs(stripeTrial.subscription?.trial_start),
      trialEndAt: getUnixMs(stripeTrial.subscription?.trial_end),
      stripeTrialSkipped: Boolean(stripeTrial.skipped),
      stripeTrialError: stripeTrial.error || "",
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
    const twilioPhoneNumber = getMakeTwilioPhoneNumber(makeData) || getMakeTwilioPhoneNumberFromText(makeResult.body);
    upsertSignupDashboardFromPayload(payload, {
      status: "setup_started",
      emailVerified: true,
      emailVerifiedAt: new Date().toISOString(),
      makeStatus: makeResult.status,
      twilioPhoneNumber,
    });
    await attachNoCardStripeTrialToSignup(payload, {
      makeStatus: makeResult.status,
      twilioPhoneNumber,
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
  enforcePublicRouteRateLimit("stripe-checkout", STRIPE_CHECKOUT_IP_MAX_REQUESTS),
  asyncRoute(async (req, res) => {
    if (!stripe || !STRIPE_PRICE_ID) {
      return res.status(503).json({
        error: "Stripe checkout is not configured yet. Set STRIPE_SECRET_KEY and STRIPE_PRICE_ID on the server.",
      });
    }

    const body = req.body || {};
    const signupPayload = body.signupPayload && typeof body.signupPayload === "object" ? body.signupPayload : body;
    const setupDetails = signupPayload.setupDetails || {};
    const businessProfile = signupPayload.businessProfile || {};
    const ownerEmail = String(body.ownerEmail || signupPayload.ownerEmail || signupPayload.email || setupDetails.ownerEmail || "").trim();
    const businessName = String(body.businessName || signupPayload.businessName || businessProfile.businessName || "").trim();
    const ownerName = String(body.ownerName || signupPayload.ownerName || setupDetails.ownerName || "").trim();
    const ownerPhone = String(body.ownerPhone || signupPayload.ownerPhone || signupPayload.phone || setupDetails.ownerPhone || "").trim();
    const businessPhone = String(signupPayload.businessPhone || signupPayload.phone || businessProfile.phone || "").trim();
    const businessAddress = String(signupPayload.businessAddress || businessProfile.address || "").trim();

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

    const customer = await stripe.customers.create({
      email: ownerEmail,
      name: ownerName || businessName || undefined,
      phone: ownerPhone || businessPhone || undefined,
      metadata: compactObject({
        businessName,
        ownerName,
        ownerEmail,
        ownerPhone,
        source: "my-ai-pa-signup",
      }),
    });

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customer.id,
      payment_method_types: ["card"],
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
      businessPhone,
      businessAddress,
      ownerName,
      ownerEmail,
      ownerPhone,
    });
    savePendingStripeSignup(session, {
      payload: signupPayload,
      summary: compactObject({
        businessName,
        businessPhone,
        businessAddress,
        ownerName,
        ownerEmail,
        ownerPhone,
      }),
    });

    res.json({
      ok: true,
      checkoutUrl: session.url,
      sessionId: session.id,
    });
  })
);

app.get(
  "/api/customer/dashboard",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) {
      return res.status(401).json({ error: "Your dashboard refresh session has expired. Sign in again." });
    }

    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard) {
      clearCustomerDashboardSessionCookie(res);
      return res.status(404).json({ error: "This customer dashboard is no longer available." });
    }

    res.json({ ok: true, dashboard, refreshedAt: new Date().toISOString() });
  })
);

app.post(
  "/api/customer/dashboard/leads/:leadId/outcome",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard?.businessId) return res.status(404).json({ error: "Business dashboard not found." });
    const lead = await recordLeadOutcome({
      prisma,
      businessId: dashboard.businessId,
      leadId: req.params.leadId,
      input: { ...(req.body || {}), source: "OWNER_DASHBOARD" },
    });
    let jobber = { skipped: true, reason: "not_requested" };
    if (req.body?.syncToJobber !== false) {
      try {
        jobber = await syncLeadToJobber({ prisma, businessId: dashboard.businessId, leadId: lead.id });
      } catch (error) {
        jobber = { synced: false, error: String(error.message || error).slice(0, 500) };
      }
    }
    res.json({ ok: true, lead: sanitizeCustomerLead(lead), jobber });
  })
);

app.get(
  "/api/customer/dashboard/integrations/jobber/connect",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).send("Your dashboard session has expired. Sign in again.");
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard?.businessId) return res.status(404).send("Business dashboard not found.");
    res.redirect(302, getJobberAuthorizationUrl({ businessId: dashboard.businessId }));
  })
);

app.get(
  "/api/integrations/jobber/oauth/callback",
  asyncRoute(async (req, res) => {
    const code = String(req.query.code || "").trim();
    const state = String(req.query.state || "").trim();
    if (!code || !state) return res.status(400).send("Jobber did not return a complete authorization response.");
    await completeJobberOAuth({ prisma, code, state });
    res.redirect(302, `${FRONTEND_APP_URL}/#/dashboard?integration=jobber-connected`);
  })
);

app.post(
  "/api/customer/dashboard/integrations/jobber/disconnect",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard?.businessId) return res.status(404).json({ error: "Business dashboard not found." });
    await disconnectJobber({ prisma, businessId: dashboard.businessId });
    res.json({ ok: true });
  })
);

app.post(
  "/api/customer/dashboard/integrations/jobber/leads/:leadId/sync",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard?.businessId) return res.status(404).json({ error: "Business dashboard not found." });
    const result = await syncLeadToJobber({ prisma, businessId: dashboard.businessId, leadId: req.params.leadId });
    res.json({ ok: true, ...result });
  })
);

app.get(
  "/api/customer/dashboard/calendar/connect/:provider",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard?.businessId) return res.status(404).json({ error: "Your business scheduling profile is not available." });
    const staffMemberId = String(req.query.staffMemberId || "").trim() || null;
    if (staffMemberId && !dashboard.staffMembers.some((member) => member.id === staffMemberId)) {
      return res.status(404).json({ error: "That team member is not available." });
    }
    res.redirect(getAuthorizationUrl({
      businessId: dashboard.businessId,
      staffMemberId,
      provider: req.params.provider,
    }));
  })
);

app.delete(
  "/api/customer/dashboard/calendar/connections/:id",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard?.businessId) return res.status(404).json({ error: "Your business scheduling profile is not available." });
    await disconnectCalendar({ businessId: dashboard.businessId, connectionId: req.params.id });
    res.json({ ok: true });
  })
);

for (const provider of ["google", "microsoft"]) {
  app.get(
    `/api/calendar/oauth/${provider}/callback`,
    enforcePublicRouteRateLimit(`calendar-oauth-${provider}`, 60),
    asyncRoute(async (req, res) => {
      if (req.query.error) {
        return res.status(400).send(`Calendar connection was cancelled: ${escapeHtml(req.query.error_description || req.query.error)}`);
      }
      await completeOAuthConnection({ state: req.query.state, code: req.query.code, provider });
      const frontend = String(process.env.FRONTEND_APP_URL || process.env.WEBSITE_URL || (process.env.NODE_ENV === "production" ? "https://www.myaipa.ca" : "http://localhost:3000")).replace(/\/+$/, "");
      res.redirect(`${frontend}/#/dashboard?calendar=connected`);
    })
  );
}

app.get(
  "/api/customer/dashboard/calls/:callId/recording",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    const callId = Number(req.params.callId);
    const visibleCall = Number.isInteger(callId) && dashboard?.calls?.find((call) => call.id === callId);
    if (!visibleCall) return res.status(404).json({ error: "Recording not found." });
    if (!visibleCall.recordingAvailable) return res.status(403).json({ error: "This recording is unavailable or does not have recorded consent." });

    const call = await prisma.call.findUnique({
      where: { id: callId },
      select: { recordingUrl: true, externalProvider: true, externalId: true },
    });
    const headers = { Accept: "audio/*,application/octet-stream" };
    if (req.headers.range) headers.Range = String(req.headers.range).slice(0, 200);
    let recordingUrl;
    let redirect = "error";
    if (call?.externalProvider === "vapi" && call.externalId) {
      if (!VAPI_API_KEY) return res.status(503).json({ error: "Recording access is temporarily unavailable." });
      recordingUrl = new URL(`${VAPI_API_BASE_URL}/call/${encodeURIComponent(call.externalId)}/mono-recording`);
      headers.Authorization = `Bearer ${VAPI_API_KEY}`;
      redirect = "follow";
    } else {
      try {
        recordingUrl = new URL(String(call?.recordingUrl || ""));
      } catch (_err) {
        return res.status(404).json({ error: "Recording not found." });
      }
      const hostname = recordingUrl.hostname.toLowerCase();
      const privateHost = hostname === "localhost" || hostname === "::1" || /^(?:127\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(hostname);
      if (recordingUrl.protocol !== "https:" || privateHost) return res.status(502).json({ error: "Recording storage location is invalid." });
    }

    const upstream = await fetch(recordingUrl, { headers, redirect });
    if (!upstream.ok && upstream.status !== 206) return res.status(502).json({ error: "Recording could not be loaded." });

    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "private, no-store, max-age=0");
    const contentType = upstream.headers.get("content-type") || "";
    const extension = /mpeg|mp3/i.test(contentType) ? "mp3" : /wav|wave/i.test(contentType) ? "wav" : "audio";
    res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="call-${callId}.${extension}"`);
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body).on("error", () => res.destroy()).pipe(res);
  })
);

app.post(
  "/api/customer/dashboard/support/suggest",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    const rateLimit = await getSupportSuggestionRateLimitDecision(lookupHash);
    if (rateLimit.blocked) {
      setRetryAfterHeader(res, rateLimit.retryAfterMs);
      return res.status(429).json({ error: "Too many suggestion requests. Wait a few minutes or send the report now." });
    }
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard?.businessId) return res.status(409).json({ error: "Business setup must finish before support diagnostics are available." });
    const description = sanitizeSupportDescription(req.body?.description);
    if (description.length < 8) return res.status(400).json({ error: "Briefly describe what is not working." });
    const callId = req.body?.callId == null || req.body.callId === "" ? null : Number(req.body.callId);
    const diagnostics = buildCustomerSupportDiagnostics(dashboard, callId, false);
    if (callId != null && !diagnostics.call) return res.status(404).json({ error: "That call is not available in this business dashboard." });
    const analysis = await getCustomerSupportAnalysis({ description, diagnostics });
    res.json({ ok: true, analysis, callLinked: Boolean(diagnostics.call) });
  })
);

app.post(
  "/api/customer/dashboard/support/reports",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    const rateLimit = await getSupportReportRateLimitDecision(lookupHash);
    if (rateLimit.blocked) {
      setRetryAfterHeader(res, rateLimit.retryAfterMs);
      return res.status(429).json({ error: "Too many support reports. Wait before sending another report." });
    }
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard?.businessId) return res.status(409).json({ error: "Business setup must finish before a support report can be sent." });
    const description = sanitizeSupportDescription(req.body?.description);
    if (description.length < 8) return res.status(400).json({ error: "Briefly describe what is not working." });
    const callId = req.body?.callId == null || req.body.callId === "" ? null : Number(req.body.callId);
    const includeSensitiveCallData = Boolean(req.body?.includeSensitiveCallData && callId != null);
    const diagnostics = buildCustomerSupportDiagnostics(dashboard, callId, includeSensitiveCallData);
    if (callId != null && !diagnostics.call) return res.status(404).json({ error: "That call is not available in this business dashboard." });
    diagnostics.request = {
      userAgent: String(req.headers["user-agent"] || "").slice(0, 240),
      contactAllowed: req.body?.contactAllowed !== false,
    };
    const fallback = getRuleBasedSupportAnalysis({ description, diagnostics });
    const analysis = normalizeSubmittedSupportAnalysis(req.body?.analysis || {}, fallback);
    let report = await prisma.supportReport.create({
      data: {
        businessId: dashboard.businessId,
        callId: diagnostics.call?.id || null,
        description,
        aiSummary: analysis.summary,
        likelyCause: analysis.likelyCause,
        suggestions: analysis.suggestions,
        diagnostics,
        includeSensitiveCallData,
        contactAllowed: req.body?.contactAllowed !== false,
        severity: analysis.severity,
      },
      include: { business: { select: { id: true, name: true, phone: true } } },
    });
    let telegramAlert = { sent: false, skipped: true };
    if (report.severity === "HIGH") {
      try {
        telegramAlert = await sendSupportTelegramAlert(report);
        if (telegramAlert.sent) {
          report = await prisma.supportReport.update({
            where: { id: report.id },
            data: { telegramAlertedAt: new Date() },
            include: { business: { select: { id: true, name: true, phone: true } } },
          });
        }
      } catch (error) {
        console.error("[support:telegram] high-priority alert failed", { ticketNumber: getSupportTicketNumber(report.id), message: error?.message || String(error) });
        telegramAlert = { sent: false, skipped: false, error: "Telegram alert could not be sent." };
      }
    }
    res.status(201).json({
      ok: true,
      ticketNumber: getSupportTicketNumber(report.id),
      status: report.status,
      createdAt: report.createdAt,
      telegramAlert,
    });
  })
);

app.post(
  "/api/customer/dashboard/request-code",
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const email = String(body.email || body.ownerEmail || "").trim();
    const phone = String(body.phone || body.ownerPhone || body.businessPhone || "").trim();
    const rateLimit = await getCustomerDashboardRateLimitDecision(req, { email, phone });

    if (rateLimit.blocked) {
      setRetryAfterHeader(res, rateLimit.retryAfterMs);
      return res.status(429).json({ error: "Too many dashboard lookup attempts. Wait a few minutes and try again." });
    }

    if (!email || !isValidEmailAddress(email) || !phone) {
      return res.status(400).json({ error: "Enter the signup email and phone number for this business." });
    }

    const signup = findCustomerDashboardSignup({ email, phone });
    if (!signup) {
      return res.status(404).json({ error: "We could not send a code. Check the signup email and phone number." });
    }

    const lookupHash = getCustomerDashboardLookupHash(email, phone);
    const code = await createCustomerDashboardLoginCode(lookupHash);
    const destination = signup.ownerPhone || signup.businessPhone;
    const sms = await sendSmsViaTwilio({
      to: destination,
      message: `Your My AI PA dashboard code is ${code}. It expires in 10 minutes. Do not share this code.`,
    });
    res.status(202).json({
      ok: true,
      codeSent: true,
      destination: maskCustomerDashboardPhone(destination),
      expiresInSeconds: Math.floor(CUSTOMER_DASHBOARD_CODE_TTL_MS / 1000),
      ...(sms.mocked && process.env.NODE_ENV !== "production" ? { devCode: code } : {}),
    });
  })
);

app.post(
  "/api/customer/dashboard/verify-code",
  asyncRoute(async (req, res) => {
    const body = req.body || {};
    const email = String(body.email || body.ownerEmail || "").trim();
    const phone = String(body.phone || body.ownerPhone || body.businessPhone || "").trim();
    const code = String(body.code || "").replace(/\D/g, "");
    if (!email || !isValidEmailAddress(email) || !phone || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ error: "Enter the six-digit code sent to the registered phone." });
    }

    const signup = findCustomerDashboardSignup({ email, phone });
    if (!signup) return res.status(401).json({ error: "The code is invalid or has expired." });
    const lookupHash = getCustomerDashboardLookupHash(email, phone);
    const verification = await verifyCustomerDashboardLoginCode(lookupHash, code);
    if (!verification.ok) {
      return res.status(401).json({
        error: verification.reason === "attempts"
          ? "Too many incorrect attempts. Request a new code."
          : "The code is invalid or has expired.",
      });
    }

    const dashboard = await getCustomerDashboard({ email, phone });
    if (!dashboard) return res.status(404).json({ error: "This customer dashboard is no longer available." });
    setCustomerDashboardSessionCookie(res, createCustomerDashboardSessionToken({ email, phone }));
    res.json({ ok: true, dashboard, refreshedAt: new Date().toISOString() });
  })
);

app.post(
  "/api/customer/dashboard/appointments/:id/respond",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) {
      return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    }
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard) {
      clearCustomerDashboardSessionCookie(res);
      return res.status(404).json({ error: "This customer dashboard is no longer available." });
    }
    if (!dashboard.businessId) {
      return res.status(409).json({ error: "Your business setup must finish before appointment requests can be managed." });
    }
    const body = req.body || {};
    const result = await respondToAppointment({
      appointmentId: req.params.id,
      businessId: dashboard.businessId,
      action: body.action,
      confirmedStart: body.confirmedStart,
      ownerNote: body.ownerNote,
      ownerEmail: dashboard.signup?.ownerEmail,
      ownerPhone: dashboard.signup?.ownerPhone,
      staffMemberId: body.staffMemberId,
      publicBaseUrl: getPublicBaseUrl(req),
    });
    res.json({
      ok: true,
      unchanged: Boolean(result.unchanged),
      appointment: sanitizeCustomerAppointment(result.appointment),
      calendarUrl: result.calendarUrl || "",
      proposalUrl: result.proposalUrl || "",
      customerAcceptanceRequired: Boolean(result.customerAcceptanceRequired),
      calendarSync: result.calendarSync || null,
      notifications: result.notifications || [],
    });
  })
);

app.put(
  "/api/customer/dashboard/scheduling",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard?.businessId) return res.status(404).json({ error: "Your business scheduling profile is not available." });
    const settings = await updateSchedulingSettings({
      businessId: dashboard.businessId,
      bookingHours: req.body?.bookingHours,
      bufferMinutes: req.body?.bufferMinutes,
      reminderHours: req.body?.reminderHours,
      calendarBookingMode: req.body?.calendarBookingMode,
    });
    res.json({ ok: true, scheduling: getSchedulingSettings(settings) });
  })
);

app.post(
  "/api/customer/dashboard/staff",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard?.businessId) return res.status(404).json({ error: "Your business scheduling profile is not available." });
    const staffMember = await createStaffMember({ businessId: dashboard.businessId, ...(req.body || {}) });
    res.status(201).json({ ok: true, staffMember });
  })
);

app.delete(
  "/api/customer/dashboard/staff/:id",
  asyncRoute(async (req, res) => {
    const lookupHash = getCustomerDashboardSessionLookupHash(req);
    if (!lookupHash) return res.status(401).json({ error: "Your dashboard session has expired. Sign in again." });
    const dashboard = await getCustomerDashboardByLookupHash(lookupHash);
    if (!dashboard?.businessId) return res.status(404).json({ error: "Your business scheduling profile is not available." });
    const staffMember = await deactivateStaffMember({ businessId: dashboard.businessId, staffMemberId: req.params.id });
    res.json({ ok: true, staffMember });
  })
);

app.post("/api/customer/dashboard", (_req, res) => {
  res.status(426).json({ error: "A one-time code is required. Request a dashboard sign-in code first." });
});

app.post("/api/customer/dashboard/logout", (req, res) => {
  clearCustomerDashboardSessionCookie(res);
  res.status(204).end();
});

app.post(
  "/api/admin/login",
  adminLoginProcessRateLimiter,
  enforcePublicRouteRateLimit("admin-login", ADMIN_LOGIN_IP_MAX_REQUESTS),
  asyncRoute(async (req, res) => {
    const actorHash = getAdminActorHash(req);
    if (!hasValidAdminPassword(req, { allowBody: true })) {
      await recordAdminAuditEvent({ prisma, action: "admin_login", outcome: "denied", actorHash, details: { reason: "invalid_password" } });
      return res.status(401).json({ error: "Invalid admin password." });
    }
    if (ADMIN_TOTP_SECRET && !verifyTotpCode(ADMIN_TOTP_SECRET, req.body?.mfaCode)) {
      await recordAdminAuditEvent({ prisma, action: "admin_login", outcome: "denied", actorHash, details: { reason: req.body?.mfaCode ? "invalid_mfa" : "mfa_required" } });
      return res.status(401).json({
        error: req.body?.mfaCode ? "Invalid authenticator code." : "Authenticator code required.",
        code: "ADMIN_MFA_REQUIRED",
        mfaRequired: true,
      });
    }
    setAdminSessionCookie(res, createAdminSessionToken());
    await recordAdminAuditEvent({ prisma, action: "admin_login", outcome: "success", actorHash, details: { mfaUsed: Boolean(ADMIN_TOTP_SECRET) } });
    res.json({ ok: true, mfaEnabled: Boolean(ADMIN_TOTP_SECRET) });
  })
);

app.get(
  "/api/admin/session",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, mfaEnabled: Boolean(ADMIN_TOTP_SECRET) });
  })
);

app.get(
  "/api/admin/attention",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    const [inbox, auditEvents] = await Promise.all([
      getOperationalAttentionInbox({ prisma, signups: listSignupDashboardRecords() }),
      listAdminAuditEvents({ prisma, limit: 50 }),
    ]);
    res.json({ ok: true, ...inbox, auditEvents });
  })
);

app.post(
  "/api/admin/attention/actions",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const action = String(req.body?.action || "").trim();
    const targetId = String(req.body?.targetId || "").trim();
    const actorHash = getAdminActorHash(req);
    let result;

    try {
      if (action === "retry_owner_text") {
        const handoff = await prisma.leadHandoff.findUnique({ where: { id: targetId }, select: { id: true, status: true } });
        if (!handoff) return res.status(404).json({ error: "Lead notification was not found." });
        if (!["RETRY_DUE", "ESCALATION_DUE", "FAILED"].includes(handoff.status)) {
          return res.status(409).json({ error: "This notification is no longer in a retryable state." });
        }
        result = await dispatchLeadHandoff(handoff.id, "OWNER");
      } else if (action === "sync_calls") {
        result = await syncVapiCalls({ limit: Math.min(100, VAPI_CALL_LIMIT) });
      } else if (action === "recover_signup") {
        result = await recoverSignupByOperationalTarget(targetId);
      } else if (action === "reopen_signup") {
        const signup = listSignupDashboardRecords().find((record) => {
          const identity = String(record.subscriptionId || record.checkoutSessionId || record.ownerEmail || record.businessName || record.signedUpAt || "unknown");
          return hashOperationalTarget(identity) === targetId;
        });
        if (!signup) return res.status(404).json({ error: "Signup record was not found." });
        result = upsertSignupDashboardRecord({
          ...signup,
          previousStatus: signup.status || "unknown",
          status: "manual_review_reopened",
          reviewRequired: true,
          reopenedAt: new Date().toISOString(),
        });
      } else if (action === "resend_signup_verification") {
        const signup = listSignupDashboardRecords().find((record) => {
          const identity = String(record.subscriptionId || record.checkoutSessionId || record.ownerEmail || record.businessName || record.signedUpAt || "unknown");
          return hashOperationalTarget(identity) === targetId;
        });
        if (!signup) return res.status(404).json({ error: "Signup record was not found." });
        const pendingStore = prunePendingSignupStore(readPendingSignupStore());
        const pendingEntry = Object.entries(pendingStore).find(([, record]) => {
          const sameEmail = signup.ownerEmail && String(record?.ownerEmail || "").toLowerCase() === String(signup.ownerEmail).toLowerCase();
          const sameBusiness = signup.businessName && String(record?.businessName || "").toLowerCase() === String(signup.businessName).toLowerCase();
          return sameEmail || sameBusiness;
        });
        if (!pendingEntry?.[1]?.payload) {
          return res.status(409).json({ error: "The verification request expired. Reopen the signup and ask the customer to confirm the form again." });
        }
        delete pendingStore[pendingEntry[0]];
        writePendingSignupStore(pendingStore);
        const pending = pendingEntry[1];
        const token = createPendingSignupVerification({
          payload: pending.payload,
          ownerEmail: pending.ownerEmail,
          businessName: pending.businessName,
          reviewReasons: pending.reviewReasons || [],
          ipHash: pending.ipHash || hashKey(`admin-resend:${targetId}`),
        });
        const email = await sendSignupVerificationEmail({
          req,
          ownerEmail: pending.ownerEmail,
          ownerName: pending.payload?.owner?.name,
          businessName: pending.businessName,
          token,
        });
        result = { sent: Boolean(email.sent), channel: "email" };
        upsertSignupDashboardRecord({
          ...signup,
          status: "pending_email_verification",
          emailVerificationSentAt: new Date().toISOString(),
          verificationResentAt: new Date().toISOString(),
        });
      } else {
        return res.status(400).json({ error: "Choose a supported recovery action." });
      }

      await recordAdminAuditEvent({
        prisma,
        action,
        outcome: "success",
        actorHash,
        targetType: action === "retry_owner_text" ? "lead_handoff" : ["recover_signup", "reopen_signup", "resend_signup_verification"].includes(action) ? "signup" : "calls",
        targetId,
        details: { initiatedFrom: "attention_inbox" },
      });
      const inbox = await getOperationalAttentionInbox({ prisma, signups: listSignupDashboardRecords() });
      res.json({ ok: true, action, result, inbox });
    } catch (error) {
      await recordAdminAuditEvent({ prisma, action, outcome: "failed", actorHash, targetId, details: { code: error?.code || "action_failed" } });
      throw error;
    }
  })
);

app.get(
  "/api/admin/audit-events",
  requireAdmin,
  asyncRoute(async (req, res) => {
    res.json({ ok: true, events: await listAdminAuditEvents({ prisma, limit: req.query.limit || 100 }) });
  })
);

app.get(
  "/api/admin/support-reports",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const requestedStatus = String(req.query.status || "").toUpperCase();
    const where = ["NEW", "INVESTIGATING", "WAITING_FOR_CUSTOMER", "RESOLVED"].includes(requestedStatus)
      ? { status: requestedStatus }
      : {};
    const reports = await prisma.supportReport.findMany({
      where,
      include: {
        business: { select: { id: true, name: true, phone: true } },
        call: { select: { id: true, startedAt: true, status: true, outcome: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    res.json({
      ok: true,
      integrations: {
        githubConfigured: Boolean(GITHUB_SUPPORT_TOKEN && /^[^/\s]+\/[^/\s]+$/.test(GITHUB_SUPPORT_REPO)),
        githubRepo: GITHUB_SUPPORT_REPO,
        telegramConfigured: Boolean(TELEGRAM_BOT_TOKEN && TELEGRAM_CHAT_ID),
        codexMode: "prepare",
      },
      reports: reports.map(sanitizeAdminSupportReport),
    });
  })
);

app.patch(
  "/api/admin/support-reports/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const existing = await prisma.supportReport.findUnique({
      where: { id: String(req.params.id || "") },
      include: { business: { select: { id: true, name: true, phone: true } }, call: { select: { id: true, startedAt: true, status: true, outcome: true } } },
    });
    if (!existing) return res.status(404).json({ error: "Support report not found." });
    const requestedStatus = String(req.body?.status || existing.status).toUpperCase();
    if (!["NEW", "INVESTIGATING", "WAITING_FOR_CUSTOMER", "RESOLVED"].includes(requestedStatus)) {
      return res.status(400).json({ error: "Choose a valid support status." });
    }
    const internalNote = sanitizeSupportDescription(req.body?.internalNote ?? existing.internalNote);
    const customerMessage = sanitizeSupportDescription(req.body?.customerMessage ?? existing.customerMessage);
    let report = await prisma.supportReport.update({
      where: { id: existing.id },
      data: {
        status: requestedStatus,
        internalNote: internalNote || null,
        customerMessage: customerMessage || null,
        resolvedAt: requestedStatus === "RESOLVED" ? (existing.resolvedAt || new Date()) : null,
      },
      include: { business: { select: { id: true, name: true, phone: true } }, call: { select: { id: true, startedAt: true, status: true, outcome: true } } },
    });

    let customerNotification = { sent: false, skipped: true };
    if (requestedStatus === "RESOLVED" && existing.status !== "RESOLVED" && report.contactAllowed) {
      try {
        const contact = await getAppointmentOwnerContact(report.businessId);
        if (contact.ownerPhone) {
          const message = `My AI PA support: ${getSupportTicketNumber(report.id)} has been resolved. ${customerMessage || "Open your dashboard to see the update."}`.slice(0, 1500);
          const sms = await sendSmsViaTwilio({ to: contact.ownerPhone, message });
          customerNotification = { sent: true, skipped: false, mocked: Boolean(sms.mocked) };
          report = await prisma.supportReport.update({
            where: { id: report.id },
            data: { customerNotifiedAt: new Date() },
            include: { business: { select: { id: true, name: true, phone: true } }, call: { select: { id: true, startedAt: true, status: true, outcome: true } } },
          });
        }
      } catch (error) {
        console.error("[support:customer-notification] resolution text failed", { ticketNumber: getSupportTicketNumber(report.id), message: error?.message || String(error) });
        customerNotification = { sent: false, skipped: false, error: "Resolution was saved, but the customer text failed." };
      }
    }
    res.json({ ok: true, report: sanitizeAdminSupportReport(report), customerNotification });
  })
);

app.post(
  "/api/admin/support-reports/:id/github-issue",
  requireAdmin,
  asyncRoute(async (req, res) => {
    let report = await prisma.supportReport.findUnique({
      where: { id: String(req.params.id || "") },
      include: { business: { select: { id: true, name: true, phone: true } }, call: { select: { id: true, startedAt: true, status: true, outcome: true } } },
    });
    if (!report) return res.status(404).json({ error: "Support report not found." });
    if (report.githubIssueUrl) return res.json({ ok: true, unchanged: true, report: sanitizeAdminSupportReport(report) });
    const issue = await createGithubSupportIssue(report);
    report = await prisma.supportReport.update({
      where: { id: report.id },
      data: { githubIssueNumber: issue.number, githubIssueUrl: issue.url, githubIssueCreatedAt: new Date() },
      include: { business: { select: { id: true, name: true, phone: true } }, call: { select: { id: true, startedAt: true, status: true, outcome: true } } },
    });
    res.status(201).json({ ok: true, issue, report: sanitizeAdminSupportReport(report) });
  })
);

app.post(
  "/api/admin/support-reports/:id/codex-task",
  requireAdmin,
  asyncRoute(async (req, res) => {
    let report = await prisma.supportReport.findUnique({
      where: { id: String(req.params.id || "") },
      include: { business: { select: { id: true, name: true, phone: true } }, call: { select: { id: true, startedAt: true, status: true, outcome: true } } },
    });
    if (!report) return res.status(404).json({ error: "Support report not found." });
    const wasPrepared = Boolean(report.codexTaskPrompt);
    if (!wasPrepared) {
      const prompt = buildSupportRepairBrief(report);
      report = await prisma.supportReport.update({
        where: { id: report.id },
        data: {
          codexTaskStatus: "PREPARED",
          codexTaskPrompt: prompt,
          codexTaskPreparedAt: new Date(),
          codexTaskUrl: "https://chatgpt.com/codex",
        },
        include: { business: { select: { id: true, name: true, phone: true } }, call: { select: { id: true, startedAt: true, status: true, outcome: true } } },
      });
    }
    res.status(wasPrepared ? 200 : 201).json({ ok: true, report: sanitizeAdminSupportReport(report), task: { status: report.codexTaskStatus, prompt: report.codexTaskPrompt, url: report.codexTaskUrl } });
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
  "/api/admin/lead-handoffs",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, ...(await getLeadHandoffDashboard()) });
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

app.get(
  "/api/admin/calls/:id",
  requireAdmin,
  asyncRoute(async (req, res) => {
    const id = parsePositiveInt(req.params.id);
    const call = await prisma.call.findUnique({
      where: { id },
      include: { caller: true, business: true, notes: { orderBy: { createdAt: "desc" } }, tasks: { orderBy: { createdAt: "desc" } } },
    });
    if (!call) return res.status(404).json({ error: "Call not found." });
    res.json({ ok: true, call: sanitizeAdminCall(call) });
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
  "/api/admin/trial-usage",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, ...(await getTrialUsageDashboard()) });
  })
);

app.post(
  "/api/admin/trial-usage/reconcile",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, ...(await processTrialUsagePolicies()) });
  })
);

app.get(
  "/api/admin/stripe-trials",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, ...(await getStripeTrialsDashboard()) });
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
  "/api/admin/vapi/inventory",
  requireAdmin,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, inventory: await getVapiAccountInventory() });
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
          backupPhone: null,
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
    const leadAckSlaMinutes = Math.max(1, Math.min(30, Number(body.leadAckSlaMinutes || 2)));
    const averageJobValueCents = Math.max(0, Math.min(1_000_000_000, Number(body.averageJobValueCents || 0)));
    const tradeType = String(body.tradeType || "ELECTRICAL").trim().toUpperCase().slice(0, 80);
    const playbookVersion = String(body.playbookVersion || "electrician-v1").trim().toLowerCase().slice(0, 80);

    const settings = await prisma.settings.upsert({
      where: { businessId },
      update: {
        answerAfterRings,
        afterHoursMode,
        ownerPhone: String(body.ownerPhone || "").trim(),
        backupPhone: body.backupPhone ? String(body.backupPhone).trim() : null,
        bookingLink: body.bookingLink ? String(body.bookingLink).trim() : null,
        leadAckSlaMinutes,
        averageJobValueCents,
        tradeType,
        playbookVersion,
      },
      create: {
        businessId,
        answerAfterRings,
        afterHoursMode,
        ownerPhone: String(body.ownerPhone || "").trim(),
        backupPhone: body.backupPhone ? String(body.backupPhone).trim() : null,
        bookingLink: body.bookingLink ? String(body.bookingLink).trim() : null,
        leadAckSlaMinutes,
        averageJobValueCents,
        tradeType,
        playbookVersion,
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
  const body = { error: message };
  if (String(err.code || "").startsWith("MAKE_SIGNUP_")) {
    body.code = err.code;
  }
  if (Number.isInteger(err.upstreamStatus) && err.upstreamStatus >= 400 && err.upstreamStatus <= 599) {
    body.upstreamStatus = err.upstreamStatus;
  }
  res.status(status).json(body);
});

function startBackgroundJobs() {
  processAppointmentReminders().catch((err) => {
    console.error("[appointment-reminder] initial run failed", err);
  });

  cleanupSensitiveCallData().catch((err) => {
    console.error("[call-data-cleanup] initial run failed", err);
  });

  processTrialReminders().catch((err) => {
    console.error("[stripe:trial-reminder] initial run failed", err);
  });

  processTrialUsagePolicies().catch((err) => {
    console.error("[trial-usage] initial policy run failed", err);
  });

  processDueLeadHandoffs().catch((err) => {
    console.error("[lead-handoff] initial run failed", err);
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

  setInterval(() => {
    processTrialUsagePolicies().catch((err) => {
      console.error("[trial-usage] scheduled policy run failed", err);
    });
  }, TRIAL_USAGE_POLICY_INTERVAL_MS);

  setInterval(() => {
    processDueLeadHandoffs().catch((err) => {
      console.error("[lead-handoff] scheduled run failed", err);
    });
  }, LEAD_HANDOFF_CHECK_INTERVAL_MS);

  setInterval(() => {
    processAppointmentReminders().catch((err) => {
      console.error("[appointment-reminder] scheduled run failed", err);
    });
  }, 5 * 60 * 1000);

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
}

function startServer(port = PORT) {
  startBackgroundJobs();
  return app.listen(port, () => {
    console.log(`My AI PA API listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  startServer,
  __test: {
    deriveCustomerSetupStep,
    getVapiCost,
    getVapiDurationSeconds,
    getVapiRecordingUrl,
    getNextMonthlyAnniversary,
    getWebhookReplayKey,
    claimWebhookReplayStore,
    pruneWebhookReplayStore,
    mapVapiStatus,
    mergeVapiEndOfCallReport,
    summarizeCompositeNotificationHealth,
    createCustomerDashboardLoginCode,
    verifyCustomerDashboardLoginCode,
    maskCustomerDashboardPhone,
    createCustomerDashboardSessionToken,
    getCustomerDashboardSessionLookupHash,
    getCustomerDashboardLookupHash,
    sanitizeCustomerStructuredData,
    sanitizeCustomerCall,
    sanitizeSupportDescription,
    redactSupportTextForAi,
    buildCustomerSupportDiagnostics,
    getRuleBasedSupportAnalysis,
    normalizeSupportAnalysis,
    normalizeSubmittedSupportAnalysis,
    getSupportSuggestionRateLimitDecision,
    getSupportReportRateLimitDecision,
    getClientIp,
    extractOpenAiResponseText,
    getSupportTicketNumber,
    sanitizeCustomerSupportReport,
    getSafeRepairDiagnostics,
    buildSupportRepairBrief,
    buildGithubSupportIssue,
    createGithubSupportIssue,
    sendSupportTelegramAlert,
    getVapiCustomerSafeMessages,
    getVapiArtifactMetrics,
    getVapiRecordingConsent,
    resolveTwilioRestAuth,
    normalizeTwilioMessage,
    getTwilioUsageCostByPrefix,
    normalizeTwilioProvisioningAreaCode,
    normalizeTwilioProvisioningVoiceUrl,
    getPublicSignupNetworkStats,
    setPublicNetworkStatsLoaderForTests,
    purchaseTwilioPhoneNumber,
    getVapiVoiceSignupExecutionBusinessId,
    getVapiVoiceSignupSmsEnvironment,
    findSignupByOperationalTarget,
    getSignupProviderRecoveryDiagnostics,
    getVoiceSignupToolArguments,
    buildRecoveredVoiceSignupPayload,
    findUniqueVapiPhoneForAssistant,
    isSyntheticPausedTestSignupArchiveEligible,
    isStaleSignupArchiveEligible,
    mergeSignupDashboardWithTrialReminders,
  },
};
