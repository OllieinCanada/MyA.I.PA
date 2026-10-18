const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {verificationProgressScript,verificationProgressMarkup}=require('../server/signupVerificationProgress');
const tick=()=>new Promise(r=>setTimeout(r,25));

test('normal polling fits its server budget and 429 backs off, including visibility changes',async()=>{
  let poll,interval,now=100000,reads=0;
  const dom=new JSDOM('<main><h1 id="verification-title"></h1><p id="verification-description"></p>'+verificationProgressMarkup()+'</main>'+verificationProgressScript('/progress'),{
    runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
      w.Date.now=()=>now; w.setInterval=(fn,ms)=>{poll=fn;interval=ms;return 1;};
      w.fetch=async()=>{reads++;return reads===1?{ok:false,status:429,headers:{get:()=> '60'}}:{ok:true,json:async()=>({signup:{state:'processing',title:'Setting up',message:'Saved progress'}})};};
    }
  });
  try{
    await tick(); assert.equal(interval,15000); assert.ok(900000/interval<120); assert.equal(reads,1);
    for(let n=0;n<10;n++){await poll();dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));}
    assert.equal(reads,1); now+=59000; await poll(); assert.equal(reads,1);
    now+=1000; await poll(); assert.equal(reads,2); assert.equal(dom.window.document.querySelector('#verification-title').textContent,'Setting up');
  }finally{dom.window.close();}
});

test('a lost confirmation response keeps GET progress alive without another confirmation POST',async()=>{
  const {verificationPageClientScript}=require('../server/signupVerificationPageClient');
  let poll,posts=0,gets=0;
  const dom=new JSDOM('<main><h1 id="verification-title"></h1><p id="verification-description"></p><p id="setup-progress" hidden></p><form id="signup-verification-form" action="/confirm"><input name="token" value="fixture"><button>Confirm</button></form>'+verificationProgressMarkup()+'</main>'+verificationProgressScript('/progress',{awaitConfirmation:true})+verificationPageClientScript({automaticSmsConfirmation:true}),{
    url:'https://api.myaipa.test/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.setInterval=fn=>{poll=fn;return 1;};w.fetch=async(_url,options)=>{
      if(options.method==='POST'){posts++;throw Error('lost response');}gets++;return{ok:true,json:async()=>({signup:{state:'processing',title:'Saved setup is continuing',message:'No second signup needed'}})};
    };}
  });
  try{await tick();await poll();assert.equal(posts,1);assert.equal(gets,1);assert.equal(dom.window.document.querySelector('#verification-title').textContent,'Saved setup is continuing');}
  finally{dom.window.close();}
});
test('progress polling is read-only and shows a safe problem without inventing a number',async()=>{
  const calls=[];
  const dom=new JSDOM('<main><h1 id="verification-title"></h1><p id="verification-description"></p></main>'+verificationProgressScript('/api/signup/verification-progress?token=synthetic'),{
    url:'https://api.myaipa.test/',runScripts:'dangerously',pretendToBeVisual:true,
    beforeParse(w){w.fetch=async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({signup:{state:'needs_attention',title:'Text setup problem',message:'<img src=x onerror=alert(1)>',assignedPhone:'+12895550199'}})};};}
  });
  try{await tick();assert.equal(calls.length,1);assert.equal(calls[0].options.method,undefined);assert.equal(calls[0].options.cache,'no-store');assert.equal(dom.window.document.querySelector('h1').textContent,'Text setup problem');assert.equal(dom.window.document.querySelector('img'),null);assert.equal(dom.window.document.querySelector('a'),null);}
  finally{dom.window.close();}
});
test('expired progress stops with support instructions, not a new signup',async()=>{
  const dom=new JSDOM('<main><h1 id="verification-title"></h1><p id="verification-description"></p></main>'+verificationProgressScript('/api/signup/verification-progress?token=synthetic'),{
    runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.fetch=async()=>({ok:false,status:410});}
  });
  try{await tick();assert.match(dom.window.document.body.textContent,/expired.*support.*do not sign up again/);}
  finally{dom.window.close();}
});

test('confirmed progress is animated, pauses on review/errors, and never completes on elapsed time',async()=>{
  let poll,state={state:'processing',title:'Preparing',message:'Working'},reads=0;
  const dom=new JSDOM('<main><h1 id="verification-title"></h1><p id="verification-description"></p>'+verificationProgressMarkup()+'</main>'+verificationProgressScript('/progress'),{
    runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.setInterval=fn=>{poll=fn;return 1;};w.fetch=async(_url,options)=>{reads++;assert.equal(options.method,undefined);assert.ok(options.signal);return{ok:true,json:async()=>({signup:state})};};}
  });
  try{
    await tick();const d=dom.window.document,panel=d.querySelector('#signup-progress-panel'),bar=d.querySelector('[role="progressbar"]');
    assert.equal(panel.dataset.active,'true');assert.equal(d.querySelector('#signup-progress-fill').style.width,'10%');
    assert.equal(bar.hasAttribute('aria-valuenow'),false);assert.equal(d.querySelectorAll('li[data-status="done"]').length,1);
    for(let i=0;i<5;i++)await poll();assert.equal(d.querySelector('#signup-progress-fill').style.width,'10%');
    state={state:'final_checks',title:'Setup problem',message:'Saved'};await poll();assert.equal(panel.dataset.active,'false');assert.match(bar.getAttribute('aria-valuetext'),/attention/);
    state={state:'needs_attention',title:'Problem',message:'Support notified',assignedPhone:'+12895550199'};await poll();assert.equal(panel.dataset.active,'false');assert.match(d.querySelector('#signup-progress-label').textContent,/needs attention/);assert.doesNotMatch(d.body.textContent,/5550199/);
    state={state:'ready',title:'Still checking',message:'No verified number',assignedPhone:''};await poll();assert.notEqual(d.querySelector('#signup-progress-fill').style.width,'100%');
    state={state:'closed',title:'Closed',message:'Contact support'};await poll();const count=reads;await poll();assert.equal(reads,count);assert.equal(panel.dataset.active,'false');
  }finally{dom.window.close();}
});

