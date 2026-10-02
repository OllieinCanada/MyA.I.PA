const crypto = require('crypto');
const zlib = require('zlib');

const PROVIDERS = {
  twilio: { name: 'TWILIO', icon: '💳', color: [52, 124, 246], url: 'https://console.twilio.com/' },
  make: { name: 'MAKE', icon: '🔗', color: [142, 75, 233], url: 'https://us2.make.com/' },
  vapi: { name: 'VAPI', icon: '🎙️', color: [26, 184, 152], url: 'https://dashboard.vapi.ai/' },
  render: { name: 'RENDER', icon: '☁️', color: [70, 132, 238], url: 'https://dashboard.render.com/' },
  signup: { name: 'SIGNUP', icon: '📞', color: [26, 184, 152], url: 'https://www.myaipa.ca/#/admin' },
  ops: { name: 'MY AI PA', icon: '🔎', color: [52, 124, 246], url: 'https://www.myaipa.ca/#/admin' },
};
const EVENTS = {
  recharge_confirmed: ['info', 'Auto-recharge confirmed', 'Your payment was confirmed.'],
  recharge_failed: ['critical', 'Auto-recharge failed', 'Check your payment method to keep service running.'],
  low_balance: ['warning', 'Balance running low', 'Check your balance and recharge settings.'],
  credits_low: ['warning', 'Credits running low', 'Review usage before your allowance runs out.'],
  usage_warning: ['warning', '30-day credit usage warning', 'Usage over the past 30 days reached your warning level. This is not your exact billing-period balance.'],
  workflow_failed: ['critical', 'Workflow stopped', 'Open the workflow to review the failed step.'],
  scenario_disabled: ['critical', 'Workflow disabled', 'This monitored workflow is not processing requests.'],
  call_failed: ['critical', 'Call failed', 'Open the call logs to review the failure.'],
  setup_failed: ['critical', 'Assistant setup failed', 'Check the saved setup before trying again.'],
  spending_alert: ['warning', 'Spending threshold reached', 'Review recent usage and your spending threshold.'],
  provider_error: ['critical', 'Twilio reported an error', 'Open Twilio Debugger to review the provider error. No automatic retry or billing change was performed.'],
  provider_warning: ['warning', 'Twilio reported a warning', 'Open Twilio Debugger to review the provider warning.'],
  deploy_succeeded: ['info', 'Deployment succeeded', 'The new deployment is live.'],
  deploy_failed: ['critical', 'Deployment failed', 'Open the deployment logs to see what stopped it.'],
  service_down: ['critical', 'Service unreachable', 'Check the service and its recent logs.'],
  service_recovered: ['info', 'Service reachable again', 'The service is responding to health checks again.'],
};
const ALLOWED = {
  twilio: ['recharge_confirmed','recharge_failed','low_balance','spending_alert','provider_error','provider_warning'],
  make: ['credits_low','usage_warning','workflow_failed','scenario_disabled','spending_alert'],
  vapi: ['recharge_confirmed','recharge_failed','low_balance','call_failed','setup_failed','spending_alert'],
  render: ['deploy_succeeded','deploy_failed','service_down','service_recovered','spending_alert'],
};
function validateEvent(event) {
  if (!event || !ALLOWED[event.provider]?.includes(event.type)) throw new TypeError('Unknown provider notification.');
  if (!/^[a-zA-Z0-9_.:-]{1,180}$/.test(String(event.id || ''))) throw new TypeError('A stable provider event ID is required.');
  const timestamp = Date.parse(event.occurredAt);
  if (!Number.isFinite(timestamp) || timestamp > Date.now() + 300000 || timestamp < Date.now() - 7*86400000) throw new TypeError('Notification timestamp is outside the accepted window.');
  if (/^recharge_/.test(event.type) && (!/^[a-zA-Z0-9_.:-]{1,100}$/.test(String(event.paymentId||'')) || event.evidence !== 'provider_receipt')) throw new TypeError('Recharge alerts require a confirmed provider receipt.');
  if (event.amount != null && (!Number.isFinite(Number(event.amount)) || (Number(event.amount) < 0 && event.type !== 'low_balance'))) throw new TypeError('Invalid notification amount.');
  if (event.amount != null && !/^[A-Z]{3}$/.test(String(event.currency || ''))) throw new TypeError('An explicit currency is required.');
  return { provider:event.provider,type:event.type,id:event.id,occurredAt:new Date(timestamp).toISOString(),
    ...(event.amount != null ? {amount:Number(event.amount),currency:event.currency} : {}),
    ...(event.provider === 'twilio' && ['provider_error','provider_warning'].includes(event.type)
      && /^\d{4,6}$/.test(String(event.errorCode || '')) ? {errorCode:String(event.errorCode)} : {}),
    ...(event.paymentId ? {paymentId:String(event.paymentId).slice(0,100),evidence:event.evidence} : {}) };
}
const escape = value => String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
function debuggerExplanation(errorCode) {
  const known = {
    '11200': ['Twilio could not read a website response.', 'A call or text callback may not have completed.', 'Check the failed webhook and server logs.'],
    '11205': ['Twilio could not connect to the website.', 'A call or text callback may not have completed.', 'Check the website address, network, and server health.'],
    '20003': ['Twilio rejected the account credentials.', 'The affected request could not run.', 'Check the account and API credentials.'],
    '21610': ['The recipient opted out of texts.', 'The affected text was blocked.', 'Do not resend unless the recipient opts back in.'],
    '30003': ['The recipient phone was unreachable.', 'This text was not delivered.', 'Confirm the phone is reachable before retrying.'],
    '30005': ['Twilio could not find the destination phone.', 'This text was not delivered.', 'Check the destination number.'],
    '30007': ['A carrier filtered the text.', 'This text was not delivered.', 'Review sender registration and message content before retrying.'],
  };
  const [issue,impact,next] = known[errorCode] || ['Twilio reported a problem; the cause is not confirmed.', 'No customer impact is confirmed yet.', 'Open the Twilio log to identify the affected request.'];
  return `Issue: ${issue}\nImpact: ${impact}\nNext: ${next}${errorCode ? `\nCode: ${errorCode}` : ''}`;
}
function presentation(input) {
  const event=validateEvent(input); const provider=PROVIDERS[event.provider]; const [severity,title,action]=EVENTS[event.type];
  const amount=event.amount == null ? '' : `${new Intl.NumberFormat('en-CA',{style:'currency',currency:event.currency}).format(event.amount)} ${event.currency}`;
  const time=new Date(event.occurredAt).toLocaleString('en-CA',{timeZone:'America/Toronto'});
  const debuggerEvent = ['provider_error','provider_warning'].includes(event.type);
  const summary = debuggerEvent ? debuggerExplanation(event.errorCode) : action;
  const detailsUrl = debuggerEvent ? (event.errorCode ? `https://www.twilio.com/docs/api/errors/${event.errorCode}` : 'https://console.twilio.com/us1/monitor/logs/debugger') : 'https://www.myaipa.ca/#/admin?tab=needs-attention';
  return { event, severity, caption:`${provider.icon} <b>${provider.name} · ${escape(title)}</b>\n${amount ? `<b>${escape(amount)}</b>\n` : ''}\n${escape(summary)}\n\n${escape(time)} (Toronto)`,
    keyboard:{inline_keyboard:[[{text:debuggerEvent?'Open Twilio log':'Open dashboard',url:debuggerEvent?'https://console.twilio.com/us1/monitor/logs/debugger':provider.url},{text:'Open details',url:detailsUrl}]]} };
}

