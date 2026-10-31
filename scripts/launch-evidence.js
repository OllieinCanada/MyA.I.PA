// Evidence predicates deliberately distinguish preparation/models from operational proof.
const STRIPE_CHECKS = ['trialing', 'pausedAtDay14', 'checkoutScoped', 'activeAfterCard', 'declineRejected',
  'cancellationScheduledVerified', 'cancellationReplayNoMutation', 'canceledServiceNotPaymentReady', 'lateCheckoutRejected'];
const PRIVACY_CHECKS = ['access_is_tenant_scoped', 'correction_propagates_to_subject_record',
  'consent_withdrawal_creates_suppression', 'deletion_removes_active_subject_data',
  'other_tenant_data_is_preserved', 'restore_replay_prevents_deleted_data_from_returning'];
function checksPass(value, names) {
  return Array.isArray(value?.checks) && names.every(name => {
    const matches = value.checks.filter(check => check.name === name);
    return matches.length === 1 && matches[0].passed === true;
  });
}
function boundToRelease(value, expected, scope) {
  return /^[a-f0-9]{40}$/.test(expected || '') && value?.releaseCommit === expected && value.scope === scope;
}
function localStripePassed(value) {
  return value?.ready === true && value.mode === 'local-mocked-stripe-no-network'
    && value.externalStripeObjectsCreated === 0 && value.realPaymentsAttempted === 0
    && Array.isArray(value.results) && value.results.length >= 5
    && value.consecutivePasses === value.results.length
    && value.results.every((cycle, index) => cycle.cycle === index + 1 && STRIPE_CHECKS.every(name => cycle[name] === true));
}
function privacyModelPassed(value) {
  return value?.scope === 'synthetic-policy-model-only' && value.passed === true
    && value.applicationHandlersExercised === false && value.productionDataUsed === false
    && value.externalProvidersMutated === false && checksPass(value, PRIVACY_CHECKS);
}
function privacyApplicationPassed(value, commit) {
  return boundToRelease(value, commit, 'isolated-application-privacy') && value.ready === true
    && value.applicationHandlersExercised === true && value.productionDataUsed === false
    && value.externalProvidersMutated === false
    && checksPass(value, [...PRIVACY_CHECKS, 'suppression_survives_erasure', 'legal_hold_enforced', 'audit_redaction']);
}
function logicalRestorePassed(value, commit) {
  const counts = Object.values(value?.tableCounts || {});
  return boundToRelease(value, commit, 'logical-database-only') && value.ready === true
    && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value.executionId || '') && /^[a-f0-9]{64}$/.test(value.artifactSha256 || '')
    && value.backupMode === 'production-logical-export' && value.ok === true && value.restored === true
    && value.checksumVerified === true && value.archiveReadable === true && value.archiveTocScreenPassed === true
    && Number.isFinite(value.restoreElapsedMs) && value.restoreElapsedMs > 0
    && value.constraintsValidated === true && value.productionDatabaseModified === false
    && value.applicationWorkersStarted === false && value.providerDispatches === 0
    && counts.length > 0 && value.tablesVerified === counts.length
    && counts.every(count => Number.isInteger(count) && count >= 0);
}
function fullRecoveryPassed(value, commit) {
  return boundToRelease(value, commit, 'database-disk-keys') && value.ready === true
    && value.ownerApprovedObjectives === true
    && Number.isFinite(value.rpoTargetSeconds) && value.rpoTargetSeconds > 0
    && Number.isFinite(value.rtoTargetSeconds) && value.rtoTargetSeconds > 0
    && Number.isFinite(value.measuredDataLossSeconds) && value.measuredDataLossSeconds >= 0 && value.measuredDataLossSeconds <= value.rpoTargetSeconds
    && Number.isFinite(value.measuredRecoverySeconds) && value.measuredRecoverySeconds > 0 && value.measuredRecoverySeconds <= value.rtoTargetSeconds
    && checksPass(value, ['database_restored', 'disk_state_reconciled', 'key_custody_verified',
      'consistent_recovery_point', 'deletion_replay', 'schema_sql_reviewed', 'workers_and_dispatch_sealed', 'safe_cutover_rehearsed']);
}
function alertDeliveryPassed(value, commit) {
  return boundToRelease(value, commit, 'controlled-private-alert') && value.ready === true
    && value.customerMessagesSent === 0 && value.customerCallsPlaced === 0
    && checksPass(value, ['incident_generated', 'notification_accepted', 'recipient_receipt_confirmed',
      'duplicate_notification_prevented', 'no_customer_impact']);
}
function legalApprovalPassed(value, commit) {
  return boundToRelease(value, commit, 'owner-counsel-approval') && value.ready === true
    && value.unresolvedPlaceholders === 0 && value.ownerApproved === true && value.counselApproved === true
    && checksPass(value, ['legal_identity_and_contact', 'privacy_officer_contact', 'retention_schedule',
      'processor_dispositions', 'privacy_request_procedure', 'customer_disclosures']);
}
function stripeProviderPassed(value, commit) {
  return boundToRelease(value, commit, 'provider-api-test-only') && value.ready === true && value.mode === 'stripe-test-clocks'
    && value.liveMode === false && value.realPaymentsAttempted === 0
    && Array.isArray(value.results) && value.results.length >= 5 && value.consecutivePasses === value.results.length
    && value.results.every((cycle, index) => cycle.cycle === index + 1
      && cycle.afterTrial === 'paused' && cycle.afterCard === 'active' && cycle.renewalPaid === true
      && cycle.cancellation === true && cycle.afterCancellation === 'canceled')
    && value.declinedCardRejected === true && value.cleanupConfirmed === true;
}
function stripeCheckoutPassed(value, commit) {
  return boundToRelease(value, commit, 'isolated-stripe-checkout-webhook') && value.ready === true
    && value.liveMode === false && value.realPaymentsAttempted === 0
    && checksPass(value, ['hosted_checkout_completed', 'signed_webhook_received', 'customer_subscription_scoped',
      'duplicate_webhook_safe', 'late_canceled_setup_rejected', 'invoice_failure_not_ready', 'cancellation_preserved']);
}
module.exports = { checksPass, localStripePassed, privacyModelPassed, privacyApplicationPassed,
  logicalRestorePassed, fullRecoveryPassed, alertDeliveryPassed, legalApprovalPassed, stripeProviderPassed, stripeCheckoutPassed };
