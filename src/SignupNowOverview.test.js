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
test('trade symbol and label follow only the recorded selection, not names; expanded evidence updates and clears',async()=>{
 const show=async id=>{await act(async()=>{root.render(<SignupNowOverview data={data(draft({selectedTradeId:id,draftNames:{businessName:'Electrical Named Fixture',ownerName:''}}))}/>);await flush();});};
 await show('electrician');expect(container.querySelector('.signup-now-trade-summary').textContent).toContain('Electrician');
 expect(container.querySelector('.signup-now-stages button svg')).not.toBeNull();
 act(()=>container.querySelector('[aria-label="Inspect Trade form step"]').click());expect(container.querySelector('.signup-now-inspector').textContent).toContain('Electrician');
 await show('plumber');expect(container.querySelector('.signup-now-inspector').textContent).toContain('Plumber');expect(container.textContent).not.toContain('Electrician');
 await show(null);expect(container.querySelector('.signup-now-trade-summary').textContent).toContain('Trade not recorded');expect(container.querySelector('.signup-now-stages button svg')).toBeNull();
 await show('<img>');expect(container.querySelector('img')).toBeNull();expect(container.textContent).not.toContain('<img>');
});
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

test('draft names update as escaped text, stay unsubmitted and never borrow another same-name business',async()=>{
 let d=draft({draftNames:{businessName:'Invented Beacon',ownerName:'Alex Fixture'}});
 await act(async()=>{root.render(<SignupNowOverview data={data(d)}/>);await flush();});
 expect(container.querySelector('.signup-now-selected strong').textContent).toBe('Invented Beacon');expect(container.textContent).toContain('Owner entered: Alex Fixture');expect(container.textContent).toContain('Unsubmitted draft');expect(container.querySelector('.signup-now-open')).toBeNull();
 d={...d,draftNames:{businessName:'<img src=x onerror=alert(1)>',ownerName:'Corrected Fixture'}};
 await act(async()=>{root.render(<SignupNowOverview data={data(d)}/>);await flush();});
 expect(container.querySelector('.signup-now-selected strong').textContent).toBe(d.draftNames.businessName);expect(container.querySelector('img')).toBeNull();expect(container.textContent).not.toContain('Alex Fixture');
 d={...d,draftNames:{businessName:'',ownerName:''}};await act(async()=>{root.render(<SignupNowOverview data={data(d)}/>);await flush();});
 expect(container.querySelector('.signup-now-selected strong').textContent).toContain('Visitor');expect(container.querySelector('.signup-now-open')).toBeNull();
});

test('short phone labels preserve the full accessible step names and expanded evidence',async()=>{
 await act(async()=>{root.render(<SignupNowOverview data={data(draft())}/>);await flush();});
 const details=container.querySelector('[aria-label="Inspect Details form step"]');
 expect(details.querySelector('.signup-now-label-short').textContent).toBe('Info');
 expect(details.querySelector('.signup-now-label-full').textContent).toBe('Details');
 expect(container.querySelector('[aria-label="Inspect Pricing form step"] .signup-now-label-short').textContent).toBe('Rates');
 expect(container.querySelector('[aria-label="Inspect Review form step"] .signup-now-label-short').textContent).toBe('Final');
 act(()=>details.click());expect(container.querySelector('.signup-now-inspector h4').textContent).toContain('Details');
});
test('the actual tracker exposes anonymous progress before named rows and keeps huge setup workspaces collapsed',async()=>{
 const row={attemptId:'signup_'+'a'.repeat(32),businessName:'Older Fixture Electrical',ownerName:'Invented Owner',active:true,stalled:true,mode:'working',currentStep:'Assigning number',signedUpAt:new Date(Date.now()-3600000).toISOString(),steps:[],completedSteps:0,totalSteps:10,info:{},setup:null};
 global.fetch=jest.fn(async url=>({ok:true,status:200,json:async()=>url.endsWith('/signup-tracker')?{...data(draft()),rows:[row]}:url.endsWith('/provider-status')?{readOnly:true,providers:[],history:[]}:{readOnly:true,events:[],groups:[]}}));
 await act(async()=>{root.render(<AdminSignupTracker/>);await flush();});
 expect(container.querySelector('.signup-now')).not.toBeNull();expect(container.querySelector('.signup-now-selected').textContent).toContain('Visitor');expect(container.querySelector('.signup-tracker-row').className).toContain('is-compact');expect(global.fetch.mock.calls.some(([url])=>url.endsWith('/setup'))).toBe(false);
 const inspect=[...container.querySelectorAll('button')].find(b=>b.textContent==='Inspect '+row.businessName);await act(async()=>{inspect.click();await flush();});expect(global.fetch.mock.calls.some(([url])=>url.endsWith('/setup'))).toBe(true);
});

