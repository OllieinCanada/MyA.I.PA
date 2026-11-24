import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Signup, { SignupSuccessPage } from './Signup';
import SignupNumberBox from './features/signup/SignupNumberBox';

jest.mock('@vapi-ai/web', () => jest.fn().mockImplementation(() => ({ on: jest.fn(), off: jest.fn(), start: jest.fn(), stop: jest.fn() })));

describe('senior-friendly signup integration', () => {
  let container, root, originalFetch;
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    window.history.replaceState(null, '', '#/signup'); window.sessionStorage.clear(); window.localStorage.clear();
    window.matchMedia = jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() });
    window.scrollTo = jest.fn();
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, text: async () => JSON.stringify({ ok: true }) });
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); global.fetch = originalFetch; window.sessionStorage.clear(); window.localStorage.clear(); });
  const render = () => act(() => root.render(<Signup />));
  const submit = () => act(() => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  const click = (text, selector = '') => {
    const scope = selector ? container.querySelector(selector) : container;
    const button = [...scope.querySelectorAll('button')].find(item => item.textContent.trim() === text);
    expect(button).toBeDefined(); act(() => button.click());
  };
  const change = (selector, value) => {
    const field = container.querySelector(selector);
    const prototype = field.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    act(() => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  const toBusiness = () => { click('Electrician', '.signup-trade-grid'); submit(); click('Residential', '.signup-specialization-grid'); submit(); click('Hamilton', '.signup-area-list'); submit(); };
  const traverse = async direction => act(async () => { window.history[direction](); await new Promise(resolve => setTimeout(resolve, 25)); });

  test('the forwarding-number box is absent while the visitor is still filling out signup', () => {
    render();
    expect(container.querySelector('.signup-number-box')).toBeNull();
    expect(container.textContent).not.toMatch(/AI forwarding number appears here|Your My AI PA number is being prepared/);
    expect(container.querySelector('.signup-mobile-primary').disabled).toBe(true);
    expect(container.querySelector('.signup-mobile-action-bar .signup-missing-shortcut').disabled).toBe(false);
    toBusiness();
    expect(container.querySelector('.signup-number-box')).toBeNull();
  });
  test('the post-submission screen retains the saved preparation state and verified assignment', () => {
    act(() => root.render(<SignupSuccessPage result={{ businessName: 'Synthetic Electrical', signupStatus: { state: 'processing', stage: 'provisioning' } }} onStartAnother={jest.fn()} />));
    expect(container.querySelector('.signup-number-box').textContent).toMatch(/Your My AI PA number is being prepared\./);
    act(() => root.render(<SignupSuccessPage key="assigned" result={{ businessName: 'Synthetic Electrical', twilioPhoneNumber: '+19055550123', signupStatus: { state: 'ready', assignedPhone: '+19055550123' } }} onStartAnother={jest.fn()} />));
    expect(container.querySelector('a[href="tel:+19055550123"]')).not.toBeNull();
  });
  test('the disabled-Continue shortcut focuses only the first invalid field and reveals its existing error', async () => {
    render(); toBusiness();
    change('#your-name-input', 'Taylor Morgan'); change('#business-name-input', 'Bright Current Electrical');
    expect(container.querySelector('#business-phone-number-input').getAttribute('aria-invalid')).toBe('false');
    expect(container.querySelector('#email-address-input').getAttribute('aria-invalid')).toBe('false');
    const button = container.querySelector('.signup-mobile-action-bar .signup-missing-shortcut');
    expect(button.textContent).toMatch(/real 10-digit business phone/); expect(button.disabled).toBe(false);
    await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(document.activeElement).toBe(container.querySelector('#business-phone-number-input'));
    expect(document.activeElement.getAttribute('aria-invalid')).toBe('true');
    expect(container.querySelector('#email-address-input').getAttribute('aria-invalid')).toBe('false');
    expect(container.querySelector('.signup-mobile-primary').disabled).toBe(true);
    expect(global.fetch.mock.calls.every(([url]) => !String(url).endsWith('/api/signup'))).toBe(true);
  });
  test('browser Back and Forward preserve business input without putting it or a status token into history', async () => {
    render(); toBusiness(); change('#your-name-input', 'Taylor Morgan'); change('#business-name-input', 'Bright Current Electrical');
    change('#business-phone-number-input', '9055550123');
    const state = JSON.stringify(window.history.state);
    for (const value of ['Taylor Morgan', 'Bright Current Electrical', '9055550123', 'token']) expect(state).not.toContain(value);
    await traverse('back'); expect(container.textContent).toMatch(/Step 3 of 7/);
    await traverse('forward'); expect(container.textContent).toMatch(/Step 4 of 7/);
    expect(container.querySelector('#your-name-input').value).toBe('Taylor Morgan');
    expect(container.querySelector('#business-name-input').value).toBe('Bright Current Electrical');
    expect(container.querySelector('#business-phone-number-input').value).toBe('9055550123');
    expect(container.querySelector('.signup-mobile-primary').disabled).toBe(true);
    await act(async () => { container.querySelector('.signup-mobile-back').click(); await new Promise(resolve => setTimeout(resolve, 25)); });
    expect(container.textContent).toMatch(/Step 3 of 7/);
  });
  test('back to the first screen does not trap browser navigation out of signup', async () => {
    render(); click('Electrician', '.signup-trade-grid'); submit();
    await traverse('back'); expect(container.textContent).toMatch(/Step 1 of 7/);
    expect(container.querySelector('.signup-mobile-back')).toBeNull();
    act(() => window.dispatchEvent(new PopStateEvent('popstate', { state: { outside: true } })));
    expect(container.textContent).toMatch(/Step 1 of 7/);
    expect(global.fetch.mock.calls.every(([url]) => !String(url).endsWith('/api/signup'))).toBe(true);
  });
  test('a mismatched current saved assignment never reaches the call-number wizard', () => {
    act(() => root.render(<SignupSuccessPage result={{ businessName: 'Synthetic Electrical', twilioPhoneNumber: '+19055550123', phoneProvisioning: { status: 'ready', e164: '+19055550123' }, signupStatus: { state: 'ready', assignedPhone: '+19055550124' } }} onStartAnother={jest.fn()} />));
    expect(container.querySelector('a[href="tel:+19055550123"]')).toBeNull();
    expect(container.querySelector('.signup-number-box').textContent).toMatch(/not verified/);
  });
  test('a failed read replaces the preparation claim rather than pretending setup is live', () => {
    const result = { signupStatus: { state: 'processing', stage: 'provisioning' } };
    act(() => root.render(<SignupNumberBox result={result} />));
    expect(container.textContent).toMatch(/Your My AI PA number is being prepared\./);
    act(() => root.render(<SignupNumberBox result={result} unavailable />));
    expect(container.textContent).toMatch(/could not be checked/); expect(container.textContent).not.toMatch(/being prepared/);
    expect(container.querySelector('.signup-number-box').getAttribute('aria-live')).toBe('polite');
  });
});
