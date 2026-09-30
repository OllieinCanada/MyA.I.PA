const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {parseReceipt,relayReceipt,synthetic}=require('../scripts/twilio-receipt-relay');
test('only recent authenticated single-payment emails are accepted',()=>{
 assert.equal(parseReceipt(synthetic()).automatic,false);
 for(const change of [{from:'billing@twilio.com.attacker.example'},{authenticationResults:'mx.google.com; dmarc=fail header.from=twilio.com'},{subject:'Monthly invoice receipt'},{receivedAtMs:1},{bodyText:'Payment successful\nPayment ID: TEST-1234\nAmount: $20.00'}])assert.throws(()=>parseReceipt({...synthetic(),...change}));
 assert.equal(parseReceipt({...synthetic(),bodyText:synthetic().bodyText+' Auto-recharge completed'}).automatic,true);
});
test('duplicate payments send once; failed delivery remains retryable',async()=>{
 const stateDir=fs.mkdtempSync(path.join(os.tmpdir(),'myaipa-receipt-test-'));let sends=0;
 const options={stateDir,env:{TELEGRAM_BOT_TOKEN:'test',TELEGRAM_CHAT_ID:'1'},fetchImpl:async()=>{sends++;return {ok:true,json:async()=>({ok:true,result:{message_id:42}})};}};
 assert.equal((await relayReceipt(synthetic(),options)).delivered,true);
 assert.equal((await relayReceipt(synthetic(),options)).duplicate,true);assert.equal(sends,1);
 const other={...synthetic(),bodyText:synthetic().bodyText.replace('1234','9999')};
 await assert.rejects(relayReceipt(other,{...options,fetchImpl:async()=>({ok:false,json:async()=>({ok:false})})}));
 assert.equal((await relayReceipt(other,options)).delivered,true);
});
