const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createObservationService, registerObservationRoutes, observationBodyGuard } = require('../server/signupFormObservation');
const memory = require('./helpers/form-observation-memory');
const store = memory(), service = createObservationService({ store, authenticateAttempt: async () => null });
let server, base, access, leakedErrors = 0;
before(async () => {
  const app = express(), pass = (_req,_res,next) => next();
  app.use('/api/signup/form-observation', observationBodyGuard({ jsonParser: express.json({ limit: '8kb' }), isAllowedOrigin: o => o === 'https://www.myaipa.test',
    createLimiter: rateLimit({ windowMs:60000, limit:4, standardHeaders:true, legacyHeaders:false }), updateLimiter:rateLimit({windowMs:60000,limit:50,standardHeaders:true,legacyHeaders:false}) }));
  app.use(express.json());
  registerObservationRoutes({ app, service, isAllowedOrigin:o=>o==='https://www.myaipa.test', createLimiter:pass, updateLimiter:pass,
    requireAdmin:(req,res,next)=>req.headers['x-test-admin']==='yes'?next():res.status(401).json({error:'unauthorized'}) });
  app.use((err,_req,res,_next)=>{ leakedErrors++;res.status(500).json({error:'Unexpected generic handler'}); });
  server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
const headers=extra=>({'Content-Type':'application/json',Origin:'https://www.myaipa.test','X-MyAIPA-Form-Observation':'1',...extra});
const snapshot={schemaVersion:1,sequence:1,expectedRevision:0,currentStep:'business_details',attemptedAdvance:false,fields:[{id:'street_address',presence:'blank',visible:'visible',required:true,interacted:true,validation:'invalid',reason:'required_missing'}]};
test('malformed, oversize or query-bearing bodies are sanitized before the general logger',async()=>{
  for(const body of ['{"raw":"PRIVATE_BODY_FRAGMENT"',JSON.stringify({raw:'x'.repeat(9000)})]){
    const r=await fetch(base+'/api/signup/form-observation/missing',{method:'PUT',headers:headers(),body});assert.ok([400,413].includes(r.status));assert.doesNotMatch(await r.text(),/PRIVATE_BODY_FRAGMENT|Unexpected|raw/);
  }
  const query=await fetch(base+'/api/signup/form-observation/missing?businessName=PRIVATE_URL',{headers:headers()});assert.equal(query.status,400);assert.equal(leakedErrors,0);
});
test('trusted origin and explicit header are required before any draft is created',async()=>{
  for(const extra of [{Origin:'https://evil.test'},{'X-MyAIPA-Form-Observation':''}]){const r=await fetch(base+'/api/signup/form-observation',{method:'POST',headers:headers(extra),body:'{"schemaVersion":1}'});assert.equal(r.status,403);}
  assert.equal(store.rows.size,0);
});
test('creation returns an opaque capability, reads/updates require it and admin list is authenticated',async()=>{
  const r=await fetch(base+'/api/signup/form-observation',{method:'POST',headers:headers(),body:'{"schemaVersion":1}'});assert.equal(r.status,200);access=await r.json();assert.match(access.id,/^fd_/);
  assert.equal((await fetch(base+'/api/signup/form-observation/'+access.id)).status,401);
  const update=await fetch(base+'/api/signup/form-observation/'+access.id,{method:'PUT',headers:headers({Authorization:'SignupDraft '+access.token}),body:JSON.stringify(snapshot)});assert.equal(update.status,200);
  assert.equal((await fetch(base+'/api/admin/signup-form-observations')).status,401);
  const admin=await fetch(base+'/api/admin/signup-form-observations',{headers:{'x-test-admin':'yes'}}), report=await admin.json();
  assert.equal(admin.status,200);assert.equal(admin.headers.get('cache-control'),'no-store');assert.equal(report.rows[0].blockerLabels[0],'Street address: Required field is blank');
  assert.doesNotMatch(JSON.stringify(report),new RegExp(access.token));assert.doesNotMatch(JSON.stringify(report),/tokenHash|userAgent|ipAddress|PRIVATE/);
});
test('the standard process limiter bounds anonymous creation without evicting existing drafts',async()=>{
  await fetch(base+'/api/signup/form-observation',{method:'POST',headers:headers(),body:'{"schemaVersion":1}'});
  const limited=await fetch(base+'/api/signup/form-observation',{method:'POST',headers:headers(),body:'{"schemaVersion":1}'});assert.equal(limited.status,429);
  assert.ok(store.rows.size<=2);assert.equal((await service.read(access.id,access.token)).revision,1);
});
