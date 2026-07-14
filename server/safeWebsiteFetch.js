const dns = require("node:dns").promises;
const net = require("node:net");

function createBlockedUrlError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function isBlockedIpv4(address) {
  const parts = String(address || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

function isBlockedIp(address) {
  const value = String(address || "").trim().toLowerCase();
  const family = net.isIP(value);
  if (family === 4) return isBlockedIpv4(value);
  if (family !== 6) return true;

  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    if (net.isIP(mapped) === 4) return isBlockedIpv4(mapped);
  }

  return (
    value === "::" ||
    value === "::1" ||
    value.startsWith("fc") ||
    value.startsWith("fd") ||
    /^fe[89ab]/.test(value) ||
    value.startsWith("ff") ||
    value.startsWith("2001:db8:")
  );
}

async function assertPublicWebsiteUrl(value, { lookup = dns.lookup } = {}) {
  let parsed;
  try {
    parsed = new URL(String(value || ""));
  } catch (_error) {
    throw createBlockedUrlError("Website URL is invalid.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw createBlockedUrlError("Website URL must use HTTP or HTTPS.");
  }
  if (parsed.username || parsed.password) {
    throw createBlockedUrlError("Website URL cannot include credentials.");
  }
  if (parsed.port && !["80", "443"].includes(parsed.port)) {
    throw createBlockedUrlError("Website URL uses a blocked port.");
  }

  const hostname = parsed.hostname.replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw createBlockedUrlError("Website URL points to a blocked host.");
  }

  const literalFamily = net.isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await lookup(hostname, { all: true, verbatim: true });

  if (!Array.isArray(addresses) || !addresses.length || addresses.some((entry) => isBlockedIp(entry.address))) {
    throw createBlockedUrlError("Website URL resolves to a private or reserved network.");
  }

  return parsed;
}

async function fetchPublicWebsite(value, options = {}, dependencies = {}) {
  const fetchImpl = dependencies.fetchImpl || global.fetch;
  const lookup = dependencies.lookup || dns.lookup;
  const maxRedirects = Number.isInteger(dependencies.maxRedirects) ? dependencies.maxRedirects : 3;
  if (typeof fetchImpl !== "function") throw new Error("Website fetch transport is unavailable.");

  let currentUrl = await assertPublicWebsiteUrl(value, { lookup });
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchImpl(currentUrl.toString(), { ...options, redirect: "manual" });
    if (response.status < 300 || response.status >= 400) return response;

    const location = response.headers?.get?.("location");
    if (!location) throw createBlockedUrlError("Website redirect is missing a destination.");
    if (redirectCount === maxRedirects) throw createBlockedUrlError("Website redirected too many times.");
    currentUrl = await assertPublicWebsiteUrl(new URL(location, currentUrl).toString(), { lookup });
  }

  throw createBlockedUrlError("Website could not be fetched safely.");
}

module.exports = {
  assertPublicWebsiteUrl,
  fetchPublicWebsite,
  isBlockedIp,
};
