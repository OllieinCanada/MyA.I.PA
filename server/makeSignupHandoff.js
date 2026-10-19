// A POST is never retried here: its side effects may already have happened.
// Consume the response body inside the same uncertainty boundary as fetch.
async function readMakeSignupHandoff({ url, options, fetchImpl = fetch, onUncertain }) {
  try {
    const response = await fetchImpl(url, options);
    const text = await response.text();
    return { response, text };
  } catch (cause) {
    const code = String(cause?.code || cause?.cause?.code || cause?.name || 'MAKE_RESPONSE_INTERRUPTED');
    try { await onUncertain({ code }); } catch (_) { /* preserve original failure */ }
    const error = new Error('The Make signup response was interrupted.', { cause });
    error.code = ['TimeoutError','AbortError'].includes(cause?.name) ? 'MAKE_SIGNUP_TIMEOUT' : 'MAKE_SIGNUP_UNREACHABLE';
    error.providerCode = code;
    error.provider = 'MAKE'; error.failedStage = 'MAKE_WEBHOOK'; error.statusCode = 502;
    throw error;
  }
}
module.exports = { readMakeSignupHandoff };
