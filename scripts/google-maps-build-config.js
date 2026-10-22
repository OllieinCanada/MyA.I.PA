const { execFileSync } = require('node:child_process');

function resolveGoogleMapsBrowserKey({ env = process.env, readRepositoryVariable = () => execFileSync(
  'gh', ['variable', 'get', 'GOOGLE_MAPS_BROWSER_KEY', '--repo', 'OllieinCanada/MyA.I.PA'],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 15000 }
) } = {}) {
  let key = String(env.REACT_APP_GOOGLE_MAPS_API_KEY || '').trim();
  if (!key && !env.CI) {
    try { key = String(readRepositoryVariable() || '').trim(); } catch (_) { /* Report a safe, actionable error below. */ }
  }
  if (!/^AIza[A-Za-z0-9_-]{35}$/.test(key)) {
    throw new Error('Production address suggestions require REACT_APP_GOOGLE_MAPS_API_KEY. Supply the public browser key or sign in to GitHub CLI to read GOOGLE_MAPS_BROWSER_KEY. Build stopped before replacing docs/.');
  }
  return key;
}

module.exports = { resolveGoogleMapsBrowserKey };
