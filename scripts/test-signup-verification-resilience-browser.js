'use strict';
// Fresh offline browser contexts; every page request is intercepted. This is
// not the user's browser, an OS sandbox, a live signup or a provider test.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {chromium}=require('./playwright-runtime');
const {verificationProgressMarkup,verificationProgressScript}=require('../server/signupVerificationProgress');
const {verificationPageClientScript}=require('../server/signupVerificationPageClient');
const SOURCE_FILES=['server/signupVerificationProgress.js','server/signupVerificationPageClient.js','scripts/test-signup-verification-resilience-browser.js'];
function html(confirm){return '<!doctype html><meta charset="utf-8"><main><h1 id="verification-title">Synthetic setup</h1><p id="verification-description"></p><p id="setup-progress" hidden></p>'+
 (confirm?'<form id="signup-verification-form" action="/confirm"><input name="token" value="invented-only"><button>Confirm</button></form><a id="verification-support" hidden>Support</a>':'')+
 verificationProgressMarkup()+'</main>'+verificationProgressScript('/progress',{awaitConfirmation:confirm})+(confirm?verificationPageClientScript({automaticSmsConfirmation:true}):'');}
async function main(){
 if(process.argv.length!==2)throw Error('FIXED_SYNTHETIC_SCOPE_REQUIRED');
 const report={scope:'offline-browser-verification-resilience',passed:false,cases:[],unexpectedPageRequests:0,productionUsed:false,providerRequests:0,messages:0,osSandboxProven:false,actualBfcacheNavigationProven:false};
 const browser=await chromium.launch({headless:true,timeout:20000,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:['--disable-gpu','--disable-dev-shm-usage']});
 const contexts=new Set();
 async function run(name,mode,work){
  const context=await browser.newContext({serviceWorkers:'block'});contexts.add(context);const page=await context.newPage();page.setDefaultTimeout(5000);
  const errors=[],releases=[];let posts=0,gets=0,unexpected=0;page.on('pageerror',e=>errors.push(e.message));
  await page.clock.install({time:new Date('2026-01-01T00:00:00Z')});
  await page.addInitScript(()=>{
   const intervals=new Set(),nativeSet=window.setInterval,nativeClear=window.clearInterval,open=document.open.bind(document);
   window.__fixtureIntervals=intervals;window.__fixtureSwapCounts=[];
   window.setInterval=(...args)=>{const id=nativeSet(...args);intervals.add(id);return id;};window.clearInterval=id=>{intervals.delete(id);return nativeClear(id);};
   document.open=(...args)=>{window.__fixtureSwapCounts.push(intervals.size);return open(...args);};
  });
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   if(url.origin!=='http://127.0.0.1:8123'||!['/fixture','/confirm','/progress'].includes(url.pathname)){unexpected++;return route.abort();}
   if(url.pathname==='/confirm'){
    posts++;assert.equal(request.method(),'POST');
    if(mode==='hung'){await new Promise(resolve=>releases.push(resolve));try{await route.abort();}catch(_){}return;}
    return route.fulfill({contentType:'text/html',body:html(false)});
   }
   assert.equal(request.method(),'GET');
   if(url.pathname==='/progress'){gets++;return route.fulfill({json:{signup:{state:'processing',title:'Saved fixture continues',message:'Synthetic saved progress'}}});}
   return route.fulfill({contentType:'text/html',body:html(mode!=='read-only')});
  });
  let passed=false;
  try{await page.goto('http://127.0.0.1:8123/fixture',{waitUntil:'domcontentloaded'});await work({page,counts:()=>({posts,gets})});assert.deepEqual(errors,[]);assert.equal(unexpected,0);passed=true;}
  finally{for(const release of releases)release();await context.close();contexts.delete(context);report.unexpectedPageRequests+=unexpected;report.cases.push({name,passed,confirmationPosts:posts,statusGets:gets,contextClosed:true});}
 }
 try{
  await run('native confirmation timeout returns to GET-only progress','hung',async({page,counts})=>{
   await page.clock.runFor(15001);await page.getByText('Checking your saved setup',{exact:true}).waitFor();assert.equal(counts().posts,1);
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));await page.getByText('Saved fixture continues',{exact:true}).waitFor();assert.equal(counts().posts,1);
  });
  await run('document replacement retains only one poller','replace',async({page,counts})=>{
   await page.getByText('Saved fixture continues',{exact:true}).waitFor();
   assert.deepEqual(await page.evaluate(()=>window.__fixtureSwapCounts),[0]);assert.equal(await page.evaluate(()=>window.__fixtureIntervals.size),1);
   await page.clock.runFor(31000);assert.equal(counts().posts,1);assert.ok(counts().gets<=5,'Retired poller must not double status traffic');assert.equal(await page.evaluate(()=>window.__fixtureIntervals.size),1);
  });
  await run('native lifecycle events resume one read-only poller','read-only',async({page,counts})=>{
   await page.getByText('Saved fixture continues',{exact:true}).waitFor();await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));assert.equal(await page.evaluate(()=>window.__fixtureIntervals.size),0);
   await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await page.getByText('Saved fixture continues',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.__fixtureIntervals.size),1);await page.clock.runFor(11000);assert.equal(counts().posts,0);assert.ok(counts().gets>=2);
  });
  report.passed=report.cases.length===3&&report.cases.every(c=>c.passed);
 }finally{
  for(const context of contexts)await context.close();await browser.close();report.cleanup={contextsClosed:contexts.size===0,browserClosed:!browser.isConnected()};
  report.sourceFiles=Object.fromEntries(SOURCE_FILES.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',file))).digest('hex')]));
  const dir=fs.mkdtempSync(path.resolve(__dirname,'../diagnostics/signup-resilience-browser-'));fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({report:path.join(dir,'result.json'),...report}));
 }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