test('one toolbar sorts the actual overview and saved list together and survives saved-data refresh',async()=>{
 const at=Date.now();
 const row=(id,name,age,extra={})=>({attemptId:id,businessName:name,ownerName:'Fictional Owner',active:true,mode:'working',currentStep:'Assigning number',signedUpAt:new Date(at-age).toISOString(),steps:[],completedSteps:0,totalSteps:10,info:{},setup:null,...extra});
 const rows=[row('old','Zulu Fixture',7200000,{stalled:true,elapsedMs:1200000}),row('new','Alpha Fixture',60000,{lastProgressAt:new Date(at-1000).toISOString()})];
 let body={ok:true,rows,summary:{active:2,stalled:1,ready:0},formObservations:{rows:[],coverage:{}}};
 global.fetch=jest.fn(async url=>({ok:true,status:200,json:async()=>url.endsWith('/signup-tracker')?body:url.endsWith('/provider-status')?{readOnly:true,providers:[],history:[]}:{readOnly:true,events:[],groups:[]}}));
 await act(async()=>{root.render(<AdminSignupTracker/>);await flush();});
 const names=()=>[...container.querySelectorAll('.signup-tracker-business h3')].map(n=>n.textContent);
 const overviewNames=()=>[...container.querySelectorAll('.signup-now-visitors strong')].map(n=>n.textContent);
 const change=async(selector,value)=>{await act(async()=>{const input=container.querySelector(selector);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));await flush();});};
 expect(container.querySelectorAll('[aria-label="Find and sort signups"]')).toHaveLength(1);
 expect(names()).toEqual(['Alpha Fixture','Zulu Fixture']);expect(overviewNames()).toEqual(names());
 await change('[aria-label="Sort signups"]','oldest');expect(names()).toEqual(['Zulu Fixture','Alpha Fixture']);expect(overviewNames()).toEqual(names());
 await change('[aria-label="Sort signups"]','name');expect(names()).toEqual(['Alpha Fixture','Zulu Fixture']);
 await change('[aria-label="Sort signups"]','stuck');expect(names()[0]).toBe('Zulu Fixture');
 body={...body,rows:[rows[1],{...rows[0],lastProgressAt:new Date().toISOString()}]};
 await act(async()=>{[...container.querySelectorAll('button')].find(b=>b.textContent==='Refresh signups').click();await flush();});
 expect(container.querySelector('[aria-label="Sort signups"]').value).toBe('stuck');expect(names()[0]).toBe('Zulu Fixture');
 expect(global.fetch.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);
});

