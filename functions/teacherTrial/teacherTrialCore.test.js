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

console.log(`\nteacherTrialCore: ${passed} tests passed`);
