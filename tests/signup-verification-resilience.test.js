'use strict';
// Synthetic DOM, mocked fetch and controlled timers only. No live links, real
// network, providers, database, application startup or actual sends.
const test=require('node:test'),assert=require('node:assert/strict');
const {JSDOM}=require('jsdom');
const {verificationProgressScript,verificationProgressMarkup}=require('../server/signupVerificationProgress');
const {verificationPageClientScript}=require('../server/signupVerificationPageClient');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const resultHtml='<main><h1 id="verification-title">Saved setup</h1><p id="verification-description">Working from saved state</p></main>';
function fixture({confirmation=false,fetchImpl}={}){
 const intervals=new Map(),timeouts=new Map(),calls=[],openIntervalCounts=[];let seq=0,now=0;
 const dom=new JSDOM('<main><h1 id="verification-title">Checking</h1><p id="verification-description"></p><p id="setup-progress" hidden></p>'+
  (confirmation?'<form id="signup-verification-form" action="/confirm"><input name="token" value="invented-fixture"><button>Confirm</button></form><a id="verification-support" hidden>Support</a>':'')+
  verificationProgressMarkup()+'</main>'+verificationProgressScript('/progress',{awaitConfirmation:confirmation})+(confirmation?verificationPageClientScript({automaticSmsConfirmation:true}):''),
  {url:'https://example.invalid/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){
   w.Date.now=()=>now;
   w.setInterval=(fn,ms)=>{const id=++seq;intervals.set(id,{fn,ms});return id;};w.clearInterval=id=>intervals.delete(id);
   w.setTimeout=(fn,ms)=>{const id=++seq;timeouts.set(id,{fn,at:now+ms});return id;};w.clearTimeout=id=>timeouts.delete(id);
   const open=w.document.open.bind(w.document);w.document.open=(...args)=>{openIntervalCounts.push(intervals.size);return open(...args);};
   w.fetch=(url,options={})=>{calls.push({url,options});return fetchImpl?fetchImpl(url,options):Promise.resolve({ok:true,json:async()=>({signup:{state:'processing',title:'Saved setup',message:'Processing fixture'}})});};
  }});
 return{dom,intervals,timeouts,calls,openIntervalCounts,
  async advance(ms){now+=ms;for(const[id,timer]of[...timeouts])if(timer.at<=now){timeouts.delete(id);timer.fn();}await flush();},
  async poll(){for(const timer of[...intervals.values()])await timer.fn();await flush();},
  close(){dom.window.close();intervals.clear();timeouts.clear();}};
}
test('confirmation which never replies has a bounded unknown outcome and no second POST',async()=>{
 const f=fixture({confirmation:true,fetchImpl:(_url,options)=>options.method==='POST'?new Promise((resolve,reject)=>{options.signal?.addEventListener('abort',()=>reject(Error('Invented confirmation interruption')),{once:true});}):Promise.resolve({ok:true,json:async()=>({signup:{state:'processing',title:'Saved work continues',message:'No replay'}})})});
 try{assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);await f.advance(1000);await f.advance(14001);assert.equal(f.dom.window.document.querySelector('#setup-progress').hidden,true);assert.match(f.dom.window.document.querySelector('#verification-title').textContent,/Checking your saved setup/);assert.equal(f.calls[0].options.signal.aborted,true);await f.poll();assert.equal(f.dom.window.document.querySelector('#verification-title').textContent,'Saved work continues');assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);}finally{f.close();}
});
test('back/forward-cache restoration restarts exactly one read-only poller',async()=>{
 const f=fixture();try{await flush();assert.equal(f.intervals.size,1);f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pagehide',{persisted:true}));assert.equal(f.intervals.size,0);f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pageshow',{persisted:true}));await flush();assert.equal(f.intervals.size,1);f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pageshow',{persisted:true}));assert.equal(f.intervals.size,1);const before=f.calls.length;await f.poll();assert.equal(f.calls.length,before+1);assert.ok(f.calls.every(c=>c.options.method===undefined));}finally{f.close();}
});
test('confirmation response disposes the old poller before replacing the document',async()=>{
 let release;const response=new Promise(resolve=>{release=resolve;});
 const f=fixture({confirmation:true,fetchImpl:()=>response});try{assert.equal(f.intervals.size,1);release({headers:{get:()=> 'text/html'},text:async()=>resultHtml});await flush();assert.deepEqual(f.openIntervalCounts,[0]);assert.equal(f.intervals.size,0);assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.method,'POST');}finally{f.close();}
});

