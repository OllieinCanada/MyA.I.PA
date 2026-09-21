const assert = require("node:assert/strict");
const { test } = require("node:test");

const {
  applyTwilioDecommissionPolicy,
  assertExclusiveResourceOwnership,
  assertSharedSignupIdentity,
  collectSignupResourceReferences,
  hashOperationalTarget,
  removeSignupTargetsFromStore,
  selectCanonicalSignupAttempt,
  selectNewestPendingSignup,
} = require("../server/signupDecommission");

const targets = [
  { ownerEmail: "owner@example.com", ownerPhone: "905-555-0100", subscriptionId: "sub_old_1", twilioPhoneNumber: "+12895550101", vapiAssistantId: "asst_1" },
  { ownerEmail: "OWNER@example.com", ownerPhone: "+1 905 555 0100", subscriptionId: "sub_old_2", twilioPhoneNumber: "+12895550102", vapiAssistantId: "asst_2" },
  { ownerEmail: "owner@example.com", ownerPhone: "19055550100", subscriptionId: "sub_old_3", twilioPhoneNumber: "+12895550103", vapiAssistantId: "asst_3" },
];

test("decommission requires one exact owner phone", () => {
  assert.deepEqual(assertSharedSignupIdentity(targets), {
    ownerEmails: ["owner@example.com"],
    ownerPhone: "+19055550100",
  });
  assert.throws(
    () => assertSharedSignupIdentity([...targets, { ownerEmail: "owner@example.com", ownerPhone: "+19055550101" }]),
    (error) => error.code === "SIGNUP_DECOMMISSION_IDENTITY_MISMATCH"
  );
});

test("decommission allows stale duplicate emails when every record shares one owner phone", () => {
  const identity = assertSharedSignupIdentity([
    targets[0],
    { ...targets[1], ownerEmail: "older@example.com" },
    { ...targets[2], ownerEmail: "newer@example.com" },
  ]);
  assert.deepEqual(identity.ownerEmails, ["newer@example.com", "older@example.com", "owner@example.com"]);
  assert.equal(identity.ownerPhone, "+19055550100");
});

test("the newest replacement must have an email and match owner phone plus exact business name", () => {
  const pendingStore = {
    older: { ownerEmail: "owner@example.com", businessName: "Old Name", createdAt: 10, payload: { owner: { phone: "+19055550100" }, business: { name: "Old Name" } } },
    newest: { ownerEmail: "replacement@example.com", businessName: "Superdaves Plumbing and Sewer Services", verifiedAt: 20, payload: { owner: { phone: "+19055550100" }, business: { name: "Superdaves Plumbing and Sewer Services" } } },
  };
  const match = selectNewestPendingSignup({
    pendingStore,
    identity: assertSharedSignupIdentity(targets),
    expectedBusinessName: "Superdaves Plumbing and Sewer Services",
  });
  assert.equal(match[0], "newest");
  assert.equal(match[1].ownerEmail, "replacement@example.com");
  assert.equal(match[1].payload.business.name, "Superdaves Plumbing and Sewer Services");
});

test("replacement selection fails closed when the canonical payload is missing or ambiguous", () => {
  const identity = assertSharedSignupIdentity(targets);
  assert.equal(
    selectNewestPendingSignup({ pendingStore: {}, identity, expectedBusinessName: "Superdaves Plumbing and Sewer Services", allowMissing: true }),
    null
  );
  assert.throws(
    () => selectNewestPendingSignup({ pendingStore: {}, identity, expectedBusinessName: "Superdaves Plumbing and Sewer Services" }),
    (error) => error.code === "SIGNUP_DECOMMISSION_CANONICAL_PAYLOAD_AMBIGUOUS"
  );
  const record = { ownerEmail: identity.ownerEmails[0], businessName: "Superdaves Plumbing and Sewer Services", payload: { owner: { phone: identity.ownerPhone }, business: { name: "Superdaves Plumbing and Sewer Services" } } };
  assert.throws(
    () => selectNewestPendingSignup({ pendingStore: { one: record, two: record }, identity, expectedBusinessName: "Superdaves Plumbing and Sewer Services" }),
    (error) => error.code === "SIGNUP_DECOMMISSION_CANONICAL_PAYLOAD_AMBIGUOUS"
  );
});

