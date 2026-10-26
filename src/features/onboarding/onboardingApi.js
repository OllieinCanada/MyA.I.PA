import { getApiBaseUrl, normalizeApiBase } from "../../config/apiBase";

export const ONBOARDING_API_BASE = normalizeApiBase(getApiBaseUrl(process.env.REACT_APP_API_BASE_URL));

export async function onboardingRequest(path, token, options = {}) {
  const response = await fetch(`${ONBOARDING_API_BASE}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Forwarding ${token}` } : {}),
      ...(options.headers || {}),
    },
    cache: "no-store",
  });
  let data = {};
  try { data = typeof response.json === "function" ? await response.json() : JSON.parse(await response.text()); } catch (_) { /* Report a safe error, not raw response text. */ }
  if (!response.ok) {
    const error = new Error(data.error || "Your saved setup could not be opened. Please try again or call support.");
    error.status = response.status;
    error.code = data.code || "";
    throw error;
  }
  return data;
}

export function tokenFromSetupUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.href);
    const hash = url.hash.replace(/^#\/?/, "");
    const shortMatch = hash.match(/^f\/([^/?#]+)/i);
    if (shortMatch) return decodeURIComponent(shortMatch[1]);
    return new URLSearchParams(hash.split("?")[1] || url.search).get("token") || "";
  } catch (_) { return ""; }
}

export function readWizardLocation() {
  try {
    const query = String(window.location.hash || "").split("?")[1] || window.location.search;
    const params = new URLSearchParams(query);
    const candidate = Number(params.get("step"));
    return { step: [1, 2, 3].includes(candidate) ? candidate : 1, edit: params.get("edit") === "1" };
  } catch (_) { return { step: 1, edit: false }; }
}

export function updateWizardLocation(step, edit = false) {
  try {
    const [route, query = ""] = String(window.location.hash || "").split("?");
    if (!/^#\/?(?:f\/|forwarding-setup|signup)/i.test(route)) return;
    const params = new URLSearchParams(query);
    if (step === 1) params.delete("step"); else params.set("step", String(step));
    if (edit) params.set("edit", "1"); else params.delete("edit");
    const suffix = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${route}${suffix ? `?${suffix}` : ""}`);
  } catch (_) { /* In-memory navigation still works if URL updates are blocked. */ }
}

export function canonicalPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith("1") ? `+${digits}` : "";
}

export function displayPhone(value) {
  const phone = canonicalPhone(value);
  return phone ? `+1 (${phone.slice(2, 5)}) ${phone.slice(5, 8)}-${phone.slice(8)}` : "";
}

export async function copySetupText(value) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(value);
  } catch (_) {
    const input = document.createElement("textarea");
    input.value = value;
    input.setAttribute("readonly", "");
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.appendChild(input);
    try {
      input.select();
      if (typeof document.execCommand !== "function" || document.execCommand("copy") === false) throw new Error("Copy is blocked. Select the displayed number or code and copy it manually.");
    } finally { input.remove(); }
  }
}
