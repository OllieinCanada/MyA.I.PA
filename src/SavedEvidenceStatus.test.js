import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import SavedEvidenceStatus from './SavedEvidenceStatus';

describe('saved-evidence screen-reader announcements', () => {
  let container, root;
  const at = Date.parse('2026-11-23T17:00:00Z');
  beforeEach(() => {
    global.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => { act(() => root.unmount()); container.remove(); });
  const render = state => act(() => root.render(<><button>Keep focus</button><SavedEvidenceStatus state={state} /></>));

  test('successful read time is visible but outside the announcing status', () => {
    render({ phase: 'connected', lastSuccessAt: at });
    const status = container.querySelector('[role="status"]');
    expect(status.textContent).toContain('Signup updates: connected');
    expect(status.textContent).not.toContain('Last successful read');
    expect(container.querySelector('small').textContent).toContain('Last successful read');
    expect(status.contains(container.querySelector('small'))).toBe(false);
  });

  test.each(['connected', 'retrying'])('a %s clock tick does not mutate the live region or steal focus', async phase => {
    const state = { phase, lastSuccessAt: at, ...(phase === 'retrying' ? { reason: { code: 'server', status: 503 } } : {}) };
    render(state);
    const live = container.querySelector('[role="status"], [role="alert"]');
    const focused = container.querySelector('button'); focused.focus();
    const mutations = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(live, { childList: true, characterData: true, subtree: true, attributes: true });
    await act(async () => { render({ ...state, lastSuccessAt: at + 5000 }); await Promise.resolve(); });
    expect(container.querySelector('[role="status"], [role="alert"]')).toBe(live);
    expect(mutations).toHaveLength(0);
    expect(document.activeElement).toBe(focused);
    observer.disconnect();
  });

  test('a failed read announces its reason and last-known qualification without the ticking clock', () => {
    render({ phase: 'retrying', reason: { code: 'server', status: 503 }, lastSuccessAt: at });
    const alert = container.querySelector('[role="alert"]');
    expect(alert.textContent).toContain('Signup updates are unavailable.');
    expect(alert.textContent).toContain('HTTP 503.');
    expect(alert.textContent).toContain('last-known—not a fresh check');
    expect(alert.textContent).not.toContain('Last successful read');
  });

  test('a meaningful failure and recovery still update the live status', () => {
    render({ phase: 'connected', lastSuccessAt: at });
    render({ phase: 'auth_required', reason: { code: 'auth' }, lastSuccessAt: at });
    expect(container.querySelector('[role="alert"]').textContent).toContain('Sign-in is required');
    render({ phase: 'connected', lastSuccessAt: at + 10000 });
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[role="status"]').textContent).toContain('connected');
  });
});
