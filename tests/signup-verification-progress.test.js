const test=require('node:test');
const assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {verificationProgressScript}=require('../server/signupVerificationProgress');
const tick=()=>new Promise(r=>setTimeout(r,25));
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
