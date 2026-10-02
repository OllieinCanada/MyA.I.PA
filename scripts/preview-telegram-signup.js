const fs = require('fs');
const path = require('path');
const { card, presentation, sendProviderNotification } = require('../server/providerNotifications');
const { buildSignupTelegramAlert, sendSignupTelegramAlert } = require('../server/signupAlerts');

// Design fixtures only: never create signup, billing, or provider resources.
const out = path.resolve(__dirname, '../diagnostics/provider-notifications');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'signup-preview.png'), card('signup', 'info'));
const fixture = { state: 'provisioning_ready',
  businessName: 'Example Electrical', eventKey: 'signup_1234567890abcdef1234567890abcdef',
  adminUrl: 'https://www.myaipa.ca/#/admin',
  record: { businessType: 'Electrical', serviceArea: 'Niagara Falls', smsVerified: true,
    twilioPhoneNumber: '+12895550123', vapiAssistantId: 'design-fixture' } };
const signup = buildSignupTelegramAlert(fixture);
const warning = presentation({ provider: 'twilio', type: 'provider_warning',
  id: 'preview:warning', occurredAt: new Date().toISOString(), errorCode: '11200' });
fs.writeFileSync(path.join(out, 'twilio-warning-preview.png'), card('twilio', 'warning'));
fs.writeFileSync(path.join(out, 'compact-alert-preview.json'), JSON.stringify({
  previewOnly: true, signup, warning: warning.caption,
}, null, 2));
console.log(JSON.stringify({ previewOnly: true, outputDirectory: out, signupCaptionLength: signup.length }));
if (process.argv.includes('--send-demo')) {
  (async () => {
    const options = { token: process.env.TELEGRAM_BOT_TOKEN, chatId: process.env.TELEGRAM_CHAT_ID };
    if (!options.token || !options.chatId) throw new Error('Telegram preview credentials unavailable');
    const sent = await sendSignupTelegramAlert(fixture, { ...options, fetchImpl: async (url, request) => {
      request.body.set('caption', '🧪 DESIGN PREVIEW — no real signup\n\n' + request.body.get('caption'));
      return fetch(url, request);
    } });
    await sendProviderNotification(warning.event, { ...options, demo: true });
    console.log(JSON.stringify({ designPreviewsSent: sent.sent ? 2 : 0 }));
  })().catch(error => { console.error(error.message); process.exitCode = 1; });
}
