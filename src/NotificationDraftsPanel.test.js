import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import NotificationDraftsPanel from './NotificationDraftsPanel';

const draft = { id: 'a'.repeat(64), contextHash: 'b'.repeat(64), revision: 1, callId: 'synthetic-ui',
  from: '+19055550100', to: '+19055550101', body: 'Exact first line.\nExact second line.', leg: 'owner', state: 'pending', expiresAt: '2027-01-01T00:00:00.000Z' };
let container, root;
beforeEach(() => { global.IS_REACT_ACT_ENVIRONMENT = true; container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
const button = label => [...container.querySelectorAll('button')].find(b => b.textContent === label);
const click = async element => act(async () => element.click());
test('loading a draft displays exact content and never approves or sends', async () => {
  const api = jest.fn().mockResolvedValue({ dispatchEnabled: false, drafts: [draft] });
  await act(async () => root.render(<NotificationDraftsPanel api={api} />));
  expect(container.querySelector('pre').textContent).toBe(draft.body);
  expect(container.textContent).toContain(draft.to); expect(container.textContent).toContain(draft.from);
  expect(button('Approve this text').disabled).toBe(true); expect(api.mock.calls).toHaveLength(1);
  expect(api.mock.calls[0][1]).toBeUndefined();
});
test('approval uses the displayed version, never sends, and needs another review before send', async () => {
  let current = { ...draft };
  const api = jest.fn(async (path, options) => {
    if (options) {
      expect(path.endsWith('/approve')).toBe(true);
      expect(options.headers['X-MyAIPA-Notification-Review']).toBe('1');
      expect(options.body).toEqual({ expectedRevision: 1, expectedHash: draft.contextHash });
      current = { ...current, state: 'approved' }; return current;
    }
    return { dispatchEnabled: true, drafts: [current] };
  });
  await act(async () => root.render(<NotificationDraftsPanel api={api} />));
  await click(container.querySelector('input')); await click(button('Approve this text'));
  expect(button('Send this approved text').disabled).toBe(true);
  expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});
test('live-disabled state prevents sending even when a text was approved', async () => {
  const api = jest.fn().mockResolvedValue({ dispatchEnabled: false, drafts: [{ ...draft, state: 'approved' }] });
  await act(async () => root.render(<NotificationDraftsPanel api={api} />)); await click(container.querySelector('input'));
  expect(button('Send this approved text').disabled).toBe(true); expect(container.textContent).toContain('Live sending is disabled');
  expect(api.mock.calls).toHaveLength(1);
});
test('a stale or uncertain action clears review, reloads, and never retries the mutation', async () => {
  const api = jest.fn(async (_path, options) => {
    if (options) throw Error('stale or response lost');
    return { dispatchEnabled: true, drafts: [draft] };
  });
  await act(async () => root.render(<NotificationDraftsPanel api={api} />)); await click(container.querySelector('input')); await click(button('Approve this text'));
  expect(container.querySelector('[role=alert]').textContent).toContain('Do not resend');
  expect(container.querySelector('input').checked).toBe(false);
  expect(button('Approve this text').disabled).toBe(true);
  expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
});