test('confirmation body-read timeout also stays unknown with one POST',async()=>{
 const f=fixture({confirmation:true,fetchImpl:(_url,options)=>options.method==='POST'?Promise.resolve({headers:{get:()=> 'text/html'},text:()=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('Invented body interruption')),{once:true});})}):Promise.resolve({ok:true,json:async()=>({signup:{state:'processing',title:'Saved fixture',message:'No replay'}})})});
 try{await flush();await f.advance(1000);await f.advance(14001);assert.equal(f.calls[0].options.signal.aborted,true);assert.match(f.dom.window.document.querySelector('#verification-title').textContent,/Checking your saved setup/);assert.equal(f.openIntervalCounts.length,0);await f.poll();assert.equal(f.calls.filter(c=>c.options.method==='POST').length,1);assert.equal(f.dom.window.document.querySelector('#verification-title').textContent,'Saved fixture');}finally{f.close();}
});

test('a stale response after page restoration cannot overwrite or unlock the new request',async()=>{
 const releases=[];const f=fixture({fetchImpl:()=>new Promise(resolve=>releases.push(resolve))});
 const response=title=>({ok:true,json:async()=>({signup:{state:'processing',title,message:'Synthetic saved state'}})});
 try{assert.equal(releases.length,1);const original=f.calls[0].options.signal;f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pagehide',{persisted:true}));assert.equal(original.aborted,true);f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pageshow',{persisted:true}));assert.equal(releases.length,2);releases[0](response('Stale result'));await flush();assert.notEqual(f.dom.window.document.querySelector('#verification-title').textContent,'Stale result');await f.poll();assert.equal(releases.length,2,'Retired request cannot clear successor busy state');releases[1](response('Current result'));await flush();assert.equal(f.dom.window.document.querySelector('#verification-title').textContent,'Current result');assert.equal(f.intervals.size,1);}finally{f.close();}
});

test('a retired page cannot restart polling after response replacement',async()=>{
 let release;const f=fixture({confirmation:true,fetchImpl:()=>new Promise(resolve=>{release=resolve;})});
 try{release({headers:{get:()=> 'text/html'},text:async()=>resultHtml});await flush();f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pageshow',{persisted:true}));f.dom.window.document.dispatchEvent(new f.dom.window.Event('visibilitychange'));await flush();assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,0);assert.equal(f.calls.length,1);}finally{f.close();}
});

test('page restoration preserves rate-limit backoff instead of flooding status reads',async()=>{
 let reads=0;const f=fixture({fetchImpl:async()=>{reads++;return reads===1?{ok:false,status:429,headers:{get:()=> '60'}}:{ok:true,json:async()=>({signup:{state:'processing',title:'Resumed after backoff',message:'Saved'}})};}});
 try{await flush();f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pagehide',{persisted:true}));f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pageshow',{persisted:true}));await flush();assert.equal(reads,1);await f.advance(59000);await f.poll();assert.equal(reads,1);await f.advance(1000);await f.poll();assert.equal(reads,2);}finally{f.close();}
});

test('closed and expired progress dispose timers and cannot resume from pageshow',async()=>{
 for(const response of [{ok:false,status:410},{ok:true,json:async()=>({signup:{state:'closed',title:'Closed fixture',message:'Contact support'}})}]){
  const f=fixture({fetchImpl:async()=>response});try{await flush();assert.equal(f.intervals.size,0);assert.equal(f.timeouts.size,0);f.dom.window.dispatchEvent(new f.dom.window.PageTransitionEvent('pageshow',{persisted:true}));await f.poll();assert.equal(f.calls.length,1);assert.notEqual(f.dom.window.document.querySelector('#signup-progress-fill').style.width,'100%');}finally{f.close();}
 }
});
