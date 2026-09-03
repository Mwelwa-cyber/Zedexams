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

const {TEACHER_TRIAL_DAYS, normalizeTeacherPlan} = require("../teacherTools/teacherPlans");

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

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

/**
 * ── The existing-teacher trial offer ────────────────────────────────────
 *
 * A SECOND way onto the exact same trial `resolveTeacherTrialGrant` above
 * grants automatically on signup — for teacher accounts that predate that
 * grant (or otherwise never received one), offered as something the teacher
 * opts into rather than something that happens to their account. It reuses
 * every field the signup trial already writes (teacherPlan,
 * teacherTrialEndsAt, teacherTrialStartedAt) — an account that has ever had
 * EITHER kind of trial, or ever paid, is excluded regardless of which
 * mechanism wrote those fields, because both write into the same canonical
 * schema. Nothing here creates a parallel entitlement system.
 *
 * The only NEW field is `users/{uid}.teacherTrialOffer` — an audit/display
 * object, never the source of truth for access. Whether a teacher currently
 * HAS trial access is decided the exact same way it always has been:
 * teacherPlan === 'trial' && teacherTrialEndsAt in the future (see
 * resolveTeacherPlan in src/engines/payment-engine/teacherPlans.js and
 * getUserPlanContext in functions/teacherTools/usageMeter.js). Deliberately
 * named *Offer* rather than reusing `teacherTrial*` as a prefix so it reads
 * as clearly distinct from the pre-existing flat teacherTrialEndsAt /
 * teacherTrialStartedAt / teacherTrialReminderSentAt fields it sits beside.
 */

const EXISTING_TEACHER_OFFER_SOURCE = "existing_teacher_offer";

// 'expired' and 'redeemed' are deliberately never WRITTEN by anything below
// — see resolveExistingTeacherTrialActivation's doc comment. They exist here
// so callers have one place to spell the whole vocabulary a stored or
// derived status can take.
const TEACHER_TRIAL_OFFER_STATUS = {
  INELIGIBLE: "ineligible",
  AVAILABLE: "available",
  ACTIVE: "active",
  EXPIRED: "expired",
  REDEEMED: "redeemed",
};

/**
 * Is this teacher eligible for the existing-teacher trial offer, right now?
 *
 * Called from two places that must never disagree: the backfill script (to
 * decide who gets `teacherTrialOffer.status = 'available'`) and the
 * activation callable (to RE-CHECK live at the moment of the click, since a
 * stored 'available' flag can go stale between the offer and the tap — a
 * teacher could subscribe, or an admin could grant a plan, in between).
 *
 * @param {object} user   users/{uid} as read from Firestore.
 * @param {Date} [now]
 * @return {{eligible: true}|{eligible: false, reason: string}}
 */
function resolveExistingTeacherTrialEligibility(user, now = new Date()) {
  if (!user || typeof user !== "object") return {eligible: false, reason: "no-profile"};
  if (user.role !== "teacher") return {eligible: false, reason: "not-a-teacher"};

  // Never had ANY trial before. The signup trial (resolveTeacherTrialGrant)
  // and this offer's own activation both stamp teacherTrialStartedAt exactly
  // once and never clear it — so this single check covers "signed up before
  // trials existed", "signup trial already ran its course", AND "already
  // claimed this exact offer once", with no separate flag needed for any of
  // the three.
  if (user.teacherTrialStartedAt) return {eligible: false, reason: "trial-already-used"};

  // Never paid — spec: "unless existing business rules explicitly allow
  // them to receive a trial". No such rule exists anywhere in this codebase
  // today (teacherPlanActivatedAt has exactly one writer,
  // functions/subscriptionActivation.js, and nothing re-offers a trial once
  // it's set), so the safe default is to require the teacher has NEVER paid.
  if (user.teacherPlanActivatedAt) return {eligible: false, reason: "previously-paid"};

  const plan = normalizeTeacherPlan(user.teacherPlan);
  if (plan === "pro" || plan === "max") {
    // Reachable only for a record with a paid tier but no activation stamp
    // (defence in depth — every real writer of pro/max also stamps
    // teacherPlanActivatedAt, which is already refused above).
    const exp = toMillis(user.teacherPlanExpiresAt);
    if (!exp || exp > now.getTime()) return {eligible: false, reason: "active-paid-plan"};
  }
  if (plan === "trial") {
    // Reachable only if teacherTrialStartedAt is missing on an old/malformed
    // record — kept as an explicit arm so this function stays correct even
    // then, rather than relying solely on the check above.
    return {eligible: false, reason: "trial-already-used"};
  }

  return {eligible: true};
}

