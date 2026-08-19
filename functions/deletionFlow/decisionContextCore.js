"use strict";

/**
 * functions/deletionFlow/decisionContextCore.js
 *
 * What a guardian is shown before they decide, and — more importantly — what
 * they are NOT shown.
 *
 * The decision screen exists to make the choice INFORMED, not fast. A parent
 * woken at 23:15 by a push notification about their child's account should not
 * be deciding blind, so the screen carries the child's streak, their exam
 * readiness and the days to their next exam. But every one of those numbers is
 * an argument for saying no, and a screen that manufactures arguments is not
 * informing anybody — it is lobbying.
 *
 * So this module is mostly about suppression:
 *
 *   • **The "worth a conversation" note is generated from real activity and
 *     SUPPRESSED when the child genuinely is inactive.** Telling a guardian
 *     "she has been using ZedExams almost every day" about a child who last
 *     opened it in March is a lie in the service of retention, and the first
 *     time a parent checks it against the app is the last time they believe
 *     anything else on the screen.
 *
 *   • **A missing number is omitted, never defaulted.** No streak line rather
 *     than a zero; no exam countdown rather than a guess. Same rule as
 *     `guardianUnlockCore.buildProgressPayload`, for the same reason.
 *
 *   • **The plan panel states what the guardian is actually charged.** Without
 *     it every request becomes a billing support message ("am I still paying
 *     for her?"), and with a wrong one it becomes a refund dispute.
 *
 * Pure: no Firestore, no clock of its own, no firebase-admin.
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * How recently a child must have been active for the "worth a conversation"
 * note to be honest.
 *
 * Seven days rather than thirty: the note's claim is "she has been using it
 * almost every day", and a child who last practised three weeks ago has not.
 */
const ACTIVE_WITHIN_DAYS = 7;

/** And how many separate days of practice make "almost every day" true. */
const ACTIVE_DAYS_THRESHOLD = 3;

/**
 * The three stat tiles.
 *
 * Each is `null` when unknown, and the renderer omits a null tile rather than
 * drawing a zero — "0 day streak" and "we do not know" look identical on
 * screen and mean opposite things to a parent deciding.
 *
 * @param {object} input
 * @param {object} [input.stats]        learnerStats/{uid}
 * @param {object} [input.summary]      aggregated progress summary
 * @param {number} [input.nextExamAt]   epoch ms of the next exam, if any
 * @param {number} input.now
 * @return {{streakDays: number|null, examReadiness: number|null, daysToExam: number|null}}
 */
function buildStatTiles({stats = {}, summary = {}, nextExamAt = null, now}) {
  assertNow(now);

  const streak = Number(stats.currentStreak);
  const readiness = Number(summary.examReadiness ?? summary.readiness ?? summary.averageScore);

  let daysToExam = null;
  if (Number.isFinite(nextExamAt) && nextExamAt > now) {
    daysToExam = Math.ceil((nextExamAt - now) / MS_PER_DAY);
  }

  return {
    streakDays: Number.isFinite(streak) && streak > 0 ? streak : null,
    examReadiness: Number.isFinite(readiness) && readiness > 0 ?
      Math.round(Math.min(100, readiness)) : null,
    daysToExam,
  };
}

/**
 * The amber "worth a conversation first" note — or nothing.
 *
 * Returns `null` whenever the claim it would make is not true of this child.
 * That is the whole function: assembling the sentence is trivial, and deciding
 * not to is the part with judgement in it.
 *
 * The note is also suppressed when there is no exam anywhere near, because
 * "her exams start in 12 days" is half of what makes it worth reading — a note
 * that says only "children often ask for this after a bad result" is a
 * generic retention message dressed as advice about this child.
 *
 * @param {object} input
 * @param {string} input.childName
 * @param {{streakDays: number|null, daysToExam: number|null}} input.tiles
 * @param {number} [input.activeDaysLast7]  distinct days practised in the week
 * @param {number} [input.lastActiveAt]     epoch ms
 * @param {number} input.now
 * @return {{text: string, reasons: string[]}|null}
 */
