const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createSavedEvidencePoller,matchesSignupView}=require('../src/features/admin/savedEvidencePolling');
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};
const response=(status=200,body={ok:true},retry=null)=>({ok:status===200,status,headers:{get:()=>retry},json:async()=>body});
function fixture(overrides={}){
 let clock=100000,id=0,visible=true,online=true;
 const tasks=new Map(),calls=[],data=[],states=[];
 const schedule=(fn,delay)=>{tasks.set(++id,{fn,at:clock+delay});return id;};
 const cancel=key=>tasks.delete(key);
 const f={tasks,calls,data,states,setVisible:v=>visible=v,setOnline:v=>online=v,now:()=>clock};
 f.poller=createSavedEvidencePoller({url:'/api/admin/signup-tracker',validate:b=>b?.ok===true,
  fetchImpl:async(url,options)=>{calls.push({url,options});return response();},
  onData:b=>data.push(b),onState:s=>states.push(s),schedule,cancel,now:()=>clock,visible:()=>visible,online:()=>online,...overrides});
 f.advance=async(ms)=>{const end=clock+ms;let rounds=0;
  for(;;){const next=[...tasks].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;
   assert.ok(++rounds<100,'bounded timer execution');clock=next[1].at;tasks.delete(next[0]);next[1].fn();await flush();}
  clock=end;await flush();};
 f.state=()=>states.at(-1);
 return f;
}

