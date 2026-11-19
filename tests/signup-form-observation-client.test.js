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
const { observedBusinessFields, observedSignupStep, observedFormSnapshot, createFormObservationClient }=compiled.exports;
const details={ownerName:'PRIVATE OWNER NAME',businessName:'PRIVATE BUSINESS NAME',phone:'+19055550199',email:'private@example.test',streetAddress:'87 PRIVATE STREET',city:'Private City',province:'ON',postalCode:'L8P 1A1',otp:'899123',password:'private-password',captchaToken:'private-captcha'};
const validation={errors:{ownerName:'',businessName:'',phone:'',email:'',streetAddress:'',city:'',province:'',postalCode:''}};
function harness({now=()=>Date.now(),authenticateAttempt=async()=>null}={}){const store=memory(),service=createObservationService({store,authenticateAttempt,now});const saved=new Map(),requests=[];const storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
 const fetchImpl=async(url,options={})=>{const u=new URL(url);assert.equal(u.origin,'https://api.example.test');requests.push({path:u.pathname,body:options.body||'',headers:options.headers});const body=options.body?JSON.parse(options.body):{};const token=String(options.headers.Authorization||'').slice(12);let data;
  try{if(options.method==='POST'&&u.pathname==='/api/signup/form-observation')data=await service.create();else if(options.method==='POST'&&u.pathname.endsWith('/link'))data=await service.link(u.pathname.split('/').at(-2),token,body);else if(options.method==='PUT')data=await service.observe(u.pathname.split('/').at(-1),token,body);else data=await service.read(u.pathname.split('/').at(-1),token);return{ok:true,status:200,json:async()=>data};}
  catch(e){return{ok:false,status:e.statusCode||503,json:async()=>({code:e.code})};}};
 return{store,service,saved,requests,storage,fetchImpl,client:createFormObservationClient({apiBase:'https://api.example.test',storage,fetchImpl,now})};}
test('actual browser builder excludes all typed values and opaque security fields',()=>{
 const metadata=observedBusinessFields({details,validation,touched:{businessName:true,streetAddress:true}}), output=JSON.stringify(metadata);
 for(const secret of Object.values(details))assert.ok(!output.includes(secret));assert.equal(metadata.length,8);assert.equal(metadata.find(f=>f.id==='business_name').presence,'present');
 assert.equal(metadata.find(f=>f.id==='owner_name').validation,'not_observed');
});

test('actual snapshot allowlists only bounded business/owner labels; other typed values remain excluded',()=>{
 const snapshot=observedFormSnapshot({step:'business_details',details,validation,touched:{businessName:true}});
 assert.deepEqual(snapshot.draftNames,{businessName:details.businessName,ownerName:details.ownerName});
 for(const [key,secret] of Object.entries(details))if(!['businessName','ownerName'].includes(key))assert.ok(!JSON.stringify(snapshot).includes(secret),key);
 const normalized=observedFormSnapshot({step:'business_details',details:{...details,businessName:' \n'+ 'x'.repeat(200),ownerName:'Alex\u202e\nFixture '},validation});
 assert.equal(normalized.draftNames.businessName.length,120);assert.equal(normalized.draftNames.ownerName,'Alex Fixture');
 assert.equal(observedFormSnapshot({step:'trade',details,validation}).draftNames,undefined);
});

