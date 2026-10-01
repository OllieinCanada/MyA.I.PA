const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ETIMEDOUT", "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT"]);

// Retry the entire GET, including consumption of a prematurely closed body.
// Never reuse this helper for provisioning or any other provider mutation.
async function fetchProviderReadText(url, options = {}, {
  fetchImpl = fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (String(options.method || "GET").toUpperCase() !== "GET" || options.body) {
    throw new Error("Provider read retries require a body-free GET.");
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(10000) });
      const text = await response.text();
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
