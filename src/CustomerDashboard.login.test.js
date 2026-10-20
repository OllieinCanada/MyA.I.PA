import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import CustomerDashboard from './CustomerDashboard';

test('a missing login text can be requested again after a minute, with no automatic resend', async () => {
  jest.useFakeTimers();
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear(); window.localStorage.clear();
  const previousFetch = global.fetch;
  global.fetch = jest.fn(async (url) => String(url).endsWith('/request-code')
    ? { ok: true, json: async () => ({ codeSent: true, destination: '••• ••• 0199' }) }
    : { ok: false, json: async () => ({ error: 'Sign in' }) });
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container);
  const button = text => [...container.querySelectorAll('button')].find(b => b.textContent.includes(text));
  const input = (id, value) => {
    const element = container.querySelector(id);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  try {
    await act(async () => root.render(<CustomerDashboard />));
    act(() => { input('#customer-dashboard-email', 'owner@example.test'); input('#customer-dashboard-phone', '9055550199'); });
    await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    expect(container.textContent).toContain('blocked or filtered messages');
    expect(button('after one minute').disabled).toBe(true);
    expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/request-code'))).toHaveLength(1);
    act(() => jest.advanceTimersByTime(60000));
    expect(button('Send a new code').disabled).toBe(false);
    expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/request-code'))).toHaveLength(1);
    act(() => input('#customer-dashboard-code', '123456'));
    await act(async () => button('Send a new code').click());
    expect(global.fetch.mock.calls.filter(([url]) => url.endsWith('/request-code'))).toHaveLength(2);
    expect(container.querySelector('#customer-dashboard-code').value).toBe('');
    expect(button('after one minute').disabled).toBe(true);
  } finally {
    act(() => root.unmount()); container.remove(); global.fetch = previousFetch; jest.useRealTimers();
  }
});
