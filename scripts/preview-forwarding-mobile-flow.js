// Render the real verification-page template and compiled forwarding screen with
// an offline fixture. Clicking Continue is tested; no carrier command is dialled.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {resolveForwardingRule}=require('../server/callForwardingProvider');
const NUMBER='+12896723342',ORIGIN='http://127.0.0.1:3219';
function numberReadyHtml(){
 const source=fs.readFileSync('server/index.js','utf8'),start=source.indexOf('    function renderVerificationPage(');
 const render=source.slice(start,source.indexOf('    async function renderSavedProgress',start));
 let html='';const res={status(){return this;},send(value){html=value;return this;}};
 const context={res,req:{method:'GET'},verificationChannel:'sms',normalizePhoneForMatch:x=>x,
  formatAssignedPhone:x=>'+1 ('+x.slice(2,5)+') '+x.slice(5,8)+'-'+x.slice(8),
  escapeHtml:x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  FRONTEND_APP_URL:ORIGIN,CUSTOMER_SUPPORT_PHONE:'+19055550100',encodeURIComponent};
 const fn=vm.runInNewContext(render+'\nrenderVerificationPage;',context);
 fn({ok:true,title:'Your My AI PA number is ready',body:'Your new receptionist is ready. Tap Continue to set up missed-call forwarding on your mobile.',assignedPhone:NUMBER,forwardingSetupUrl:ORIGIN+'/#/f/preview-only'});
 return html;
}
async function main(){
 const executable='C:/Users/Olive/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe';
 const browser=await chromium.launch({headless:true,executablePath:fs.existsSync(executable)?executable:undefined,args:['--disable-gpu','--disable-dev-shm-usage']});
 const root=path.resolve('docs'),out=path.resolve('diagnostics/mobile-forwarding-review');fs.mkdirSync(out,{recursive:true});
 const html=numberReadyHtml(),rule=resolveForwardingRule({destination:NUMBER});
 fs.writeFileSync(path.join(out,'number-ready.html'),html);
 try{for(const [name,width] of [['mobile',390],['desktop',1365]]){
  const page=await browser.newPage({viewport:{width,height:900},userAgent:'Android',reducedMotion:'reduce'});
  page.setDefaultTimeout(20000);const errors=[];let writes=0;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{
   const url=new URL(route.request().url());
   if(route.request().method()!=='GET'){writes++;return route.abort();}
   if(url.pathname==='/api/forwarding/setup')return route.fulfill({json:{ok:true,forwarding:{id:'offline-fixture',carrier:'not_sure',lineType:'mobile',forwardingStatus:'ready_to_activate',assignedMyAiPaNumber:NUMBER,rule}}});
   if(url.origin!==ORIGIN)return route.abort();
   if(url.pathname==='/number-ready')return route.fulfill({contentType:'text/html',body:html});
   const file=path.resolve(root,url.pathname==='/'?'index.html':decodeURIComponent(url.pathname).slice(1));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.abort();
   return route.fulfill({path:file});
  });
  await page.goto(ORIGIN+'/number-ready',{waitUntil:'domcontentloaded'});
  await page.screenshot({path:path.join(out,'number-ready-'+name+'.png'),fullPage:true,animations:'disabled',timeout:60000});
  await page.getByRole('link',{name:'Tap Continue to get instant call forwarding',exact:true}).click();
  await page.getByRole('button',{name:'Open Phone App to Set Up Forwarding',exact:true}).waitFor();
  assert.equal(await page.locator('.forwarding-activate').getAttribute('href'),rule.activationTelUri);
  assert.equal(await page.locator('.forwarding-command strong').textContent(),rule.activationDialString);
  assert.equal(await page.locator('select').count(),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.equal(writes,0);assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(out,'forwarding-'+name+'.png'),fullPage:true,animations:'disabled',timeout:60000});
  await page.close();console.log('PASS '+name+': real Continue opens mobile code/button immediately; zero provider requests or writes.');
 }}finally{await browser.close();}
 console.log('Code: '+rule.activationDialString+'; screenshots: '+out);
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
