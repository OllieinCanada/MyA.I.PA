const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);
const TRANSIENT_READ_STATUSES = new Set([500, 502, 503, 504]);

function readRetryDelay(response, attempt, now) {
  const value = response.headers?.get?.('retry-after');
  if (value) {
    const parsed = /^\d+$/.test(value.trim()) ? Number(value.trim()) * 1000 : Date.parse(value) - now();
    if (Number.isFinite(parsed)) {
      // A long provider cooldown belongs to the next scheduled job, not a
      // sleeping request or an early retry that ignores the provider's limit.
      if (parsed > 5000) return null;
      return Math.max(250 * (attempt + 1), parsed);
    }
  }
  return 250 * (attempt + 1);
}

// Retry the entire GET, including consumption of a prematurely closed body.
// Never reuse this helper for provisioning or any other provider mutation.
async function fetchProviderReadText(url, options = {}, {
  fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = Date.now,
} = {}) {
  if (String(options.method || "GET").toUpperCase() !== "GET" || options.body) {
    throw new Error("Provider read retries require a body-free GET.");
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(10000) });
      const text = await response.text();
      if (TRANSIENT_READ_STATUSES.has(response.status) && attempt < 2) {
        const delay = readRetryDelay(response, attempt, now);
        if (delay !== null) {
          await sleep(delay);
          continue;
        }
      }
      return { response, text };
    } catch (error) {
      const code = error?.code || error?.cause?.code;
      const transient = NETWORK_CODES.has(code) || ["TimeoutError", "AbortError"].includes(error?.name);
      if (!transient || attempt === 2) throw error;
      await sleep(250 * (attempt + 1));
    }
  }
}
module.exports = { fetchProviderReadText };
