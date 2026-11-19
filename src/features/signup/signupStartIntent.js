// A short-lived UI intent, not identity, consent, verification or signup proof.
const KEY = 'myaipa_signup_start_intent_v1';
let memoryAt = null;
function browserStorage() { try { return window.sessionStorage; } catch { return null; } }
export function noteSignupStart(storage = browserStorage(), now = Date.now()) {
  memoryAt = now;
  try { storage?.setItem(KEY, JSON.stringify({ version: 1, at: now })); } catch { /* Same-tab memory fallback only. */ }
}
export function consumeSignupStart(storage = browserStorage(), now = Date.now()) {
  let at = memoryAt; memoryAt = null;
  try {
    const saved = JSON.parse(storage?.getItem(KEY) || 'null'); storage?.removeItem(KEY);
    if (saved?.version === 1 && Object.keys(saved).sort().join(',') === 'at,version') at = saved.at;
  } catch { /* A malformed capability is not identity or authority. */ }
  return Number.isSafeInteger(at) && at <= now && now - at <= 120000;
}
export function navigateToSignup() { noteSignupStart(); window.location.hash = '/signup'; }
export function installSignupStartLinks(doc = document) {
  const clicked = event => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target?.closest?.('a[href]'); if (!link || link.hasAttribute('download') || link.target === '_blank') return;
    try {
      const url = new URL(link.href, window.location.href);
      if (url.origin === window.location.origin && /^#\/?signup(?:[?]|$)/i.test(url.hash)) noteSignupStart();
    } catch { /* Never follow or report arbitrary links. */ }
  };
  doc.addEventListener('click', clicked);
  return () => doc.removeEventListener('click', clicked);
}
