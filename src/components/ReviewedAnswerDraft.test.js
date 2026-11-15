import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import ReviewedAnswerDraft from './ReviewedAnswerDraft';
describe('reviewed answer preparation without publication',()=>{
 let container,root,originalFetch,storage;
 beforeEach(()=>{global.IS_REACT_ACT_ENVIRONMENT=true;container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);originalFetch=global.fetch;global.fetch=jest.fn(()=>{throw Error('No network authorized');});storage=jest.spyOn(Storage.prototype,'setItem');});
 afterEach(()=>{act(()=>root.unmount());container.remove();global.fetch=originalFetch;storage.mockRestore();});
 const mount=(props={businessId:101,businessName:'Fictional Electric'})=>act(()=>root.render(<ReviewedAnswerDraft {...props}/>));
 const button=()=>container.querySelector('button');
 const edit=(index,value)=>act(()=>{const node=container.querySelectorAll('input,textarea')[index];Object.getOwnPropertyDescriptor(node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));});
 const complete=()=>{edit(0,'Are you open weekends?');edit(1,'Please request a callback to confirm availability.');edit(2,'Owner-confirmed operating policy.');};
 test('requires all fields and exact business identity before review',()=>{mount();expect(button().disabled).toBe(true);edit(0,'Question');edit(1,'Answer');expect(button().disabled).toBe(true);edit(2,'Verified fact');expect(button().disabled).toBe(false);expect([...container.querySelectorAll('input,textarea')].map(n=>n.maxLength)).toEqual([240,2000,500]);});
 test('review only creates an escaped local preview and no network/storage writes',()=>{mount();complete();edit(1,'<img src=x onerror=alert(1)>');act(()=>button().click());expect(container.textContent).toContain('Reviewed draft only—not published');expect(container.querySelector('img')).toBeNull();expect(container.textContent).toContain('<img src=x');expect(global.fetch).not.toHaveBeenCalled();expect(storage).not.toHaveBeenCalled();});
 test('any edit invalidates the reviewed snapshot',()=>{mount();complete();act(()=>button().click());expect(container.querySelector('[aria-label="Reviewed answer preview"]')).not.toBeNull();edit(2,'Changed policy');expect(container.querySelector('[aria-label="Reviewed answer preview"]')).toBeNull();expect(container.textContent).toContain('Not reviewed.');});
 test('business switch discards old draft and review',()=>{mount();complete();act(()=>button().click());mount({businessId:102,businessName:'Other Fictional Business'});expect([...container.querySelectorAll('input,textarea')].every(n=>n.value==='')).toBe(true);expect(button().disabled).toBe(true);expect(container.querySelector('[aria-label="Reviewed answer preview"]')).toBeNull();});
 test('missing business ID cannot use a default target',()=>{mount({businessName:'No identity'});expect([...container.querySelectorAll('input,textarea,button')].every(n=>n.disabled)).toBe(true);expect(container.querySelector('[role=alert]').textContent).toContain('exact business identity');expect(global.fetch).not.toHaveBeenCalled();});
});
