// Browser history contains navigation enums only. Form values and private
// signup-status access stay in React/session state, never in these entries.
const HISTORY_KEY = 'myaipaSignupNavigation';
const FIRST_POSITION = Object.freeze({ currentStep: 1, businessSlide: 1, tradeSetupPanel: 'trade', returnToReviewAfterEdit: false, reviewReturnStep: 1 });

function normalizeSignupPosition(value) {
  if (!value || ![1, 3].includes(value.currentStep) || ![1, 2, 3, 4, 5].includes(value.businessSlide)
      || !['trade', 'specialization'].includes(value.tradeSetupPanel)) return null;
  const editing = value.currentStep === 1 && value.returnToReviewAfterEdit === true;
  return { currentStep: value.currentStep, businessSlide: value.currentStep === 3 ? 4 : Math.min(value.businessSlide, 4),
    tradeSetupPanel: value.currentStep === 3 || value.businessSlide > 1 ? 'specialization' : value.tradeSetupPanel,
    returnToReviewAfterEdit: editing, reviewReturnStep: editing ? 3 : 1 };
}
const samePosition = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function signupPositionIndex(position) {
  if (position.currentStep === 3) return 5;
  return position.businessSlide === 1 ? position.tradeSetupPanel === 'trade' ? 0 : 1 : position.businessSlide;
}
function signupPositionForIndex(index) {
  return { ...FIRST_POSITION, currentStep: index === 5 ? 3 : 1, businessSlide: index >= 2 ? Math.min(index, 4) : 1,
    tradeSetupPanel: index === 0 ? 'trade' : 'specialization' };
}
function previousSignupPosition(position) {
  const current = normalizeSignupPosition(position);
  if (!current) return null;
  if (current.returnToReviewAfterEdit) return { ...current, currentStep: 3, businessSlide: 4, returnToReviewAfterEdit: false, reviewReturnStep: 1 };
  const index = signupPositionIndex(current);
  return index ? signupPositionForIndex(index - 1) : null;
}

function createSignupNavigation({ window: win, initialPosition = FIRST_POSITION, onNavigate, canNavigate = () => true, guard = value => value }) {
  let flowId, entries, cursor, pending = null, frozen = null, disposed = false, submitted = false, available = true;
  const initialRoute = String(win.location?.hash || '').split('?')[0];
  const freshId = () => `nav-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const write = (method, entry) => {
    try { win.history[method]({ ...(win.history.state || {}), [HISTORY_KEY]: entry }, ''); }
    catch (_) { available = false; }
  };
  const ownEntry = position => ({ version: 1, flowId, index: cursor, position });
  const reset = position => {
    flowId = freshId(); entries = [normalizeSignupPosition(position) || { ...FIRST_POSITION }]; cursor = 0;
    pending = null; frozen = null; submitted = false; available = true;
    write('replaceState', ownEntry(entries[0]));
  };
  reset(initialPosition);
  const restoreCurrent = () => {
    const position = normalizeSignupPosition(guard(entries[cursor]));
    if (!position) return;
    if (!samePosition(position, entries[cursor])) { entries[cursor] = position; write('replaceState', ownEntry(position)); }
    onNavigate(position);
  };
  const traverse = targetIndex => {
    if (targetIndex === cursor) { restoreCurrent(); return true; }
    pending = targetIndex;
    try { win.history.go(targetIndex - cursor); }
    catch (_) { pending = null; available = false; return false; }
    return true;
  };
  const onPop = event => {
    if (disposed) return;
    pending = null;
    if (submitted || String(win.location?.hash || '').split('?')[0] !== initialRoute) return;
    const entry = event.state?.[HISTORY_KEY];
    if (entry?.version !== 1 || entry.flowId !== flowId || !Number.isInteger(entry.index)
      || !entries[entry.index] || !samePosition(entries[entry.index], normalizeSignupPosition(entry.position))) return;
    // Even while submission freezes the form, a browser pop has already moved
    // physical history. Retain the visible logical origin, but track that move
    // so a later failed-submit resume/Back cannot skip a screen.
    if (!canNavigate()) {
      if (!frozen) frozen = { index: cursor, position: entries[cursor] };
      cursor = entry.index;
      return;
    }
    cursor = entry.index; frozen = null;
    restoreCurrent();
  };
  win.addEventListener('popstate', onPop);
  return {
    observe(value) {
      if (disposed || submitted || pending !== null || !available || !canNavigate()) return;
      const position = normalizeSignupPosition(value);
      if (position && frozen) {
        const origin = frozen; frozen = null;
        if (samePosition(position, origin.position) && samePosition(entries[origin.index], origin.position)) {
          // Reuse the original entry rather than pushing a duplicate review.
          // restoreCurrent rechecks current prerequisites when traversal ends.
          traverse(origin.index); return;
        }
      }
      if (!position || samePosition(position, entries[cursor])) return;
      entries = entries.slice(0, cursor + 1); entries.push(position); cursor++;
      write('pushState', ownEntry(position));
    },
    back(value) {
      if (disposed || submitted || !canNavigate()) return true;
      if (!available) return false;
      if (pending !== null) return true;
      const requested = normalizeSignupPosition(value);
      if (!requested) return false;
      const target = normalizeSignupPosition(guard(requested));
      if (!target) return false;
      // The requested previous screen is relative to the frozen visible form,
      // not whichever physical entry a busy browser pop happened to land on.
      let targetIndex = (frozen ? frozen.index : cursor) - 1;
      frozen = null;
      while (targetIndex >= 0 && !samePosition(entries[targetIndex], target)) targetIndex--;
      if (targetIndex < 0) {
        entries[cursor] = target; write('replaceState', ownEntry(target)); onNavigate(target); return true;
      }
      return traverse(targetIndex);
    },
    submitted() { submitted = true; pending = null; frozen = null; write('replaceState', { version: 1, flowId, state: 'submitted' }); },
    reset,
    dispose() { disposed = true; win.removeEventListener('popstate', onPop); },
  };
}

module.exports = { HISTORY_KEY, FIRST_POSITION, normalizeSignupPosition, signupPositionIndex, signupPositionForIndex, previousSignupPosition, createSignupNavigation };
