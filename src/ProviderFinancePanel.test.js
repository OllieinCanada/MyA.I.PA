import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import ProviderFinancePanel, { financeValue } from './ProviderFinancePanel';

let container, root;
const at = new Date().toISOString();
const fixture = { refreshing: false, providers: [{ id: 'vapi', name: 'Vapi', warnings: ['Saved call costs are estimates.'], metrics: {
  balance: { value: 0, currency: 'USD', source: 'dashboard_verified', observedAt: at, stale: true },
  spendMonth: { value: null, currency: 'USD', estimated: true, savedCalls: 3, pricedCalls: 0 },
} }], manualFields: { vapi: ['balance', 'budgetMonth'] } };
beforeEach(() => {
  jest.useFakeTimers(); global.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
  global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ finances: fixture }) });
});
afterEach(() => { act(() => root.unmount()); container.remove(); jest.useRealTimers(); delete global.fetch; });
async function render() { await act(async () => { root.render(<ProviderFinancePanel apiBase="https://api.example.invalid" />); }); }
test('zero, unknown, estimates and verified stale amounts remain distinguishable', async () => {
  await render();
  expect(container.textContent).toContain('USD 0.00');
  expect(container.textContent).toContain('Not confirmed');
  expect(container.textContent).toContain('Manually verified · Stale / recheck');
  expect(container.textContent).toContain('No combined total');
  expect(container.textContent).toContain('Priced: 0 / 3');
  expect(fetch.mock.calls[0][1].credentials).toBe('include');
});
test('network failure retains last-known values and explicitly marks all data stale', async () => {
  await render(); fetch.mockRejectedValueOnce(Error('network failure'));
  await act(async () => { jest.advanceTimersByTime(60000); });
  expect(container.textContent).toContain('USD 0.00');
  expect(container.querySelector('[role=alert]').textContent).toContain('last-known values');
});
test('polling does not overlap pending requests and aborts on unmount', async () => {
  fetch.mockImplementation(() => new Promise(() => {}));
  await render();
  const signal = fetch.mock.calls[0][1].signal;
  await act(async () => { jest.advanceTimersByTime(120000); });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(signal.aborted).toBe(true);
  act(() => root.unmount()); root = createRoot(container);
  const calls = fetch.mock.calls.length;
  await act(async () => { jest.advanceTimersByTime(120000); });
  expect(fetch).toHaveBeenCalledTimes(calls);
});
test('display never silently converts currencies', () => {
  expect(financeValue({ value: 2, currency: 'CAD' })).toBe('CAD 2.00');
  expect(financeValue({ value: null, currency: 'USD' })).toBe('Not confirmed');
});
test('verified-fact editor has stable accessible labels and cannot submit an empty amount', async () => {
  await render();
  const button = Array.from(container.querySelectorAll('button')).find(element => element.textContent === 'Record a dashboard-verified fact');
  act(() => button.click());
  expect(container.querySelector('[aria-label="Provider"]').value).toBe('vapi');
  expect(container.querySelector('[aria-label="Fact"]').value).toBe('balance');
  const amount = container.querySelector('[aria-label="Amount"]');
  expect(amount.required).toBe(true); expect(amount.validity.valueMissing).toBe(true);
});
