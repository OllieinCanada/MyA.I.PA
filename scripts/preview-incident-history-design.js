'use strict';
const { previewIncidentHistory, ACTIVE_WINDOW_MS } = require('../server/runtimeIncidentHistoryDesign');

// Fixed synthetic examples only. No input files, environment values, network or writes.
function previewFixedExamples() {
  const now = '2026-11-02T12:00:00.000Z';
  const fixture = number => ({ id: number.toString(16).padStart(24, '0'), generation: 1, occurrences: 1,
    severity: 'critical', remediationStatus: 'needs_user', firstDetectedAt: '2026-10-01T12:00:00.000Z', lastDetectedAt: '2026-10-01T12:00:00.000Z' });
  const records = [fixture(1), { ...fixture(2), remediationStatus: 'resolved' }];
  return {
    syntheticOnly: true, runtimePolicyChanged: false, livePolicyApproved: false,
    noPolicy: previewIncidentHistory({ records, incoming: fixture(3), now }),
    illustrativeFullHistory: previewIncidentHistory({ records, incoming: fixture(3), now,
      policy: { historyCapacity: 2, resolvedRetentionMs: ACTIVE_WINDOW_MS * 2 } }),
    note: 'Capacity2 and retention14days are fixture values, not recommendations or approved live settings. Resolved-old counts are review-only, never deletion commands.',
  };
}
if (require.main === module) {
  if (process.argv.length !== 2) { console.error('This design preview accepts no arguments or live input.'); process.exitCode = 1; }
  else console.log(JSON.stringify(previewFixedExamples(), null, 2));
}
module.exports = { previewFixedExamples };
