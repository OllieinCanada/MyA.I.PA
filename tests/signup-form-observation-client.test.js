const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const babel = require('@babel/core');
const memory = require('./helpers/form-observation-memory');
const { createObservationService } = require('../server/signupFormObservation');
const filename=path.resolve(__dirname,'../src/features/signup/formObservationClient.js');
const code=babel.transformFileSync(filename,{configFile:false,babelrc:false,plugins:[require.resolve('@babel/plugin-transform-modules-commonjs')]}).code;
const compiled=new Module(filename,module);compiled.filename=filename;compiled.paths=module.paths;compiled._compile(code,filename);
const { observedBusinessFields, observedSignupStep, createFormObservationClient }=compiled.exports;
const details={ownerName:'PRIVATE OWNER NAME',businessName:'PRIVATE BUSINESS NAME',phone:'+19055550199',email:'private@example.test',streetAddress:'87 PRIVATE STREET',city:'Private City',province:'ON',postalCode:'L8P 1A1',otp:'899123',password:'private-password',captchaToken:'private-captcha'};
const validation={errors:{ownerName:'',businessName:'',phone:'',email:'',streetAddress:'',city:'',province:'',postalCode:''}};
function harness(){const store=memory(),service=createObservationService({store,authenticateAttempt:async()=>null});const saved=new Map(),requests=[];const storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 const fetchImpl=async(url,options={})=>{const u=new URL(url);assert.equal(u.origin,'https://api.example.test');requests.push({path:u.pathname,body:options.body||'',headers:options.headers});const body=options.body?JSON.parse(options.body):{};const token=String(options.headers.Authorization||'').slice(12);let data;
  try{if(options.method==='POST'&&u.pathname==='/api/signup/form-observation')data=await service.create();else if(options.method==='PUT')data=await service.observe(u.pathname.split('/').at(-1),token,body);else data=await service.read(u.pathname.split('/').at(-1),token);return{ok:true,status:200,json:async()=>data};}
  catch(e){return{ok:false,status:e.statusCode||503,json:async()=>({code:e.code})};}};
 return{store,service,saved,requests,storage,fetchImpl,client:createFormObservationClient({apiBase:'https://api.example.test',storage,fetchImpl})};}
test('actual browser builder excludes all typed values and opaque security fields',()=>{
 const metadata=observedBusinessFields({details,validation,touched:{businessName:true,streetAddress:true}}), output=JSON.stringify(metadata);
 for(const secret of Object.values(details))assert.ok(!output.includes(secret));assert.equal(metadata.length,8);assert.equal(metadata.find(f=>f.id==='business_name').presence,'present');
 assert.equal(metadata.find(f=>f.id==='owner_name').validation,'not_observed');
});
test('blank observed/touched and untouched differ and corrected fields retain only validation enums',()=>{
 const blank={...details,businessName:'',streetAddress:''},invalid={errors:{...validation.errors,businessName:'Enter name',streetAddress:'Enter address'}};
 let fields=observedBusinessFields({details:blank,validation:invalid,touched:{businessName:true}});
 assert.equal(fields.find(f=>f.id==='business_name').reason,'required_missing');assert.equal(fields.find(f=>f.id==='street_address').reason,'not_observed');
 fields=observedBusinessFields({details,validation,touched:{businessName:true}});assert.equal(fields.find(f=>f.id==='business_name').validation,'valid');
 assert.equal(observedSignupStep(1,3,'trade'),'business_details');assert.equal(observedSignupStep(1,2,'trade'),'service_areas');
});
test('no interaction means no create/write; session storage contains only the capability cursor',async()=>{
 const h=harness(),snapshot={currentStep:'business_details',attemptedAdvance:false,fields:observedBusinessFields({details,validation,touched:{businessName:true}})};
 await h.client.observe(snapshot,false);assert.equal(h.requests.length,0);await h.client.observe(snapshot,true);await h.client.settled();assert.equal(h.requests.length,2);
 for(const request of h.requests)for(const secret of Object.values(details))assert.ok(!request.body.includes(secret));
 const pointer=JSON.parse([...h.saved.values()][0]);assert.deepEqual(Object.keys(pointer).sort(),['expiresAt','id','revision','sequence','token'].sort());
 assert.doesNotMatch(JSON.stringify([...h.saved.values()]),/PRIVATE|private@|899123|fields|business_name/);
});
test('refresh/resume reuses exact capability and server revision but never restores typed form data',async()=>{
 const h=harness(),snapshot={currentStep:'business_details',attemptedAdvance:false,fields:observedBusinessFields({details,validation,touched:{businessName:true}})};
 await h.client.observe(snapshot,true);const first=JSON.parse([...h.saved.values()][0]);
 const resumed=createFormObservationClient({apiBase:'https://api.example.test',storage:h.storage,fetchImpl:h.fetchImpl});await resumed.observe({...snapshot,currentStep:'service_areas',fields:[]},true);
 const last=JSON.parse([...h.saved.values()][0]);assert.equal(last.id,first.id);assert.equal(last.expiresAt,first.expiresAt);assert.equal(last.revision,first.revision+1);assert.equal(h.store.rows.size,1);
});
test('a lost capability never borrows another identity, and stale writes are not automatically replayed',async()=>{
 const h=harness(),snapshot={currentStep:'business_details',attemptedAdvance:false,fields:observedBusinessFields({details,validation,touched:{businessName:true}})};
 await h.client.observe(snapshot,true);const pointer=JSON.parse([...h.saved.values()][0]);
 await h.service.observe(pointer.id,pointer.token,{schemaVersion:1,sequence:pointer.sequence+1,expectedRevision:pointer.revision,...snapshot,currentStep:'service_areas',fields:[]});
 await h.client.observe({...snapshot,attemptedAdvance:true},true);await h.client.settled();
 assert.equal((await h.service.read(pointer.id,pointer.token)).revision,2,'Old client did not overwrite a newer observation');
 h.storage.setItem('myaipa_signup_observation_v1',JSON.stringify({...pointer,token:'x'.repeat(43)}));
 const lost=createFormObservationClient({apiBase:'https://api.example.test',storage:h.storage,fetchImpl:h.fetchImpl});await lost.observe(snapshot,true);assert.equal(h.store.rows.size,1);assert.equal(h.saved.size,0);
});
test('reset during an in-flight create cannot attach the old capability to a new signup',async()=>{
 const h=harness();let release,started;const entered=new Promise(r=>{started=r;}),gate=new Promise(r=>{release=r;});let held=true;
 const client=createFormObservationClient({apiBase:'https://api.example.test',storage:h.storage,fetchImpl:async(...args)=>{const response=await h.fetchImpl(...args);if(held&&args[0].endsWith('/form-observation')){held=false;started();await gate;}return response;}});
 const snapshot={currentStep:'business_details',attemptedAdvance:false,fields:observedBusinessFields({details,validation,touched:{businessName:true}})};
 const first=client.observe(snapshot,true);await entered;client.reset();client.observe({...snapshot,attemptedAdvance:true},true);release();await first;await client.settled();
 const rows=(await h.service.listAdmin()).rows;assert.equal(rows.length,1);assert.equal(h.store.rows.size,2);assert.equal(rows[0].revision,1);
 const created=h.requests.filter(r=>r.path==='/api/signup/form-observation');assert.equal(created.length,2);assert.equal(h.requests.filter(r=>r.path===('/api/signup/form-observation/'+rows[0].id)).length,1);
});
