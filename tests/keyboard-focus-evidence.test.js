const test = require('node:test');
const assert = require('node:assert/strict');
const { assessKeyboardFocus } = require('../scripts/keyboard-focus-evidence');
const border = color => ({ width: '1px', style: 'solid', color });
const base = { key: '1.2', focusWithin: false, visible: true, outlineStyle: 'none', outlineWidth: '0px',
  outlineColor: 'rgb(0, 0, 0)', boxShadow: 'none', borders: [border('rgb(200, 200, 200)')] };
function run(change, { prior = {}, active = { tag: 'INPUT', tabIndex: 0 }, extraBefore = [], extraAfter = [] } = {}) {
  return assessKeyboardFocus({ surfaces: [{ ...base, ...prior }, ...extraBefore] },
    { active, surfaces: [{ ...base, focusWithin: true, ...change }, ...extraAfter] });
}
test('accepts a direct keyboard-triggered visible outline', () => {
  assert.equal(run({ outlineStyle: 'solid', outlineWidth: '3px' }).reason, 'changed_outline');
});
test('accepts the real trade-search focus-within wrapper change', () => {
  const parent = { ...base, key: '1', boxShadow: 'rgba(15, 56, 99, 0.65) 0px 22px 55px -42px' };
  const result = run({}, { extraBefore: [parent], extraAfter: [{ ...parent, focusWithin: true,
    boxShadow: 'rgba(23, 107, 255, 0.1) 0px 0px 0px 4px, rgba(15, 56, 99, 0.65) 0px 22px 55px -42px' }] });
  assert.equal(result.passed, true); assert.equal(result.surface, '1');
});
test('accepts a focus-triggered visible border change', () => {
  assert.equal(run({ borders: [border('rgb(23, 107, 255)')] }).reason, 'changed_border');
});
test('rejects an unchanged static shadow', () => {
  assert.equal(run({ boxShadow: 'rgb(0, 0, 0) 0px 2px 5px' }, { prior: { boxShadow: 'rgb(0, 0, 0) 0px 2px 5px' } }).passed, false);
});
test('rejects a new transparent ring even with an existing visible static shadow', () => {
  assert.equal(run({ boxShadow: 'rgba(0, 0, 0, 0) 0px 0px 0px 4px, rgb(0, 0, 0) 0px 2px 5px' },
    { prior: { boxShadow: 'rgb(0, 0, 0) 0px 2px 5px' } }).passed, false);
});
test('rejects transparent outlines, hidden surfaces and unrelated ancestors', () => {
  for (const change of [{ outlineStyle: 'solid', outlineWidth: '3px', outlineColor: 'transparent' },
    { outlineStyle: 'solid', outlineWidth: '3px', visible: false },
    { outlineStyle: 'solid', outlineWidth: '3px', focusWithin: false }]) assert.equal(run(change).passed, false);
});
test('rejects absent baseline evidence and missing keyboard focus', () => {
  assert.equal(assessKeyboardFocus({ surfaces: [] }, { active: { tag: 'INPUT', tabIndex: 0 }, surfaces: [{ ...base, focusWithin: true }] }).passed, false);
  for (const active of [{ tag: 'BODY', tabIndex: -1 }, { tag: 'DIV', tabIndex: -1 }]) assert.equal(run({}, { active }).passed, false);
});
