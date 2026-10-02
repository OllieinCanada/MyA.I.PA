const { card } = require('./providerNotifications');

// One visual envelope for operational notices, including older queued messages.
// Keep full evidence in the incident/outbox, not in the phone-sized caption.
function compactNotice(value) {
  const lines = String(value || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const limit = (line, size) => line.length <= size ? line
    : /^Next:/.test(line) ? 'Next: Open details before retrying or changing live resources.'
      : `${line.slice(0, size - 1).trimEnd()}…`;
  if (/NO LONGER DETECTED|SERVICE HEALTHY AGAIN/.test(lines[0] || '') && lines.some(line => /^What Codex\/My AI PA did:/.test(line))) {
    const cleared = /NO LONGER DETECTED/.test(lines[0]);
    return [lines[0].slice(0, 150), cleared
      ? `Alert disappeared. Repair is not confirmed.${lines.some(line => /^What Codex\/My AI PA did:.*did not replay/i.test(line)) ? ' Customer work was not retried.' : ''}`
      : 'Service responds again. The original customer request is not confirmed complete.',
    limit(lines.find(line => /^Your next step:/.test(line))?.replace(/^Your next step:/, 'Next:') || 'Next: Open details.', 180),
    (lines.find(line => /^Reference:/.test(line)) || '').slice(0, 100)].filter(Boolean).join('\n');
  }
  const seen = new Set();
  const unique = lines.filter(line => {
    const content = line.replace(/^[^:]+:\s*/, '').toLowerCase();
    if (seen.has(content)) return false;
    seen.add(content); return true;
  });
  const selected = unique.map(line => line
    .replace(/^What stopped:/, 'Cause:').replace(/^Who it affects:/, 'Business:')
    .replace(/^What is safe:/, 'Impact:').replace(/^What happens next:|^Your next step:/, 'Next:')
    .replace(/^What Codex\/My AI PA did:/, 'Done:').replace(/^How it was checked:/, 'Check:'))
    .filter(line => !/^Technical evidence:|^Status: No immediate action needed$/.test(line));
  const result = selected.map(line => limit(line, /^Next:/.test(line) ? 180 : 160)).join('\n');
  if (result.length <= 950) return result;
  // Never clip the action or reference off the bottom of an old queued brief.
  const action = selected.find(line => /^Next:/.test(line));
  const reference = selected.find(line => /^Reference:/.test(line));
  const essential = selected.filter((line, index) => index === 0 || /^(Issue|Cause|Business|Impact|Summary):/.test(line)).slice(0, 5);
  return [...essential, action, reference].filter(Boolean).map(line => limit(line, 120)).join('\n');
}

function noticeStyle(text) {
  const header = String(text || '').split('\n')[0];
  const provider = /\bTWILIO\b/i.test(header) ? 'twilio'
    : /\bVAPI\b/i.test(header) ? 'vapi' : /\bMAKE\b/i.test(header) ? 'make'
      : /\bRENDER\b/i.test(header) ? 'render' : /SIGNUP/i.test(header) ? 'signup' : 'ops';
  const severity = /🔴|CRITICAL|\bHIGH\b/i.test(header) ? 'critical'
    : /✅|VERIFIED FIXED|SERVICE HEALTHY|NO LONGER DETECTED/i.test(header) ? 'info' : 'warning';
  return { provider, severity };
}

function noticeRequest(text, { chatId, replyMarkup, provider, severity } = {}) {
  const style = noticeStyle(text);
  const form = new FormData();
  form.append('chat_id', String(chatId));
  form.append('caption', compactNotice(text));
  form.append('photo', new Blob([card(provider || style.provider, severity || style.severity)], { type: 'image/png' }), 'my-ai-pa-alert.png');
  if (replyMarkup) form.append('reply_markup', JSON.stringify(replyMarkup));
  return { method: 'POST', body: form, signal: AbortSignal.timeout(7_000) };
}

module.exports = { compactNotice, noticeStyle, noticeRequest };
