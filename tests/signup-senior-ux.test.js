const test = require('node:test');
const assert = require('node:assert/strict');
const { HISTORY_KEY, FIRST_POSITION, normalizeSignupPosition, signupPositionForIndex, previousSignupPosition, createSignupNavigation } = require('../src/features/signup/signupNavigation');
const { signupNumberState, isSignupStatusSnapshot } = require('../src/features/signup/signupNumberState');
const { signupMissingRequirement } = require('../src/features/signup/signupMissingRequirement');

function historyFixture(options = {}) {
  const listeners = new Set(), states = [null], visited = [];
  let index = 0, active = true, limit = 5;
  const win = { location: { hash: '#/signup' }, addEventListener: (_event, listener) => listeners.add(listener), removeEventListener: (_event, listener) => listeners.delete(listener) };
  win.history = { get state() { return states[index]; }, replaceState(state) { states[index] = state; }, pushState(state) { states.splice(index + 1); states.push(state); index++; },
    go(delta) { if (index + delta < 0 || index + delta >= states.length) return; index += delta; for (const listener of listeners) listener({ state: states[index] }); } };
  const controller = createSignupNavigation({ window: win, onNavigate: position => visited.push(position), canNavigate: () => active,
    guard: position => Math.min(position.currentStep === 3 ? 5 : position.businessSlide === 1 ? position.tradeSetupPanel === 'trade' ? 0 : 1 : position.businessSlide, limit) === limit
      ? signupPositionForIndex(limit) : position, ...options });
  return { win, controller, states, visited, emit: state => { for (const listener of listeners) listener({ state }); },
    setActive: value => { active = value; }, setLimit: value => { limit = value; }, get index() { return index; }, get listeners() { return listeners.size; } };
}

