export const PRODUCTION_API_BASE_URL = "https://myaipa-api.onrender.com";
export const LOCAL_API_BASE_URL = "http://localhost:8787";

export function normalizeApiBase(value) {
  return String(value || "").replace(/\/+$/, "");
}

export function isLocalBrowser() {
  if (typeof window === "undefined") return false;
  return /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(window.location.hostname);
}

export function getDefaultApiBaseUrl() {
  return isLocalBrowser() ? LOCAL_API_BASE_URL : PRODUCTION_API_BASE_URL;
}

export function isMakeWebhookUrl(url) {
  return /^https:\/\/hook\.[^/]+\.make\.com\//.test(String(url || ""));
}
