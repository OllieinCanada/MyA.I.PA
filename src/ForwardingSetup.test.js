import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ForwardingSetup from './ForwardingSetup';

describe('phone-type-first forwarding',()=>{
 let container,root;
 const initial={id:'fixture',carrier:'not_sure',lineType:'not_sure',assignedMyAiPaNumber:'+12895550199',forwardingStatus:'carrier_needed'};
 const manual={...initial,lineType:'mobile',forwardingStatus:'manual_setup_required',rule:{humanInstructions:['Use unanswered calls only.'],warnings:[],activationMethod:'MANUAL',destinationDigits:'2895550199'}};
 beforeEach(()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;window.location.hash='#/f/fixture';
  global.fetch=jest.fn(async()=>({ok:true,json:async()=>({forwarding:initial})}));
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
 });
 afterEach(()=>{act(()=>root.unmount());container.remove();window.location.hash='';window.sessionStorage.clear();jest.restoreAllMocks();});
 const button=text=>Array.from(container.querySelectorAll('button')).find(b=>b.textContent===text);
 const mount=async()=>{await act(async()=>{root.render(<ForwardingSetup/>);});};
 test('asks type first; unknown mobile proceeds without a provider or an automatic call',async()=>{
  await mount();expect(container.textContent).toContain('Cellphone or landline?');expect(container.querySelector('select')).toBeNull();
  expect(button('Show instructions').disabled).toBe(true);
  act(()=>button('Cellphone').click());expect(container.querySelector('select')).toBeNull();
  global.fetch.mockImplementationOnce(async()=>({ok:true,json:async()=>({forwarding:manual})}));
  await act(async()=>button('Show instructions').click());
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({carrier:'not_sure',lineType:'mobile'});
  expect(container.textContent).toContain('Test My Setup');expect(container.textContent).not.toContain('You’re protected.');
  expect(global.fetch.mock.calls.some(([url])=>url.endsWith('/verify'))).toBe(false);
  act(()=>button('Can’t find that option? Choose your provider').click());
  expect(container.querySelector('select')).not.toBeNull();
 });
 test('landline asks for provider when its instructions are needed',async()=>{
  await mount();act(()=>button('Landline').click());expect(container.textContent).toContain('Who provides this line?');
 });
 test('saved choices bypass the questions',async()=>{
  global.fetch.mockImplementationOnce(async()=>({ok:true,json:async()=>({forwarding:{...manual,carrier:'rogers'}})}));
  await mount();expect(container.textContent).not.toContain('Cellphone or landline?');expect(container.querySelector('select')).toBeNull();
 });
 test('an older manual TELUS setup refreshes its saved rule before opening activation',async()=>{
  jest.spyOn(window.navigator,'userAgent','get').mockReturnValue('Android');
  const updated={...manual,carrier:'telus',rule:{...manual.rule,supported:true,activationMethod:'DIAL_STRING',activationTelUri:'#dial-preview'}};
  global.fetch.mockImplementationOnce(async()=>({ok:true,json:async()=>({forwarding:updated})}))
    .mockImplementationOnce(async()=>({ok:true,json:async()=>({forwarding:{...updated,forwardingStatus:'ready_to_activate'}})}))
    .mockImplementationOnce(async()=>({ok:true,json:async()=>({forwarding:{...updated,forwardingStatus:'dialer_opened'}})}));
  await mount();expect(container.textContent).not.toContain('we will not guess one');
  await act(async()=>button('Open Phone App and Protect My Missed Calls').click());
  expect(global.fetch.mock.calls[1][0]).toMatch(/selections$/);expect(global.fetch.mock.calls[2][0]).toMatch(/activation-opened$/);
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({carrier:'telus',lineType:'mobile'});
  expect(global.fetch.mock.calls.some(([url])=>url.endsWith('/verify'))).toBe(false);
 });
});
