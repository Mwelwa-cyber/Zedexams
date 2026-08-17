"use strict";

/**
 * guardianUnlockCore — the pure decisions behind "ask my guardian to unlock".
 *
 * Everything here is a function of its arguments: the rate limit, the shape of
 * the progress evidence, and which plan is quoted. Firestore, email and token
 * minting live in index.js. The split is the repo's usual `*Core.js` one, and
 * it is what lets the 72-hour rule be tested as arithmetic instead of as a
 * sequence of emulator writes.
 *
 * ── The rate limit is enforced HERE as well as on the client ────────────
 *
 * The client copy in `interruptionBudget` keeps the button honest. This copy
 * is the control, because the other one runs on the learner's device. A child
 * who works out that clearing site data re-arms the button must still not be
 * able to send their parent four messages in an evening — that is how an
 * app's messages become the thing a parent blocks.
 */

/** One request per learner per 72 hours. Mirrors LIMITS.guardianRequestCooldownMs. */
const REQUEST_COOLDOWN_MS = 72 * 60 * 60 * 1000;

/** How long a guardian pay link stays usable. */
const PAY_LINK_TTL_DAYS = 7;

const OUTCOME = Object.freeze({
  SENT: "sent",
  RATE_LIMITED: "rate_limited",
  NO_GUARDIAN: "no_guardian",
  FAILED: "failed",
});

/** Gate ids a learner may ask a guardian to unlock. An allow-list, not a
 * pass-through: the gate id reaches the message text, and a caller that could
 * name anything could put anything in front of a parent. */
const REQUESTABLE_GATES = Object.freeze([
  "PAPER_CONTINUE",
  "PAPER_OPEN",
  "PAPER_OFFLINE",
  "AUTO_MARKING",
  "NOTES_OTHER_TERMS",
  "LIVE_CHALLENGE",
]);

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * May this learner send a request now?
 *
 * @param {Date|null} lastRequestAt
 * @param {Date} now
 */
function decideRateLimit(lastRequestAt, now = new Date()) {
  const last = toDate(lastRequestAt);
  if (!last) return {allowed: true, retryAfterMs: 0};
  const elapsed = now.getTime() - last.getTime();
  if (elapsed >= REQUEST_COOLDOWN_MS) return {allowed: true, retryAfterMs: 0};
  return {allowed: false, retryAfterMs: REQUEST_COOLDOWN_MS - elapsed};
}

/**
 * Is there somebody to message, and are we allowed to message them?
 *
 * FAIL CLOSED. A learner with no guardian record, an empty contact, or a
 * guardian who DECLINED gets `no_guardian` — messaging a contact that was
 * never verified, or one that has already said no, is the fastest way to turn
 * a product into spam and lose the account with it.
 */
function resolveGuardianContact(user) {
  const guardian = user && typeof user.guardian === "object" ? user.guardian : null;
  if (!guardian) return {ok: false, reason: OUTCOME.NO_GUARDIAN};
  const contact = String(guardian.contact || "").trim();
  if (!contact) return {ok: false, reason: OUTCOME.NO_GUARDIAN};
  if (guardian.consentStatus === "denied") return {ok: false, reason: OUTCOME.NO_GUARDIAN};
  const method = guardian.method === "whatsapp" ? "whatsapp" : "email";
  return {ok: true, contact, method};
}

/**
 * Assemble the evidence the message opens with.
 *
 * Every field is optional and every absence is an omission rather than a
 * substitution. A guardian who checks one number against the app and finds it
 * invented will not believe the next one — so a missing streak means no streak
 * line, not a zero, and an unknown weak topic means no advice, not a guess.
 *
 * @param {object} input
 * @param {Array<object>} [input.recentResults]  latest attempt docs, newest first
 * @param {object} [input.progress]              users/{uid} progress fields
 * @param {object} [input.clientContext]         hints from the app (a score
 *   computed a moment ago and not yet written). Numbers only, clamped.
 */
