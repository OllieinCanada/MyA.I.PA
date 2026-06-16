require("dotenv").config();

const crypto = require("crypto");
const cors = require("cors");
const express = require("express");
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
const assistantRateLimit = new Map();
const signupIpRateLimit = new Map();
const signupIdentityRateLimit = new Map();
const signupDuplicateSubmissions = new Map();
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

app.use(
  cors({
    origin(origin, callback) {
      callback(null, origin || true);
    },
    credentials: true,
  })
);
app.use(express.json({ limit: "15mb" }));

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function parsePositiveInt(value, fallback) {
  if (value == null || value === "") return fallback;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
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
  const cookie = [
    `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
  ];
  if (process.env.NODE_ENV === "production") {
    cookie.push("Secure");
  }
  res.setHeader("Set-Cookie", cookie.join("; "));
}

function clearAdminSessionCookie(res) {
  const cookie = [
    `${ADMIN_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (process.env.NODE_ENV === "production") {
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

  if (isEnabled(process.env.SIGNUP_REQUIRE_VERIFICATION)) {
    reviewReasons.push("verification_required");
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

    if (securityDecision.reviewRequired) {
      console.warn("[signup:security] held signup for review", {
        reviewReasons: securityDecision.reviewReasons,
        ipHash: hashKey(securityDecision.ip),
        emailHash: hashKey(ownerEmail),
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
      return res.status(502).json({ error: makeData?.error || "Make webhook did not complete the signup." });
    }

    res.json({
      success: true,
      ok: true,
      businessName,
      twilioPhoneNumber: getMakeTwilioPhoneNumber(makeData) || getMakeTwilioPhoneNumberFromText(makeResult.body),
      makeStatus: makeResult.status,
    });
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
    const calls = await prisma.call.findMany({
      where,
      include: { caller: true, business: true },
      orderBy: { startedAt: "desc" },
      take: 200,
    });
    res.json({ ok: true, calls: calls.map(sanitizeAdminCall) });
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

setInterval(() => {
  cleanupSensitiveCallData().catch((err) => {
    console.error("[call-data-cleanup] scheduled run failed", err);
  });
}, SENSITIVE_CALL_CLEANUP_INTERVAL_MS);

app.listen(PORT, () => {
  console.log(`My AI PA API listening on http://localhost:${PORT}`);
});