test('history normalization carries only finite navigation values, never form/contact/status access', () => {
  const normalized = normalizeSignupPosition({ ...FIRST_POSITION, details: { phone: 'private' }, token: 'private', businessName: 'private' });
  assert.deepEqual(normalized, FIRST_POSITION);
  assert.equal(normalizeSignupPosition({ ...FIRST_POSITION, currentStep: 99 }), null);
  assert.equal(normalizeSignupPosition({ ...FIRST_POSITION, tradeSetupPanel: 'private' }), null);
});
test('both backward and forward history restore only the matching session positions', () => {
  const f = historyFixture();
  for (let i = 1; i <= 5; i++) f.controller.observe(signupPositionForIndex(i));
  assert.equal(f.states.length, 6);
  f.controller.back(signupPositionForIndex(4));
  assert.deepEqual(f.visited.at(-1), signupPositionForIndex(4));
  f.win.history.go(1);
  assert.deepEqual(f.visited.at(-1), signupPositionForIndex(5));
  assert.equal(f.states.length, 6);
  assert.ok(f.states.every(state => Object.keys(state[HISTORY_KEY]).sort().join(',') === 'flowId,index,position,version'));
});
test('review editing Back returns to review and no unsupported previous entry is invented', () => {
  const f = historyFixture();
  f.controller.observe(signupPositionForIndex(5));
  const editing = { ...FIRST_POSITION, returnToReviewAfterEdit: true, reviewReturnStep: 3 };
  f.controller.observe(editing);
  f.controller.back(previousSignupPosition(editing));
  assert.equal(f.visited.at(-1).currentStep, 3);
  assert.equal(previousSignupPosition(FIRST_POSITION), null);
  assert.equal(f.controller.back(null), false);
});
test('forward history cannot bypass a newly invalid prerequisite', () => {
  const f = historyFixture();
  for (let i = 1; i <= 5; i++) f.controller.observe(signupPositionForIndex(i));
  f.win.history.go(-2); f.setLimit(2); f.win.history.go(1);
  assert.deepEqual(f.visited.at(-1), signupPositionForIndex(2));
  assert.deepEqual(f.win.history.state[HISTORY_KEY].position, signupPositionForIndex(2));
});
test('busy and submitted sessions never restore an earlier form or trigger actions', () => {
  const f = historyFixture(); f.controller.observe(signupPositionForIndex(1));
  f.setActive(false); f.win.history.go(-1); assert.equal(f.visited.length, 0);
  f.setActive(true); f.controller.submitted(); f.win.history.go(1); assert.equal(f.visited.length, 0);
  assert.equal(f.controller.back(FIRST_POSITION), true);
});
test('busy-pop resume restores the physical review entry before Back, without duplicate entries', () => {
  const f = historyFixture();
  for (let i = 1; i <= 5; i++) f.controller.observe(signupPositionForIndex(i));
  f.setActive(false); f.win.history.go(-1);
  assert.equal(f.index, 4); assert.equal(f.visited.length, 0);
  f.setActive(true); f.controller.observe(signupPositionForIndex(5));
  assert.equal(f.index, 5);
  assert.deepEqual(f.visited.at(-1), signupPositionForIndex(5));
  f.controller.back(signupPositionForIndex(4));
  assert.equal(f.index, 4); assert.deepEqual(f.visited.at(-1), signupPositionForIndex(4));
  assert.equal(f.states.length, 6);
});
test('busy-pop direct Back reconciles multiple physical pops while keeping the busy form frozen', () => {
  const f = historyFixture();
  for (let i = 1; i <= 5; i++) f.controller.observe(signupPositionForIndex(i));
  f.setActive(false); f.win.history.go(-2); f.win.history.go(1);
  assert.equal(f.index, 4); assert.equal(f.visited.length, 0);
  f.setActive(true); f.controller.back(signupPositionForIndex(4));
  assert.equal(f.index, 4); assert.deepEqual(f.visited.at(-1), signupPositionForIndex(4));
  assert.equal(f.states.length, 6);
});
test('busy-pop resume still revalidates prerequisites and cannot restore invalid review', () => {
  const f = historyFixture();
  for (let i = 1; i <= 5; i++) f.controller.observe(signupPositionForIndex(i));
  f.setActive(false); f.win.history.go(-1); f.setLimit(3);
  assert.equal(f.visited.length, 0);
  f.setActive(true); f.controller.observe(signupPositionForIndex(5));
  assert.deepEqual(f.visited.at(-1), signupPositionForIndex(3));
  assert.equal(f.states.length, 6);
});
test('busy-pop followed by submission permanently fences previous and forward form entries', () => {
  const f = historyFixture();
  for (let i = 1; i <= 5; i++) f.controller.observe(signupPositionForIndex(i));
  f.setActive(false); f.win.history.go(-1); f.controller.submitted();
  assert.equal(f.win.history.state[HISTORY_KEY].state, 'submitted');
  f.setActive(true); f.controller.observe(signupPositionForIndex(5)); f.win.history.go(1);
  f.controller.back(signupPositionForIndex(4));
  assert.equal(f.visited.length, 0); assert.equal(f.states.length, 6);
});
test('old, forged or cross-route history cannot affect a new signup session', () => {
  const f = historyFixture(); const old = f.win.history.state;
  f.controller.reset(FIRST_POSITION); f.emit(old); assert.equal(f.visited.length, 0);
  f.controller.observe(signupPositionForIndex(1));
  f.emit({ [HISTORY_KEY]: { ...f.win.history.state[HISTORY_KEY], position: signupPositionForIndex(5) } });
  assert.equal(f.visited.length, 0);
  f.win.location.hash = '#/'; f.win.history.go(-1); assert.equal(f.visited.length, 0);
  f.controller.dispose(); assert.equal(f.listeners, 0);
});
test('blocked history storage degrades to in-memory form navigation without weakening validation', () => {
  const f = historyFixture(); f.win.history.pushState = () => { throw Error('Storage unavailable'); };
  f.controller.observe(signupPositionForIndex(1));
  assert.equal(f.controller.back(FIRST_POSITION), false);
});

