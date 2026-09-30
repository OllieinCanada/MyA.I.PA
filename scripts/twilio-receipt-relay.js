const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {loadProjectEnv,rootPath}=require('./_helpers');
const {card}=require('../server/providerNotifications');
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
function parseReceipt(input,{now=Date.now()}={}){
 if(!/^[a-f0-9]{8,64}$/i.test(input?.gmailMessageId||''))throw new Error('Missing Gmail message identity');
 const from=String(input.from||'');
 if(!/@(?:[a-z0-9-]+\.)*twilio\.com(?:>|\s|$)/i.test(from))throw new Error('Not a Twilio sender');
 // Use Gmail's topmost mx.google.com Authentication-Results, not an email body claim.
 const auth=String(input.authenticationResults||'');
 if(!/^mx\.google\.com\s*;/i.test(auth)||!/(?:^|[;\s])dmarc=pass\b/i.test(auth)||!/header\.from=(?:[a-z0-9-]+\.)*twilio\.com(?:[;\s]|$)/i.test(auth))throw new Error('Gmail did not authenticate the Twilio sender');
 const time=Number(input.receivedAtMs);
 if(!Number.isFinite(time)||time<now-7*86400000||time>now+300000)throw new Error('Receipt is not recent');
 const subject=String(input.subject||''),body=String(input.bodyText||'');
 if(body.length>100000)throw new Error('Receipt is too large');
 if(/monthly|invoice|statement|summary/i.test(subject))throw new Error('Monthly documents are not individual payment confirmations');
 if(!/payment (?:received|successful|confirmed)|(?:recharge|payment) (?:was |has been )?(?:successfully )?(?:completed|processed)|thank you for your payment/i.test(subject+'\n'+body))throw new Error('No clear successful payment confirmation');
 const ids=[...body.matchAll(/(?:payment|transaction|receipt)\s*(?:id|number|#)\s*[:#]?\s*([a-z0-9][a-z0-9_.:-]{3,99})/gi)].map(x=>x[1]);
 if(new Set(ids).size!==1)throw new Error('Payment identity is missing or ambiguous');
 const amounts=[...body.matchAll(/(?:amount(?: paid| charged)?|payment amount|recharge amount)\s*:\s*(USD|CAD)\s*\$?([0-9]+(?:\.[0-9]{2})?)/gi)].map(x=>({currency:x[1].toUpperCase(),amount:Number(x[2])}));
 if(amounts.length!==1||!(amounts[0].amount>0))throw new Error('Payment amount/currency is missing or ambiguous');
 return {key:digest('twilio:'+ids[0]),automatic:/auto[- ]?recharge|automatic recharge/i.test(subject+'\n'+body),...amounts[0]};
}
async function relayReceipt(input,{env=loadProjectEnv(),fetchImpl=fetch,stateDir=rootPath('diagnostics','provider-notifications','receipt-deliveries'),demo=false}={}){
 const receipt=parseReceipt(input);
 if(!env.TELEGRAM_BOT_TOKEN||!env.TELEGRAM_CHAT_ID)throw new Error('Telegram credentials are missing');
 fs.mkdirSync(stateDir,{recursive:true});
 const marker=path.join(stateDir,receipt.key+'.json'),lock=path.join(stateDir,receipt.key+'.lock');
 if(!demo&&fs.existsSync(marker))return {duplicate:true};
 let handle;
 try{handle=fs.openSync(lock,'wx');}catch(e){if(e.code==='EEXIST')throw new Error('Receipt delivery is already running or its lock needs review');throw e;}
 try{
  if(!demo&&fs.existsSync(marker))return {duplicate:true};
  const form=new FormData();form.append('chat_id',env.TELEGRAM_CHAT_ID);
  form.append('photo',new Blob([card('twilio')],{type:'image/png'}),'twilio-payment.png');
  form.append('caption',`${demo?'🧪 RELAY TEST — fictional payment; no money charged\n\n':''}💳 TWILIO · ${receipt.automatic?'Auto-recharge':'Payment'} confirmation email\n${receipt.amount.toFixed(2)} ${receipt.currency}\n\nGmail authenticated the Twilio sender. This confirms receipt of its email—not an independent bank verification.`);
  form.append('reply_markup',JSON.stringify({inline_keyboard:[[{text:'Open Twilio',url:'https://console.twilio.com/'},{text:'Open Gmail',url:'https://mail.google.com/'}]]}));
  const r=await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendPhoto`,{method:'POST',body:form,signal:AbortSignal.timeout(10000)});
  const b=await r.json();if(!r.ok||b.ok!==true||!b.result?.message_id)throw new Error('Telegram receipt delivery was not confirmed');
  if(!demo)fs.writeFileSync(marker,JSON.stringify({deliveredAt:new Date().toISOString(),telegramMessageId:b.result.message_id}),{flag:'wx'});
  return {delivered:true,demo};
 }finally{fs.closeSync(handle);fs.unlinkSync(lock);}
}
const synthetic=()=>({gmailMessageId:'abcdef0123456789',from:'billing@twilio.com',authenticationResults:'mx.google.com; dmarc=pass header.from=twilio.com',receivedAtMs:Date.now(),subject:'Payment successful',bodyText:'Thank you for your payment. Payment ID: TEST-ONLY-1234\nAmount: USD 20.00'});
if(require.main===module){
 const demo=process.argv.includes('--demo'),inputPath=process.argv.find(x=>x.startsWith('--input='))?.slice(8);
 const input=demo?synthetic():inputPath?JSON.parse(fs.readFileSync(inputPath,'utf8')):null;
 relayReceipt(input,{demo}).then(r=>console.log(JSON.stringify(r))).catch(e=>{console.error(e.message);process.exitCode=1;});
}
module.exports={parseReceipt,relayReceipt,synthetic};
