// Actual Signup component, local synthetic observation service and admin report.
// No dotenv, server/index, production credentials or provider transports.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express'),webpack=require('webpack');
const {rateLimit}=require('express-rate-limit');
const {createObservationService,registerObservationRoutes,observationBodyGuard}=require('../server/signupFormObservation');
const {registerTrackerRoutes}=require('../server/adminSignupTracker');
const memory=require('../tests/helpers/form-observation-memory');
const output=path.resolve('diagnostics/signup-form-observation-phase-b'),publicDir=path.join(output,'public');
const sourceFiles=['server/signupFormObservation.js','src/Signup.js','src/features/signup/formObservationClient.js','src/features/signup/signupStartIntent.js','src/IntuitiveLandingPage.js','src/AdminSignupTracker.js','src/SignupTrackerCompact.css','src/SignupNowOverview.js','src/SignupNowOverview.css','src/features/admin/signupNowModel.js','src/useSavedEvidence.js','src/features/admin/savedEvidencePolling.js','scripts/signup-observation-preview-entry.js','scripts/test-signup-form-observation-browser.js'];
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,require('node:crypto').createHash('sha256').update(fs.readFileSync(path.resolve(file))).digest('hex')]));
sourceFiles.push('src/AdminDashboard.css');
async function main(){
 const initialSourceHashes=sourceHashes();
 const extraModules=String(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean);
 if(extraModules.length){
  const lock=JSON.parse(fs.readFileSync(path.join(__dirname,'../package-lock.json'),'utf8'));
  for(const name of ['react','react-dom'])assert.equal(JSON.parse(fs.readFileSync(path.join(extraModules[0],name,'package.json'),'utf8')).version,lock.packages['node_modules/'+name].version,'External preview '+name+' must match the unchanged lock');
 }
 fs.mkdirSync(publicDir,{recursive:true});const store=memory(),service=createObservationService({store,authenticateAttempt:async()=>null});const app=express();let base,blockedWrites=0,externalBlocked=0,observationWrites=0;
 const payloads=[];app.use((req,_res,next)=>{if(req.method!=='GET'&&!req.path.startsWith('/api/signup/form-observation')){blockedWrites++;return _res.status(403).json({error:'No provider/signup/payment actions allowed in this preview'});}next();});
 const pass=(_req,_res,next)=>next();
 app.use('/api/signup/form-observation',observationBodyGuard({jsonParser:express.json({limit:'8kb'}),isAllowedOrigin:o=>o===base,
  createLimiter:rateLimit({windowMs:60000,limit:20,standardHeaders:true,legacyHeaders:false}),updateLimiter:rateLimit({windowMs:60000,limit:200,standardHeaders:true,legacyHeaders:false})}));
 app.use((req,_res,next)=>{if(req.path.startsWith('/api/signup/form-observation')&&req.method!=='GET'){observationWrites++;payloads.push(JSON.stringify(req.body));}next();});app.use(express.json());
 registerObservationRoutes({app,service,isAllowedOrigin:o=>o===base,createLimiter:pass,updateLimiter:pass,requireAdmin:pass});
 registerTrackerRoutes({app,requireAdmin:pass,isAllowedOrigin:o=>o===base,list:()=>[],save:()=>{throw Error('No business edits in PhaseA');},audit:async()=>null,actorHash:()=>'',observations:()=>service.listAdmin()});
 app.get('/api/public/vapi-preview-config',(_req,res)=>res.json({enabled:false}));
 app.get('/api/admin/provider-status',(_req,res)=>res.json({readOnly:true,providers:[],history:[]}));
 app.get('/api/admin/signup-bugs',(_req,res)=>res.json({readOnly:true,events:[],groups:[]}));
 app.get('/',(_req,res)=>res.type('html').send('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signup field observations — synthetic preview</title></head><body style="margin:0"><div id="root"></div><script src="/form.js"></script></body></html>'));app.use(express.static(publicDir));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}`;
 let browser,page; const errors=[];
 try{
  const stub=path.join(publicDir,'inert-vapi.js');fs.writeFileSync(stub,'module.exports=class InertVapi {constructor(){throw new Error("Voice is forbidden in this form-only fixture");}};');
  await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'signup-observation-preview-entry.js'),output:{path:publicDir,filename:'form.js'},optimization:{minimize:false},resolve:{modules:[...extraModules,'node_modules'],alias:{'@vapi-ai/web':stub}},plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'development',REACT_APP_API_BASE_URL:base,PUBLIC_URL:'',REACT_APP_GOOGLE_MAPS_API_KEY:''})})],module:{rules:[{test:/\.js$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-react')]}}},{test:/\.css$/,use:[require.resolve('style-loader'),require.resolve('css-loader')]}]}});compiler.run((err,stats)=>compiler.close(closeErr=>err||closeErr||stats.hasErrors()?reject(err||closeErr||Error(stats.toString({all:false,errors:true}))):resolve()));});
  console.log('Phase B: synthetic bundle ready; launching browser.');
  const {chromium}=require('./playwright-runtime');browser=await chromium.launch({headless:true,timeout:60000});const context=await browser.newContext({viewport:{width:1440,height:1100}});page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);page.on('pageerror',e=>{errors.push(e.message);console.error('Synthetic page error:',e.message);});
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(externalBlocked++,route.abort()));
  const wait=async predicate=>{for(let i=0;i<200;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error('Expected metadata condition was not observed');};
  const row=async()=> (await service.listAdmin()).rows[0];
  async function businessForm(){await page.getByRole('button',{name:/Electrician/}).first().click();await page.getByRole('button',{name:'Continue to property types',exact:true}).first().click();await page.getByRole('button',{name:/Residential/}).first().click();await page.getByRole('button',{name:'Continue to service areas',exact:true}).first().click();await page.getByRole('button',{name:'Hamilton',exact:true}).click();
   // The real narrow-screen area picker submits through its visible Next
   // button; the long desktop label is deliberately hidden below 640px.
   await page.getByRole('button',{name:page.viewportSize().width<640?'Next':'Continue to business details',exact:true}).first().click();
   await page.locator('#signup-business-details').waitFor();return page.locator('#signup-business-details');}
  // Focused local proof is deliberately partial. Default/full CI still runs
  // every journey below; this artifact cannot stand in for the full gate.
  if(process.argv.includes('--start-proof-only')){
   await context.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(externalBlocked++,route.abort()));
   await page.setViewportSize({width:390,height:844});
   await page.goto(base+'/#/',{waitUntil:'domcontentloaded'});
   const cta=page.getByRole('button',{name:'Start Your Free Trial',exact:true}).first();await cta.waitFor();
   assert.equal((await service.listAdmin()).rows.length,0);assert.equal(observationWrites,0,'A passive visit is not a start');
   await page.screenshot({path:path.join(output,'start-proof-1-before-click.png')});
   await page.evaluate(()=>document.addEventListener('click',event=>{if(event.target.closest('button')?.textContent.trim()==='Start Your Free Trial')window.__syntheticStartClickAt=Date.now();},{capture:true}));
   await cta.click();await page.getByRole('heading',{name:'Choose your trade',exact:true}).first().waitFor();
   await wait(async()=> (await service.listAdmin()).rows.length===1);
   const beforeTyping=(await service.listAdmin()).rows[0],clickAt=await page.evaluate(()=>window.__syntheticStartClickAt);
   assert.ok(Number.isFinite(clickAt));assert.equal(beforeTyping.startSource,'trial_button');assert.equal(beforeTyping.currentStep,'trade');assert.equal(beforeTyping.draftNames,null);assert.equal(beforeTyping.linkedAttemptId,null);assert.deepEqual(beforeTyping.blockers,[]);
   assert.ok(beforeTyping.fields.every(f=>f.observedAt==null||f.validation==='not_observed'),'No typed input or fabricated validation is needed');
   assert.equal(await page.locator('input:visible,textarea:visible').count(),0,'Proof happens on trade selection, before the business fields');
   const reportBefore=await (await fetch(base+'/api/admin/signup-form-observations')).json();assert.equal(reportBefore.rows[0].id,beforeTyping.id);
   await page.screenshot({path:path.join(output,'start-proof-2-saved-before-typing.png')});
   const admin=await context.newPage();admin.on('pageerror',e=>errors.push(e.message));await admin.goto(base+'/#/admin',{waitUntil:'domcontentloaded'});
   const overview=admin.getByRole('region',{name:'Signups happening now'});await overview.locator('.signup-now-selected').getByText('Visitor '+beforeTyping.id.slice(-8),{exact:true}).waitFor();
   await overview.screenshot({path:path.join(output,'start-proof-3-admin-before-typing.png')});
   // Refresh cannot count the same browser draft as a second new signup.
   await page.bringToFront();await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Choose your trade',exact:true}).first().waitFor();assert.equal((await service.listAdmin()).rows.length,1);
   const detailsPanel=await businessForm();await detailsPanel.getByPlaceholder('e.g., Smith Electrical Services').fill('Invented Start Proof Electrical');await detailsPanel.getByPlaceholder('e.g., Jamie Smith').fill('Alex Fixture');
   await wait(async()=> (await service.listAdmin()).rows[0]?.draftNames?.businessName==='Invented Start Proof Electrical');
   await admin.bringToFront();await admin.waitForFunction(()=>document.querySelector('.signup-now-selected strong')?.textContent==='Invented Start Proof Electrical',null,{timeout:15000});
   await overview.screenshot({path:path.join(output,'start-proof-4-live-entered-names.png')});
   await page.bringToFront();await detailsPanel.getByPlaceholder('e.g., Smith Electrical Services').fill('Corrected Start Proof Electrical');
   await admin.bringToFront();await admin.waitForFunction(()=>document.querySelector('.signup-now-selected strong')?.textContent==='Corrected Start Proof Electrical',null,{timeout:15000});
   const afterTyping=(await service.listAdmin()).rows[0];assert.equal(afterTyping.id,beforeTyping.id);assert.equal(afterTyping.linkedAttemptId,null);assert.equal(afterTyping.draftNamesVerified,false);
   const outbox=new Set();const enqueue=async x=>{const duplicate=outbox.has(x.dedupeKey);outbox.add(x.dedupeKey);return duplicate?{duplicate:true}:{queued:true};};
   await service.processStalls({enqueue,frontendUrl:base});await service.processStalls({enqueue,frontendUrl:base});assert.equal([...outbox].filter(k=>k.startsWith('signup-form-start:')).length,1);
   assert.equal(blockedWrites,0);assert.deepEqual(errors,[]);assert.deepEqual(sourceHashes(),initialSourceHashes);
   fs.writeFileSync(path.join(output,'start-click-only-report.json'),JSON.stringify({passed:true,partial:true,ready:false,scope:'synthetic-actual-button-form-http-admin-memory-store',checkedAt:new Date().toISOString(),sourceSha256:initialSourceHashes,clickAt:new Date(clickAt).toISOString(),savedBeforeTyping:{id:beforeTyping.id,createdAt:new Date(beforeTyping.createdAt).toISOString(),startedAt:new Date(beforeTyping.startedAt).toISOString(),startSource:beforeTyping.startSource,currentStep:beforeTyping.currentStep,draftNames:beforeTyping.draftNames,linkedAttemptId:beforeTyping.linkedAttemptId},clickToDraftCreatedMs:beforeTyping.createdAt-clickAt,visibleInActualAdminBeforeTyping:true,namesAppearedWithoutSubmission:true,validToValidNameCorrectionVisible:true,sameDraftAfterRefresh:true,syntheticStartOutboxKeys:1,signupSubmissions:0,productionRequests:0,realMessages:0,providerTrafficAllowed:0,externalBlocked,limitations:['Memory-backed fixture, not durable PostgreSQL/restart proof','Fixture admin authentication, not a live session test','Network routes/disabled handlers are instrumentation, not an OS egress sandbox','Not the full browser gate, a released build or live Telegram-delivery proof']},null,2));
   await admin.close();console.log('PASS focused actual Start Trial → server draft → admin before typing → corrected live names. Partial synthetic proof only.');return;
  }
  console.log('Phase B: browser ready; opening actual form.');
  await page.goto(base+'/#/signup',{waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Choose your trade',exact:true}).first().waitFor();assert.equal(observationWrites,0);
  let panel=await businessForm();console.log('Phase B: business form reached after genuine trade/property/area interactions.');
  let name=panel.getByPlaceholder('e.g., Smith Electrical Services');await name.focus();await name.press('Tab');
  await wait(async()=> (await row())?.blockerLabels.includes('Business name: Required field is blank'));
  let current=await row();assert.equal(current.fields.find(f=>f.id==='street_address').reason,'not_observed');assert.equal(current.identity,'unlinked_visitor_unknown_identity');
  await panel.getByPlaceholder('Start typing your address').fill('x');await panel.getByPlaceholder('Start typing your address').press('Tab');
  await wait(async()=> (await row()).fields.find(f=>f.id==='street_address').reason==='validation_failed');
  const rawName='North Harbour Private Works',rawAddress='92 Beacon Private Place',rawPostal='PRIVATE_BAD_POSTAL';
  await name.fill(rawName);await panel.getByPlaceholder('Start typing your address').fill(rawAddress);await panel.getByPlaceholder('L8P 1A1').fill(rawPostal);await name.focus();
  await wait(async()=>{const r=await row();return r.fields.find(f=>f.id==='business_name').validation==='valid'&&r.fields.find(f=>f.id==='street_address').validation==='valid'&&r.fields.find(f=>f.id==='postal_code').validation==='invalid';});
  current=await row();const initialId=current.id,expiry=current.expiresAt,revision=current.revision;
  assert.equal(current.draftNames.businessName,rawName);assert.equal(current.draftNamesVerified,false);assert.equal(current.linkedAttemptId,null);
  for(const marker of [rawAddress,rawPostal]){assert.ok(!JSON.stringify(payloads).includes(marker));assert.ok(!JSON.stringify([...store.rows.values()]).includes(marker));assert.ok(!JSON.stringify(current).includes(marker));}
  await panel.getByRole('button',{name:'Back',exact:true}).first().click();await wait(async()=> (await row()).currentStep==='service_areas');assert.equal((await row()).blockers.length,0,'Hidden earlier fields cannot be active blockers');
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('heading',{name:'Choose your trade',exact:true}).first().waitFor();panel=await businessForm();name=panel.getByPlaceholder('e.g., Smith Electrical Services');assert.equal(await name.inputValue(),'','Metadata does not restore typed values');await name.focus();await name.press('Tab');await wait(async()=> (await row()).revision>revision&&(await row()).currentStep==='business_details');
  current=await row();assert.equal(current.id,initialId);assert.equal(current.expiresAt,expiry);assert.equal(current.fields.find(f=>f.id==='business_name').presence,'blank');
  const synthetic={owner:'Alex Ridley',phone:'2895554186',email:'alex@northharbour.ca',city:'Hamilton',postal:'L8P 1A1',amount:'81.73'};
  await name.fill(rawName);await panel.getByPlaceholder('e.g., Jamie Smith').fill(synthetic.owner);await panel.getByPlaceholder('(416) 555-1234').fill(synthetic.phone);await panel.getByPlaceholder('you@yourbusiness.com').fill(synthetic.email);await panel.getByPlaceholder('Start typing your address').fill(rawAddress);await panel.getByPlaceholder('Hamilton',{exact:true}).fill(synthetic.city);await panel.getByPlaceholder('L8P 1A1').fill(synthetic.postal);
  await panel.getByRole('button',{name:'Continue to service call pricing',exact:true}).first().click();const pricing=page.locator('#signup-pricing');await pricing.waitFor();
  await wait(async()=> (await row()).currentStep==='pricing');assert.equal((await row()).blockers.length,0,'Unchecked optional rates are not blockers');
  await pricing.getByRole('checkbox',{name:'Share minimum service visit fee',exact:true}).check();await wait(async()=> (await row()).blockers.some(f=>f.id==='visit_fee'&&f.reason==='required_missing'));
  await pricing.getByPlaceholder('Enter price').fill('-7');await wait(async()=> (await row()).fields.find(f=>f.id==='visit_fee').reason==='validation_failed');
  await pricing.getByPlaceholder('Enter price').fill(synthetic.amount);await wait(async()=> (await row()).fields.find(f=>f.id==='visit_fee').validation==='valid');
  await pricing.getByRole('checkbox',{name:'Share minimum service visit fee',exact:true}).uncheck();await wait(async()=> (await row()).fields.find(f=>f.id==='visit_fee').visibleAtObservation==='hidden');assert.equal((await row()).blockers.length,0);
  await pricing.getByRole('button',{name:'Review and confirm',exact:true}).first().click();await page.getByRole('heading',{name:'Final review',exact:true}).waitFor();
  await page.getByRole('button',{name:'Start free trial',exact:true}).first().click();await wait(async()=> (await row()).blockers.some(f=>f.id==='human_verification'));
  assert.equal((await row()).coverage.checkout,'not_observed_use_trusted_backend_receipts');assert.equal((await row()).coverage.termsAgreement,'not_collected_by_this_form');
  await page.setViewportSize({width:390,height:1000});await wait(async()=> (await row()).fields.find(f=>f.id==='business_name').visibleAtObservation==='hidden');assert.deepEqual((await row()).blockers.map(f=>f.id),['human_verification']);
  await page.setViewportSize({width:1440,height:1100});await wait(async()=> (await row()).fields.find(f=>f.id==='business_name').visibleAtObservation==='visible');
  assert.equal((await row()).draftNames.businessName,rawName);assert.equal((await row()).draftNames.ownerName,synthetic.owner);
  for(const marker of [rawAddress,rawPostal,synthetic.phone,synthetic.email,synthetic.city,synthetic.postal,synthetic.amount,'Electrician','Residential']){assert.ok(!JSON.stringify(payloads).includes(marker));assert.ok(!JSON.stringify([...store.rows.values()]).includes(marker));}
  console.log('Phase B: pricing conditional fields and final-review/mobile visibility passed.');
  await page.getByRole('button',{name:'Open admin report',exact:true}).click();await page.getByText('All browser field observations',{exact:true}).click();const report=page.getByRole('region',{name:'Unlinked signup observations'});await report.getByRole('button',{name:'View field status'}).click();await report.getByText('Business name',{exact:true}).waitFor();assert.ok((await report.textContent()).includes('not proof that signup failed or was never submitted'));
  for(const marker of [rawName,synthetic.owner])assert.ok((await report.textContent()).includes(marker));
  for(const marker of [rawAddress,rawPostal,synthetic.phone,synthetic.email,synthetic.amount])assert.ok(!(await report.textContent()).includes(marker));assert.ok((await report.textContent()).includes('Human verification'));assert.ok((await page.locator('.signup-tracker-policy').textContent()).includes('not proof of agreement'));
  await report.screenshot({path:path.join(output,'1440-phase-b-field-report.png')});
  await page.setViewportSize({width:390,height:1000});await report.screenshot({path:path.join(output,'390-phase-b-field-report.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Restore only a synthetic status capability, never submit a signup. This
  // exercises the real reset button and proves the observation token is lost.
  await page.evaluate(()=>{sessionStorage.setItem('myaipa_signup_result_v2',JSON.stringify({signupStatus:{id:'attempt_00000000000000000000',token:'synthetic-reset-status-capability'}}));window.location.hash='/signup';});
  await page.reload({waitUntil:'commit'});await page.getByRole('button',{name:'Start another signup',exact:true}).click();await page.getByRole('heading',{name:'Choose your trade',exact:true}).first().waitFor();
  await wait(async()=> (await service.listAdmin()).rows.some(r=>r.id!==initialId&&r.startSource==='trial_button'));
  const resetPointer=await page.evaluate(()=>JSON.parse(sessionStorage.getItem('myaipa_signup_observation_v1')));assert.notEqual(resetPointer.id,initialId);assert.equal(await page.evaluate(()=>sessionStorage.getItem('myaipa_signup_result_v2')),null);
  // Click the actual homepage CTA before typing any form field.
  const startContext=await browser.newContext({viewport:{width:390,height:844}});
  await startContext.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(externalBlocked++,route.abort()));
  const visitor=await startContext.newPage();visitor.on('pageerror',e=>errors.push(e.message));page=visitor;const beforeStarts=(await service.listAdmin()).rows.length;
  await visitor.goto(base+'/#/',{waitUntil:'domcontentloaded'});await visitor.getByRole('button',{name:'Start Your Free Trial',exact:true}).first().click();
  await visitor.getByRole('heading',{name:'Choose your trade',exact:true}).first().waitFor();
  await wait(async()=> (await service.listAdmin()).rows.length===beforeStarts+1);const startPointer=await visitor.evaluate(()=>JSON.parse(sessionStorage.getItem('myaipa_signup_observation_v1'))),started=(await service.listAdmin()).rows.find(r=>r.id===startPointer.id);
  assert.equal(started.startSource,'trial_button');assert.equal(started.currentStep,'trade');assert.deepEqual(started.blockers,[]);assert.equal(started.fields.find(f=>f.id==='trade_choice').validation,'not_observed');
  const outbox=new Set(),enqueue=async item=>{const duplicate=outbox.has(item.dedupeKey);outbox.add(item.dedupeKey);return duplicate?{duplicate:true}:{queued:true};};
  await service.processStalls({enqueue,frontendUrl:base});const startKey='signup-form-start:'+startPointer.id;assert.ok(outbox.has(startKey));const acceptedCount=outbox.size;
  await visitor.reload({waitUntil:'domcontentloaded'});await visitor.getByRole('heading',{name:'Choose your trade',exact:true}).first().waitFor();await service.processStalls({enqueue,frontendUrl:base});assert.equal(outbox.size,acceptedCount,'Reload cannot manufacture a second start alert');
  const admin=await startContext.newPage();admin.on('pageerror',e=>errors.push(e.message));await admin.goto(base+'/#/admin',{waitUntil:'domcontentloaded'});
  const overview=admin.getByRole('region',{name:'Signups happening now'});await overview.getByText('Visitor '+startPointer.id.slice(-8),{exact:true}).first().waitFor();
  assert.equal(await overview.locator('.signup-now-stages button').count(),6);assert.equal(await overview.getByRole('region',{name:'Expanded signup step'}).count(),0);
  const compactBounds=await overview.locator('.signup-now-stages button').evaluateAll(items=>items.map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right};}));assert.ok(compactBounds.every(r=>Math.abs(r.y-compactBounds[0].y)<2),'All six steps fit one line');assert.ok(compactBounds.at(-1).right<=390,'No off-screen step');
  await overview.screenshot({path:path.join(output,'390-start-saved-before-typing.png')});
  await businessForm();await wait(async()=> (await service.listAdmin()).rows.find(r=>r.id===startPointer.id)?.currentStep==='business_details');
  await admin.bringToFront();
  await overview.locator('.signup-now-selected').getByText('Business details',{exact:true}).waitFor({timeout:15000});
  // The same real visitor can be recognized by entered display names before
  // submission, and valid-to-valid corrections must not be deduplicated away.
  await visitor.bringToFront();const liveDetails=visitor.locator('#signup-business-details');
  await liveDetails.getByPlaceholder('e.g., Smith Electrical Services').fill('Invented Live Beacon');await liveDetails.getByPlaceholder('e.g., Jamie Smith').fill('Alex Fixture');
  await admin.bringToFront();await admin.waitForFunction(()=>document.querySelector('.signup-now-selected strong')?.textContent==='Invented Live Beacon',null,{timeout:15000});
  await visitor.bringToFront();await liveDetails.getByPlaceholder('e.g., Smith Electrical Services').fill('Corrected Live Beacon');
  await admin.bringToFront();await admin.waitForFunction(()=>document.querySelector('.signup-now-selected strong')?.textContent==='Corrected Live Beacon',null,{timeout:15000});
  assert.equal((await service.listAdmin()).rows.find(r=>r.id===startPointer.id).linkedAttemptId,null);
  assert.equal(await overview.locator('.signup-now-open').count(),0,'Entered names never confer canonical signup access');
  await visitor.bringToFront();await liveDetails.getByPlaceholder('e.g., Smith Electrical Services').fill('');await liveDetails.getByPlaceholder('e.g., Jamie Smith').fill('');
  await admin.bringToFront();await admin.waitForFunction(label=>document.querySelector('.signup-now-selected strong')?.textContent===label,'Visitor '+startPointer.id.slice(-8),{timeout:15000});
  await overview.getByRole('button',{name:'Inspect Details form step',exact:true}).click();await overview.getByRole('region',{name:'Expanded signup step'}).getByText('Business phone',{exact:true}).waitFor();
  for(const width of [1440,390,320]){await admin.setViewportSize({width,height:844});await overview.screenshot({path:path.join(output,`${width}-signup-now-expanded.png`)});assert.equal(await admin.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);const boxes=await overview.locator('.signup-now-stages button').evaluateAll(items=>items.map(e=>{const r=e.getBoundingClientRect(),label=e.querySelector('strong'),l=label.getBoundingClientRect();return{y:r.y,right:r.right,labelFits:label.scrollWidth<=label.clientWidth+1&&l.x>=r.x&&l.right<=r.right+1};}));assert.ok(boxes.every(b=>Math.abs(b.y-boxes[0].y)<2));assert.ok(boxes.at(-1).right<=width);assert.ok(boxes.every(b=>b.labelFits),'Step text must fit inside its own box at '+width+'px');assert.deepEqual(await overview.locator('.signup-now-label-short:visible').allTextContents(),width<=580?['Info','Rates','Final']:[]);}
  await overview.getByRole('button',{name:'Close',exact:true}).click();await overview.screenshot({path:path.join(output,'320-signup-now-compact.png')});
  await admin.addScriptTag({path:require.resolve('axe-core/axe.min.js')});const accessibility=await admin.evaluate(async()=>(await window.axe.run('.signup-now',{runOnly:{type:'tag',values:['wcag2a','wcag2aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));assert.deepEqual(accessibility,[]);
  await startContext.close();
  assert.deepEqual(errors,[]);assert.equal(blockedWrites,0);
  assert.deepEqual(sourceHashes(),initialSourceHashes,'Sources changed during synthetic rehearsal');
  fs.writeFileSync(path.join(output,'signup-now-browser-report.json'),JSON.stringify({passed:true,scope:'synthetic-actual-form-and-dashboard',sourceState:process.env.CI?'ci-checkout':'uncommitted-local-working-tree',sourceHead:process.env.SIGNUP_DIAGNOSTIC_HEAD||process.env.REACT_APP_RELEASE_SHA||null,sourceSha256:initialSourceHashes,actualHomepageCta:true,actualMobileAreaNext:true,startBeforeTyping:true,noPassivePageStart:true,unverifiedUntilExactLink:true,liveDraftNameCorrections:true,automaticAdminProgress:true,compactStepWidths:[1440,390,320],allSixStepsOneRow:true,stepLabelsFit:true,clickToExpand:true,refreshDoesNotReenqueue:true,syntheticOutboxOnly:true,accessibilityViolations:accessibility.length,providerTrafficAllowed:0,productionRequests:0,telegramSends:0,calls:0,sms:0,limitation:'Memory fixture and blocked browser routes, not OS isolation, real PostgreSQL concurrency, Telegram delivery or live release proof.'},null,2));
  fs.writeFileSync(path.join(output,'phase-b-browser-report.json'),JSON.stringify({passed:true,actualSignupComponent:true,actualObservationRoutes:true,scenarios:['passive page load does not create a draft','genuine trade/property/service-area interaction','blank business name','untouched visible street address','bad address format','corrected name/address','invalid postal metadata','back navigation hides prior blockers','refresh/resume exact cursor with no value restoration','optional unchecked pricing not blocked','selected missing/negative/corrected amount','unchecking hides rate without blocker','final review incomplete human verification','mobile hidden review fields not blockers','terms and checkout explicitly unproven','unverified draft names in authenticated admin report','live display-name corrections and clearing without identity linkage','desktop/mobile no overflow','no non-name typed-value leaks','real Start another signup resets without stale state or capability'],observationWrites,blockedWrites,externalBlocked,allowedProviderRequests:0,signupSubmissions:0,telegramSends:0,displayNameFieldsAllowed:['businessName','ownerName'],otherRawValuesPersisted:0},null,2));console.log('PASS Phase B actual Signup/privacy/pricing/final-review/admin field-report browser checks.');
 }catch(error){const failureAt=Date.now();console.error('Synthetic rehearsal failed:',error.message);fs.writeFileSync(path.join(output,`failure-${failureAt}.json`),JSON.stringify({passed:false,scope:'synthetic-only',error:{message:String(error.message),stack:String(error.stack)},pageErrors:errors,sourceSha256:initialSourceHashes},null,2));if(page&&!page.isClosed())await page.screenshot({path:path.join(output,`failure-${failureAt}.png`),timeout:10000}).catch(()=>{});throw error;}
 finally{await browser?.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
