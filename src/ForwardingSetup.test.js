import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ForwardingSetup from './ForwardingSetup';
import dialerFixture from './forwardingDialerFixture.json';

describe('immediate forwarding instructions',()=>{
 let container,root;
 const initial={id:'fixture',carrier:'not_sure',lineType:'not_sure',assignedMyAiPaNumber:'+12895550199',forwardingStatus:'carrier_needed',rule:{...dialerFixture,humanInstructions:['Open your provider settings and forward unanswered calls only.'],warnings:[],supported:true,activationMethod:'DIAL_STRING',destinationDigits:'2895550199'}};
 const manual={...initial,lineType:'mobile',forwardingStatus:'manual_setup_required',rule:{humanInstructions:['Use unanswered calls only.'],warnings:[],activationMethod:'MANUAL',destinationDigits:'2895550199'}};
 beforeEach(()=>{
  global.IS_REACT_ACT_ENVIRONMENT=true;window.location.hash='#/f/fixture';
  global.fetch=jest.fn(async()=>({ok:true,json:async()=>({forwarding:initial})}));
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
 });
 afterEach(()=>{act(()=>root.unmount());container.remove();window.location.hash='';window.sessionStorage.clear();jest.restoreAllMocks();});
 const button=text=>Array.from(container.querySelectorAll('button,a[role="button"]')).find(b=>b.textContent===text);
 const mount=async()=>{await act(async()=>{root.render(<ForwardingSetup/>);});};
 test('uses the original headset and blue-wordmark brand',async()=>{
  await mount();
  const brand=container.querySelector('.forwarding-brand');
  expect(brand.getAttribute('aria-label')).toBe('My AI PA home');
  expect(brand.querySelector('svg.forwarding-brand-mark')).not.toBeNull();
  expect(brand.querySelectorAll('svg rect[fill="#ff7a00"]')).toHaveLength(7);
  expect(brand.querySelector('strong').textContent).toBe('AI PA');
 });
 test('unknown service immediately shows the destination and safe setup instructions',async()=>{
  await mount();expect(container.textContent).not.toContain('Cellphone or landline?');expect(container.querySelector('select')).toBeNull();
  expect(button('Open Phone App to Set Up Forwarding').getAttribute('href')).toBe(dialerFixture.activationTelUri);
  expect(container.textContent).toContain(dialerFixture.activationDialString);
  expect(global.fetch).toHaveBeenCalledTimes(1);
  act(()=>button('Need different setup instructions?').click());
  const select=container.querySelector('select');
  act(()=>{select.value='not_sure:mobile';select.dispatchEvent(new Event('change',{bubbles:true}));});
  global.fetch.mockImplementationOnce(async()=>({ok:true,json:async()=>({forwarding:manual})}));
  await act(async()=>button('Update instructions').click());
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({carrier:'not_sure',lineType:'mobile'});
  expect(container.textContent).not.toContain('Test My Setup');expect(container.textContent).not.toContain('You’re protected.');
  expect(global.fetch.mock.calls.some(([url])=>url.endsWith('/verify'))).toBe(false);
  expect(container.querySelector('select')).toBeNull();
 });
 test.each(['mobile','landline','voip'])('%s goes straight to its saved instructions without a type-selection screen',async(lineType)=>{
  global.fetch.mockImplementationOnce(async()=>({ok:true,json:async()=>({forwarding:{...manual,lineType}})}));
  await mount();
  expect(container.textContent).toContain('Copy forwarding number');
  expect(container.querySelector('select')).toBeNull();
  expect(container.textContent).not.toContain('Cellphone or landline?');
  expect(global.fetch).toHaveBeenCalledTimes(1);
  act(()=>button('Need different setup instructions?').click());
  expect(container.textContent).toContain('Use unanswered calls only.');
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
  await act(async()=>button('Open Phone App to Set Up Forwarding').click());
  expect(global.fetch.mock.calls[1][0]).toMatch(/selections$/);expect(global.fetch.mock.calls[2][0]).toMatch(/activation-opened$/);
  expect(JSON.parse(global.fetch.mock.calls[1][1].body)).toEqual({carrier:'telus',lineType:'mobile'});
  expect(global.fetch.mock.calls.some(([url])=>url.endsWith('/verify'))).toBe(false);
 });
 test('returning from the dialer never starts an outbound call, even with old auto-test state',async()=>{
  jest.spyOn(window.navigator,'userAgent','get').mockReturnValue('Android');
  const rule={...manual.rule,...dialerFixture,supported:true,activationMethod:'DIAL_STRING'};
  window.sessionStorage.setItem('myaipa-forwarding-auto-test:fixture',String(Date.now()-5000));
  global.fetch.mockImplementationOnce(async()=>({ok:true,json:async()=>({forwarding:{...manual,forwardingStatus:'dialer_opened',rule}})}));
  await mount();
  expect(button('Open Phone App to Set Up Forwarding').getAttribute('href')).toBe(dialerFixture.activationTelUri);
  await act(async()=>{window.dispatchEvent(new Event('focus'));window.dispatchEvent(new Event('pageshow'));document.dispatchEvent(new Event('visibilitychange'));});
  expect(global.fetch).toHaveBeenCalledTimes(1);
  expect(container.textContent).not.toMatch(/Test My Setup|Do not answer the test call|You’re protected/);
 });
 test('iPhones receive the phone button and an exact copy-code fallback',async()=>{
  jest.spyOn(window.navigator,'userAgent','get').mockReturnValue('iPhone');
  const writeText=jest.fn().mockResolvedValue(undefined);
  Object.defineProperty(window.navigator,'clipboard',{configurable:true,value:{writeText}});
  const rule={...manual.rule,...dialerFixture,supported:true,activationMethod:'DIAL_STRING'};
  global.fetch.mockImplementationOnce(async()=>({ok:true,json:async()=>({forwarding:{...manual,rule}})}));
  await mount();expect(container.querySelector('a[href^="tel:"]').getAttribute('href')).toBe(dialerFixture.activationTelUri);
  expect(container.textContent).toContain('iPhones can block carrier-code links');
  await act(async()=>button('Copy code').click());
  expect(writeText).toHaveBeenCalledWith(dialerFixture.activationDialString);
  expect(global.fetch).toHaveBeenCalledTimes(1);
 });
});
