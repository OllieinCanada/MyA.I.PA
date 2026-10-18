// Entirely offline fixtures. No signup, provider, message or billing requests.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {verificationProgressMarkup,verificationProgressScript}=require('../server/signupVerificationProgress');
const {buildSignupProgress}=require('../server/signupProgress');
async function main(){
 const bundled='C:/Users/Olive/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
 const browser=await chromium.launch({headless:true,timeout:20000,executablePath:fs.existsSync(bundled)?bundled:undefined,args:['--disable-gpu','--disable-dev-shm-usage']});
 const out=path.resolve('diagnostics/verification-progress');fs.mkdirSync(out,{recursive:true});
 try{
  for(const width of [390,1440]){
   const progress = buildSignupProgress({contactVerified:true,receipts:{'twilio-number':{status:'completed',result:{twilioPhoneNumber:'+12895550199'}},'vapi-assistant':{status:'completed',result:{assistantId:'offline-fixture'}}}});
   let state={state:'processing',title:'We’re setting up your assistant.',message:'Your phone is verified. We’re preparing your assistant and assigning your My AI PA number.',progress};
   const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});page.setDefaultTimeout(10000);
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{
    const request=route.request(),url=new URL(request.url());
    assert.equal(request.method(),'GET');assert.equal(url.hostname,'127.0.0.1');
    if(url.pathname==='/progress')return route.fulfill({json:{signup:state}});
    return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:20px;box-sizing:border-box;background:#f2f7ff;font:18px Arial;color:#07142a}main{max-width:680px;margin:30px auto;background:white;padding:24px;box-sizing:border-box;border-radius:24px}h1{font-size:32px}p{line-height:1.5}</style><main><h1 id="verification-title">Setting up your assistant</h1><p id="verification-description"></p>'+verificationProgressMarkup()+'</main>'+verificationProgressScript('/progress')});
   });
   await page.goto('http://127.0.0.1/preview',{waitUntil:'domcontentloaded'});
   await page.getByText('Checking your assistant’s business answers',{exact:true}).waitFor();
   assert.equal(await page.locator('#signup-progress-steps li').count(),10);
   assert.equal(await page.locator('#signup-progress-steps li[data-status="done"]').count(),3);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.screenshot({path:path.join(out,'working-'+width+'.png'),fullPage:true});
   state={state:'needs_attention',title:'Setup needs attention',message:'Your signup is saved. Our team has been notified. Do not sign up again.'};
   await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
   await page.locator('#signup-progress-panel[data-active="false"]').waitFor();
   assert.notEqual(await page.locator('#signup-progress-fill').evaluate(e=>e.style.width),'100%');
   await page.screenshot({path:path.join(out,'paused-'+width+'.png'),fullPage:true});
   assert.deepEqual(errors,[]);await page.close();console.log('PASS '+width+'px: truthful progress, paused problem state, reduced motion, no overflow.');
  }
  console.log('Production requests: 0. Screenshots: '+out);
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
