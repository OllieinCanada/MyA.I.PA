import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import AdminSignupTracker from './AdminSignupTracker';
import ProviderMaintenance from './ProviderMaintenance';
import useSavedEvidence from './useSavedEvidence';
import SavedEvidenceStatus from './SavedEvidenceStatus';
const {projectSetup}=require('../server/adminSignupSetup');
// Product cadence/deadlines use fake timers below; allow slow local DOM/ICU
// initialization without relaxing any five-second or no-overlap assertion.
jest.setTimeout(20000);
jest.mock('./SignupControlRoom',()=>({__esModule:true,default:({row})=><div data-testid="chosen-signup">{row.currentStep}</div>}));
const flush=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
const reply=(status,body)=>({ok:status===200,status,headers:{get:()=>null},json:async()=>body});
const id='signup_'+'a'.repeat(32);
function row(extra={}){return{attemptId:id,businessName:'Invented Pilot',ownerName:'Fixture Owner',signedUpAt:new Date().toISOString(),
 lastProgressAt:new Date().toISOString(),mode:'working',active:true,stalled:false,status:'setup_started',currentStep:'Assigning number',nextAction:'Read saved progress',
 completedSteps:1,totalSteps:10,steps:[],info:{},infoRevision:'fixture-revision',...extra};}
let root,container,fetchBefore;
beforeEach(()=>{
 global.IS_REACT_ACT_ENVIRONMENT=true;jest.useFakeTimers();fetchBefore=global.fetch;
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});
 Object.defineProperty(navigator,'onLine',{configurable:true,value:true});
 container=document.createElement('div');document.body.append(container);root=createRoot(container);
});
afterEach(()=>{try{act(()=>root.unmount());expect(jest.getTimerCount()).toBe(0);}finally{container.remove();global.fetch=fetchBefore;jest.useRealTimers();}});
const advance=async ms=>act(async()=>{jest.advanceTimersByTime(ms);await flush();});

test('the actual tracker advances automatically and keeps a just-completed signup visible',async()=>{
 let current=row();const trace=[];
 global.fetch=jest.fn(async(url,options)=>{
  expect(options.method).toBe('GET');expect(options.credentials).toBe('include');expect(options.cache).toBe('no-store');expect(options.body).toBeUndefined();trace.push(url);
  if(url.endsWith('/signup-tracker'))return reply(200,{ok:true,rows:[current],summary:{},generatedAt:new Date().toISOString()});
  if(url.endsWith('/provider-status'))return reply(200,{readOnly:true,providers:[],history:[]});
  if(url.includes('/signup-bugs?'))return reply(200,{readOnly:true,events:[],groups:[]});
  throw Error('Forbidden request');
 });
 await act(async()=>{root.render(<AdminSignupTracker apiBase="https://fixture.test"/>);await flush();});
 expect(container.querySelector('select').value).toBe('watching');expect(container.textContent).toContain('Signup updates: connected');
 current=row({currentStep:'Assistant created'});await advance(5000);expect(container.textContent).toContain('Assistant created');
 current=row({active:false,mode:'ready',status:'setup_ready',currentStep:'Setup ready'});await advance(5000);
 expect(container.querySelectorAll('.signup-tracker-row')).toHaveLength(1);expect(container.textContent).toContain('Setup ready');
 expect(trace.filter(url=>url.endsWith('/signup-tracker'))).toHaveLength(3);expect(trace.filter(url=>url.endsWith('/provider-status'))).toHaveLength(1);
});

test('provider failures stay visibly stale during a retry and recover only after a successful read',async()=>{
 let mode='good',resolve;
 const body={readOnly:true,providers:[{id:'render',name:'Fixture Provider',fresh:true,indicator:'none',lastSuccessfulAt:new Date().toISOString(),notices:[],sourceUrl:'https://example.test',features:'Synthetic status'}],history:[]};
 global.fetch=jest.fn(()=>mode==='good'?Promise.resolve(reply(200,body)):mode==='fail'?Promise.resolve(reply(503,{})):new Promise(r=>resolve=r));
 await act(async()=>{root.render(<ProviderMaintenance apiBase="https://fixture.test"/>);await flush();});
 expect(container.textContent).toContain('Provider reports: none');
 mode='fail';await act(async()=>{container.querySelector('button').click();await flush();});
 expect(container.textContent).toContain('HTTP 503');expect(container.textContent).not.toContain('Provider reports: none');
 mode='pending';await advance(60000);expect(container.textContent).not.toContain('Provider reports: none');
 await act(async()=>{resolve(reply(200,body));await flush();});expect(container.textContent).toContain('Provider reports: none');
});