test("durable attempt recovery requires exactly one exact-name and shared-phone payload", () => {
  const identity = assertSharedSignupIdentity(targets);
  const canonical = {
    ownerEmail: "replacement@example.com",
    ownerPhone: identity.ownerPhone,
    businessName: "Superdaves Plumbing and Sewer Services",
    payload: {
      owner: { email: "replacement@example.com", phone: identity.ownerPhone },
      business: { name: "Superdaves Plumbing and Sewer Services" },
    },
  };
  assert.equal(selectCanonicalSignupAttempt({ attempts: [canonical], identity, expectedBusinessName: canonical.businessName }), canonical);
  assert.throws(
    () => selectCanonicalSignupAttempt({ attempts: [canonical, { ...canonical }], identity, expectedBusinessName: canonical.businessName }),
    (error) => error.code === "SIGNUP_DECOMMISSION_CANONICAL_ATTEMPT_AMBIGUOUS"
  );
  assert.throws(
    () => selectCanonicalSignupAttempt({
      attempts: [{
        ...canonical,
        payload: {
          ...canonical.payload,
          business: { name: "Stale HVAC payload" },
        },
      }],
      identity,
      expectedBusinessName: canonical.businessName,
    }),
    (error) => error.code === "SIGNUP_DECOMMISSION_CANONICAL_ATTEMPT_AMBIGUOUS"
  );
});

test("resource ownership fails closed when an outside account references a target resource", () => {
  assert.throws(
    () => assertExclusiveResourceOwnership({ targets, allSignups: [...targets, { ownerEmail: "other@example.com", vapiAssistantId: "asst_2" }] }),
    (error) => error.code === "SIGNUP_DECOMMISSION_RESOURCE_SHARED"
  );
  const result = assertExclusiveResourceOwnership({ targets, allSignups: targets });
  assert.deepEqual([...result.subscriptionIds].sort(), ["sub_old_1", "sub_old_2", "sub_old_3"]);
});

test("resource collection and store removal are deterministic", () => {
  const resources = collectSignupResourceReferences(targets);
  assert.equal(resources.phoneNumbers.size, 3);
  const store = Object.fromEntries(targets.map((record, index) => [`old-${index}`, record]));
  store.keep = { ownerEmail: "keep@example.com" };
  const removed = removeSignupTargetsFromStore(store, targets.map(hashOperationalTarget));
  assert.equal(removed.removed, 3);
  assert.deepEqual(Object.keys(removed.store), ["keep"]);
});

test("attempt-scoped records use the same operational identity for lookup and removal", () => {
  const attemptRecord = {
    ownerEmail: "owner@example.com",
    signupAttemptId: "signup_attempt_exact",
  };
  const expected = require("node:crypto")
    .createHash("sha256")
    .update("attempt:signup_attempt_exact")
    .digest("hex")
    .slice(0, 24);
  assert.equal(hashOperationalTarget(attemptRecord), expected);
  const removed = removeSignupTargetsFromStore(
    { attempt: attemptRecord, keep: { ownerEmail: "keep@example.com" } },
    [expected]
  );
  assert.equal(removed.removed, 1);
  assert.deepEqual(Object.keys(removed.store), ["keep"]);
});

test("preserve-number decommission never calls the Twilio release function", async () => {
  let releases = 0;
  const results = await applyTwilioDecommissionPolicy({
    targets: [{ sid: "PN_one" }, { sid: "PN_two" }],
    preserve: true,
    release: async () => {
      releases += 1;
      return "released";
    },
  });
  assert.equal(releases, 0);
  assert.deepEqual(results, ["preserved", "preserved"]);
});

test("ordinary decommission still releases each selected Twilio number", async () => {
  const released = [];
  const results = await applyTwilioDecommissionPolicy({
    targets: [{ sid: "PN_one" }, { sid: "PN_two" }],
    release: async (target) => {
      released.push(target.sid);
      return "released";
    },
  });
  assert.deepEqual(released, ["PN_one", "PN_two"]);
  assert.deepEqual(results, ["released", "released"]);
});
