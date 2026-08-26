import { getApiBaseUrl, normalizeApiBase } from "./config/apiBase";

const API_BASE = normalizeApiBase(getApiBaseUrl(process.env.REACT_APP_API_BASE_URL));
const seenErrors = new Set();
let installed = false;

export function getSafeClientRoute(locationValue = typeof window !== "undefined" ? window.location : {}) {
  const hashRoute = String(locationValue?.hash || "")
    .replace(/^#\/?/, "")
    .split(/[?#]/, 1)[0];
  const raw = hashRoute ? `/${hashRoute}` : String(locationValue?.pathname || "/").split(/[?#]/, 1)[0];
  return raw.replace(/[^a-z0-9_\-./]+/gi, "").slice(0, 120) || "/";
}

export function redactClientErrorMessage(value) {
  return String(value || "Browser code stopped unexpectedly.")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email hidden]")
    .replace(/(?:\+?1[\s.()-]*)?(?:\d[\s.()-]*){10}/g, "[phone hidden]")
    .replace(/\b(?:token|secret|password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=[hidden]")
    .replace(/https?:\/\/[^\s?#]+[^\s]*/gi, (url) => String(url).split(/[?#]/, 1)[0])
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

export function buildClientErrorReport({ type, message, component, locationValue, release } = {}) {
  return {
    type: String(type || "browser_error").replace(/[^a-z0-9_-]+/gi, "_").slice(0, 40),
    message: redactClientErrorMessage(message),
    route: getSafeClientRoute(locationValue),
    component: String(component || "").replace(/[^a-z0-9 _.-]+/gi, "").slice(0, 80),
    release: String(release || process.env.REACT_APP_RELEASE_SHA || "").replace(/[^a-z0-9_.-]+/gi, "").slice(0, 40),
  };
}

export async function reportClientError(input, { fetchImpl = fetch, force = false } = {}) {
  if (!force && process.env.NODE_ENV !== "production") return { sent: false, skipped: true };
  const payload = buildClientErrorReport({ ...input, locationValue: input?.locationValue || window.location });
  const key = `${payload.type}:${payload.route}:${payload.message}`;
  if (seenErrors.has(key)) return { sent: false, skipped: true, reason: "duplicate" };
  seenErrors.add(key);
  try {
    const response = await fetchImpl(`${API_BASE}/api/client-errors`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    });
    if (!response.ok) seenErrors.delete(key);
    return { sent: response.ok, skipped: false };
  } catch (_error) {
    seenErrors.delete(key);
    return { sent: false, skipped: false };
  }
}

export function installClientErrorReporting() {
  if (installed || typeof window === "undefined" || process.env.NODE_ENV !== "production") return;
  installed = true;
  window.addEventListener("error", (event) => {
    const resourceTag = event?.target && event.target !== window
      ? String(event.target.tagName || "resource").toLowerCase()
      : "";
    void reportClientError({
      type: resourceTag ? "resource_error" : "uncaught_error",
      message: resourceTag
        ? `${resourceTag} resource failed to load`
        : event?.error?.message || event?.message || "Uncaught browser error",
      component: resourceTag,
    });
  }, true);
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    void reportClientError({
      type: "unhandled_rejection",
      message: reason?.message || (typeof reason === "string" ? reason : "Unhandled browser promise rejection"),
    });
  });
}

export function resetClientErrorReporterForTests() {
  seenErrors.clear();
  installed = false;
}