test('same-validity name edits and clearing flow through the real client/service without leaking names into the saved capability or public read',async()=>{
 const h=harness(),input={step:'business_details',details,validation,touched:{businessName:true,ownerName:true}};
 await h.client.observe(observedFormSnapshot(input),true);await h.client.settled();
 let row=(await h.service.listAdmin()).rows[0];assert.equal(row.draftNames.businessName,details.businessName);assert.equal(row.linkedAttemptId,null);
 const id=row.id,expiry=row.expiresAt;
 await h.client.observe(observedFormSnapshot({...input,details:{...details,businessName:'Changed Fictional Name'}}),true);await h.client.settled();
 row=(await h.service.listAdmin()).rows[0];assert.equal(row.id,id);assert.equal(row.draftNames.businessName,'Changed Fictional Name');assert.equal(row.revision,2);assert.equal(row.expiresAt,expiry);
 await h.client.observe(observedFormSnapshot({...input,details:{...details,businessName:'',ownerName:''},validation:{errors:{...validation.errors,businessName:'Required',ownerName:'Required'}}}),true);await h.client.settled();
 assert.deepEqual((await h.service.listAdmin()).rows[0].draftNames,{businessName:'',ownerName:''});
 const pointer=JSON.parse([...h.saved.values()][0]);assert.deepEqual(Object.keys(pointer).sort(),['expiresAt','id','revision','sequence','token']);assert.ok(!JSON.stringify([...h.saved.values()]).includes('PRIVATE'));
 assert.equal((await h.service.read(pointer.id,pointer.token)).draftNames,undefined);
 for(const request of h.requests)for(const key of ['phone','email','streetAddress','city','postalCode','otp','password','captchaToken'])assert.ok(!request.body.includes(details[key]),key);
});

