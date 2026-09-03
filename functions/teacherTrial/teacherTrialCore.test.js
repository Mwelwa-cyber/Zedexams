"use strict";

/**
 * teacherTrialCore — pins the two decisions the free teacher trial rests on:
 * who gets granted one (once, on signup) and who gets the one "ends soon"
 * reminder email.
 *
 * Run: node functions/teacherTrial/teacherTrialCore.test.js
 */

const assert = require("node:assert");
const {
  TEACHER_TRIAL_DAYS,
  REMINDER_WINDOW_HOURS,
  resolveTeacherTrialGrant,
  isTrialReminderDue,
  daysRemaining,
  buildTrialReminderEmail,
  EXISTING_TEACHER_OFFER_SOURCE,
  TEACHER_TRIAL_OFFER_STATUS,
  resolveExistingTeacherTrialEligibility,
  resolveExistingTeacherTrialActivation,
  resolveTeacherTrialOfferBackfillDecision,
} = require("./teacherTrialCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ok — ${name}`);
}

console.log("teacherTrialCore");

const NOW = new Date("2026-09-03T09:00:00Z");
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

// ── resolveTeacherTrialGrant ────────────────────────────────────────────
test("a brand-new teacher with no plan is granted a trial ending TEACHER_TRIAL_DAYS out", () => {
  const grant = resolveTeacherTrialGrant({role: "teacher"}, NOW);
  assert.ok(grant);
  assert.strictEqual(grant.teacherPlan, "trial");
  assert.strictEqual(grant.teacherTrialEndsAtMs, NOW.getTime() + TEACHER_TRIAL_DAYS * MS_PER_DAY);
});

test("learners, parents and admins are never granted a teacher trial", () => {
  assert.strictEqual(resolveTeacherTrialGrant({role: "learner"}, NOW), null);
  assert.strictEqual(resolveTeacherTrialGrant({role: "parent"}, NOW), null);
  assert.strictEqual(resolveTeacherTrialGrant({role: "admin"}, NOW), null);
  assert.strictEqual(resolveTeacherTrialGrant({role: "superAdmin"}, NOW), null);
  assert.strictEqual(resolveTeacherTrialGrant({}, NOW), null);
});

test("a teacher document that already carries a teacherPlan is never re-granted", () => {
  // The idempotency guard — a repair/retry must never overwrite a plan a
  // payment (or an earlier grant) already set.
  assert.strictEqual(resolveTeacherTrialGrant({role: "teacher", teacherPlan: "pro"}, NOW), null);
  assert.strictEqual(resolveTeacherTrialGrant({role: "teacher", teacherPlan: "free"}, NOW), null);
  assert.strictEqual(resolveTeacherTrialGrant({role: "teacher", teacherPlan: "trial"}, NOW), null);
});

test("malformed input never throws", () => {
  assert.strictEqual(resolveTeacherTrialGrant(null, NOW), null);
  assert.strictEqual(resolveTeacherTrialGrant(undefined, NOW), null);
});

// ── isTrialReminderDue ──────────────────────────────────────────────────
test("due when the end falls inside the reminder window and nothing sent yet", () => {
  const endsAtMs = NOW.getTime() + 10 * MS_PER_HOUR; // well inside 48h
  assert.strictEqual(
      isTrialReminderDue({teacherPlan: "trial", teacherTrialEndsAtMs: endsAtMs}, NOW),
      true,
  );
});

test("not due yet when the end is beyond the reminder window", () => {
  const endsAtMs = NOW.getTime() + (REMINDER_WINDOW_HOURS + 1) * MS_PER_HOUR;
  assert.strictEqual(
      isTrialReminderDue({teacherPlan: "trial", teacherTrialEndsAtMs: endsAtMs}, NOW),
      false,
  );
});

test("not due once already ended — a missed window is not backfilled", () => {
  const endsAtMs = NOW.getTime() - MS_PER_HOUR;
  assert.strictEqual(
      isTrialReminderDue({teacherPlan: "trial", teacherTrialEndsAtMs: endsAtMs}, NOW),
      false,
  );
});

test("not due once a reminder has already been sent", () => {
  const endsAtMs = NOW.getTime() + 10 * MS_PER_HOUR;
  assert.strictEqual(
      isTrialReminderDue({
        teacherPlan: "trial",
        teacherTrialEndsAtMs: endsAtMs,
        teacherTrialReminderSentAtMs: NOW.getTime() - MS_PER_DAY,
      }, NOW),
      false,
  );
});

test("not due for a converted or lapsed-to-free account (teacherPlan no longer 'trial')", () => {
  const endsAtMs = NOW.getTime() + 10 * MS_PER_HOUR;
  assert.strictEqual(isTrialReminderDue({teacherPlan: "pro", teacherTrialEndsAtMs: endsAtMs}, NOW), false);
  assert.strictEqual(isTrialReminderDue({teacherPlan: "free", teacherTrialEndsAtMs: endsAtMs}, NOW), false);
});