test('search/status/date filters include anonymous drafts honestly, expose empty results and reset without writes',async()=>{
 const at=Date.now(),d=draft({createdAt:at-2*86400000,lastObservedAt:at-1000});
 const row={attemptId:'signup_fixture',businessName:'Fictional Recent',ownerName:'Invented Owner',active:true,mode:'working',currentStep:'Assigning number',signedUpAt:new Date(at-60000).toISOString(),steps:[],completedSteps:0,totalSteps:10,info:{},setup:null};
 global.fetch=jest.fn(async url=>({ok:true,status:200,json:async()=>url.endsWith('/signup-tracker')?{...data(d),rows:[row]}:url.endsWith('/provider-status')?{readOnly:true,providers:[],history:[]}:{readOnly:true,events:[],groups:[]}}));
 await act(async()=>{root.render(<AdminSignupTracker/>);await flush();});
 const select=async(selector,value)=>{await act(async()=>{const el=container.querySelector(selector);el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));await flush();});};
 await select('[aria-label="Signup start date"]','24h');expect(container.querySelectorAll('.signup-now-visitors button')).toHaveLength(1);expect(container.querySelector('.signup-tracker-view-summary').textContent).toContain('1 signup · 0 drafts');
 await select('[aria-label="Show signups"]','ready');expect(container.querySelector('.signup-tracker-empty')).not.toBeNull();expect(container.textContent).toContain('No observed starts match this view');
 await act(async()=>{[...container.querySelectorAll('button')].find(b=>b.textContent==='Reset view').click();await flush();});
 expect(container.querySelector('[aria-label="Signup start date"]').value).toBe('all');expect(container.querySelector('[aria-label="Show signups"]').value).toBe('watching');expect(container.querySelectorAll('.signup-now-visitors button')).toHaveLength(2);
 // Native setter exercises React's controlled search input rather than editing state directly.
 await act(async()=>{const el=container.querySelector('input[type="search"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'visitor');el.dispatchEvent(new Event('input',{bubbles:true}));await flush();});
 expect(container.querySelectorAll('.signup-tracker-row')).toHaveLength(0);expect(container.querySelectorAll('.signup-now-visitors button')).toHaveLength(1);
 expect(global.fetch.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);
});

test('quick view buttons reset the actual toolbar and overview without any writes or diagnostic calls',async()=>{
 const at=Date.now();
 const rows=[{attemptId:'old',businessName:'Older Fixture',active:true,stalled:true,mode:'working',currentStep:'Assigning number',signedUpAt:new Date(at-3*86400000).toISOString(),elapsedMs:3*86400000,steps:[],info:{}},
 {attemptId:'recent',businessName:'Recent Fixture',active:true,mode:'working',currentStep:'Assigning number',signedUpAt:new Date(at-1000).toISOString(),steps:[],info:{}}];
 global.fetch=jest.fn(async url=>({ok:true,status:200,json:async()=>url.endsWith('/signup-tracker')?{ok:true,rows,summary:{},formObservations:{rows:[],coverage:{}}}:url.endsWith('/provider-status')?{readOnly:true,providers:[],history:[]}:{readOnly:true,events:[],groups:[]}}));
 await act(async()=>{root.render(<AdminSignupTracker/>);await flush();});
 const select=async(label,value)=>{await act(async()=>{const el=container.querySelector('[aria-label="'+label+'"]');el.value=value;el.dispatchEvent(new Event('change',{bubbles:true}));await flush();});};
 const quick=async label=>{await act(async()=>{[...container.querySelectorAll('[aria-label="Quick signup views"] button')].find(b=>b.textContent===label).click();await flush();});};
 await select('Show signups','ready');await select('Signup start date','7d');await select('Sort signups','name');
 await quick('Newest');expect(container.querySelector('[aria-label="Show signups"]').value).toBe('all');expect(container.querySelector('[aria-label="Signup start date"]').value).toBe('all');expect(container.querySelector('[aria-label="Sort signups"]').value).toBe('newest');
 expect(container.querySelector('.signup-now-visitors strong').textContent).toBe('Recent Fixture');
 await quick('Needs attention');expect(container.querySelector('[aria-label="Sort signups"]').value).toBe('stuck');expect(container.querySelectorAll('.signup-tracker-row')).toHaveLength(1);
 await quick('Today');expect(container.querySelectorAll('.signup-tracker-row')).toHaveLength(1);expect(container.querySelector('.signup-tracker-business h3').textContent).toBe('Recent Fixture');
 await select('Sort signups','oldest');await quick('All');expect(container.querySelector('[aria-label="Sort signups"]').value).toBe('oldest');expect(container.querySelectorAll('.signup-tracker-row')).toHaveLength(2);
 expect(global.fetch.mock.calls.every(([,init])=>init.method==='GET')).toBe(true);expect(global.fetch.mock.calls.some(([url])=>url.endsWith('/setup'))).toBe(false);
});

test('pinned selected-signup summary preserves last-known evidence on read failure and never invents a cause',async()=>{
 const row={attemptId:'saved',businessName:'Synthetic Selected',active:true,mode:'working',currentStep:'Assigning number',nextAction:'Inspect saved receipts before retrying.',signedUpAt:new Date().toISOString(),setup:null};
 const body={ok:true,rows:[row],formObservations:{rows:[],coverage:{}}};
 await act(async()=>{root.render(<SignupNowOverview data={body} evidenceState={{phase:'connected',lastSuccessAt:Date.now()}}/>);await flush();});
 let summary=container.querySelector('[aria-label="Signup status summary"]');expect(summary.textContent).toContain('Assigning number');expect(summary.textContent).toContain('No exact technical failure cause');expect(summary.textContent).not.toContain('Database transaction expired');
 await act(async()=>{root.render(<SignupNowOverview data={body} evidenceState={{phase:'retrying',lastSuccessAt:Date.now()-10000,reason:{code:'server'}}}/>);await flush();});
 summary=container.querySelector('[aria-label="Signup status summary"]');expect(summary.textContent).toContain('Last-known recorded reason');expect(summary.textContent).toContain('last-known information');expect(summary.textContent).toContain(row.nextAction);expect(summary.querySelector('button')).toBeNull();
 await act(async()=>{root.render(<SignupNowOverview data={{...body,rows:[{...row,mode:'waiting_customer',currentStep:'Waiting for phone verification'}]}}/>);await flush();});
 expect(container.querySelector('[aria-label="Signup status summary"]').textContent).toContain('not proof of a technical failure');
});

test('saved stage lights require backend verification and keep selected inspection separate from current workflow',async()=>{
 const groups=[{id:'number',checks:[{id:'one',label:'Saved policy',state:'verified'}]},{id:'assistant',checks:[{id:'two',label:'Script observation',state:'observed'}]}];
 const row={attemptId:'saved',businessName:'Synthetic Lights',active:true,mode:'working',currentStep:'Checking assistant',steps:[{key:'assistant',status:'current'}],signedUpAt:new Date().toISOString(),setup:{groups}};
 await act(async()=>{root.render(<SignupNowOverview data={{ok:true,rows:[row],formObservations:{rows:[]}}}/>);await flush();});
 const buttons=container.querySelectorAll('.signup-now-stages button');expect(buttons[0].classList.contains('is-verified')).toBe(true);expect(buttons[1].classList.contains('is-pending')).toBe(true);expect(buttons[1].getAttribute('aria-current')).toBe('step');
 act(()=>buttons[0].click());expect(buttons[0].getAttribute('aria-expanded')).toBe('true');expect(buttons[0].getAttribute('aria-current')).toBeNull();expect(buttons[1].getAttribute('aria-current')).toBe('step');expect(document.getElementById(buttons[1].getAttribute('aria-describedby')).textContent).toBe('Not verified');
});

test('partial and malformed saved groups remain readable and unverified instead of crashing or turning green',async()=>{
 for(const checks of [undefined,{},[null],[{id:'one',label:'Known check',state:'verified'},null]]){
  const row={attemptId:'partial',businessName:'Partial Fixture',active:true,mode:'working',currentStep:'Evidence incomplete',signedUpAt:new Date().toISOString(),setup:{groups:[{id:'number',title:'Number',checks}]}};
  await act(async()=>{root.render(<SignupNowOverview data={{rows:[row]}}/>);await flush();});
  const button=container.querySelector('.signup-now-stages button');expect(button.classList.contains('is-verified')).toBe(false);expect(button.textContent).toContain('Not verified');
  act(()=>button.click());expect(container.textContent).not.toContain('Backend verified');
 }
});
test('partial or reordered backend groups keep their canonical station labels, never array-position guesses',async()=>{
 for(const groups of [[{id:'assistant',title:'Assistant setup'}],[{id:'activation',title:'Trial setup'},{id:'number',title:'Number setup'}]]){
  const row={attemptId:'partial',businessName:'Reordered Fixture',active:true,mode:'working',currentStep:'Checking saved evidence',signedUpAt:new Date().toISOString(),setup:{groups}};
  await act(async()=>{root.render(<SignupNowOverview data={{rows:[row]}}/>);await flush();});
  const buttons=[...container.querySelectorAll('.signup-now-stages button')];
  expect(buttons.map(button=>button.getAttribute('aria-label'))).toEqual(groups.map(group=>'Inspect '+({number:'Number',assistant:'Agent',texts:'Texts',activation:'Trial'})[group.id]+' saved checks'));
  expect(buttons.every(button=>!button.classList.contains('is-verified'))).toBe(true);
 }
});