/**
 * The activation DECISION for the existing-teacher trial offer, given the
 * user doc as read INSIDE a Firestore transaction and the function's own
 * clock. Pure — the transaction handler (functions/teacherTrial/
 * existingTeacherOffer.js) does no deciding of its own, only applies
 * whatever this returns; that split is what makes the decision unit-
 * testable without a Firestore transaction in play.
 *
 * Idempotent by construction: the FIRST check is "has this exact offer
 * already been granted", ahead of eligibility — a retried transaction
 * (Firestore's own optimistic-concurrency retry on a conflicting write), a
 * second tap before the button disabled, or a second device hitting the
 * callable a moment later all read the post-grant document and take this
 * branch, returning the SAME expiry rather than re-deciding eligibility
 * (which would now reject them, since the grant itself set
 * teacherTrialStartedAt). Multiple concurrent callers therefore converge on
 * exactly one grant, never zero and never two.
 *
 * `status` is written as 'active' and NEVER updated to 'expired' by
 * anything in this codebase — the same design `resolveTeacherPlan` already
 * uses for `teacherPlan` itself ("teacherPlan stays the literal string
 * 'trial' after it ends — nothing ever clears it"). Whether the grant is
 * still LIVE is always read off `teacherTrialEndsAt` compared to now, never
 * off a stored status a cron might have failed to update; callers that want
 * a display-ready status (offer / active / expired) derive it themselves
 * from teacherPlan + teacherTrialEndsAt, exactly like every other trial/plan
 * surface in this codebase already does.
 *
 * @param {object} user
 * @param {Date} [now]
 * @return {{outcome: 'granted', teacherTrialEndsAtMs: number,
 *            preserveOfferedAt: (import('firebase-admin').firestore.Timestamp|null)}
 *          |{outcome: 'already-active', teacherTrialEndsAtMs: number|null}
 *          |{outcome: 'ineligible', reason: string}}
 */
function resolveExistingTeacherTrialActivation(user, now = new Date()) {
  if (!user || typeof user !== "object") {
    return {outcome: "ineligible", reason: "no-profile"};
  }

  const offer = user.teacherTrialOffer;
  const alreadyGrantedByThisOffer = offer
    && offer.source === EXISTING_TEACHER_OFFER_SOURCE
    && offer.status === TEACHER_TRIAL_OFFER_STATUS.ACTIVE
    && user.teacherPlan === "trial";
  if (alreadyGrantedByThisOffer) {
    return {outcome: "already-active", teacherTrialEndsAtMs: toMillis(user.teacherTrialEndsAt)};
  }

  const eligibility = resolveExistingTeacherTrialEligibility(user, now);
  if (!eligibility.eligible) {
    return {outcome: "ineligible", reason: eligibility.reason};
  }

  return {
    outcome: "granted",
    teacherTrialEndsAtMs: now.getTime() + TEACHER_TRIAL_DAYS * MS_PER_DAY,
    // A prior 'available' offer records WHEN the teacher became eligible
    // (offeredAt) — that moment predates activation and must not be
    // overwritten by it. Absent (no prior offer doc — e.g. an admin-driven
    // one-off grant with no backfill pass behind it), the handler stamps a
    // fresh server timestamp instead.
    preserveOfferedAt: (offer && offer.offeredAt) || null,
  };
}

/**
 * What the backfill script should stamp onto `users/{uid}.teacherTrialOffer`
 * for one teacher — or that nothing should be written at all.
 *
 * Idempotent by construction: a document that ALREADY carries a
 * teacherTrialOffer object is always 'skip' — re-running the backfill must
 * never clobber 'active' history a real activation wrote, and must not
 * silently flip someone the backfill already ruled ineligible.
 *
 * Ambiguous data reports 'ambiguous' rather than guessing — a teacher role
 * with a teacherPlan value that is neither empty/'free' nor something
 * normalizeTeacherPlan recognises is unreadable, and an unreadable record
 * must never resolve to "eligible" by default.
 *
 * @param {object} user
 * @param {Date} [now]
 * @return {{decision: 'skip'|'ambiguous'|'eligible'|'ineligible', reason?: string}}
 */
function resolveTeacherTrialOfferBackfillDecision(user, now = new Date()) {
  if (!user || typeof user !== "object") return {decision: "skip", reason: "no-profile"};
  if (user.teacherTrialOffer) return {decision: "skip", reason: "already-marked"};
  if (user.role !== "teacher") return {decision: "skip", reason: "not-a-teacher"};

  const rawPlan = user.teacherPlan;
  const hasRawPlan = rawPlan !== undefined && rawPlan !== null;
  if (hasRawPlan && rawPlan !== "free" && normalizeTeacherPlan(rawPlan) === null) {
    return {decision: "ambiguous", reason: `unrecognised teacherPlan value: ${JSON.stringify(rawPlan)}`};
  }

  const eligibility = resolveExistingTeacherTrialEligibility(user, now);
  if (eligibility.eligible) return {decision: "eligible"};
  return {decision: "ineligible", reason: eligibility.reason};
}

module.exports = {
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
};