test("not due with no recorded end at all", () => {
  assert.strictEqual(isTrialReminderDue({teacherPlan: "trial"}, NOW), false);
});

test("malformed input never throws", () => {
  assert.strictEqual(isTrialReminderDue(null, NOW), false);
  assert.strictEqual(isTrialReminderDue(undefined, NOW), false);
});

// ── daysRemaining / buildTrialReminderEmail ─────────────────────────────
test("daysRemaining floors at 1 and rounds up", () => {
  assert.strictEqual(daysRemaining(NOW.getTime() + 1 * MS_PER_HOUR, NOW), 1);
  assert.strictEqual(daysRemaining(NOW.getTime() + 25 * MS_PER_HOUR, NOW), 2);
  assert.strictEqual(daysRemaining(NOW.getTime() - MS_PER_HOUR, NOW), 1); // never 0 or negative
});

test("the reminder email says 'tomorrow' at 1 day and names the number otherwise", () => {
  const soon = buildTrialReminderEmail({displayName: "Mwansa", endsAtMs: NOW.getTime() + 10 * MS_PER_HOUR, now: NOW});
  assert.match(soon.subject, /tomorrow/i);
  assert.match(soon.text, /tomorrow/);
  assert.match(soon.html, /tomorrow/);

  const twoDays = buildTrialReminderEmail({displayName: "Mwansa", endsAtMs: NOW.getTime() + 40 * MS_PER_HOUR, now: NOW});
  assert.match(twoDays.subject, /2 days/);
});

test("a blank display name falls back to a friendly greeting, never 'Hi ,'", () => {
  const email = buildTrialReminderEmail({displayName: "", endsAtMs: NOW.getTime() + 10 * MS_PER_HOUR, now: NOW});
  assert.doesNotMatch(email.text, /Hi ,/);
  assert.match(email.text, /Hi there,/);
});

test("the email HTML escapes the display name (never raw markup from a user-chosen name)", () => {
  const email = buildTrialReminderEmail({
    displayName: '<script>alert(1)</script>',
    endsAtMs: NOW.getTime() + 10 * MS_PER_HOUR,
    now: NOW,
  });
  assert.ok(!email.html.includes("<script>"));
});

// ── resolveExistingTeacherTrialEligibility ─────────────────────────────
console.log("\nresolveExistingTeacherTrialEligibility");

test("a free-plan teacher who never had a trial or paid plan is eligible", () => {
  assert.deepStrictEqual(
      resolveExistingTeacherTrialEligibility({role: "teacher"}, NOW),
      {eligible: true},
  );
  assert.deepStrictEqual(
      resolveExistingTeacherTrialEligibility({role: "teacher", teacherPlan: "free"}, NOW),
      {eligible: true},
  );
});

test("learners, parents and admins are never eligible", () => {
  assert.strictEqual(resolveExistingTeacherTrialEligibility({role: "learner"}, NOW).eligible, false);
  assert.strictEqual(resolveExistingTeacherTrialEligibility({role: "parent"}, NOW).eligible, false);
  assert.strictEqual(resolveExistingTeacherTrialEligibility({role: "admin"}, NOW).eligible, false);
});

test("a teacher who already had ANY trial (signup or this offer) is ineligible", () => {
  const withStartedAt = {role: "teacher", teacherPlan: "free", teacherTrialStartedAt: {toDate: () => new Date(NOW.getTime() - MS_PER_DAY)}};
  const res = resolveExistingTeacherTrialEligibility(withStartedAt, NOW);
  assert.strictEqual(res.eligible, false);
  assert.strictEqual(res.reason, "trial-already-used");
});

test("a teacher with a LIVE trial (teacherPlan still 'trial') is ineligible", () => {
  const res = resolveExistingTeacherTrialEligibility({role: "teacher", teacherPlan: "trial"}, NOW);
  assert.strictEqual(res.eligible, false);
  assert.strictEqual(res.reason, "trial-already-used");
});

test("a teacher who has ever paid (teacherPlanActivatedAt set) is ineligible, even if lapsed to free", () => {
  const lapsedPaid = {
    role: "teacher",
    teacherPlan: "free",
    teacherPlanActivatedAt: {toDate: () => new Date(NOW.getTime() - 90 * MS_PER_DAY)},
  };
  const res = resolveExistingTeacherTrialEligibility(lapsedPaid, NOW);
  assert.strictEqual(res.eligible, false);
  assert.strictEqual(res.reason, "previously-paid");
});

test("a teacher on an active paid plan is ineligible", () => {
  const activePaid = {
    role: "teacher",
    teacherPlan: "pro",
    teacherPlanExpiresAt: {toDate: () => new Date(NOW.getTime() + 10 * MS_PER_DAY)},
  };
  const res = resolveExistingTeacherTrialEligibility(activePaid, NOW);
  assert.strictEqual(res.eligible, false);
  assert.strictEqual(res.reason, "active-paid-plan");
});

