// Actual Signup component, local synthetic observation service and admin report.
// No dotenv, server/index, production credentials or provider transports.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),express=require('express'),webpack=require('webpack');
const {rateLimit}=require('express-rate-limit');
const {createObservationService,registerObservationRoutes,observationBodyGuard}=require('../server/signupFormObservation');
const {registerTrackerRoutes}=require('../server/adminSignupTracker');
const memory=require('../tests/helpers/form-observation-memory');
const output=path.resolve('diagnostics/signup-form-observation-phase-a'),publicDir=path.join(output,'public');
async function main(){
 fs.mkdirSync(publicDir,{recursive:true});const store=memory(),service=createObservationService({store,authenticateAttempt:async()=>null});const app=express();let base,blockedWrites=0,externalBlocked=0,observationWrites=0;
 const payloads=[];app.use((req,_res,next)=>{if(req.method!=='GET'&&!req.path.startsWith('/api/signup/form-observation')){blockedWrites++;return _res.status(403).json({error:'No provider/signup/payment actions allowed in this preview'});}next();});
 const pass=(_req,_res,next)=>next();
 app.use('/api/signup/form-observation',observationBodyGuard({jsonParser:express.json({limit:'8kb'}),isAllowedOrigin:o=>o===base,
  createLimiter:rateLimit({windowMs:60000,limit:20,standardHeaders:true,legacyHeaders:false}),updateLimiter:rateLimit({windowMs:60000,limit:200,standardHeaders:true,legacyHeaders:false})}));
 app.use((req,_res,next)=>{if(req.path.startsWith('/api/signup/form-observation')&&req.method!=='GET'){observationWrites++;payloads.push(JSON.stringify(req.body));}next();});app.use(express.json());
 registerObservationRoutes({app,service,isAllowedOrigin:o=>o===base,createLimiter:pass,updateLimiter:pass,requireAdmin:pass});
 registerTrackerRoutes({app,requireAdmin:pass,isAllowedOrigin:o=>o===base,list:()=>[],save:()=>{throw Error('No business edits in PhaseA');},audit:async()=>null,actorHash:()=>'',observations:()=>service.listAdmin()});
 app.get('/api/public/vapi-preview-config',(_req,res)=>res.json({enabled:false}));
 app.get('/',(_req,res)=>res.type('html').send('<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signup field observations — synthetic preview</title></head><body style="margin:0"><div id="root"></div><script src="/form.js"></script></body></html>'));app.use(express.static(publicDir));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});base=`http://127.0.0.1:${server.address().port}`;
 let browser,page;
 try{
  const stub=path.join(publicDir,'inert-vapi.js');fs.writeFileSync(stub,'module.exports=class InertVapi {constructor(){throw new Error("Voice is forbidden in this form-only fixture");}};');
  await new Promise((resolve,reject)=>{const compiler=webpack({mode:'development',devtool:false,entry:path.join(__dirname,'signup-observation-preview-entry.js'),output:{path:publicDir,filename:'form.js'},optimization:{minimize:false},resolve:{alias:{'@vapi-ai/web':stub}},plugins:[new webpack.DefinePlugin({'process.env':JSON.stringify({NODE_ENV:'development',REACT_APP_API_BASE_URL:base,PUBLIC_URL:'',REACT_APP_GOOGLE_MAPS_API_KEY:''})})],module:{rules:[{test:/\.js$/,exclude:/node_modules/,use:{loader:require.resolve('babel-loader'),options:{presets:[require.resolve('@babel/preset-react')]}}},{test:/\.css$/,use:[require.resolve('style-loader'),require.resolve('css-loader')]}]}});compiler.run((err,stats)=>compiler.close(closeErr=>err||closeErr||stats.hasErrors()?reject(err||closeErr||Error(stats.toString({all:false,errors:true}))):resolve()));});
  console.log('Phase A: synthetic bundle ready; launching browser.');
  const {chromium}=require('./playwright-runtime');browser=await chromium.launch({headless:true,timeout:60000});const context=await browser.newContext({viewport:{width:1440,height:1100}});page=await context.newPage();page.setDefaultTimeout(30000);page.setDefaultNavigationTimeout(60000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():(externalBlocked++,route.abort()));
  const wait=async predicate=>{for(let i=0;i<200;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error('Expected metadata condition was not observed');};
  const row=async()=> (await service.listAdmin()).rows[0];
  async function businessForm(){await page.getByRole('button',{name:/Electrician/}).first().click();await page.getByRole('button',{name:'Continue to property types',exact:true}).first().click();await page.getByRole('button',{name:/Residential/}).first().click();await page.getByRole('button',{name:'Continue to service areas',exact:true}).first().click();await page.getByRole('button',{name:'Hamilton',exact:true}).click();await page.getByRole('button',{name:'Continue to business details',exact:true}).first().click();await page.locator('#signup-business-details').waitFor();return page.locator('#signup-business-details');}
  console.log('Phase A: browser ready; opening actual form.');
  await page.goto(base+'/#/signup',{waitUntil:'commit'});await page.getByRole('heading',{name:'Choose your trade',exact:true}).first().waitFor();assert.equal(observationWrites,0);
  let panel=await businessForm();console.log('Phase A: business form reached.');assert.equal(observationWrites,0,'Navigation before PhaseA form interaction must not invent engaged drafts');
  let name=panel.getByPlaceholder('e.g., Smith Electrical Services');await name.focus();await name.press('Tab');
  await wait(async()=> (await row())?.blockerLabels.includes('Business name: Required field is blank'));
  let current=await row();assert.equal(current.fields.find(f=>f.id==='street_address').reason,'not_observed');assert.equal(current.identity,'unsubmitted_visitor_unknown_identity');
  await panel.getByPlaceholder('Start typing your address').fill('x');await panel.getByPlaceholder('Start typing your address').press('Tab');
  await wait(async()=> (await row()).fields.find(f=>f.id==='street_address').reason==='validation_failed');
  const rawName='North Harbour Private Works',rawAddress='92 Beacon Private Place',rawPostal='PRIVATE_BAD_POSTAL';
  await name.fill(rawName);await panel.getByPlaceholder('Start typing your address').fill(rawAddress);await panel.getByPlaceholder('L8P 1A1').fill(rawPostal);await name.focus();
  await wait(async()=>{const r=await row();return r.fields.find(f=>f.id==='business_name').validation==='valid'&&r.fields.find(f=>f.id==='street_address').validation==='valid'&&r.fields.find(f=>f.id==='postal_code').validation==='invalid';});
  current=await row();const initialId=current.id,expiry=current.expiresAt,revision=current.revision;
  for(const marker of [rawName,rawAddress,rawPostal]){assert.ok(!JSON.stringify(payloads).includes(marker));assert.ok(!JSON.stringify([...store.rows.values()]).includes(marker));assert.ok(!JSON.stringify(current).includes(marker));}
  await panel.getByRole('button',{name:'Back',exact:true}).first().click();await wait(async()=> (await row()).currentStep==='service_areas');assert.equal((await row()).blockers.length,0,'Hidden earlier fields cannot be active blockers');
  await page.reload();await page.getByRole('heading',{name:'Choose your trade',exact:true}).first().waitFor();panel=await businessForm();name=panel.getByPlaceholder('e.g., Smith Electrical Services');assert.equal(await name.inputValue(),'','Metadata does not restore typed values');await name.focus();await name.press('Tab');await wait(async()=> (await row()).revision>revision&&(await row()).currentStep==='business_details');
  current=await row();assert.equal(current.id,initialId);assert.equal(current.expiresAt,expiry);assert.equal(current.fields.find(f=>f.id==='business_name').presence,'blank');
  await page.getByRole('button',{name:'Open admin report',exact:true}).click();const report=page.getByRole('region',{name:'Unsubmitted signup observations'});await report.getByRole('button',{name:'View field status'}).click();await report.getByText('Business name',{exact:true}).waitFor();
  for(const marker of [rawName,rawAddress,rawPostal])assert.ok(!(await report.textContent()).includes(marker));assert.ok((await report.textContent()).includes('untouched; reason unknown'));
  await report.screenshot({path:path.join(output,'1440-phase-a-field-report.png')});
  await page.setViewportSize({width:390,height:1000});await report.screenshot({path:path.join(output,'390-phase-a-field-report.png')});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);assert.equal(blockedWrites,0);
  fs.writeFileSync(path.join(output,'phase-a-browser-report.json'),JSON.stringify({passed:true,actualSignupComponent:true,actualObservationRoutes:true,scenarios:['unengaged navigation','blank business name','untouched visible street address','bad address format','corrected name/address','invalid postal metadata','back navigation hides prior blockers','refresh/resume exact cursor with no value restoration','unknown-identity admin field report','desktop/mobile no overflow','no typed-value leaks'],observationWrites,blockedWrites,externalBlocked,providerRequests:0,signupSubmissions:0,telegramSends:0,rawValuesPersisted:0},null,2));console.log('PASS PhaseA actual Signup/privacy/correction/back/resume/admin field-report browser checks.');
 }catch(error){if(page)await page.screenshot({path:path.join(output,'phase-a-failure.png'),timeout:10000}).catch(()=>{});throw error;}
 finally{await browser?.close();server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