test('immediate read and five-second updates use only uncached authenticated GETs',async()=>{
 const f=fixture();await f.poller.start();assert.equal(f.data.length,1);
 await f.advance(4999);assert.equal(f.calls.length,1);await f.advance(1);assert.equal(f.calls.length,2);
 for(const c of f.calls){assert.equal(c.url,'/api/admin/signup-tracker');assert.equal(c.options.method,'GET');assert.equal(c.options.credentials,'include');assert.equal(c.options.cache,'no-store');assert.equal(c.options.body,undefined);}
 f.poller.stop();assert.equal(f.tasks.size,0);
});
test('slow reads and repeated manual/focus refreshes never overlap',async()=>{
 let resolve,count=0;const f=fixture({fetchImpl:()=>{count++;return new Promise(r=>resolve=r);}});
 const first=f.poller.start();f.poller.refresh();f.poller.sync();await f.advance(6000);assert.equal(count,1);
 resolve(response());await first;await f.advance(4999);assert.equal(count,1);await f.advance(1);assert.equal(count,2);f.poller.stop();
});
test('a timeout aborts its read, retains last-known data and retries GET safely',async()=>{
 let n=0,signal;const f=fixture({fetchImpl:async(_,o)=>{signal=o.signal;return ++n===1?response():new Promise(()=>{});}});
 await f.poller.start();await f.advance(5000);await f.advance(10000);
 assert.equal(signal.aborted,true);assert.equal(f.state().phase,'retrying');assert.equal(f.state().reason.code,'timeout');assert.equal(f.data.length,1);
 await f.advance(5000);assert.equal(n,3);f.poller.stop();assert.equal(f.tasks.size,0);
});
test('transient failures back off, preserve stale status while checking, and recover only on success',async()=>{
 let n=0,resolve;const f=fixture({fetchImpl:async()=>++n===1?response():n<4?response(503):new Promise(r=>resolve=r)});
 await f.poller.start();await f.advance(5000);assert.equal(f.state().reason.status,503);assert.equal(f.data.length,1);
 await f.advance(5000);assert.equal(n,3);await f.advance(9999);assert.equal(n,3);await f.advance(1);
 assert.equal(f.state().phase,'checking');assert.equal(f.state().reason.status,503);
 resolve(response(200,{ok:true,newer:true}));await flush();assert.equal(f.state().phase,'connected');assert.equal(f.state().reason,null);assert.equal(f.data.at(-1).newer,true);f.poller.stop();
});
for(const status of [401,403])test(`HTTP ${status} pauses automatic requests until an explicit refresh`,async()=>{
 let n=0;const f=fixture({fetchImpl:async()=>{n++;return response(status);}});await f.poller.start();
 assert.equal(f.state().phase,'auth_required');assert.equal(f.tasks.size,0);await f.advance(120000);f.poller.sync();await flush();assert.equal(n,1);
 await f.poller.refresh();assert.equal(n,2);assert.equal(f.data.length,0);f.poller.stop();
});
test('rate limits respect bounded Retry-After without issuing actions',async()=>{
 let n=0;const f=fixture({fetchImpl:async()=>{n++;return response(429,{},'3600');}});await f.poller.start();
 assert.equal(f.state().reason.code,'rate_limit');await f.advance(59999);assert.equal(n,1);await f.advance(1);assert.equal(n,2);f.poller.stop();
});
for(const bad of [()=>response(200,{rows:[]}),()=>({ok:true,json:async()=>{throw Error('private response');}})])test('malformed responses cannot produce a connected state',async()=>{
 const f=fixture({fetchImpl:async()=>bad()});await f.poller.start();assert.equal(f.state().phase,'retrying');assert.equal(f.state().reason.code,'invalid');assert.equal(f.data.length,0);assert.doesNotMatch(JSON.stringify(f.states),/private response/);f.poller.stop();
});
test('hidden tabs pause reads; returning visible triggers an immediate read',async()=>{
 const f=fixture();f.setVisible(false);await f.poller.start();assert.equal(f.calls.length,0);assert.equal(f.state().phase,'paused');
 f.setVisible(true);await f.poller.sync();assert.equal(f.calls.length,1);f.setVisible(false);f.poller.sync();await f.advance(60000);assert.equal(f.calls.length,1);
 f.setVisible(true);await f.poller.sync();assert.equal(f.calls.length,2);f.poller.stop();
});
test('offline reads pause and remain stale while the returning connection is checked',async()=>{
 let resolve,n=0;const f=fixture({fetchImpl:()=>{n++;return new Promise(r=>resolve=r);}});f.setOnline(false);await f.poller.start();assert.equal(n,0);
 f.setOnline(true);const p=f.poller.sync();assert.equal(n,1);assert.equal(f.state().reason.code,'offline');resolve(response());await p;assert.equal(f.state().reason,null);f.poller.stop();
});
test('late responses from an aborted read cannot overwrite a newer read',async()=>{
 const resolvers=[];const f=fixture({fetchImpl:()=>new Promise(r=>resolvers.push(r))});const old=f.poller.start();
 f.setVisible(false);f.poller.sync();f.setVisible(true);const current=f.poller.sync();
 resolvers[1](response(200,{ok:true,value:'current'}));await current;resolvers[0](response(200,{ok:true,value:'old'}));await old;
 assert.deepEqual(f.data,[{ok:true,value:'current'}]);f.poller.stop();assert.equal(f.tasks.size,0);
});
test('editor pause excludes reads and resumes without replaying any write',async()=>{
 const f=fixture();await f.poller.start();f.poller.pause();f.poller.refresh();await f.advance(60000);assert.equal(f.calls.length,1);
 await f.poller.resume();assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.options.method==='GET'));f.poller.stop();
});
test('history pages read once, without automatic cursor refreshes',async()=>{
 const f=fixture({auto:false});await f.poller.start();await f.advance(120000);await f.poller.sync();assert.equal(f.calls.length,1);await f.poller.refresh();assert.equal(f.calls.length,2);f.poller.stop();
});
test('unmount aborts, removes timers and ignores late success or failure',async()=>{
 let reject,signal;const f=fixture({fetchImpl:(_,o)=>{signal=o.signal;return new Promise((_,r)=>reject=r);}});const p=f.poller.start(),count=f.states.length;
 f.poller.stop();assert.equal(signal.aborted,true);assert.equal(f.tasks.size,0);reject(Error('private transport details'));await p;
 assert.equal(f.states.length,count);assert.equal(f.data.length,0);
});
test('default watch view retains recent completed signups without guessing missing dates',()=>{
 const now=Date.parse('2026-11-19T01:00:00Z');
 for(const row of [{active:true},{active:false,mode:'ready',lastProgressAt:'2026-11-19T00:59:00Z'}])assert.equal(matchesSignupView(row,'watching',now),true);
 for(const lastProgressAt of [undefined,'bad','2026-11-17T01:00:00Z','2026-11-20T01:00:00Z'])assert.equal(Boolean(matchesSignupView({active:false,mode:'ready',lastProgressAt},'watching',now)),false);
 assert.equal(matchesSignupView({mode:'ready'},'ready',now),true);assert.equal(matchesSignupView({},'all',now),true);
});
test('the adaptive frontend leaves the existing backend and ten-minute stall contract unchanged',()=>{
 const report=require('../server/adminSignupTracker').dashboard([]);
 assert.equal(report.pollIntervalSeconds,60);assert.equal(report.stallAfterMinutes,10);
});
