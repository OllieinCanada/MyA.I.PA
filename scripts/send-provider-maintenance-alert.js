'use strict';
// One explicitly requested owner alert only. No default send, webhook edits or automatic retry.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fetchProviderStatus,maintenanceMessage,PROVIDERS}=require('../server/providerMaintenance');
const {telegramBotRequest}=require('../server/telegramBotApi');
async function sendOnce({notice,token,chatId,ledger,fetchImpl=fetch}){
 if(!token||!chatId)throw Error('Configured Telegram owner destination is unavailable.');
 const identity=crypto.createHash('sha256').update(JSON.stringify([notice.provider,notice.id,chatId])).digest('hex');
 // A durable local intent precedes the request. Unknown or rejected outcomes never auto-repeat.
 const fd=fs.openSync(ledger,'wx');try{fs.writeFileSync(fd,JSON.stringify({version:1,identity,outcome:'attempt_recorded',provider:notice.provider,event:notice.id}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 try{
  const response=await telegramBotRequest('sendMessage',{chat_id:String(chatId),text:maintenanceMessage(notice),disable_web_page_preview:true},{token,fetchImpl});
  if(!Number.isSafeInteger(response?.result?.message_id)||response.result.message_id<=0)throw Error('Acceptance receipt unavailable');
  fs.writeFileSync(ledger,JSON.stringify({version:1,identity,outcome:'accepted',provider:notice.provider,event:notice.id,messageId:response.result.message_id}));
  return {accepted:true,messageId:response.result.message_id,readByOwnerUnverified:true};
 }catch{throw Error('Telegram acceptance is unconfirmed. Inspect the owner chat and existing attempt ledger before any separately authorized resend.');}
}
async function main(argv=process.argv.slice(2)){
 const args=Object.fromEntries(argv.map(arg=>{const split=arg.indexOf('=');return split<0?[arg,true]:[arg.slice(0,split),arg.slice(split+1)];}));
 if(Object.keys(args).some(k=>!['--provider','--event','--apply','--confirm','--ledger'].includes(k)))throw Error('Unknown argument');
 const provider=args['--provider'],event=args['--event'];if(!Object.hasOwn(PROVIDERS,provider)||!/^[a-zA-Z0-9_-]{1,80}$/.test(event||''))throw Error('An exact supported provider/event is required.');
 const report=await fetchProviderStatus(provider);if(report.outcome!=='observed')throw Error('Official public feed unavailable; no alert sent.');
 const notice=report.notices.find(n=>n.id===event);if(!notice)throw Error('Exact event absent from current official feed; no alert sent.');
 if(!args['--apply']){console.log(JSON.stringify({mode:'dry-run',message:maintenanceMessage(notice),sent:false}));return;}
 if(args['--confirm']!=='SEND_ONE_OWNER_MAINTENANCE_ALERT'||!args['--ledger'])throw Error('Explicit confirmation and exclusive attempt-ledger path required.');
 const ledger=path.resolve(args['--ledger']);const result=await sendOnce({notice,token:process.env.TELEGRAM_BOT_TOKEN,chatId:process.env.TELEGRAM_CHAT_ID,ledger});console.log(JSON.stringify(result));
}
if(require.main===module)main().catch(()=>{console.error('Maintenance alert did not complete. No automatic retry. Check configuration, official feed and the attempt ledger; no secret values are printed.');process.exitCode=1;});
module.exports={sendOnce,main};
