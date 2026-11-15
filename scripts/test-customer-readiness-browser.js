'use strict';
// Sealed UI fixtures only. Every request is fulfilled locally or refused.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const browsers=require('./playwright-runtime');
const coverage=require('./customer-readiness-browser-coverage');
const root=path.resolve('build-candidate'),base='http://127.0.0.1:4179';
const bounded=(work,ms)=>Promise.race([work,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Owned browser cleanup deadline exceeded')),ms);timer.unref();})]);
const fixture={businessId:101,signup:{businessName:'Fictional Pilot Electric',ownerName:'Fixture Owner',twilioPhoneNumber:'+12025550101',status:'setup_ready'},
 stats:{},agentTesting:{passed:true},billing:{paymentReady:true},setup:{checklist:[]},faqs:[],
 calls:[{id:101,status:'COMPLETED',startedAt:'2030-01-02T17:00:00Z',durationSec:50,aiSummary:'Fictional estimate enquiry; no real action.',
 caller:{name:'Synthetic Caller',phone:'+12025550103'},lead:{id:201,name:'Synthetic Caller',summary:'Fictional enquiry'},details:{},
 notificationEvidence:{available:true,submission:'owner_notification_accepted',owner:{state:'accepted',accepted:true},customer:{state:'unconfirmed'}}}]};
async function run(){
 const identity=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true});
 assert.ok(identity.status===0&&/^[a-f0-9]{40}$/.test(identity.stdout.trim()),'Exact source identity required');
 const sourceHead=identity.stdout.trim();
 assert.ok(!process.env.CUSTOMER_READINESS_HEAD||process.env.CUSTOMER_READINESS_HEAD===sourceHead,'Expected head mismatch');
 const args=process.argv.slice(2);
 assert.ok(args.length<=1&&args.every(a=>/^--engines=(chromium|firefox|webkit)(,(chromium|firefox|webkit))*$/.test(a)),'Only a focused engine selection is supported');
 const selected=args.length?args[0].slice(10).split(','):coverage.ENGINES;
 assert.equal(new Set(selected).size,selected.length,'Duplicate engine selection');
 assert.ok(fs.existsSync(path.join(root,'index.html')),'Build candidate first');
 const out=path.resolve('diagnostics/customer-readiness/browser-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex'));
 fs.mkdirSync(out,{recursive:true});
 const report={checkedAt:new Date().toISOString(),sourceHead,scope:'local-built-UI-with-inert-fixtures',cases:[],failures:[],
  requestedEngines:selected,requiredEngines:coverage.ENGINES,widths:coverage.WIDTHS,unexpectedWrites:[],blockedExternal:0,blockedSockets:0,
  providerActions:0,productionWrites:0,realDeliveryProven:false,shippingReady:false};
 const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 report.buildManifestSha256=sha(fs.readFileSync(path.join(root,'asset-manifest.json')));
 report.sourceSha256=Object.fromEntries(['src/index.js','src/AdminDashboard.js','src/CustomerDashboard.js',
  'src/components/CallOutcomeTimeline.js','src/components/CallOutcomeTimeline.css','src/features/calls/callOutcomeTimeline.js',
  'src/components/ReviewedAnswerDraft.js','src/components/ReviewedAnswerDraft.css','src/components/RouteBoundary.js',
  'scripts/test-customer-readiness-browser.js','scripts/customer-readiness-browser-coverage.js'].map(file=>[file,sha(fs.readFileSync(file))]));
 report.qualification='Mocked signed-in UI data only, not server authentication, SQL restore, real Safari hardware, provider delivery or an OS network sandbox.';
 for(const engine of report.requestedEngines){let browser;
  try{browser=await browsers[engine].launch({headless:true,timeout:60000});
   for(const width of report.widths){const context=await browser.newContext({viewport:{width,height:1000},serviceWorkers:'block'});
    const errors=[],assets=[];
    try{
     await context.routeWebSocket('**/*',socket=>{report.blockedSockets++;socket.close();});
     await context.route('**/*',async route=>{
      const req=route.request(),url=new URL(req.url());
      const cors={'access-control-allow-origin':base,'access-control-allow-credentials':'true','access-control-allow-headers':'content-type','access-control-allow-methods':'GET,OPTIONS'};
      if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:cors});
      if(!['GET','HEAD'].includes(req.method())){report.unexpectedWrites.push({engine,width,path:url.pathname});return route.abort();}
      if(url.origin==='https://api.myaipa.ca'&&url.pathname==='/api/customer/dashboard')return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify({dashboard:fixture,refreshedAt:'2030-01-02T17:00:00Z'})});
      if(url.origin==='https://api.myaipa.ca'&&url.pathname.startsWith('/api/admin/')) {
       const body=url.pathname==='/api/admin/calls'?{ok:true,calls:fixture.calls}:url.pathname==='/api/admin/calls/101'?{ok:true,call:fixture.calls[0]}:{ok:true};
       return route.fulfill({headers:cors,contentType:'application/json',body:JSON.stringify(body)});
      }
      if(url.origin!==base){report.blockedExternal++;return route.abort();}
      const file=path.resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:''});
      if(file.endsWith('.js'))assets.push(url.pathname);
      const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.mp3':'audio/mpeg'};
      return route.fulfill({contentType:mime[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
     });
     const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
     await page.goto(base,{waitUntil:'domcontentloaded',timeout:20000});await page.locator('#root > *').first().waitFor();
     assert.ok(!assets.some(p=>/\/(admin|customer|signup)\./.test(p)),'Homepage fetched a secondary route chunk');
     await page.goto(base+'/#/dashboard',{waitUntil:'domcontentloaded',timeout:20000});
     await page.locator('.customer-call-summary').first().click({timeout:20000});
     const timeline=page.getByRole('region',{name:'Call outcome evidence'});await timeline.waitFor();
     assert.equal(await timeline.locator('li').count(),5);
     assert.ok((await timeline.innerText()).includes('delivery is not confirmed'));
     assert.equal(await timeline.locator('button,a').count(),0);
     await timeline.screenshot({path:path.join(out,engine+'-'+width+'-timeline.png')});
     await page.getByText('More settings',{exact:true}).click();
     const draft=page.getByRole('region',{name:'Reviewed answer preparation'});await draft.waitFor();
     await draft.getByLabel('Caller question',{exact:true}).fill('Do you provide weekend estimates?');
     await draft.getByLabel('Proposed business answer',{exact:true}).fill('Please request a callback to confirm availability.');
     await draft.getByLabel('Verified source or business fact',{exact:true}).fill('Invented fixture policy, confirmed for this test only.');
     await draft.getByRole('button',{name:'Mark draft reviewed',exact:true}).click();
     await draft.getByText('Reviewed draft only—not published. Editing any field removes this review.',{exact:true}).waitFor();
     await draft.getByLabel('Caller question',{exact:true}).focus();
     assert.ok(await draft.getByLabel('Caller question',{exact:true}).evaluate(el=>el===document.activeElement));
     await draft.screenshot({path:path.join(out,engine+'-'+width+'-answer.png')});
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Horizontal page overflow');
     await page.goto(base+'/#/admin?tab=calls',{waitUntil:'domcontentloaded',timeout:20000});
     await page.getByRole('button',{name:'Review Call',exact:true}).first().click({timeout:20000});
     const adminTimeline=page.getByRole('region',{name:'Call outcome evidence'});await adminTimeline.waitFor();
     assert.equal(await adminTimeline.locator('li').count(),5);
     const bounds=await adminTimeline.boundingBox();
     for(const card of await adminTimeline.locator('li').all())assert.ok((await card.boundingBox()).width>=Math.min(200,bounds.width-40),'Timeline cards squeezed by parent layout');
     await adminTimeline.screenshot({path:path.join(out,engine+'-'+width+'-admin-timeline.png')});
     assert.deepEqual(errors,[]);report.cases.push({engine,width,passed:true,adminTimelinePassed:true,routeChunkLoaded:assets.some(p=>/\/customer\./.test(p))&&assets.some(p=>/\/admin\./.test(p))});
    }catch(e){report.failures.push({engine,width,message:String(e.message).slice(0,300)});}
    finally{await bounded(context.close(),10000);}
   }
  }catch(e){report.failures.push({engine,message:String(e.message).slice(0,300)});}
  finally{if(browser)try{await bounded(browser.close(),10000);}catch(e){report.failures.push({engine,phase:'cleanup',message:e.message});}}
 }
 report.buildUnchanged=report.buildManifestSha256===sha(fs.readFileSync(path.join(root,'asset-manifest.json')));
 report.completeMatrixPassed=coverage.complete(report);
 report.focusedRun=selected.length!==coverage.ENGINES.length;
 report.focusedCasesPassed=report.buildUnchanged&&report.cases.length===selected.length*3&&report.cases.every(c=>c.passed&&c.adminTimelinePassed&&c.routeChunkLoaded)&&report.failures.length===0&&report.unexpectedWrites.length===0;
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2),{flag:'wx'});
 console.log(JSON.stringify({out,...report}));if(!report.focusedCasesPassed||(!report.focusedRun&&!report.completeMatrixPassed))process.exitCode=1;
}
if(require.main===module)run().catch(()=>{console.error('SEALED_UI_REHEARSAL_FAILED');process.exitCode=1;});
