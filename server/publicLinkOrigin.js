'use strict';
const { isBlockedIp } = require('./safeWebsiteFetch');
const net = require('node:net');
const invalid = () => Object.assign(new Error('A trusted public HTTPS application URL must be configured.'), { statusCode: 503, code: 'PUBLIC_LINK_ORIGIN_UNCONFIGURED' });

function configuredBase(value, production) {
  const text = String(value || '').trim();
  if (!text || /[<>"'\r\n]/.test(text)) throw invalid();
  let url;
  try { url = new URL(text); } catch { throw invalid(); }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || production && (url.protocol !== 'https:' || host === 'localhost' || host.endsWith('.localhost')
      || host.endsWith('.local') || host.endsWith('.internal') || net.isIP(host) && isBlockedIp(host))) throw invalid();
  return url.toString().replace(/\/+$/, '');
}

function publicLinkBase(req, env = process.env) {
  const production = String(env.NODE_ENV || '').toLowerCase() === 'production';
  const configured = env.PUBLIC_APP_URL || env.APP_URL;
  if (configured) return configuredBase(configured, production);
  // Never derive credential-bearing links from Host/X-Forwarded-Host/Origin.
  // A missing production configuration fails closed instead of trusting input.
  if (production) throw invalid();
  const port = Number(req?.socket?.localPort || env.PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid();
  return `http://127.0.0.1:${port}`;
}

function verificationLinkBase(req, env = process.env) {
  return env.SIGNUP_VERIFICATION_BASE_URL
    ? configuredBase(env.SIGNUP_VERIFICATION_BASE_URL, String(env.NODE_ENV || '').toLowerCase() === 'production')
    : publicLinkBase(req, env);
}
module.exports = { publicLinkBase, verificationLinkBase, configuredBase };
