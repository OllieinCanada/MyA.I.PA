'use strict';
// Local diagnostic adapter only. Its Map/queue models the storage contract;
// this is not a durable database or evidence of real PostgreSQL crash safety.
const {claimNotificationDispatch,completeNotificationDispatch}=require('../server/smsNotificationDispatch');
function createDispatchStub(){
 const rows=new Map();let tail=Promise.resolve();
 const store={findUnique:async({where})=>rows.has(where.key)?structuredClone(rows.get(where.key)):null,
  create:async({data})=>{if(rows.has(data.key))throw Error('duplicate key');rows.set(data.key,structuredClone(data));return data;},
  update:async({where,data})=>{if(!rows.has(where.key))throw Error('missing key');const next={...rows.get(where.key),...structuredClone(data)};rows.set(where.key,next);return next;}};
 const db={runtimeStore:store,$queryRaw:async()=>[],
  $transaction:async fn=>{const previous=tail;let release;tail=new Promise(r=>{release=r;});await previous;const before=structuredClone([...rows]);try{return await fn(db);}catch(e){rows.clear();for(const [k,v]of before)rows.set(k,v);throw e;}finally{release();}}};
 const wrap=delegate=>async(url,options)=>{let payload;try{payload=JSON.parse(String(options?.body||''));}catch{}if(payload&&['claim','complete'].includes(payload.action)){
   try{const data=await(payload.action==='claim'?claimNotificationDispatch:completeNotificationDispatch)({prisma:db,input:payload});return{ok:true,status:200,json:async()=>data};}
   catch(e){return{ok:false,status:e.statusCode||503,json:async()=>({schemaVersion:1,errorCode:e.code||'stub_store_failed'})};}
  }return delegate(url,options);};
 return{db,rows,wrap};
}
module.exports={createDispatchStub};
