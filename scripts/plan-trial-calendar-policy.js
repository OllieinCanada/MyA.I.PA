'use strict';
// Read-only local preview of the calendar implementation used at enrollment.
const {calendarForAnchor} = require('../server/trialCalendarPolicy');
function planTrialCalendar(options) {
  return {...calendarForAnchor(options),existingAccountsChanged:false,billingChanged:false,readyToActivate:false};
}
if (require.main === module) {
  try { console.log(JSON.stringify(planTrialCalendar({trialStartAt:process.argv.find(a=>a.startsWith('--start='))?.slice(8)}),null,2)); }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
module.exports = {planTrialCalendar};