test("malformed input never throws", () => {
  assert.strictEqual(resolveExistingTeacherTrialEligibility(null, NOW).eligible, false);
  assert.strictEqual(resolveExistingTeacherTrialEligibility(undefined, NOW).eligible, false);
});

// ── resolveExistingTeacherTrialActivation ──────────────────────────────
console.log("\nresolveExistingTeacherTrialActivation");

test("grants an eligible teacher a trial ending TEACHER_TRIAL_DAYS out", () => {
  const res = resolveExistingTeacherTrialActivation({role: "teacher"}, NOW);
  assert.strictEqual(res.outcome, "granted");
  assert.strictEqual(res.teacherTrialEndsAtMs, NOW.getTime() + TEACHER_TRIAL_DAYS * MS_PER_DAY);
  assert.strictEqual(res.preserveOfferedAt, null);
});

test("preserves a prior offer's offeredAt rather than restamping it", () => {
  const offeredAt = {toDate: () => new Date(NOW.getTime() - 5 * MS_PER_DAY)};
  const res = resolveExistingTeacherTrialActivation({
    role: "teacher",
    teacherTrialOffer: {status: TEACHER_TRIAL_OFFER_STATUS.AVAILABLE, offeredAt, source: EXISTING_TEACHER_OFFER_SOURCE},
  }, NOW);
  assert.strictEqual(res.outcome, "granted");
  assert.strictEqual(res.preserveOfferedAt, offeredAt);
});

test("an ineligible teacher is refused, never silently granted", () => {
  const res = resolveExistingTeacherTrialActivation({role: "learner"}, NOW);
  assert.strictEqual(res.outcome, "ineligible");
  assert.strictEqual(res.reason, "not-a-teacher");
});

test("idempotent: a doc already granted by THIS offer returns 'already-active' with the same expiry, never re-deciding", () => {
  const endsAt = {toMillis: () => NOW.getTime() + 3 * MS_PER_DAY};
  const alreadyGranted = {
    role: "teacher",
    teacherPlan: "trial",
    teacherTrialEndsAt: endsAt,
    teacherTrialStartedAt: {toDate: () => new Date(NOW.getTime() - 4 * MS_PER_DAY)},
    teacherTrialOffer: {status: TEACHER_TRIAL_OFFER_STATUS.ACTIVE, source: EXISTING_TEACHER_OFFER_SOURCE},
  };
  const res = resolveExistingTeacherTrialActivation(alreadyGranted, NOW);
  assert.strictEqual(res.outcome, "already-active");
  assert.strictEqual(res.teacherTrialEndsAtMs, NOW.getTime() + 3 * MS_PER_DAY);
});

test("repeated calls on the SAME starting doc always agree (concurrency safety at the decision level)", () => {
  const fresh = {role: "teacher"};
  const first = resolveExistingTeacherTrialActivation(fresh, NOW);
  const second = resolveExistingTeacherTrialActivation(fresh, NOW);
  assert.strictEqual(first.outcome, "granted");
  assert.strictEqual(second.outcome, "granted");
  assert.strictEqual(first.teacherTrialEndsAtMs, second.teacherTrialEndsAtMs);
});

// ── resolveTeacherTrialOfferBackfillDecision ───────────────────────────
console.log("\nresolveTeacherTrialOfferBackfillDecision");

test("an eligible existing teacher is marked eligible", () => {
  assert.deepStrictEqual(
      resolveTeacherTrialOfferBackfillDecision({role: "teacher"}, NOW),
      {decision: "eligible"},
  );
});

test("a teacher already carrying a teacherTrialOffer is skipped, never re-marked", () => {
  const res = resolveTeacherTrialOfferBackfillDecision({
    role: "teacher",
    teacherTrialOffer: {status: TEACHER_TRIAL_OFFER_STATUS.ACTIVE},
  }, NOW);
  assert.deepStrictEqual(res, {decision: "skip", reason: "already-marked"});
});

test("a non-teacher is skipped", () => {
  assert.strictEqual(resolveTeacherTrialOfferBackfillDecision({role: "learner"}, NOW).decision, "skip");
});

test("a teacher who already used a trial is marked ineligible, not skipped", () => {
  const res = resolveTeacherTrialOfferBackfillDecision({
    role: "teacher",
    teacherTrialStartedAt: {toDate: () => new Date(NOW.getTime() - MS_PER_DAY)},
  }, NOW);
  assert.strictEqual(res.decision, "ineligible");
  assert.strictEqual(res.reason, "trial-already-used");
});

test("an unrecognised teacherPlan value is reported ambiguous, never silently eligible", () => {
  const res = resolveTeacherTrialOfferBackfillDecision({role: "teacher", teacherPlan: "some-legacy-garbage"}, NOW);
  assert.strictEqual(res.decision, "ambiguous");
});

test("malformed input never throws", () => {
  assert.strictEqual(resolveTeacherTrialOfferBackfillDecision(null, NOW).decision, "skip");
});

console.log(`\nteacherTrialCore: ${passed} tests passed`);
