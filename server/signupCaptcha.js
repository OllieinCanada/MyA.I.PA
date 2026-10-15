const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const PRODUCTION_HOSTNAMES = ["myaipa.ca", "www.myaipa.ca", "ollieincanada.github.io"];
const GOOGLE_TEST_SECRET = "6LeIxAcTAAAAAGG-vFI1TnRWxMZNFuojJ4WifJWe";

function configuredCaptchaProvider(env = process.env) {
  // This is server configuration, never a value supplied by the browser.
  return String(env.CAPTCHA_PROVIDER || "turnstile").trim().toLowerCase();
}

async function verifyProviderCaptcha(security = {}, ip, { env = process.env, fetchImpl = fetch } = {}) {
  const provider = configuredCaptchaProvider(env);
  if (!["turnstile", "recaptcha"].includes(provider)) return { ok: false, reason: "captcha_provider_not_configured" };
  const secret = String(provider === "turnstile"
    ? env.TURNSTILE_SECRET_KEY || ""
    : env.RECAPTCHA_SECRET_KEY || env.GOOGLE_RECAPTCHA_SECRET_KEY || "").trim();
  if (!secret) return { ok: false, skipped: false, reason: "captcha_not_configured" };
  const production = env.NODE_ENV === "production" || Boolean(env.RENDER);
  if (production && (secret === GOOGLE_TEST_SECRET || /^[123]x0+[A-Z]{2}$/.test(secret))) {
    return { ok: false, reason: "captcha_test_secret_forbidden" };
  }
  const claimed = typeof security?.captchaProvider === "string" ? security.captchaProvider.trim().toLowerCase() : "";
  if (claimed && claimed !== provider) return { ok: false, reason: "captcha_provider_mismatch" };
  const specific = provider === "turnstile" ? security?.turnstileToken : security?.recaptchaToken;
  const generic = security?.captchaToken;
  if (specific && generic && specific !== generic) return { ok: false, reason: "captcha_token_mismatch" };
  const token = specific || generic;
  if (typeof token !== "string" || !token.trim()) return { ok: false, reason: "missing_captcha" };
  if (token.length > 2048) return { ok: false, reason: "invalid_captcha" };
  const body = new URLSearchParams({ secret, response: token.trim() });
  if (ip && ip !== "unknown") body.set("remoteip", ip);
  try {
    const result = await fetchImpl(provider === "turnstile" ? TURNSTILE_VERIFY_URL : RECAPTCHA_VERIFY_URL, {
      method: "POST", body, signal: AbortSignal.timeout(10000),
    });
    if (!result.ok) return { ok: false, reason: "captcha_unreachable" };
    const data = await result.json();
    if (data?.success !== true) {
      // Keep provider error codes, never credentials, submitted tokens, or exception messages.
      const codes = Array.isArray(data?.["error-codes"]) ? data["error-codes"].filter((x) => typeof x === "string" && /^[a-z-]{1,64}$/.test(x)) : [];
      return { ok: false, reason: codes.join(",") || "captcha_failed" };
    }
    // This integration requires a checkbox key. Do not accept a v3 score token
    // without evaluating its score/action as though it proved a checkbox was solved.
    if (provider === "recaptcha" && (data.score !== undefined || data.action !== undefined)) {
      return { ok: false, reason: "captcha_key_type_mismatch" };
    }
    const configuredHosts = String(env.CAPTCHA_ALLOWED_HOSTNAMES || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const hosts = configuredHosts.length ? configuredHosts : production ? PRODUCTION_HOSTNAMES : [];
    if (hosts.length && !hosts.includes(String(data.hostname || "").toLowerCase())) {
      return { ok: false, reason: "captcha_hostname_mismatch" };
    }
    return { ok: true, skipped: false };
  } catch (_error) {
    return { ok: false, reason: "captcha_unreachable" };
  }
}

async function verifySignupCaptcha(security = {}, ip, options = {}) {
  const env = options.env || process.env;
  if (configuredCaptchaProvider(env) !== "turnstile+recaptcha") return verifyProviderCaptcha(security, ip, options);
  const claimed = typeof security?.captchaProvider === "string" ? security.captchaProvider.trim().toLowerCase() : "";
  if (claimed && claimed !== "turnstile+recaptcha") return { ok: false, reason: "captcha_provider_mismatch" };
  // Require separate proofs and both configured secrets before consuming either single-use token.
  const secrets = [env.TURNSTILE_SECRET_KEY, env.RECAPTCHA_SECRET_KEY || env.GOOGLE_RECAPTCHA_SECRET_KEY].map((x) => String(x || "").trim());
  if (secrets.some((x) => !x)) return { ok: false, skipped: false, reason: "captcha_not_configured" };
  if ((env.NODE_ENV === "production" || Boolean(env.RENDER)) && secrets.some((x) => x === GOOGLE_TEST_SECRET || /^[123]x0+[A-Z]{2}$/.test(x))) {
    return { ok: false, reason: "captcha_test_secret_forbidden" };
  }
  const proofs = [security?.turnstileToken, security?.recaptchaToken];
  if (proofs.some((x) => typeof x !== "string" || !x.trim())) return { ok: false, reason: "missing_captcha" };
  if (proofs.some((x) => x.length > 2048) || proofs[0] === proofs[1]) return { ok: false, reason: "invalid_captcha" };
  if (security?.captchaToken && security.captchaToken !== proofs[0]) return { ok: false, reason: "captcha_token_mismatch" };
  for (const provider of ["turnstile", "recaptcha"]) {
    const result = await verifyProviderCaptcha({
      captchaProvider: provider,
      ...(provider === "turnstile" ? { turnstileToken: proofs[0] } : { recaptchaToken: proofs[1] }),
    }, ip, { ...options, env: { ...env, CAPTCHA_PROVIDER: provider } });
    if (!result.ok) return result;
  }
  return { ok: true, skipped: false };
}

module.exports = { configuredCaptchaProvider, verifySignupCaptcha };
