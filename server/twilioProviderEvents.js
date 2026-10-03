const crypto = require('crypto');
const {verifyTwilioWebhookRequest} = require('./smsSuppression');
const {deliverDurably,validateEvent,enqueueProviderNotification} = require('./providerNotifications');
const PATH = '/api/webhooks/twilio/provider-alerts';
function toEvent(body, accountSid) {
  if (!accountSid || body.AccountSid !== accountSid) throw new Error('Account mismatch');
  let id, type, occurredAt;
  if (body.UsageTriggerSid) {
    if (!/^UT[0-9a-f]{32}$/i.test(body.UsageTriggerSid) || !body.IdempotencyToken || String(body.IdempotencyToken).length > 512 || body.TriggerBy !== 'price' || body.UsageCategory !== 'totalprice') throw new Error('Invalid usage event');
    id = 'usage:' + crypto.createHash('sha256').update(String(body.IdempotencyToken)).digest('hex');
    type = 'spending_alert'; occurredAt = body.DateFired;
  } else {
    if (!/^NO[0-9a-f]{32}$/i.test(body.Sid) || !['ERROR','WARNING'].includes(String(body.Level).toUpperCase())) throw new Error('Invalid debugger event');
    id = 'debug:' + body.Sid; occurredAt = body.Timestamp;
    type = String(body.Level).toUpperCase() === 'ERROR' ? 'provider_error' : 'provider_warning';
  }
  // Do not store the raw Payload: it can contain phone numbers and credentials.
  // Currency is not supplied in usage callbacks, so never guess a currency.
  let errorCode;
  if (type === 'provider_error' || type === 'provider_warning') {
    // Extract only the documented numeric code. Never persist or forward the
    // provider's message, webhook body, URL, phone numbers, or credentials.
    try {
      const payload = JSON.parse(String(body.Payload || '{}'));
      if (/^\d{4,6}$/.test(String(payload?.error_code || ''))) errorCode = String(payload.error_code);
    } catch (_) { /* Missing evidence stays explicitly unknown. */ }
  }
  return validateEvent({provider:'twilio',type,id,occurredAt,errorCode});
}
function registerTwilioProviderEvents(app,{prisma,env=process.env,deliver=deliverDurably,enqueue=enqueueProviderNotification}={}) {
  app.post(PATH, require('express').urlencoded({extended:false,limit:'32kb'}), async(req,res)=>{
    const configuredUrl = 'https://api.myaipa.ca' + PATH;
    if (!req.is('application/x-www-form-urlencoded') || !verifyTwilioWebhookRequest(req,env,{configuredUrl})) return res.status(403).json({error:'Invalid Twilio signature.'});
    let event;
    try {event=toEvent(req.body,env.TWILIO_ACCOUNT_SID);} catch {return res.status(400).json({error:'Invalid Twilio event.'});}
    try {
      // Acknowledge only after the redacted event is safely stored. Telegram
      // latency must not keep Twilio's callback open or lose the notification.
      const result=await enqueue(event,{prisma});
      if(result?.accepted!==true)return res.sendStatus(503);
      res.sendStatus(204);
      if(!result.delivered) {
        // Best-effort immediate delivery. A process restart or delivery failure
        // leaves durable work for the existing authenticated backup poll.
        Promise.resolve().then(()=>deliver(event,{prisma,token:env.TELEGRAM_BOT_TOKEN,chatId:env.TELEGRAM_CHAT_ID})).catch(()=>{});
      }
      return;
    }catch {return res.sendStatus(503);}
  });
}
module.exports={PATH,toEvent,registerTwilioProviderEvents};