function buildConversationNote({childName, tiles, activeDaysLast7, lastActiveAt, now}) {
  assertNow(now);

  const name = String(childName || "").trim() || "Your child";

  // Is the child ACTUALLY active? Both signals have to agree, and both have to
  // be present — an unknown activity level is not an active one.
  const activeDays = Number(activeDaysLast7);
  const recentlySeen = Number.isFinite(lastActiveAt) &&
    lastActiveAt > now - ACTIVE_WITHIN_DAYS * MS_PER_DAY;
  const practisingOften = Number.isFinite(activeDays) && activeDays >= ACTIVE_DAYS_THRESHOLD;
  const streaking = Number.isFinite(tiles?.streakDays) && tiles.streakDays >= ACTIVE_DAYS_THRESHOLD;

  if (!recentlySeen) return null;
  if (!practisingOften && !streaking) return null;

  const examSoon = Number.isFinite(tiles?.daysToExam) && tiles.daysToExam > 0 && tiles.daysToExam <= 30;
  if (!examSoon) return null;

  const reasons = [];
  if (streaking) reasons.push("streak");
  if (practisingOften) reasons.push("recent_practice");
  reasons.push("exam_soon");

  return {
    text: `${name} has been using ZedExams almost every day and their exams start in ` +
      `${tiles.daysToExam} ${tiles.daysToExam === 1 ? "day" : "days"}. ` +
      "Children often ask for this after one bad result. You don't have to answer tonight.",
    reasons,
  };
}

/**
 * The plan panel: what deleting this child does, and does not do, to the money.
 *
 * Returns `null` when the guardian is not paying — a free-plan family shown a
 * billing reassurance is being told about a charge that does not exist, which
 * raises a question rather than answering one.
 *
 * The sentence names the OTHER children explicitly when there are any, because
 * "your plan is unchanged" answers "am I still being charged" and leaves "for
 * whom" open, and that second question is the one that generates the support
 * message.
 *
 * @param {object} input
 * @param {object|null} input.subscription   {planLabel, priceLabel, active}
 * @param {number} input.linkedChildCount    including the one being deleted
 * @param {string} input.childName
 * @return {{text: string, othersRemain: boolean}|null}
 */
function buildPlanPanel({subscription, linkedChildCount, childName}) {
  if (!subscription || !subscription.active) return null;
  const price = String(subscription.priceLabel || "").trim();
  if (!price) return null;

  const others = Math.max(0, Number(linkedChildCount || 0) - 1);
  const name = String(childName || "").trim() || "this account";

  const covers = others > 0 ?
    `covering ${others + 1} children` :
    "covering this account";
  const consequence = others > 0 ?
    `Deleting ${name}'s account does not cancel it — your other ${others === 1 ? "child keeps" : "children keep"} everything.` :
    `Deleting ${name}'s account does not cancel it. You can change or stop your plan under Account → Subscription.`;

  return {
    text: `You pay ${price} ${covers}. ${consequence}`,
    othersRemain: others > 0,
  };
}

/**
 * Everything the decision screen needs, assembled.
 *
 * @return {{tiles: object, note: object|null, plan: object|null}}
 */
function buildDecisionContext({
  childName, stats, summary, nextExamAt, activeDaysLast7, lastActiveAt,
  subscription, linkedChildCount, now,
}) {
  assertNow(now);
  const tiles = buildStatTiles({stats, summary, nextExamAt, now});
  return {
    tiles,
    note: buildConversationNote({childName, tiles, activeDaysLast7, lastActiveAt, now}),
    plan: buildPlanPanel({subscription, linkedChildCount, childName}),
  };
}

function assertNow(now) {
  if (!Number.isFinite(now)) {
    throw new TypeError("decisionContextCore: `now` (epoch ms) is required");
  }
}

module.exports = {
  ACTIVE_WITHIN_DAYS,
  ACTIVE_DAYS_THRESHOLD,
  MS_PER_DAY,
  buildStatTiles,
  buildConversationNote,
  buildPlanPanel,
  buildDecisionContext,
};
