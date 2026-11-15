const test = require('node:test');
const assert = require('node:assert/strict');
const { planTrialCalendar } = require('../scripts/plan-trial-calendar-policy');

test('Toronto day 14 reminder window, complete day 15 and exact start-of-day-16 cutoff', () => {
  const p = planTrialCalendar({ trialStartAt: '2026-11-15T00:30:00Z' }); // Nov 14 Toronto
  assert.equal(p.day14ReminderWindow.opensAt, '2026-11-27T05:00:00.000Z');
  assert.equal(p.day14ReminderWindow.closesAtExclusive, '2026-11-28T05:00:00.000Z');
  assert.equal(p.completeGraceDay15.opensAt, '2026-11-28T05:00:00.000Z');
  assert.equal(p.serviceCutoffAt, '2026-11-29T05:00:00.000Z');
  assert.equal(p.completeGraceDay15.closesAtExclusive, p.serviceCutoffAt);
  assert.equal(p.readyToActivate, false);
  assert.equal(p.existingAccountsChanged, false);
  assert.equal(p.billingChanged, false);
});

test('a complete spring-forward day is 23 clock hours, not an assumed 24', () => {
  const p = planTrialCalendar({ trialStartAt: '2026-02-22T17:00:00Z' });
  assert.equal(p.completeGraceDay15.opensAt, '2026-03-08T05:00:00.000Z');
  assert.equal(p.serviceCutoffAt, '2026-03-09T04:00:00.000Z');
  assert.equal(Date.parse(p.serviceCutoffAt) - Date.parse(p.completeGraceDay15.opensAt), 23 * 3600000);
});

test('a complete fall-back day is 25 clock hours', () => {
  const p = planTrialCalendar({ trialStartAt: '2026-10-18T16:00:00Z' });
  assert.equal(p.completeGraceDay15.opensAt, '2026-11-01T04:00:00.000Z');
  assert.equal(p.serviceCutoffAt, '2026-11-02T05:00:00.000Z');
  assert.equal(Date.parse(p.serviceCutoffAt) - Date.parse(p.completeGraceDay15.opensAt), 25 * 3600000);
});

test('Toronto midnight changes the day-one calendar date at exactly the boundary', () => {
  const before = planTrialCalendar({ trialStartAt: '2026-11-15T04:59:59.999Z' });
  const after = planTrialCalendar({ trialStartAt: '2026-11-15T05:00:00.000Z' });
  assert.equal(before.serviceCutoffAt, '2026-11-29T05:00:00.000Z');
  assert.equal(after.serviceCutoffAt, '2026-11-30T05:00:00.000Z');
});

test('month, leap-day and year crossings remain calendar-based', () => {
  for (const [start, end] of [
    ['2028-02-15T17:00:00Z', '2028-03-01T05:00:00.000Z'],
    ['2026-12-20T17:00:00Z', '2027-01-04T05:00:00.000Z'],
  ]) assert.equal(planTrialCalendar({ trialStartAt: start }).serviceCutoffAt, end);
});

test('missing, ambiguous, invalid and unsupported trial starts fail closed', () => {
  for (const value of [undefined, 0, '', '2026-11-14', '2026-11-14T12:00:00',
    '2026-02-30T12:00:00Z', 'invalid', '1999-01-01T00:00:00Z']) {
    assert.throws(() => planTrialCalendar({ trialStartAt: value }));
  }
});
