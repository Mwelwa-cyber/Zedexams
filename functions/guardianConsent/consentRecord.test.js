"use strict";

// One consent record, three routes to it.
//
// The gap this closes: linking by family code created an authorised
// guardian with NO consent evidence at all, while `/child-safety` — the
// published standards page named in the Play Console declaration — says a
// guardian approves the account. Two routes wrote "approved" two ways and
// only one of them wrote anything a regulator would recognise.

const assert = require("assert");
const {
  WITHDRAWN_DELETION_DAYS,
  SUSPENSION_REASONS,
  grantedRecord,
  deniedRecord,
  restoredRecord,
  isGuardianSuspension,
} = require("./consentRecord");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("guardianConsent/consentRecord");

test("granted records HOW the approval arrived, not merely that it did", () => {
  const emailed = grantedRecord({now: 1, evidence: {via: "link", tokenId: "t1", ip: "1.2.3.4"}});
  assert.strictEqual(emailed.guardian.consentStatus, "granted");
  assert.strictEqual(emailed.guardian.decidedAt, 1);
  assert.strictEqual(emailed.guardian.evidence.via, "link");
  assert.strictEqual(emailed.guardian.evidence.tokenId, "t1");

  const byCode = grantedRecord({
    now: 2,
    evidence: {via: "code", guardianUid: "p1", guardianEmail: "a@b.c", code: "ABCD2345"},
  });
  assert.strictEqual(byCode.guardian.evidence.via, "code");
  assert.strictEqual(byCode.guardian.evidence.guardianUid, "p1");
  assert.strictEqual(byCode.guardian.evidence.guardianEmail, "a@b.c");
  // Both routes produce the SAME field, so one query answers "is this
  // child's account approved" regardless of how it was approved.
  assert.strictEqual(byCode.guardian.consentStatus, emailed.guardian.consentStatus);
});

test("an unstated route still records something, never undefined", () => {
  const r = grantedRecord({now: 1});
  assert.strictEqual(r.guardian.evidence.via, "link");
  assert.strictEqual(r.guardian.evidence.ip, "");
  assert.strictEqual(r.guardian.evidence.userAgent, "");
  // Keys that were never supplied are ABSENT rather than undefined —
  // Firestore rejects an undefined value, so a spread of optionals is
  // the difference between a write and a 500.
  assert.ok(!("tokenId" in r.guardian.evidence));
  assert.ok(!("guardianUid" in r.guardian.evidence));
});

test("denied suspends and schedules deletion — it is not a flag", () => {
  // The guardian is told the account is deactivated, so it has to be.
  const deletionAt = new Date("2026-09-17T00:00:00Z");
  const r = deniedRecord({now: 5, reason: "guardian_withdrew", deletionAt});
  assert.strictEqual(r.guardian.consentStatus, "denied");
  assert.strictEqual(r.suspended, true);
  assert.strictEqual(r.suspendedReason, "guardian_withdrew");
  assert.strictEqual(r.scheduledDeletionAt, deletionAt);
  assert.strictEqual(WITHDRAWN_DELETION_DAYS, 30);

  // The default reason is the emailed decline, so a caller that forgets
  // to say which route it is cannot mislabel a withdrawal as a decline
  // in the other direction.
  assert.strictEqual(deniedRecord({now: 5}).suspendedReason, "guardian_declined");
});

test("restoring clears the suspension AND writes the consent", () => {
  const r = restoredRecord({now: 7, evidence: {via: "parent_app", guardianUid: "p1"}});
  assert.strictEqual(r.guardian.consentStatus, "granted");
  assert.strictEqual(r.suspended, false);
  assert.strictEqual(r.suspendedReason, null);
  assert.strictEqual(r.scheduledDeletionAt, null);
});

test("only OUR suspensions may be lifted by a re-approval", () => {
  // A consent decision must never be a route around moderation: a
  // guardian re-approving must not reinstate an account an administrator
  // suspended for something else entirely.
  for (const reason of SUSPENSION_REASONS) {
    assert.strictEqual(isGuardianSuspension({suspended: true, suspendedReason: reason}), true);
  }
  assert.strictEqual(
      isGuardianSuspension({suspended: true, suspendedReason: "abuse"}), false,
      "an admin suspension is not a consent suspension",
  );
  assert.strictEqual(isGuardianSuspension({suspended: true}), false, "no reason recorded is not ours");
  assert.strictEqual(isGuardianSuspension({suspended: false, suspendedReason: "guardian_withdrew"}), false);
  assert.strictEqual(isGuardianSuspension(null), false);
  assert.strictEqual(isGuardianSuspension("nope"), false);
});

console.log(`\n${passed} assertions passed.`);
