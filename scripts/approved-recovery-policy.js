// Pure synthetic planning only. No private policy discovery, approval or secret loading.
const crypto=require('node:crypto');
// Intentionally absent: callers must explicitly supply a synthetic test policy.
// A missing private file must never turn into default or fictional live approval.
const policy=null;
const iso=value=>{
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))return false;
  return new Date(value).toISOString()===(value.includes('.')?value:value.slice(0,-1)+'.000Z');
};
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
function validatePolicy(value=policy){
  if(value?.schemaVersion!==1||value.scope!=='synthetic-test-only'||value.approval?.fixtureOnly!==true||value.approval?.realApproval!==false)throw Error('EXPLICIT_SYNTHETIC_POLICY_REQUIRED_NO_LIVE_APPROVAL');
  const groups=['approval','objectives','capture','retention','custody','staging','rehearsal','monitor','notifications','productionSource','github'];
  if(groups.some(name=>!value[name]||typeof value[name]!=='object'||Array.isArray(value[name]))||Object.prototype.hasOwnProperty.call(value.approval,'policyApproved'))throw Error('SYNTHETIC_POLICY_SHAPE_REQUIRED_NO_LIVE_APPROVAL');
  if(!Number.isSafeInteger(value.objectives?.maximumDataLossSeconds)||value.objectives.maximumDataLossSeconds<1||!Number.isSafeInteger(value.objectives.maximumServiceRecoverySeconds)||value.objectives.maximumServiceRecoverySeconds<1||value.objectives.measuredProductionObjectivesPassed!==false)throw Error('SYNTHETIC_OBJECTIVES_REQUIRED');
  if(value.mode!=='synthetic-manual-preparation-only'||value.approval.productionRehearsalApproved!==false||value.capture?.enabled!==false||value.capture.automaticCadenceApproved!==false||value.monitor?.enabled!==false||value.rehearsal?.productionChangesAllowed!==false||value.staging?.data!=='synthetic-only'||value.staging.productionBackupAllowed!==false||value.staging.workersEnabled!==false||value.staging.externalProviderTrafficAllowed!==false||value.staging.strictFileReadsEnabledByDefault!==false)throw Error('PREPARATION_MUST_REMAIN_DISABLED');
  if(!Number.isInteger(value.capture.intervalMinutes)||value.capture.intervalMinutes<1||value.capture.intervalMinutes>30||value.capture.maximumConcurrentExecutions!==1||!Number.isInteger(value.monitor.intervalMinutes)||value.monitor.intervalMinutes<1||!Number.isFinite(value.monitor.backupWarningAgeMinutes)||value.monitor.backupWarningAgeMinutes<1||!Number.isFinite(value.monitor.backupCriticalAgeMinutes)||value.monitor.backupCriticalAgeMinutes<=value.monitor.backupWarningAgeMinutes||!(value.monitor.diskWarningFraction>0&&value.monitor.diskWarningFraction<value.monitor.diskCriticalFraction&&value.monitor.diskCriticalFraction<1))throw Error('SYNTHETIC_MONITOR_POLICY_REQUIRED');
  if(value.retention?.storage!=='private-github-release-attachments'||!Number.isSafeInteger(value.retention.maxSyntheticReleases)||value.retention.maxSyntheticReleases<1||!Number.isSafeInteger(value.retention.maxBundleBytes)||value.retention.maxBundleBytes<1||!Number.isSafeInteger(value.retention.maxTotalSyntheticAssetBytes)||value.retention.maxTotalSyntheticAssetBytes<value.retention.maxBundleBytes||value.retention.automaticDeletionEnabled!==false||value.retention.realDataRetentionApproved!==false||value.retention.independentKeyVault!==true||value.retention.retainKeyVersionsUntilAssociatedObjectsConfirmedDeleted!==true||value.retention.retainKeyVersionsUntilLiveCiphertextNoLongerRequiresThem!==true||value.capture.requireAllWritersFenced!==true||value.capture.requireInFlightDrain!==true||value.capture.requireDatabaseFileBoundary!==true||value.capture.requirePrivacyReplay!==true)throw Error('SYNTHETIC_CUSTODY_AND_COHERENCE_REQUIRED');
  if(typeof value.github.repository!=='string'||!/^fixture-[a-z0-9-]+\/fixture-[a-z0-9-]+$/.test(value.github.repository)||!Number.isSafeInteger(value.github.repositoryId)||value.github.repositoryId<1||value.github.privateRequired!==true||value.github.actionsMustStayDisabled!==true||typeof value.productionSource.serviceId!=='string'||!/^fixture-[a-z0-9-]+$/.test(value.productionSource.serviceId)||typeof value.productionSource.databaseId!=='string'||!/^fixture-[a-z0-9-]+$/.test(value.productionSource.databaseId)||typeof value.reviewedApplicationRelease!=='string'||!/^[a-f0-9]{40}$/.test(value.reviewedApplicationRelease)||value.notifications.receiptTestApproved!==false||value.notifications.recipientReceiptProven!==false)throw Error('FICTIONAL_SYNTHETIC_TARGETS_REQUIRED');
  return value;
}
function readiness(value=policy){
  if(value===null||value===undefined)return{ready:false,missing:['explicitSyntheticPolicy'],productionExecutionAllowed:false,automaticCadenceEnabled:false,policyRequired:true};
  validatePolicy(value);const missing=[];
  for(const name of ['vaultSetupComplete','independentRecoveryAccessTested','offlineExportRestored'])if(value.custody[name]!==true)missing.push('custody.'+name);
  for(const name of ['freshMetadataVerified','selectedStorageHasIndependentOfflineCopy'])if(value.github[name]!==true)missing.push('github.'+name);
  if(!value.custody.emergencyRecoveryContact)missing.push('custody.emergencyRecoveryContact');
  if(!value.notifications.backupEmail)missing.push('notifications.backupEmail');
  if(!value.staging.osNetworkBoundaryVerified)missing.push('staging.osNetworkBoundaryVerified');
  if(!value.rehearsal.callFallbackAndWebhookBufferingVerified)missing.push('rehearsal.callFallbackAndWebhookBufferingVerified');
  if(!value.rehearsal.selectedWindow)missing.push('rehearsal.selectedWindow');
  missing.push('approval.productionRehearsalApproved');
  return{ready:false,missing,productionExecutionAllowed:false,automaticCadenceEnabled:false};
}
function assess(facts,value=policy,now=Date.now()){
  validatePolicy(value);const issues=[];const add=(code,severity)=>issues.push({code,severity});
  const complete=facts.lastUsableSet;
  const valid=complete&&complete.environment==='production'&&complete.syntheticOnly===false&&complete.serviceId===value.productionSource.serviceId&&complete.databaseId===value.productionSource.databaseId&&complete.scope==='coherent-database-files-keys'&&complete.databaseVerified===true&&complete.filesVerified===true&&complete.keysVerified===true&&complete.coherenceVerified===true&&complete.privacyReplayReady===true&&sha(complete.manifestSha256)&&iso(complete.recoveryPointAt)&&Date.parse(complete.recoveryPointAt)<=now;
  if(!valid)add('USABLE_RECOVERY_POINT_UNPROVEN','critical');
  else{const age=(now-Date.parse(complete.recoveryPointAt))/60000;if(age>=value.monitor.backupCriticalAgeMinutes)add('RECOVERY_POINT_TOO_OLD','critical');else if(age>=value.monitor.backupWarningAgeMinutes)add('RECOVERY_POINT_AGING','warning');}
  if(facts.backupOutcome==='failed')add('BACKUP_FAILED','critical');
  else if(facts.backupOutcome==='uncertain')add('BACKUP_OUTCOME_UNCONFIRMED_DO_NOT_RETRY','critical');
  else if(!['completed','running'].includes(facts.backupOutcome))add('BACKUP_STATUS_UNKNOWN','critical');
  if(facts.keyRecoveryProbePassed!==true)add('KEY_RECOVERY_UNPROVEN_OR_FAILED','critical');
  if(facts.fileCoverageValid!==true)add('FILE_COVERAGE_INVALID_OR_UNKNOWN','critical');
  const used=facts.diskUsedBytes,capacity=facts.diskCapacityBytes;
  if(!Number.isSafeInteger(used)||!Number.isSafeInteger(capacity)||capacity<=0||used<0||used>capacity)add('DISK_HEADROOM_UNKNOWN','critical');
  else if(used/capacity>=value.monitor.diskCriticalFraction)add('DISK_HEADROOM_CRITICAL','critical');else if(used/capacity>=value.monitor.diskWarningFraction)add('DISK_HEADROOM_WARNING','warning');
  if(!iso(facts.restoreNextDueAt)||Date.parse(facts.restoreNextDueAt)<=now||facts.restoreCurrentForChanges!==true)add('RESTORE_EXERCISE_DUE','warning');
  return{checkedAt:new Date(now).toISOString(),severity:issues.some(i=>i.severity==='critical')?'critical':issues.length?'warning':'healthy',issues,productionRecoveryProven:false,dispatchAllowed:false};
}
function notificationPlan(report,state={},value=policy){
  validatePolicy(value);
  return require('./recovery-notification-model').notificationPlan(report,state);
}
function monthAfter(input){if(!iso(input))throw Error('RESTORE_TIMESTAMP_REQUIRED');const date=new Date(input),day=date.getUTCDate();date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()+1);const end=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+1,0)).getUTCDate();date.setUTCDate(Math.min(day,end));return date.toISOString();}
module.exports={policy,validatePolicy,readiness,assess,notificationPlan,monthAfter};
