// Browser QA may exercise UI, never a live application/provider workflow.
const { redactIncidentText } = require('../server/incidentAlerts');
function decision(rawUrl, method, localOrigin) {
  const url = new URL(rawUrl), read = ['GET', 'HEAD'].includes(method);
  if ((url.origin === localOrigin || url.origin === 'https://api.myaipa.ca') && url.pathname === '/api/client-errors'
    && ['POST', 'OPTIONS'].includes(method)) return 'client_error_fixture';
  if ((url.origin === localOrigin || url.origin === 'https://api.myaipa.ca')
    && /^\/api\/signup\/form-observation(?:\/|$)/.test(url.pathname)
    && ['GET', 'POST', 'PUT', 'OPTIONS'].includes(method)) return 'observation_fixture';
  if (url.pathname.startsWith('/api/') || url.hostname === 'api.myaipa.ca') return read || method === 'OPTIONS' ? 'offline_api' : 'reject_write';
  if (!read) return 'reject_write';
  if (url.origin === localOrigin) return 'local_static';
  if (['fonts.googleapis.com', 'fonts.gstatic.com'].includes(url.hostname) && url.protocol === 'https:') return 'readonly_asset';
  if (['www.myaipa.ca', 'myaipa.ca'].includes(url.hostname) && url.protocol === 'https:'
    && /\.(?:css|woff2?|ttf|otf|png|jpe?g|webp|svg|wav|mp3|m4a|ogg)$/i.test(url.pathname)) return 'readonly_asset';
  return 'offline_external';
}
async function installNetworkIsolation(context, baseUrl, evidence, { expectedResourceFailure = false } = {}) {
  const localOrigin = new URL(baseUrl).origin;
  let revision = 0, sequence = 0;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), action = decision(request.url(), request.method(), localOrigin);
    evidence[action] = (evidence[action] || 0) + 1;
    if (['local_static', 'readonly_asset'].includes(action)) return route.continue();
    const headers = { 'access-control-allow-origin': request.headers().origin || '*',
      'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
      'access-control-allow-headers': 'content-type,x-myaipa-form-observation,authorization' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (action === 'client_error_fixture') {
      const body = request.postDataJSON();
      (evidence.clientErrors ||= []).push({ type: String(body.type || '').slice(0, 40),
        message: redactIncidentText(body.message || '', { maxLength: 180 }),
        expectedNegativeTest: expectedResourceFailure && body.type === 'resource_error' });
      return route.fulfill({ status: 202, headers, contentType: 'application/json', body: '{"ok":true,"accepted":false,"offlineFixture":true}' });
    }
    if (action === 'observation_fixture') {
      if (request.method() === 'PUT') { const body = request.postDataJSON(); revision = body.expectedRevision + 1; sequence = body.sequence; }
      return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({
        id: 'fd_11111111-1111-4111-8111-111111111111', token: 'f'.repeat(43), revision, sequence,
        expiresAt: Date.now() + 86400000, offlineFixture: true }) });
    }
    if (action === 'reject_write') {
      evidence.unexpectedWrites.push({ method: request.method(), host: url.hostname, path: url.pathname });
      return route.fulfill({ status: 403, headers, contentType: 'application/json', body: '{"offline":true,"error":"UI_QA_WRITE_BLOCKED"}' });
    }
    if (action === 'offline_api') return route.fulfill({ status: 200, headers, contentType: 'application/json', body: '{"offline":true,"configured":false}' });
    return route.fulfill({ status: 200, headers, contentType: request.resourceType() === 'stylesheet' ? 'text/css' : 'application/javascript', body: '' });
  });
  // Service workers are already disabled by each test context. Also prevent a
  // future preview feature from opening a live provider socket during UI QA.
  await context.routeWebSocket('**/*', socket => { evidence.blockedSockets++; socket.close(); });
}
async function installSlowImageDelay(context, delayMs = 1200) {
  await context.route('**/trade-heroes/**', async route => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    // Playwright runs the most recently registered handler first. Continue
    // would bypass the earlier method/origin policy; fallback must reach it.
    await route.fallback();
  });
}
module.exports = { decision, installNetworkIsolation, installSlowImageDelay };