test('real checkpoints tick off individually and survive connection interruptions without advancing',async()=>{
  const {buildSignupProgress}=require('../server/signupProgress');
  let poll,offline=false,progress=buildSignupProgress({contactVerified:true});
  const dom=new JSDOM('<main><h1 id="verification-title"></h1><p id="verification-description"></p>'+verificationProgressMarkup()+'</main>'+verificationProgressScript('/progress'),{
    runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.setInterval=fn=>{poll=fn;return 1;};w.fetch=async()=>{if(offline)throw Error('offline');return{ok:true,json:async()=>({signup:{state:'processing',title:'Setting up',message:'Your phone is verified.',progress}})};};}
  });
  try{
    await tick();const d=dom.window.document;
    assert.equal(d.querySelectorAll('li[data-status="done"]').length,1);
    progress=buildSignupProgress({contactVerified:true,receipts:{'twilio-number':{status:'completed',result:{twilioPhoneNumber:'+12895550199'}}}});
    await poll();assert.equal(d.querySelectorAll('li[data-status="done"]').length,2);
    assert.equal(d.querySelector('#signup-progress-label').textContent,'Creating your assistant');
    assert.equal(d.querySelector('[aria-current="step"]').textContent,'Assistant created');
    assert.equal(d.querySelector('[role="progressbar"]').getAttribute('aria-valuenow'),'2');
    offline=true;await poll();assert.equal(d.querySelectorAll('li[data-status="done"]').length,2);
    assert.equal(d.querySelector('#signup-progress-panel').dataset.active,'false');
    assert.equal(d.querySelector('#signup-progress-fill').style.width,'20%');
  }finally{dom.window.close();}
});

test('a lost connection pauses animation and a later read resumes the same progress',async()=>{
  let poll,offline=true;
  const dom=new JSDOM('<main><h1 id="verification-title"></h1><p id="verification-description"></p>'+verificationProgressMarkup()+'</main>'+verificationProgressScript('/progress'),{
    runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.setInterval=fn=>{poll=fn;return 1;};w.fetch=async()=>{if(offline)throw Error('offline');return{ok:true,json:async()=>({signup:{state:'processing',title:'Preparing',message:'Working'}})};};}
  });
  try{await tick();const panel=dom.window.document.querySelector('#signup-progress-panel');assert.equal(panel.dataset.active,'false');assert.match(panel.textContent,/Reconnecting/);offline=false;await poll();assert.equal(panel.dataset.active,'true');}
  finally{dom.window.close();}
});

test('confirmation previews neither poll nor mark the phone verified until confirmation starts',async()=>{
  let poll,reads=0;
  const dom=new JSDOM('<main><h1 id="verification-title"></h1><p id="verification-description"></p><form id="signup-verification-form"></form>'+verificationProgressMarkup()+'</main>'+verificationProgressScript('/progress',{awaitConfirmation:true}),{
    runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.setInterval=fn=>{poll=fn;return 1;};w.fetch=async()=>{reads++;return{ok:false,status:410};};}
  });
  try{await tick();assert.equal(reads,0);assert.equal(dom.window.document.querySelectorAll('li[data-status="done"]').length,0);dom.window.document.dispatchEvent(new dom.window.Event('signup-verification-started'));await poll();assert.equal(reads,1);assert.doesNotMatch(dom.window.document.querySelector('#verification-description').textContent,/This link expired/);assert.equal(dom.window.document.querySelectorAll('li[data-status="done"]').length,0);}
  finally{dom.window.close();}
});

test('verification page attaches read-only progress before the confirmation POST script',()=>{
  const fs=require('node:fs'),source=fs.readFileSync(require.resolve('../server/index.js'),'utf8');
  const start=source.indexOf('function renderVerificationPage('),page=source.slice(start,source.indexOf('async function renderSavedProgress',start));
  assert.match(page,/verificationProgressMarkup\(\)/);
  assert.ok(page.indexOf('verificationProgressScript(')<page.indexOf('verificationPageClientScript('));
  assert.match(verificationProgressMarkup(),/prefers-reduced-motion/);
});
