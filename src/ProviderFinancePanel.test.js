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
function button(text) { return Array.from(container.querySelectorAll('button')).find(element => element.textContent === text); }
async function change(label, value) {
  const element = container.querySelector('[aria-label="' + label + '"]');
  const prototype = element.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
}
test('zero, unknown, estimates and verified stale amounts remain distinguishable', async () => {
  await render();
  expect(container.textContent).toContain('USD 0.00');
  expect(container.textContent).toContain('Not confirmed');
  expect(container.textContent).toContain('Outdated / recheck');
  expect(container.textContent).toContain('Provider dashboard check');
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
test('checked-just-now refreshes the actual editor time, rather than keeping page-load time', async () => {
  jest.setSystemTime(new Date('2026-10-28T15:00:00Z'));
  await render();
  await act(async () => { jest.advanceTimersByTime(180000); button('Record a dashboard-verified fact').click(); });
  const input = container.querySelector('[aria-label="Actually checked at (your local time)"]');
  const opened = input.value;
  await act(async () => { jest.advanceTimersByTime(120000); button('Checked just now').click(); });
  expect(input.value).not.toBe(opened);
  expect(container.querySelector('.finance-save-preview').textContent).toContain('Toronto');
});
test('manual estimate editor previews currency, coverage month and the acknowledged saved values', async () => {
  const finances = { ...fixture, providers: [...fixture.providers, { id: 'render', name: 'Render', metrics: {}, warnings: [] }], manualFields: { ...fixture.manualFields, render: ['monthlyEstimate', 'nextBillAt'] } };
  fetch.mockResolvedValue({ ok: true, json: async () => ({ finances }) });
  await render(); act(() => button('Record a dashboard-verified fact').click());
  await change('Provider', 'render'); await change('Amount', '17.75'); await change('Currency', 'CAD'); await change('Estimate covers month', '2026-10');
  expect(container.querySelector('.finance-save-preview').textContent).toContain('CAD 17.75 for 2026-10');
  fetch.mockImplementation(async (_url, options) => options.method === 'POST'
    ? { ok: true, json: async () => ({ ok: true, entry: { ...JSON.parse(options.body), source: 'dashboard_verified' } }) }
    : { ok: true, json: async () => ({ finances }) });
  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const submission = fetch.mock.calls.find(([, options]) => options.method === 'POST');
  expect(JSON.parse(submission[1].body).billingMonth).toBe('2026-10');
  expect(submission[1].headers['X-MyAIPA-Finance']).toBe('1');
  expect(container.querySelector('.finance-save-result').textContent).toContain('Saved Monthly cost estimate: CAD 17.75 for 2026-10');
  expect(container.querySelector('.finance-save-result').textContent).toContain('Previous values remain in history');
});
test('uncertain saves are not reported successful or automatically retried', async () => {
  await render(); act(() => button('Record a dashboard-verified fact').click()); await change('Amount', '12');
  fetch.mockRejectedValueOnce(Error('connection lost'));
  await act(async () => { container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(container.querySelector('.finance-save-result').textContent).toContain('Save not confirmed');
  await act(async () => { jest.advanceTimersByTime(120000); });
  expect(fetch.mock.calls.filter(([, options]) => options.method === 'POST')).toHaveLength(1);
});
test('history is read-only, preserves before/after timestamps, and failures do not erase current values', async () => {
  await render();
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ history: [{ type: 'verification', field: 'balance', recordedAt: at,
    value: { value: 12, currency: 'USD', observedAt: at }, previous: { value: 11, currency: 'USD', observedAt: '2026-10-27T12:00:00Z' } }] }) });
  await act(async () => { button('View Vapi history').click(); });
  expect(container.querySelector('.finance-history').textContent).toContain('Previous: USD 11.00');
  expect(fetch.mock.calls.at(-1)[0]).toContain('/history?provider=vapi');
  expect(fetch.mock.calls.at(-1)[1].method).toBeUndefined();
  act(() => button('Close history').click()); fetch.mockRejectedValueOnce(Error('unavailable'));
  await act(async () => { button('View Vapi history').click(); });
  expect(container.querySelector('.finance-history [role=alert]').textContent).toContain('History could not be confirmed');
  expect(container.textContent).toContain('USD 0.00');
});
test('overview does not treat stale wallet credit as confirmed funding or invent an overall cost', async () => {
  const finances = { ...fixture, overview: { actions: [{ id: 'vapi:balance', provider: 'vapi', field: 'balance', title: 'Recheck Vapi funding', detail: 'The balance is outdated.' }], planTotals: [{ currency: 'CAD', value: 10 }, { currency: 'USD', value: 17.75 }], planCoverage: '2 of 2 monthly plan sources', renewals: [] } };
  fetch.mockResolvedValue({ ok: true, json: async () => ({ finances }) }); await render();
  expect(container.querySelector('.finance-summary').textContent).toContain('1 item');
  expect(container.querySelector('.finance-summary').textContent).not.toContain('USD 0.00');
  expect(container.querySelector('.finance-summary').textContent).toContain('CAD 10.00');
  expect(container.querySelector('.finance-summary').textContent).toContain('USD 17.75');
  expect(container.querySelector('.finance-summary').textContent).toContain('not total operating cost');
});