test('idle and local-only submitting state do not claim the provider is preparing a number', () => {
  assert.equal(signupNumberState(null).title, 'AI forwarding number appears here.');
  for (const result of [{ busy: true }, { phoneProvisioning: { status: 'pending' } }, { signupStatus: { state: 'processing' } }])
    assert.equal(signupNumberState(result).state, 'unknown');
});
test('preparation requires explicit nonterminal server provisioning stage and current readable evidence', () => {
  const result = { signupStatus: { state: 'processing', stage: 'provisioning', terminal: false } };
  assert.equal(signupNumberState(result).title, 'Your My AI PA number is being prepared.');
  assert.equal(signupNumberState(result, { unavailable: true }).state, 'unknown');
  assert.equal(signupNumberState({ signupStatus: { ...result.signupStatus, terminal: true } }).state, 'unknown');
  assert.equal(signupNumberState({ ...result, reviewRequired: true }).state, 'waiting');
});
test('only a matching ready assignment is displayed, and owner numbers are never a substitute', () => {
  const result = { twilioPhoneNumber: '+19055550123', phoneProvisioning: { status: 'ready', e164: '+19055550123' }, signupStatus: { state: 'ready', assignedPhone: '+19055550123' } };
  assert.equal(signupNumberState(result).number, '+19055550123');
  for (const changed of [
    { ...result, signupStatus: { state: 'ready', assignedPhone: '+19055550124' } },
    { ...result, signupStatus: { state: 'ready', assignedPhone: '' } },
    { ...result, phoneProvisioning: { status: 'ready', e164: '+19055550124' } },
    { ...result, verificationRequired: true }, { ...result, reviewRequired: true },
    { ownerPhone: '+19055550123', signupStatus: { state: 'ready' } },
  ]) assert.equal(signupNumberState(changed).number, undefined);
});
test('failed and closed assignments remain explicit and do not imply nothing was purchased', () => {
  const failed = signupNumberState({ signupStatus: { state: 'needs_attention' }, phoneProvisioning: { status: 'failed' } });
  assert.equal(failed.state, 'failed'); assert.match(failed.detail, /does not prove that nothing was purchased/);
  assert.equal(signupNumberState({ signupStatus: { state: 'closed' } }).state, 'closed');
});
test('absent and malformed status snapshots are never accepted as a successful status read', () => {
  for (const value of [null, [], {}, { state: 'made_up' }, 'ready']) assert.equal(isSignupStatusSnapshot(value), false);
  for (const state of ['processing', 'ready', 'closed', 'needs_attention', 'verification_required', 'final_checks']) assert.equal(isSignupStatusSnapshot({ state }), true);
});
test('missing-field shortcut reuses the first actual validation error without contact data', () => {
  const missing = signupMissingRequirement({ currentStep: 1, businessSlide: 3, businessErrors: { ownerName: '', phone: 'Enter a real 10-digit business phone number.', email: 'Enter a business email.' } });
  assert.deepEqual(missing, { field: 'phone', selector: '#business-phone-number-input', message: 'Enter a real 10-digit business phone number.' });
  assert.equal(signupMissingRequirement({ currentStep: 1, businessSlide: 3, businessErrors: {} }), null);
});
test('selection, checked-price and verification shortcuts target the actual incomplete group only', () => {
  const missing = values => signupMissingRequirement({ currentStep: 1, businessSlide: 1, tradeSetupPanel: 'trade', ...values });
  assert.match(missing({ tradeMissing: true }).selector, /trade-grid/);
  assert.match(missing({ tradeSetupPanel: 'specialization', propertyMissing: true }).selector, /specialization-grid/);
  assert.match(missing({ businessSlide: 2, areaMissing: true }).selector, /area-list/);
  assert.equal(missing({ businessSlide: 4, pricing: { includeVisitFee: false, repairVisitFee: '' } }), null);
  assert.equal(missing({ businessSlide: 4, pricing: { includeHourlyRate: true, repairHourlyRate: '' } }).selector, '#hourly-labour-rate-input');
  assert.equal(missing({ businessSlide: 4, pricing: { includeHourlyRate: true, repairHourlyRate: 'Infinity' } }).selector, '#hourly-labour-rate-input');
  assert.equal(missing({ currentStep: 3, securityMissing: true }).selector, '#signup-human-verification');
});