const validate=b=>b?.ok===true;
function Probe({scope='one'}){
 const feed=useSavedEvidence({url:'https://fixture.test/'+scope,validate});
 return <><SavedEvidenceStatus state={feed.state}/><div id="value">{feed.data?.value||'Unknown'}</div><button onClick={feed.load}>Refresh</button></>;
}
test('session expiry is explicit, keeps saved data stale and stops background authentication attempts',async()=>{
 let fail=false;global.fetch=jest.fn(async()=>fail?reply(401,{}):reply(200,{ok:true,value:'Saved fixture'}));
 await act(async()=>{root.render(<Probe/>);await flush();});fail=true;await advance(5000);
 expect(container.textContent).toContain('Sign-in is required');expect(container.textContent).toContain('HTTP 401');expect(container.querySelector('#value').textContent).toBe('Saved fixture');
 const reads=global.fetch.mock.calls.length;await advance(120000);await act(async()=>{window.dispatchEvent(new Event('focus'));await flush();});expect(global.fetch).toHaveBeenCalledTimes(reads);
});
test('hidden/offline suspension and scope changes cannot show another signup response',async()=>{
 const pending={};global.fetch=jest.fn(url=>new Promise(resolve=>pending[url]=resolve));
 await act(async()=>{root.render(<Probe scope="old"/>);await flush();});
 await act(async()=>{root.render(<Probe scope="new"/>);await flush();});expect(container.querySelector('#value').textContent).toBe('Unknown');
 await act(async()=>{pending['https://fixture.test/new'](reply(200,{ok:true,value:'Current'}));pending['https://fixture.test/old'](reply(200,{ok:true,value:'Wrong'}));await flush();});
 expect(container.querySelector('#value').textContent).toBe('Current');
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));await flush();});
 const reads=global.fetch.mock.calls.length;await advance(60000);expect(global.fetch).toHaveBeenCalledTimes(reads);
 Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));await flush();});expect(global.fetch).toHaveBeenCalledTimes(reads+1);
});
test('an older detailed snapshot cannot hide newer progress received by the actual control room',async()=>{
 const Actual=jest.requireActual('./SignupControlRoom').default;
 const setup=(at,detail)=>{const result=projectSetup({});result.checkedAt=at;result.groups[0].checks[0]={id:'fixture',label:'Fixture checkpoint',state:'blocked',detail};return result;};
 const older=setup('2026-11-19T01:00:00Z','Old detailed marker'),newer=setup('2026-11-19T01:01:00Z','New parent marker');
 let detail=older;
 global.fetch=jest.fn(async(url)=>url.endsWith('/setup')?reply(200,{setup:detail}):reply(200,{readOnly:true,events:[],groups:[]}));
 await act(async()=>{root.render(<Actual row={row({setup:older})} apiBase="https://fixture.test"/>);await flush();});
 expect(container.textContent).toContain('Old detailed marker');
 detail=newer;
 await act(async()=>{root.render(<Actual row={row({setup:newer,completedSteps:2})} apiBase="https://fixture.test"/>);await flush();});
 expect(container.textContent).toContain('New parent marker');expect(container.textContent).not.toContain('Old detailed marker');
 expect(global.fetch.mock.calls.filter(([url])=>url.endsWith('/setup'))).toHaveLength(2);
 const timestampOnly={...older,checkedAt:'2026-11-19T01:02:00Z'};
 await act(async()=>{root.render(<Actual row={row({setup:timestampOnly,completedSteps:2})} apiBase="https://fixture.test"/>);await flush();});
 expect(container.textContent).toContain('New parent marker');expect(global.fetch.mock.calls.filter(([url])=>url.endsWith('/setup'))).toHaveLength(2);
});
