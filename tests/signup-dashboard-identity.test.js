const assert = require("node:assert/strict");
const test = require("node:test");

const {
  canRemoveSignupAlias,
  findSignupDashboardExistingKey,
  findSignupReminderKey,
  getSignupAliases,
  normalizeSignupSubmissionId,
  selectSignupDashboardRecordForProvisioning,
  isBillingAlias,
  preserveSignupWorkflowForBilling,
  withoutBillingAliases,
} = require("../server/signupDashboardIdentity");

const business = {ownerEmail:'owner@example.com',ownerPhone:'+19055550101',businessName:'Example Co'};
test('Stripe callback without attempt ID joins the unique canonical subscription',()=>{
 const canonical={...business,signupAttemptId:'attempt-a',subscriptionId:'sub-a',status:'setup_ready'};
 const alias={...business,subscriptionId:'sub-a',status:'subscription_trialing'};
 assert.equal(findSignupDashboardExistingKey({a:canonical,b:alias},alias),'a');
 assert.equal(findSignupDashboardExistingKey({a:{...canonical,subscriptionId:undefined}},alias),'a');
 assert.throws(()=>findSignupDashboardExistingKey({a:canonical,b:{...canonical,signupAttemptId:'attempt-b'}},alias),/ambiguous/);
 assert.equal(preserveSignupWorkflowForBilling(canonical,alias).status,'setup_ready');
 assert.equal(preserveSignupWorkflowForBilling(canonical,{...alias,signupAttemptId:'attempt-a'}).status,'setup_ready');
 assert.equal(preserveSignupWorkflowForBilling({...canonical,status:'setup_error'},alias).status,'setup_error');
 assert.equal(canRemoveSignupAlias(alias,canonical),true);
});
test('billing aliases are projected once, without removing real attempts or unrelated businesses',()=>{
 const canonical={...business,signupAttemptId:'attempt-a',subscriptionId:'sub-a'};
 const alias={...business,subscriptionId:'sub-a'};
 assert.equal(isBillingAlias(alias,canonical),true);
 assert.deepEqual(Object.keys(withoutBillingAliases({a:canonical,b:alias})),['a']);
 assert.equal(findSignupReminderKey({a:canonical,b:alias},{subscriptionId:'sub-a'}),'a');
 assert.equal(isBillingAlias({...alias,vapiAssistantId:'other'},canonical),false);
 assert.equal(isBillingAlias({...alias,businessName:'Different Co'},canonical),false);
 assert.deepEqual(Object.keys(withoutBillingAliases({a:canonical,b:{...alias,signupAttemptId:'attempt-b'}})),['a','b']);
 assert.deepEqual(Object.keys(withoutBillingAliases({a:canonical,b:{...canonical,signupAttemptId:'attempt-b'},c:alias})),['a','b','c']);
});

test('coalescing retains newer trial gate evidence but not billing-alias readiness or contacts',()=>{
 const canonical={...business,signupAttemptId:'attempt-a',subscriptionId:'sub-a',status:'setup_ready',smsVerified:true,agentRouteBindingMode:'direct',agentRouteBindingVerifiedAt:'2026-10-02T00:00:00Z'};
 const alias={...business,subscriptionId:'sub-a',status:'subscription_trialing',agentRouteBindingMode:'trial-gate',agentRouteBindingVerifiedAt:'2026-10-02T00:01:00Z',trialUsageGateStatus:'active'};
 const merged=withoutBillingAliases({a:canonical,b:alias}).a;
 assert.equal(merged.status,'setup_ready');assert.equal(merged.smsVerified,true);
 assert.equal(merged.agentRouteBindingMode,'trial-gate');assert.equal(merged.trialUsageGateStatus,'active');
 assert.equal(canonical.agentRouteBindingMode,'direct');
 assert.equal(withoutBillingAliases({a:{...canonical,agentRouteBindingVerifiedAt:'2026-10-02T00:02:00Z'},b:alias}).a.agentRouteBindingMode,'direct');
});

test("reminders join the subscription stored in an attempt-keyed record", () => {
  assert.equal(findSignupReminderKey({ "attempt:a": { subscriptionId: "sub_a" } },
    { subscriptionId: "sub_a" }), "attempt:a");
});

