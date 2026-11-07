'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {rateLimit}=require('express-rate-limit');
const {dispatchHandler}=require('../server/smsNotificationDispatch');
const source=fs.readFileSync(path.resolve(__dirname,'../server/index.js'),'utf8');

function actualLimiter(){
 const start=source.indexOf('const smsNotificationDispatchProcessRateLimiter = rateLimit({');
 assert.ok(start>=0);const end=source.indexOf('\n});',start)+4;assert.ok(end>start);
 const build=new Function('rateLimit','PUBLIC_ROUTE_WINDOW_MS',source.slice(start,end)+'; return smsNotificationDispatchProcessRateLimiter;');
 return build(options=>{assert.equal(options.limit,240);assert.equal(options.standardHeaders,true);
   return rateLimit({...options,limit:2});},60000);
}
test('actual process limiter returns 429 before a third authorization/store attempt',async()=>{
 const limiter=actualLimiter();let authAttempts=0,storeAccess=0;
 const handler=dispatchHandler({env:{SMS_NOTIFICATION_DISPATCH_ENABLED:'true'},authenticate:()=>{authAttempts++;return false;},
   prisma:{get runtimeStore(){storeAccess++;throw Error('unauthorized storage access');}}});
 async function request(){return new Promise((resolve,reject)=>{
   const req={ip:'192.0.2.55',headers:{},socket:{remoteAddress:'192.0.2.55'},app:{get:()=>false},method:'POST',body:{action:'claim'}};
   const res={statusCode:200,headersSent:false,writableEnded:false,headers:{},setHeader(k,v){this.headers[k]=v;},
     status(n){this.statusCode=n;return this;},json(body){this.body=body;resolve(this);return this;},send(body){this.body=body;resolve(this);return this;}};
   Promise.resolve(limiter(req,res,error=>{if(error)return reject(error);Promise.resolve(handler(req,res)).catch(reject);})).catch(reject);
 });}
 assert.equal((await request()).statusCode,401);assert.equal((await request()).statusCode,401);
 const blocked=await request();assert.equal(blocked.statusCode,429);assert.ok(blocked.headers['Retry-After']);
 assert.equal(authAttempts,2);assert.equal(storeAccess,0);
});
test('production route runs both process and distributed limits before authentication',()=>{
 const start=source.indexOf("app.post('/api/integrations/sms/dispatch',"),route=source.slice(start,source.indexOf('\n);',start));
 const local=route.indexOf('smsNotificationDispatchProcessRateLimiter'),shared=route.indexOf("enforcePublicRouteRateLimit('sms-notification-dispatch', 120)"),auth=route.indexOf('notificationDispatchHandler');
 assert.ok(local>0&&local<shared&&shared<auth);assert.match(source,/SMS_NOTIFICATION_DISPATCH_ENABLED|notificationDispatchHandler/);
});
