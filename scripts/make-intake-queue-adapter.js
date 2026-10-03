// Equivalent Make API surface to the MCP queue tools. No bulk deletion API is
// exposed. Authoritative running-execution inspection must be supplied by the
// connected operations surface; its absence blocks writes, not read-only use.
function createMakeIntakeQueueAdapter({ baseUrl, token, readRunningExecutions, fetchImpl = fetch }) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || !["us1.make.com", "us2.make.com", "eu1.make.com", "eu2.make.com"].includes(base.hostname) || base.pathname !== "/api/v2" || base.search || base.hash || base.username || base.password || !token) throw new Error("MAKE_QUEUE_CONFIG_INVALID");
  const id = (value) => { if (!/^[a-zA-Z0-9_-]+$/.test(String(value))) throw new Error("MAKE_QUEUE_ID_INVALID"); return encodeURIComponent(value); };
  async function request(path, options = {}) {
    const response = await fetchImpl(`${base.origin}/api/v2${path}`, { ...options, redirect: "error", signal: AbortSignal.timeout(15000), headers: { Authorization: `Token ${token}`, Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}) } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`MAKE_QUEUE_HTTP_${response.status}`);
    return response.json();
  }
  return {
    async state(target) {
      const value = await request(`/scenarios/${id(target.scenarioId)}`);
      const scenario = value?.scenario;
      const count = typeof readRunningExecutions === "function" ? await readRunningExecutions(target) : null;
      return { hookId: scenario?.hookId, scenarioId: scenario?.id, active: scenario?.isActive, runningExecutions: Number.isInteger(count) && count >= 0 ? count : null };
    },
    async item(target, itemId) {
      const value = await request(`/hooks/${id(target.hookId)}/incomings/${id(itemId)}`);
      if (value === null) return null;
      if (!value.incoming || value.incoming.id !== itemId || !value.incoming.data || typeof value.incoming.data !== "object") throw new Error("MAKE_QUEUE_ITEM_UNRECOGNIZED");
      // This endpoint returns only waiting queue items; Make disallows deleting
      // items already being processed. State is rechecked by the guard.
      return { id: value.incoming.id, payload: value.incoming.data, processing: false };
    },
    async deleteOne(target, itemId) {
      const value = await request(`/hooks/${id(target.hookId)}/incomings?confirmed=true`, { method: "DELETE", body: JSON.stringify({ ids: [String(itemId)] }) });
      if (!value || value.error || value.incomings?.length !== 1 || value.incomings[0] !== itemId) throw new Error("MAKE_QUEUE_DELETE_UNCONFIRMED");
      return { deleted: itemId };
    },
  };
}
module.exports = { createMakeIntakeQueueAdapter };