test("reminders cannot borrow another subscription through the owner's email", () => {
  assert.equal(findSignupReminderKey({ "email:owner@example.com": {
    ownerEmail: "owner@example.com", subscriptionId: "sub_other"
  } }, { ownerEmail: "owner@example.com", subscriptionId: "sub_a" }), null);
  assert.equal(findSignupReminderKey({ a: { subscriptionId: "sub_a" },
    b: { subscriptionId: "sub_a" } }, { subscriptionId: "sub_a" }), null);
});

test("accepts only random UUID submission identities", () => {
  assert.equal(
    normalizeSignupSubmissionId("BF618A68-091F-4F3F-8F93-9B0F4544F512"),
    "bf618a68-091f-4f3f-8f93-9b0f4544f512"
  );
  assert.equal(normalizeSignupSubmissionId("johns-painting"), "");
  assert.equal(normalizeSignupSubmissionId("00000000-0000-0000-0000-000000000000"), "");
});

test("a new signup attempt never inherits an older signup that reused the same email", () => {
  const oldAttempt = {
    signupAttemptId: "signup_old",
    ownerEmail: "owner@example.com",
    businessName: "David Electrical",
    twilioPhoneNumber: "+12892169256",
    vapiAssistantId: "assistant-old",
  };
  const store = {
    "email:owner@example.com": oldAttempt,
  };
  const johnsAttempt = {
    signupAttemptId: "signup_johns_painting",
    ownerEmail: "owner@example.com",
    businessName: "John's Painting",
    status: "review_required",
  };

  const key = findSignupDashboardExistingKey(store, johnsAttempt);
  const merged = { ...(store[key] || {}), ...johnsAttempt };

  assert.equal(key, "attempt:signup_johns_painting");
  assert.equal(merged.twilioPhoneNumber, undefined);
  assert.equal(merged.vapiAssistantId, undefined);
  assert.equal(canRemoveSignupAlias(oldAttempt, merged), false);
});

test("updates for the same attempt retain their existing legacy dashboard record", () => {
  const store = {
    "email:owner@example.com": {
      signupAttemptId: "signup_same_attempt",
      ownerEmail: "owner@example.com",
      status: "signup_received",
    },
  };

  assert.equal(findSignupDashboardExistingKey(store, {
    signupAttemptId: "signup_same_attempt",
    ownerEmail: "owner@example.com",
    status: "review_required",
  }), "email:owner@example.com");
});

test("attempt aliases are first-class and only exact-attempt duplicates are removable", () => {
  const aliases = getSignupAliases({
    signupAttemptId: "signup_exact",
    ownerEmail: "owner@example.com",
    subscriptionId: "sub_123",
  });

  assert.equal(aliases[0], "attempt:signup_exact");
  assert.equal(canRemoveSignupAlias(
    { signupAttemptId: "signup_exact" },
    { signupAttemptId: "signup_exact" }
  ), true);
  assert.equal(canRemoveSignupAlias(
    { signupAttemptId: "signup_other" },
    { signupAttemptId: "signup_exact" }
  ), false);
});

test("provisioning selects only the exact signup attempt when an email was reused", () => {
  const records = [
    { signupAttemptId: "attempt-old", ownerEmail: "owner@example.com", ownerPhone: "+19055550101" },
    { signupAttemptId: "attempt-new", ownerEmail: "owner@example.com", ownerPhone: "+19055550102" },
  ];
  assert.equal(selectSignupDashboardRecordForProvisioning(records, {
    signupAttemptId: "attempt-new",
    ownerEmail: "owner@example.com",
  }), records[1]);
  assert.equal(selectSignupDashboardRecordForProvisioning(records, {
    signupAttemptId: "attempt-missing",
    ownerEmail: "owner@example.com",
  }), null);
});

test("legacy provisioning fails closed when an email maps to more than one unowned record", () => {
  const records = [
    { ownerEmail: "owner@example.com", businessName: "First" },
    { ownerEmail: "owner@example.com", businessName: "Second" },
  ];
  assert.equal(selectSignupDashboardRecordForProvisioning(records, { ownerEmail: "owner@example.com" }), null);
  assert.equal(selectSignupDashboardRecordForProvisioning(records.slice(0, 1), { ownerEmail: "owner@example.com" }), records[0]);
});