test('rapid name edits keep the newest snapshot after a slow metadata write, without submitting or linking signup',async()=>{
 const h=harness();let enter,release,held=false;const entered=new Promise(r=>{enter=r;}),gate=new Promise(r=>{release=r;});
 const client=createFormObservationClient({apiBase:'https://api.example.test',storage:h.storage,fetchImpl:async(url,options)=>{if(options.method==='PUT'&&!held){held=true;enter();await gate;}return h.fetchImpl(url,options);}});
 const input={step:'business_details',details,validation,touched:{businessName:true,ownerName:true}};
 const first=client.observe(observedFormSnapshot(input),true);await entered;
 await client.observe(observedFormSnapshot({...input,details:{...details,businessName:'Intermediate Fixture'}}),true);
 await client.observe(observedFormSnapshot({...input,details:{...details,businessName:'Latest Fixture'}}),true);
 release();await first;await client.settled();const rows=(await h.service.listAdmin()).rows;
 assert.equal(rows.length,1);assert.equal(rows[0].draftNames.businessName,'Latest Fixture');assert.equal(rows[0].linkedAttemptId,null);assert.equal(h.requests.filter(r=>r.body.includes('Intermediate Fixture')).length,0);
 assert.ok(h.requests.every(r=>r.path.startsWith('/api/signup/form-observation')));
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
test('trade, property types and service areas retain presence only, never selections or custom area text',()=>{
 for(const [step,input,id] of [['trade',{selectedTradeId:'PRIVATE_TRADE'},'trade_choice'],['property_types',{selectedSpecializationIds:['PRIVATE_PROPERTY']},'property_types'],['service_areas',{selectedAreas:['PRIVATE_CUSTOM_LOCATION']},'service_areas']]){
  const snapshot=observedFormSnapshot({step,details,validation,touched:{[id]:true},...input});assert.equal(snapshot.fields[0].validation,'valid');assert.equal(snapshot.fields[0].presence,'present');assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE/);
  const blank=observedFormSnapshot({step,details,validation,attemptedAdvance:true});assert.equal(blank.fields[0].reason,'required_missing');
 }
});
test('optional pricing is not a blocker; only enabled missing/invalid rates are required, without amounts',()=>{
 let snapshot=observedFormSnapshot({step:'pricing',details,validation,attemptedAdvance:true,pricing:{includeVisitFee:false,repairVisitFee:'PRIVATE_AMOUNT'}});
 assert.equal(snapshot.fields[0].required,false);assert.equal(snapshot.fields[0].validation,'valid');assert.equal(snapshot.fields[1].visible,'hidden');assert.equal(snapshot.fields[1].presence,'unknown');assert.equal(snapshot.fields[1].required,false);assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE_AMOUNT/);
 snapshot=observedFormSnapshot({step:'pricing',details,validation,touched:{includeVisitFee:true},pricing:{includeVisitFee:true,repairVisitFee:''}});assert.equal(snapshot.fields[1].reason,'required_missing');
 snapshot=observedFormSnapshot({step:'pricing',details,validation,touched:{repairVisitFee:true},pricing:{includeVisitFee:true,repairVisitFee:'-7.25'}});assert.equal(snapshot.fields[1].reason,'validation_failed');assert.ok(!JSON.stringify(snapshot).includes('-7.25'));
 snapshot=observedFormSnapshot({step:'pricing',details,validation,touched:{repairVisitFee:true},pricing:{includeVisitFee:true,repairVisitFee:'79.27'}});assert.equal(snapshot.fields[1].validation,'valid');assert.ok(!JSON.stringify(snapshot).includes('79.27'));
});
test('final review distinguishes hidden mobile fields and incomplete human verification without collecting proof',()=>{
 const input={step:'final_review',details,validation,attemptedAdvance:true,humanVerified:false,wide:false,captchaToken:'PRIVATE_PROOF',otp:'123456',payment:{card:'4111111111111111'},termsAccepted:true};
 let snapshot=observedFormSnapshot(input);assert.equal(snapshot.fields[0].visible,'hidden');assert.equal(snapshot.fields[0].presence,'unknown');assert.equal(snapshot.fields.at(-1).id,'human_verification');assert.equal(snapshot.fields.at(-1).reason,'required_missing');
 assert.deepEqual(snapshot.draftNames,{businessName:details.businessName,ownerName:details.ownerName});
 assert.doesNotMatch(JSON.stringify(snapshot),/PRIVATE_PROOF|123456|4111111111111111|termsAccepted|captchaToken/);
 for(const [key,value] of Object.entries(details))if(!['businessName','ownerName'].includes(key))assert.ok(!JSON.stringify(snapshot).includes(value),key);
 snapshot=observedFormSnapshot({...input,humanVerified:true,wide:true});assert.equal(snapshot.fields.at(-1).validation,'valid');assert.equal(snapshot.fields[0].visible,'visible');
});
test('all actual form steps fit the bounded record and the admin report keeps checkout/terms coverage honest',async()=>{
 const h=harness();for(const step of ['trade','property_types','service_areas','business_details','pricing','final_review']){
  await h.client.observe(observedFormSnapshot({step,details,validation,attemptedAdvance:true,selectedTradeId:'PRIVATE_TRADE',selectedSpecializationIds:['PRIVATE_TYPE'],selectedAreas:['PRIVATE_AREA'],pricing:{includeVisitFee:true,repairVisitFee:'91.73'},humanVerified:false}),true);
 }
 const report=(await h.service.listAdmin()).rows[0];assert.equal(report.currentStep,'final_review');assert.equal(report.coverage.termsAgreement,'not_collected_by_this_form');assert.equal(report.coverage.checkout,'not_observed_use_trusted_backend_receipts');assert.equal(report.blockers[0].id,'human_verification');
 assert.ok(Buffer.byteLength(JSON.stringify([...h.store.rows.values()][0]))<=8192);assert.deepEqual(report.draftNames,{businessName:details.businessName,ownerName:details.ownerName});
 for(const [key,value] of Object.entries(details))if(!['businessName','ownerName'].includes(key))assert.ok(!JSON.stringify([...h.store.rows.values()]).includes(value),key);
 assert.doesNotMatch(JSON.stringify([...h.store.rows.values()]),/PRIVATE_TRADE|PRIVATE_TYPE|PRIVATE_AREA|91\.73|private@example/);assert.equal(report.coverage.instrumentedSteps.length,6);
});
test('a newly interacted draft after fixed expiry is observed even when its enum states match the expired draft',async()=>{
 let at=1800000000000;const h=harness({now:()=>at}),snapshot={currentStep:'business_details',attemptedAdvance:false,fields:observedBusinessFields({details,validation,touched:{businessName:true}})};
 await h.client.observe(snapshot,true);const old=JSON.parse([...h.saved.values()][0]);at=old.expiresAt+1;
 await h.client.observe(snapshot,true);const current=JSON.parse([...h.saved.values()][0]),report=await h.service.listAdmin();assert.notEqual(current.id,old.id);assert.equal(report.rows.length,1);assert.equal(report.rows[0].id,current.id);assert.equal(current.revision,1);
});
test('unavailable browser fetch cannot prevent normal form construction or interaction',async()=>{
 const original=globalThis.fetch;try{globalThis.fetch=undefined;const saved=new Map(),storage={getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)};
  const client=createFormObservationClient({apiBase:'https://api.example.test',storage});await client.observe({currentStep:'trade',attemptedAdvance:true,fields:[]},true);await client.settled();assert.equal(saved.size,0);
 }finally{globalThis.fetch=original;}
});
const linkAccess={id:'attempt_'+'a'.repeat(20),token:'synthetic-status-capability'};
const linkSnapshot={currentStep:'business_details',attemptedAdvance:true,fields:observedBusinessFields({details,validation,touched:{businessName:true}})};
const allowAttempt=async(id,token)=>id===linkAccess.id&&token===linkAccess.token?{eventKey:'signup_'+'a'.repeat(32),status:'provisioning',expiresAt:new Date(Date.now()+60000)}:null;
test('a transient metadata-link response retries the exact two-capability association only once',async()=>{
 const h=harness({authenticateAttempt:allowAttempt});await h.client.observe(linkSnapshot,true);const attempts=[],access={...linkAccess};
 const client=createFormObservationClient({apiBase:'https://api.example.test',storage:h.storage,waitImpl:async()=>{access.id='attempt_'+'b'.repeat(20);access.token='different-status-capability';},fetchImpl:async(url,options)=>{
  assert.ok(url.endsWith('/link'));attempts.push({url,options});if(attempts.length===1)return{ok:false,status:503,json:async()=>({})};return h.fetchImpl(url,options);
 }});
 assert.equal(await client.link(access),true);assert.equal(attempts.length,2);assert.equal(attempts[0].url,attempts[1].url);assert.equal(attempts[0].options.body,attempts[1].options.body);assert.equal(JSON.parse(attempts[1].options.body).attemptId,linkAccess.id);
 assert.equal((await h.service.listAdmin()).rows[0].identity,'exact_attempt_link');assert.equal(h.store.rows.size,1);
});
test('a lost metadata acknowledgement reuses the existing link without submitting signup or messages',async()=>{
 const h=harness({authenticateAttempt:allowAttempt});await h.client.observe(linkSnapshot,true);let calls=0;
 const client=createFormObservationClient({apiBase:'https://api.example.test',storage:h.storage,waitImpl:async()=>{},fetchImpl:async(url,options)=>{
  assert.ok(url.endsWith('/link'));const response=await h.fetchImpl(url,options);if(++calls===1)throw Error('synthetic lost acknowledgement');return response;
 }});
 assert.equal(await client.link(linkAccess),true);assert.equal(calls,2);assert.equal(h.store.rows.size,1);
 assert.ok(h.requests.every(r=>r.path.startsWith('/api/signup/form-observation')));
});
test('rejected, malformed and persistently unavailable links stay unconfirmed with a strict request bound',async()=>{
 for(const [status,body,expectedCalls] of [[401,{},1],[200,{},1],[503,{},2]]){
  const h=harness();await h.client.observe(linkSnapshot,true);let calls=0;
  const client=createFormObservationClient({apiBase:'https://api.example.test',storage:h.storage,waitImpl:async()=>{},fetchImpl:async(url)=>{assert.ok(url.endsWith('/link'));calls++;return{ok:status===200,status,json:async()=>body};}});
  assert.equal(await client.link(linkAccess),false);assert.equal(calls,expectedCalls);assert.equal((await h.service.listAdmin()).rows[0].identity,'unlinked_visitor_unknown_identity');
 }
});
test('reset during metadata linking cannot retry the old association against a new signup',async()=>{
 const h=harness();await h.client.observe(linkSnapshot,true);let entered,release,calls=0;const started=new Promise(r=>{entered=r;}),gate=new Promise(r=>{release=r;});
 const client=createFormObservationClient({apiBase:'https://api.example.test',storage:h.storage,waitImpl:async()=>{},fetchImpl:async(url)=>{assert.ok(url.endsWith('/link'));calls++;entered();await gate;return{ok:false,status:503,json:async()=>({})};}});
 const linking=client.link(linkAccess);await started;client.reset();release();assert.equal(await linking,false);assert.equal(calls,1);assert.equal(h.saved.size,0);
});
