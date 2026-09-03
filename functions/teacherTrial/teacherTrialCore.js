"use strict";

/**
 * teacherTrialCore — pure decisions behind the free teacher trial.
 *
 * Two callers, two decisions:
 *   - onUserCreated.js grants the trial once, on document creation, using
 *     resolveTeacherTrialGrant().
 *   - expiryReminder.js decides who gets the "trial ends soon" email, using
 *     isTrialReminderDue() + buildTrialReminderEmail().
 *
 * No Firestore, no clock of its own (`now` is always passed in) — same
 * pattern as functions/guardianConsent/userAgeBootstrapCore.js, for the same
 * reason: the boundary cases (day math, the reminder window) are testable
 * under plain `node` instead of argued about against a live emulator.
 */

const {TEACHER_TRIAL_DAYS} = require("../teacherTools/teacherPlans");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// How long before teacherTrialEndsAt the reminder email may fire, and how
// long a firing is remembered before another window would otherwise re-fire
// it. One email per trial: the window is wide (48h) precisely so a daily
// cron catches every trial exactly once even if a run is missed — narrower
// would risk a trial ending inside the gap between two runs with no email
// sent at all.
const REMINDER_WINDOW_HOURS = 48;

/**
 * Should this freshly-created user document be granted a free trial?
 *
 * Only ever fires for a brand-new `teacher` role document with no plan
 * already on it — the second condition is the idempotency guard: this is
 * called from an onCreate trigger, which by construction only ever sees a
 * document once, but a defensive check costs nothing and means a future
 * caller (a repair script, a retried event) can never grant a second trial
 * on top of a plan a payment already set.
 *
 * @param {object} user   The users/{uid} document as written at create time.
 * @param {Date} [now]
 * @return {{teacherPlan: 'trial', teacherTrialEndsAtMs: number}|null}
 */
function resolveTeacherTrialGrant(user, now = new Date()) {
  if (!user || typeof user !== "object") return null;
  if (user.role !== "teacher") return null;
  // Anything already on teacherPlan — including a value from an admin grant
  // flow (bulk demo trials, a Google Play purchase mid-flight) — means this
  // account already has a plan decision made for it. Never overwrite one.
  if (user.teacherPlan !== undefined && user.teacherPlan !== null) return null;

  return {
    teacherPlan: "trial",
    teacherTrialEndsAtMs: now.getTime() + TEACHER_TRIAL_DAYS * MS_PER_DAY,
  };
}

/**
 * Is this teacher's trial due its one "ending soon" reminder?
 *
 * All three must hold: the plan is (still, literally) 'trial', the recorded
 * end falls inside the reminder window ahead of `now`, and no reminder has
 * been sent yet. A trial already reminded, already converted (teacherPlan
 * moved on to 'pro'/'max'), or already lapsed (end is in the past — the
 * daily cron will have had an earlier, timely run inside the window; a
 * missed window is not backfilled, since "your trial ended already" is not
 * the message this reminder exists to send) is never due again.
 *
 * @param {object} user  users/{uid} fields: teacherPlan, teacherTrialEndsAtMs,
 *   teacherTrialReminderSentAtMs (all already unwrapped from Firestore
 *   Timestamps by the caller — this function takes plain numbers so it stays
 *   dependency-free).
 * @param {Date} [now]
 * @return {boolean}
 */
function isTrialReminderDue(user, now = new Date()) {
  if (!user || typeof user !== "object") return false;
  if (user.teacherPlan !== "trial") return false;
  if (user.teacherTrialReminderSentAtMs) return false;
  const endsAtMs = Number(user.teacherTrialEndsAtMs);
  if (!Number.isFinite(endsAtMs)) return false;
  const nowMs = now.getTime();
  const windowMs = REMINDER_WINDOW_HOURS * 60 * 60 * 1000;
  return endsAtMs > nowMs && endsAtMs - nowMs <= windowMs;
}

/**
 * How many whole days remain until `endsAtMs`, floored at 1 — the reminder
 * copy always says "ends soon" language a teacher can act on ("tomorrow",
 * "in 2 days"), never "in 0 days" or a negative count from a rounding edge.
 */
function daysRemaining(endsAtMs, now = new Date()) {
  const ms = Number(endsAtMs) - now.getTime();
  return Math.max(1, Math.ceil(ms / MS_PER_DAY));
}

/**
 * The trial-ending reminder email, as plain data — no nodemailer, no
 * Firebase, so the copy is reviewable and testable without sending anything.
 *
 * @param {{displayName?: string, endsAtMs: number, now?: Date}} params
 * @return {{subject: string, text: string, html: string}}
 */
function buildTrialReminderEmail({displayName, endsAtMs, now = new Date()}) {
  const days = daysRemaining(endsAtMs, now);
  const name = (displayName || "").trim() || "there";
  const dayWord = days === 1 ? "tomorrow" : `in ${days} days`;
  const subject = days === 1
    ? "Your ZedExams trial ends tomorrow"
    : `Your ZedExams trial ends in ${days} days`;

  const text = [
    `Hi ${name},`,
    "",
    `Your free ${TEACHER_TRIAL_DAYS}-day trial of ZedExams Pro ends ${dayWord}. `
      + "After that your account moves to the Free plan, and the tools you've "
      + "been using (AI lesson plans, schemes of work, assessments, downloads) "
      + "go back to the Free allowance.",
    "",
    "Keep everything you've had this week — upgrade any time from My Subscription:",
    "https://zedexams.com/teacher/subscription",
    "",
    "— The ZedExams team",
  ].join("\n");

  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your free ${TEACHER_TRIAL_DAYS}-day trial of ZedExams Pro ends ${escapeHtml(dayWord)}.
    After that your account moves to the Free plan, and the tools you've been using
    (AI lesson plans, schemes of work, assessments, downloads) go back to the Free allowance.</p>
    <p><a href="https://zedexams.com/teacher/subscription">Keep everything you've had this week — upgrade any time</a>.</p>
    <p>— The ZedExams team</p>
  `.trim();

  return {subject, text, html};
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = {
  TEACHER_TRIAL_DAYS,
  REMINDER_WINDOW_HOURS,
  resolveTeacherTrialGrant,
  isTrialReminderDue,
  daysRemaining,
  buildTrialReminderEmail,
};
