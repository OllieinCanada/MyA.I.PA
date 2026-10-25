const fs = require('node:fs');
const path = require('node:path');
const { rootPath } = require('./_helpers');
const { readRenderCredentials } = require('./run-with-render-env');

async function verifyRelease({ commit, token, fetchImpl = fetch, renderCredentials }) {
  if (!/^[a-f0-9]{40}$/i.test(String(commit || '')) || !token) {
    throw new Error('An exact deployed commit and operations credential are required.');
  }
  async function get(url, headers = {}) {
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
    return { status: response.status, body: await response.json() };
  }
  const [security, ready, render] = await Promise.all([
    get('https://api.myaipa.ca/api/internal/operations/security-readiness', { 'x-monitor-api-key': token }),
    get('https://api.myaipa.ca/api/health/ready'),
    get('https://api.render.com/v1/services/srv-d92503a8qa3s73crdpog', {
      Authorization: `Bearer ${renderCredentials.key}`,
    }),
  ]);
  const buildCommand = (render.body.service || render.body)?.serviceDetails?.envSpecificDetails?.buildCommand;
  const checks = {
    ready: ready.status === 200 && ready.body.ok === true,
    releaseMatches: ready.body.releaseCommit === commit && security.body.releaseCommit === commit,
    securityReady: security.status === 200 && security.body.ok === true,
    parserPatched: security.body.versions?.bodyParser === '1.20.9',
    mailerPatched: security.body.versions?.nodemailer === '10.1.4',
    compressionRejected: security.body.requestCompression === 'rejected-before-body-parsing',
    lockedInstall: render.status === 200 && buildCommand === 'npm ci --include=dev --legacy-peer-deps && npm run backend:prepare',
  };
  return { checkedAt: new Date().toISOString(), commit, checks, ok: Object.values(checks).every(Boolean) };
}

async function main() {
  const commit = process.argv.find(arg => arg.startsWith('--commit='))?.slice(9);
  const report = await verifyRelease({ commit, token: process.env.MONITOR_API_KEY, renderCredentials: readRenderCredentials() });
  const reportPath = rootPath('diagnostics', 'shipping-readiness', 'backend-security-release.json');
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
if (require.main === module) main().catch(() => {
  console.error('Security release could not be verified; no production settings were changed.'); process.exitCode = 1;
});
module.exports = { verifyRelease };