// Small deterministic PNG cards: no browser, hosted image, or image service needed.
const FONT={A:['01110','10001','10001','11111','10001','10001','10001'],E:['11111','10000','10000','11110','10000','10000','11111'],I:['111','010','010','010','010','010','111'],K:['10001','10010','10100','11000','10100','10010','10001'],L:['10000','10000','10000','10000','10000','10000','11111'],M:['10001','11011','10101','10101','10001','10001','10001'],N:['10001','11001','10101','10011','10001','10001','10001'],O:['01110','10001','10001','10001','10001','10001','01110'],P:['11110','10001','10001','11110','10000','10000','10000'],R:['11110','10001','10001','11110','10100','10010','10001'],T:['11111','00100','00100','00100','00100','00100','00100'],V:['10001','10001','10001','10001','10001','01010','00100'],W:['10001','10001','10001','10101','10101','10101','01010'],D:['11110','10001','10001','10001','10001','10001','11110'],F:['11111','10000','10000','11110','10000','10000','10000'],S:['01111','10000','10000','01110','00001','00001','11110'],U:['10001','10001','10001','10001','10001','10001','01110'],' ':['00000','00000','00000','00000','00000','00000','00000']};
Object.assign(FONT, {G:['01110','10001','10000','10111','10001','10001','01110'],H:['10001','10001','10001','11111','10001','10001','10001'],Y:['10001','10001','01010','00100','00100','00100','00100']});
function crc32(bytes) {let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function chunk(name,data){const type=Buffer.from(name),size=Buffer.alloc(4),crc=Buffer.alloc(4);size.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([type,data])));return Buffer.concat([size,type,data,crc]);}
function card(providerKey,severity='info') {
  const provider=PROVIDERS[providerKey];if(!provider)throw new TypeError('Unknown provider.');
  const width=720,height=280,stride=width*3+1,raw=Buffer.alloc(height*stride);
  const accent=severity==='critical'?[244,70,86]:severity==='warning'?[248,177,54]:provider.color;
  function rect(x,y,w,h,color){for(let yy=Math.max(0,y);yy<Math.min(height,y+h);yy++)for(let xx=Math.max(0,x);xx<Math.min(width,x+w);xx++){const n=yy*stride+1+xx*3;raw[n]=color[0];raw[n+1]=color[1];raw[n+2]=color[2];}}
  rect(0,0,width,height,[17,25,43]);rect(0,0,12,height,accent);rect(45,45,112,112,provider.color);
  for(let i=0;i<3;i++)rect(65,70+i*24,70-i*12,10,[255,255,255]);
  function text(value,x,y,scale,color){for(const letter of value){const glyph=FONT[letter]||FONT[' '];glyph.forEach((row,yy)=>[...row].forEach((p,xx)=>{if(p==='1')rect(x+xx*scale,y+yy*scale,scale,scale,color);}));x+=(glyph[0].length+1)*scale;}}
  text(provider.name,190,58,9,[245,248,255]);
  text(severity==='critical'?'NEEDS REVIEW':severity==='warning'?'WARNING':'UPDATE',190,148,4,accent);
  rect(45,219,630,2,[46,57,77]);text('MY AI PA',45,239,3,[153,171,199]);
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
async function sendProviderNotification(input,{token,chatId,fetchImpl=fetch,demo=false}={}) {
  if (!token || !chatId) throw new Error('Telegram provider notifications are not configured.');
  const message=presentation(input); const form=new FormData();
  form.append('chat_id',String(chatId));form.append('caption',(demo?'🧪 DESIGN PREVIEW — not a real incident\n\n':'')+message.caption);form.append('parse_mode','HTML');
  form.append('reply_markup',JSON.stringify(message.keyboard));
  form.append('photo',new Blob([card(message.event.provider,message.severity)],{type:'image/png'}),'provider-alert.png');
  const r=await fetchImpl(`https://api.telegram.org/bot${token}/sendPhoto`,{method:'POST',body:form,signal:AbortSignal.timeout(10000)});
  const body=await r.json().catch(()=>({}));
  if (!r.ok || body.ok!==true || !body.result?.message_id) throw new Error(`Telegram provider card was not confirmed (${r.status}).`);
  return {messageId:body.result.message_id};
}
async function deliverDurably(input,{prisma,token,chatId,fetchImpl=fetch,now=Date.now()}={}) {
  const event=validateEvent(input);const key='provider-notification:'+crypto.createHash('sha256').update(`${event.provider}:${event.id}`).digest('hex');
  const claimed=await prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))::text AS lock_result`;
    const row=await tx.runtimeStore.findUnique({where:{key}});
    if(row?.data?.deliveredAt || Number(row?.data?.leaseUntil)>now)return false;
    const data={event,leaseUntil:now+60000};
    await tx.runtimeStore.upsert({where:{key},create:{key,data},update:{data}});return true;
  });
  if(!claimed)return {duplicate:true};
  try {
    const receipt=await sendProviderNotification(event,{token,chatId,fetchImpl});
    await prisma.runtimeStore.update({where:{key},data:{data:{event,deliveredAt:new Date().toISOString(),messageId:receipt.messageId}}});
    return {delivered:true};
  } catch(error) {
    await prisma.runtimeStore.update({where:{key},data:{data:{event,leaseUntil:0,lastFailure:'telegram_delivery_unconfirmed'}}});
    throw error;
  }
}
module.exports={PROVIDERS,EVENTS,validateEvent,presentation,card,sendProviderNotification,deliverDurably};
