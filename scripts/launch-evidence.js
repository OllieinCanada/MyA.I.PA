// Evidence predicates deliberately distinguish preparation/models from operational proof.
const STRIPE_CHECKS = ['trialing', 'pausedAtDay14', 'checkoutScoped', 'activeAfterCard', 'declineRejected',
  'cancellationScheduledVerified', 'cancellationReplayNoMutation', 'canceledServiceNotPaymentReady', 'lateCheckoutRejected'];
const PRIVACY_CHECKS = ['access_is_tenant_scoped', 'correction_propagates_to_subject_record',
  'consent_withdrawal_creates_suppression', 'deletion_removes_active_subject_data',
  'other_tenant_data_is_preserved', 'restore_replay_prevents_deleted_data_from_returning'];
function checksPass(value, names) {
  const record = item => item !== null && typeof item === 'object' && !Array.isArray(item);
  return Array.isArray(names) && names.length > 0 && new Set(names).size === names.length
    && names.every(name => typeof name === 'string' && name.length > 0)
    && Array.isArray(value?.checks)
    && value.checks.every(check => record(check) && typeof check.name === 'string' && check.name.length > 0 && check.passed === true)
    && new Set(value.checks.map(check => check.name)).size === value.checks.length
    && names.every(name => {
    const matches = value.checks.filter(check => check.name === name);
    return matches.length === 1 && matches[0].passed === true;
  });
}
function boundToRelease(value, expected, scope) {
  return typeof expected === 'string' && /^[a-f0-9]{40}$/.test(expected)
    && typeof value?.releaseCommit === 'string' && value.releaseCommit === expected && value.scope === scope;
}
function localStripePassed(value) {
  return value?.ready === true && value.mode === 'local-mocked-stripe-no-network'
    && value.externalStripeObjectsCreated === 0 && value.realPaymentsAttempted === 0
    && Array.isArray(value.results) && value.results.length >= 5
    && value.consecutivePasses === value.results.length
    && value.results.every((cycle, index) => cycle !== null && typeof cycle === 'object' && !Array.isArray(cycle)
      && cycle.cycle === index + 1 && STRIPE_CHECKS.every(name => cycle[name] === true));
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
  const tables = value?.tableCounts;
  if (tables === null || typeof tables !== 'object' || Array.isArray(tables)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(tables))
    || Object.keys(tables).length === 0 || Object.keys(tables).some(name => !name.trim() || name.length > 256)) return false;
  const counts = Object.values(tables);
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
    && value.results.every((cycle, index) => cycle !== null && typeof cycle === 'object' && !Array.isArray(cycle) && cycle.cycle === index + 1
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
const CREDENTIAL_MAX_AGE_MS=60*60*1000;
function credentialExpectedScopeValid(e){
  if(!e||typeof e!=='object'||Array.isArray(e)||Object.keys(e).length!==4
    ||!['releaseCommit','serviceId','frontendOrigin','publicArtifactSha256'].every(k=>Object.hasOwn(e,k))
    ||!/^[a-f0-9]{40}$/.test(e.releaseCommit||'')||!/^srv-[a-z0-9]{10,64}$/.test(e.serviceId||'')
    ||!/^[a-f0-9]{64}$/.test(e.publicArtifactSha256||''))return false;
  try{const u=new URL(e.frontendOrigin);return u.protocol==='https:'&&u.origin===e.frontendOrigin&&!u.username&&!u.password&&!u.search&&!u.hash&&u.pathname==='/';}catch{return false;}
}
function credentialReportDigest(r){return require('node:crypto').createHash('sha256').update(JSON.stringify(r)).digest('hex');}
function credentialConfigurationPassed(r,expected,attempt,now=Date.now()){
  const fresh=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(x)
    &&Number.isFinite(Date.parse(x))&&now-Date.parse(x)>=0&&now-Date.parse(x)<=CREDENTIAL_MAX_AGE_MS;
  const c=r?.signupControls,b=r?.evidence,current=attempt?.current,completed=attempt?.completed;
  const uuid=x=>/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(x||'');
  return credentialExpectedScopeValid(expected)&&r?.schemaVersion===2&&r.scope==='configuration-presence-only'
    &&r.releaseCommit===expected.releaseCommit&&r.evidenceStatus==='source-bound-presence-attestation'
    &&r.secretValuesCollected===false&&r.secretValuesPrinted===false&&Array.isArray(r.issues)&&r.issues.length===0
    &&c?.configurationReady===true&&c.publicSelfServiceReady===false&&c.captchaConfigured===true&&c.captchaProviderSelected===true
    &&c.smtpConfigured===true&&c.signupVerificationEnabled===true&&c.manualApprovalEnabled===false
    &&c.adminMfaEnabled===true&&c.adminTotpConfigured===true&&c.backupEncryptionConfigured===true
    &&credentialExpectedScopeValid(b?.expected)&&Object.keys(expected).every(k=>b.expected[k]===expected[k])
    &&b.runtime?.kind==='server-runtime-presence'&&b.runtime.serviceId===expected.serviceId&&b.runtime.releaseCommit===expected.releaseCommit
    &&b.deployedPublic?.kind==='deployed-public-configuration'&&b.deployedPublic.origin===expected.frontendOrigin
    &&b.deployedPublic.releaseCommit===expected.releaseCommit&&b.deployedPublic.artifactSha256===expected.publicArtifactSha256
    &&fresh(r.checkedAt)&&fresh(b.runtime.checkedAt)&&fresh(b.deployedPublic.checkedAt)
    &&Date.parse(b.runtime.checkedAt)<=Date.parse(r.checkedAt)&&Date.parse(b.deployedPublic.checkedAt)<=Date.parse(r.checkedAt)
    &&current?.schemaVersion===1&&current.kind==='credential-audit-attempt'&&current.state==='started'&&uuid(current.attemptId)
    &&completed?.schemaVersion===1&&completed.kind==='credential-audit-attempt'&&completed.state==='completed'
    &&current.attemptId===r.auditAttemptId&&completed.attemptId===current.attemptId
    &&fresh(current.checkedAt)&&fresh(completed.checkedAt)&&Date.parse(current.checkedAt)<=Date.parse(r.checkedAt)
    &&Date.parse(completed.checkedAt)>=Date.parse(r.checkedAt)&&completed.reportSha256===credentialReportDigest(r);
}
module.exports = { checksPass, localStripePassed, privacyModelPassed, privacyApplicationPassed,
  CREDENTIAL_MAX_AGE_MS,credentialExpectedScopeValid,credentialReportDigest,credentialConfigurationPassed,
  logicalRestorePassed, fullRecoveryPassed, alertDeliveryPassed, legalApprovalPassed, stripeProviderPassed, stripeCheckoutPassed };
