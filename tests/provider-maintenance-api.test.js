'use strict';
const {test,before,after}=require('node:test'),assert=require('node:assert/strict'),express=require('express');
const {registerProviderStatusRoutes}=require('../server/providerMaintenance');
let reads=0,fail=false,server,base;const transport=global.fetch;
before(async()=>{
 const prisma={runtimeStore:{findMany:async()=>{reads++;if(fail)throw Error('private database connection');return [];},findUnique:async()=>null}};
 const app=express();registerProviderStatusRoutes({app,prisma,requireAdmin:(req,res,next)=>req.headers['x-synthetic-admin']==='yes'?next():res.sendStatus(401)});
 server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base='http://127.0.0.1:'+server.address().port;
 global.fetch=(url,options)=>{assert.equal(new URL(url).origin,base,'Only synthetic loopback traffic');return transport(url,options);};
});
after(async()=>{global.fetch=transport;if(server)await new Promise(resolve=>server.close(resolve));});
const headers={'x-synthetic-admin':'yes'};
test('actual provider-status read handler refuses anonymous access before database queries',async()=>{const before=reads;assert.equal((await fetch(base+'/api/admin/provider-status')).status,401);assert.equal(reads,before);});
test('empty saved inventory is unknown, not healthy; GET has no provider calls and exposes no write endpoints',async()=>{
 const r=await fetch(base+'/api/admin/provider-status',{headers}),body=await r.json();assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(body.readOnly,true);assert.equal(body.ready,false);assert.equal(body.providers.length,4);assert.ok(body.providers.every(p=>!p.fresh&&p.indicator==='unknown'));assert.equal(body.history.length,0);
 for(const method of ['POST','DELETE','PATCH'])assert.equal((await fetch(base+'/api/admin/provider-status',{method,headers})).status,404);
});
test('invalid cursor and database failures are visible errors, never a successful all-clear',async()=>{
 assert.equal((await fetch(base+'/api/admin/provider-status?cursor=invalid',{headers})).status,400);
 fail=true;try{const r=await fetch(base+'/api/admin/provider-status',{headers}),body=await r.json();assert.equal(r.status,503);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(body.providers,undefined);assert.doesNotMatch(JSON.stringify(body),/private database/);}finally{fail=false;}
});