function buildProgressPayload({recentResults = [], progress = {}, clientContext = {}} = {}) {
  const latest = recentResults[0] || null;

  const clientScore = Number(clientContext.score);
  const clientOutOf = Number(clientContext.outOf);
  const hasClientScore =
    Number.isFinite(clientScore) && Number.isFinite(clientOutOf) &&
    clientOutOf > 0 && clientScore >= 0 && clientScore <= clientOutOf;

  const score = hasClientScore ? clientScore :
    (Number.isFinite(Number(latest?.score)) ? Number(latest.score) : null);
  const outOf = hasClientScore ? clientOutOf :
    (Number.isFinite(Number(latest?.total)) ? Number(latest.total) : null);

  const streakDays = Number.isFinite(Number(progress.currentStreak)) ?
    Number(progress.currentStreak) : null;

  const daysPractisedThisWeek = Number.isFinite(Number(progress.daysPractisedThisWeek)) ?
    Number(progress.daysPractisedThisWeek) : null;

  const remaining = Number(clientContext.remaining);

  return {
    score,
    outOf,
    subject: typeof latest?.subject === "string" ? latest.subject : null,
    paperTitle: typeof clientContext.paperTitle === "string" ?
      clientContext.paperTitle.slice(0, 120) : null,
    weakTopic: typeof progress.weakestTopic === "string" ? progress.weakestTopic : null,
    weakTopicDetail: typeof progress.weakestTopicDetail === "string" ?
      progress.weakestTopicDetail : null,
    streakDays,
    daysPractisedThisWeek,
    weekOverWeekDelta: Number.isFinite(Number(progress.weekOverWeekDelta)) ?
      Number(progress.weekOverWeekDelta) : null,
    remaining: Number.isFinite(remaining) && remaining > 0 ? Math.round(remaining) : null,
  };
}

/**
 * Which rung to quote.
 *
 * The Term Pass unless the exam is close enough that the seasonal Exam Pass is
 * on sale, in which case that one — a guardian eight weeks from the papers is
 * being asked for a different thing than one in February, and quoting four
 * months to somebody counting down six weeks reads as not having read the
 * situation.
 */
function chooseQuotedPlan(daysToExam, now = new Date()) {
  const month = now.getUTCMonth() + 1; // 1-12
  const examSeason = month >= 9 && month <= 11;
  if (examSeason && Number.isFinite(daysToExam) && daysToExam > 0 && daysToExam <= 90) {
    return {id: "exam", checkoutPlanId: "exam_pass", label: "Exam Pass", price: 99};
  }
  return {id: "term", checkoutPlanId: "term_pass", label: "Term Pass", price: 120};
}

/**
 * How many linked parent ACCOUNTS one ask may reach.
 *
 * A child can be linked to both parents and, later, a co-guardian. The cap is
 * here so a link table that grows unexpectedly (or is abused) cannot turn one
 * request into an unbounded fan-out of writes and pushes.
 */
const MAX_NOTIFIED_PARENTS = 10;

function firstNameOf(name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed) return "Your child";
  return trimmed.split(/\s+/)[0];
}

/**
 * The notification a linked parent account gets when their child asks.
 *
 * The guardian on the consent record is emailed — that path is unchanged and
 * is the one that reaches a payer who has never opened the app. This is the
 * SECOND surface: a parent who does have an account should not have to find
 * out from their inbox that their child asked them for something in an app
 * they are signed in to.
 *
 * Two choices worth defending:
 *
 *   • Category `account`, which is one of the three that are always written
 *     in-app (notificationPrefsCore.ALWAYS_IN_APP_CATEGORIES). A child asking
 *     their guardian for something must reach that guardian's own record; a
 *     toggle they set months ago should not be able to swallow it. The PUSH
 *     is still gated by their preferences and quiet hours, which is the part
 *     that is actually an interruption.
 *
 *   • The tap target is the child's progress, not a checkout. The rule the
 *     whole guardian path is built on — evidence before price — does not stop
 *     applying because the ask arrived through the bell.
 *
 * @param {object} input
 * @param {string} input.learnerName    the child's display name
 * @param {string} input.learnerUid
 * @param {string} [input.requestClause] from guardianMessageCore.requestClause
 * @returns {{category: string, type: string, title: string, body: string,
 *   action: {label: string, url: string}|null, dedupeKey: string|null}}
 */
function buildParentAskNotification({learnerName, learnerUid, requestClause} = {}) {
  const name = firstNameOf(learnerName);
  const clause = String(requestClause || "").trim().replace(/[.\s]+$/, "");
  // A clause we could not build is omitted, never replaced with a guess about
  // what the child wanted — the same rule the emailed message follows.
  const detail = clause ? `${name} ${clause}. ` : "";
  const uid = typeof learnerUid === "string" ? learnerUid.trim() : "";
  return {
    category: "account",
    type: "child_unlock_request",
    title: `${name} wants Premium`,
    body: `${detail}Tap to see how they are doing before you decide.`,
    action: uid ? {label: "See their progress", url: `/family/child/${uid}`} : null,
    dedupeKey: uid ? `child-unlock-request:${uid}` : null,
  };
}

module.exports = {
  MAX_NOTIFIED_PARENTS,
  OUTCOME,
  PAY_LINK_TTL_DAYS,
  REQUEST_COOLDOWN_MS,
  REQUESTABLE_GATES,
  buildParentAskNotification,
  buildProgressPayload,
  chooseQuotedPlan,
  decideRateLimit,
  resolveGuardianContact,
};
