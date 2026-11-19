import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import SignupNowOverview from './SignupNowOverview';
import AdminSignupTracker from './AdminSignupTracker';
jest.setTimeout(20000);
let root,container,previousFetch;
beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;previousFetch=global.fetch;container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(()=>{try{act(()=>root.unmount());}finally{container.remove();global.fetch=previousFetch;}});
const flush=async()=>{for(let i=0;i<24;i++)await Promise.resolve();};
const draft=(extra={})=>({id:'fd_00000000-0000-4000-8000-000000000001',identity:'unlinked_visitor_unknown_identity',engaged:true,createdAt:Date.now(),startedAt:Date.now(),lastObservedAt:Date.now(),observedAgeMs:0,currentStep:'trade',currentStepLabel:'Trade',fields:[],blockerLabels:[],blockers:[],coverage:{},...extra});
const data=d=>({ok:true,rows:[],summary:{active:0,stalled:0,ready:0},formObservations:{rows:[d],coverage:{hasMore:false}}});
test('six small boxes remain collapsed until clicked and update the actual field inspector without guessing a name',async()=>{
 let d=draft();await act(async()=>{root.render(<SignupNowOverview data={data(d)}/>);await flush();});
 expect(container.querySelectorAll('.signup-now-stages button')).toHaveLength(6);expect(container.querySelector('.signup-now-inspector')).toBeNull();
 const details=[...container.querySelectorAll('.signup-now-stages button')].find(b=>b.textContent.includes('Details'));act(()=>details.click());
 expect(container.textContent).toContain('No field observations were saved');
 d=draft({currentStep:'business_details',currentStepLabel:'Business details',fields:[{id:'business_phone',label:'Business phone',observedAt:Date.now(),visibleAtObservation:'visible',currentStepVisible:true,required:true,validation:'invalid',presence:'present',reasonLabel:'Does not pass this form’s validation'}]});
 await act(async()=>{root.render(<SignupNowOverview data={data(d)}/>);await flush();});
 expect(container.querySelector('.signup-now-inspector').textContent).toContain('Business phone');expect(container.textContent).toContain('Does not pass this form’s validation');expect(container.textContent).not.toContain('Super Dan');
 expect(container.textContent).toContain('awaits the next background check');
 d={...d,startAlertQueuedAt:Date.now()};await act(async()=>{root.render(<SignupNowOverview data={data(d)}/>);await flush();});expect(container.textContent).toContain('delivery not confirmed here');
});
test('exact linkage replaces the anonymous draft with the saved business, not a same-name inference',async()=>{
 const d=draft(),row={attemptId:'signup_'+'a'.repeat(32),businessName:'Invented Harbour Services',active:true,mode:'working',signedUpAt:new Date().toISOString(),currentStep:'Assigning number',setup:{groups:[]}};
 const inspected=[];await act(async()=>{root.render(<SignupNowOverview data={{...data({...d,linkedAttemptId:row.attemptId}),rows:[row]}} onInspectSignup={id=>inspected.push(id)}/>);await flush();});
 expect(container.querySelectorAll('.signup-now-visitors button')).toHaveLength(1);expect(container.textContent).toContain(row.businessName);expect(container.textContent).not.toContain('Visitor 00000001');
 act(()=>container.querySelector('.signup-now-open').click());expect(inspected).toEqual([row.attemptId]);
});
test('missing browser coverage is unknown, never an all-clear zero',async()=>{
 await act(async()=>{root.render(<SignupNowOverview data={{rows:[],summary:{},formObservations:{rows:[],coverage:{unavailable:true}}}}/>);await flush();});
 expect(container.querySelector('.signup-now-counts strong').textContent).toBe('—');expect(container.querySelector('[role="alert"]').textContent).toContain('Missing drafts are not proof nobody started');
});
test('the actual tracker exposes anonymous progress before named rows and keeps huge setup workspaces collapsed',async()=>{
 const row={attemptId:'signup_'+'a'.repeat(32),businessName:'Older Fixture Electrical',ownerName:'Invented Owner',active:true,stalled:true,mode:'working',currentStep:'Assigning number',signedUpAt:new Date(Date.now()-3600000).toISOString(),steps:[],completedSteps:0,totalSteps:10,info:{},setup:null};
 global.fetch=jest.fn(async url=>({ok:true,status:200,json:async()=>url.endsWith('/signup-tracker')?{...data(draft()),rows:[row]}:url.endsWith('/provider-status')?{readOnly:true,providers:[],history:[]}:{readOnly:true,events:[],groups:[]}}));
 await act(async()=>{root.render(<AdminSignupTracker/>);await flush();});
 expect(container.querySelector('.signup-now')).not.toBeNull();expect(container.querySelector('.signup-now-selected').textContent).toContain('Visitor');expect(container.querySelector('.signup-tracker-row').className).toContain('is-compact');expect(global.fetch.mock.calls.some(([url])=>url.endsWith('/setup'))).toBe(false);
 const inspect=[...container.querySelectorAll('button')].find(b=>b.textContent==='Inspect '+row.businessName);await act(async()=>{inspect.click();await flush();});expect(global.fetch.mock.calls.some(([url])=>url.endsWith('/setup'))).toBe(true);
});
