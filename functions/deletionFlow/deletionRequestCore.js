"use strict";

/**
 * functions/deletionFlow/deletionRequestCore.js
 *
 * Deleting an account is a state machine, not a button. This is the machine,
 * with every dependency injected — no firebase-admin, no firebase-functions,
 * no clock of its own — so every transition, timeout and refusal is tested as
 * arithmetic under plain `node` (deletionRequestCore.test.js).
 *
 * ── Why a machine at all ───────────────────────────────────────────────
 *
 * A child under 18 with a guardian cannot delete their own account on the
 * spot: the account is the guardian's responsibility and the decision is
 * theirs. But a guardian who never answers must not be able to trap a child
 * inside a product they want to leave, and a child whose "guardian" is the
 * wrong adult must never be made to ask that adult for permission. Those three
 * requirements pull in different directions, and the only thing that holds all
 * of them at once is a state machine with a clock in it.
 *
 *   pending_guardian ──approve──▶ scheduled ──30 days──▶ completed
 *          │                          │
 *          │                          └──restore/sign-in──▶ cancelled
 *          ├──decline───▶ declined
 *          ├──7 days────▶ escalated_support
 *          └──cancel────▶ cancelled
 *
 *   (18+ or no guardian) ─────────▶ scheduled  /  escalated_support
 *
 * ── The rules that are NOT negotiable ──────────────────────────────────
 *
 *   1. **Nothing is deleted until `completed`.** Every earlier state leaves
 *      the account working. `scheduled` in particular is a live account with a
 *      banner on it — the 30 days are the point, not a formality.
 *
 *   2. **The 7-day timeout is a right, not a courtesy.** A request still
 *      `pending_guardian` after seven days goes to `escalated_support` whether
 *      or not the guardian ever opened the notification. Silence is not a veto.
 *
 *   3. **A child with no guardian is never stuck.** No approved link → the
 *      request skips the guardian step entirely and goes to support with an
 *      email-verified confirmation. There is no path that ends in "you cannot
 *      leave because nobody is listening".
 *
 *   4. **Only the server writes `state`.** Clients request; the machine
 *      decides. `firestore.rules` denies every client write to the collection,
 *      and every transition here is guarded by both the current state and the
 *      identity of the actor.
 *
 *   5. **Every transition is recorded.** `/child-safety` promises guardians
 *      can view, change and delete — you need the audit trail to show it
 *      happened, and the trail is append-only.
 *
 * ── One thing this module deliberately does not decide ─────────────────
 *
 * WHAT gets deleted. That is `functions/accountDeletion.js`, which already
 * enumerates the collections and is the thing the executor calls. Two lists of
 * "what a deletion removes" is precisely the fork that makes one of them
 * wrong; `DELETED_SUMMARY` below is COPY for the screens and says so.
 */

/* ── States ──────────────────────────────────────────────────────────── */

const STATE = Object.freeze({
  /** Waiting on a linked guardian. Nothing deleted. */
  PENDING_GUARDIAN: "pending_guardian",
  /** The guardian said yes; the 30-day window is running. Nothing deleted. */
  SCHEDULED: "scheduled",
  /** The guardian said no. Closed; the child can still reach support. */
  DECLINED: "declined",
  /** No guardian, or a guardian who never answered. A human takes it. */
  ESCALATED_SUPPORT: "escalated_support",
  /** Withdrawn — by the child, by the guardian restoring, or by a sign-in. */
  CANCELLED: "cancelled",
  /** The purge has run. This is the only state in which data is gone. */
  COMPLETED: "completed",
});

/** States from which nothing further happens without a new request. */
const TERMINAL_STATES = Object.freeze([
  STATE.DECLINED, STATE.CANCELLED, STATE.COMPLETED,
]);

/** Who may have asked. */
const REQUESTED_BY = Object.freeze({
  LEARNER: "learner",
  GUARDIAN: "guardian",
  SUPPORT: "support",
});

/* ── The clock ───────────────────────────────────────────────────────── */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A guardian has this long to answer before the child's request goes to us. */
const GUARDIAN_RESPONSE_DAYS = 7;

/** How long an approved account keeps working, and can be brought back. */
const GRACE_DAYS = 30;

/**
 * When both sides are reminded that the window is closing. Five days out
 * rather than one: a reminder that arrives the day before leaves a guardian
 * who reads email on Sundays no room to act.
 */
const REMINDER_DAYS_BEFORE = 5;

/* ── Copy shared by the child's screen and the guardian's ────────────── */

/**
 * What a deletion removes, in the words BOTH sides read.
 *
 * The child and the guardian must see the same list — the mockups are explicit
 * about it, and the reason is that a guardian who is shown a gentler list than
 * their child was is being asked to consent to something they have not been
 * told. One array, two screens.
 *
 * This is COPY, not the deletion manifest. `functions/accountDeletion.js` owns
 * what is actually purged; a second enumeration here would be a fork, and the
 * fork would be discovered the day they disagreed.
 */
const DELETED_SUMMARY = Object.freeze([
  "Their profile and picture",
  "Their notes and saved work",
  "Their results and their streak",
  "Their badges and stickers",
  "Their place on the leaderboard",
  "Their link to their guardian",
]);

/* ── Deciding what a new request becomes ─────────────────────────────── */

/**
 * Which state a fresh request opens in, and who (if anyone) is asked.
 *
 * The three-way split is the whole design:
 *
 *   • An adult owns their own account. No guardian step; the 30-day window
 *     starts at once. Asking somebody else's permission to delete an adult's
 *     data would be the wrong failure in the other direction.
 *   • A minor WITH an approved link asks that guardian.
 *   • A minor with NO approved link goes to support. Not "refused", not
 *     "blocked pending a guardian they do not have" — a human handles it,
 *     because the alternative is a child who cannot leave.
 *
 * A PENDING link does not count. It is an adult who typed a code and whom the
 * child has not yet confirmed; handing them a veto over the child's account
 * before the child has said "yes, that is my grown-up" would make the
 * confirmation step decorative.
 *
 * @param {object} input
 * @param {boolean} input.isMinor            fails closed — see resolveIsMinor
 * @param {Array<object>} [input.links]      parentLinks docs for this learner
 * @param {number} input.now                 epoch ms
 * @return {{state: string, guardianUid: string|null, escalatedAt: number|null,
 *           scheduledDeleteAt: number|null, reason: string}}
 */
function openRequest({isMinor, links = [], now}) {
  assertNow(now);

  if (!isMinor) {
    return {
      state: STATE.SCHEDULED,
      guardianUid: null,
      escalatedAt: null,
      scheduledDeleteAt: now + GRACE_DAYS * MS_PER_DAY,
      reason: "adult_self_service",
    };
  }

  const guardian = chooseGuardian(links);
  if (!guardian) {
    return {
      state: STATE.ESCALATED_SUPPORT,
      guardianUid: null,
      escalatedAt: now,
      scheduledDeleteAt: null,
      reason: "minor_no_guardian",
    };
  }

  return {
    state: STATE.PENDING_GUARDIAN,
    guardianUid: guardian.parentUid,
    escalatedAt: null,
    scheduledDeleteAt: null,
    reason: "minor_awaiting_guardian",
  };
}

/**
 * Which guardian is asked when a child has more than one.
 *
 * The OWNER, if there is one — they are the account holder, they pay, and they
 * are the only role permitted to remove a child. Otherwise the earliest active
 * link, so the choice is deterministic rather than whichever document the
 * query happened to return first: a request that names a different guardian on
 * a retry is a request nobody can audit.
 *
 * Only ONE guardian is asked. Notifying every co-guardian would turn a child's
 * private decision into a family announcement, and would raise the question of
 * what happens when two of them answer differently — which is a design
 * decision nobody has made.
 *
 * @param {Array<object>} links
 * @return {object|null}
 */
function chooseGuardian(links) {
  const active = (Array.isArray(links) ? links : []).filter(isActiveLink);
  if (active.length === 0) return null;
  const owners = active.filter((l) => l.role === "owner");
  const pool = owners.length > 0 ? owners : active;
  return [...pool].sort(byCreatedAtThenUid)[0] || null;
}

/**
 * An link authorises a guardian only when it is ACTIVE.
 *
 * A link with no `status` at all is treated as active, matching
 * `familyPortalCore.isLinkActive` — those are links written before the field
 * existed, and reading them as inactive would silently strip real guardians of
 * the ability to answer for children they have been managing for months.
 */
function isActiveLink(link) {
  if (!link || typeof link !== "object") return false;
  if (link.status === undefined || link.status === null) return true;
  return link.status === "active";
}

function byCreatedAtThenUid(a, b) {
  const at = toMillis(a.createdAt);
  const bt = toMillis(b.createdAt);
  if (at !== bt) return at - bt;
  return String(a.parentUid || "").localeCompare(String(b.parentUid || ""));
}

/**
 * Is this account a minor?
 *
 * FAILS CLOSED, by the same rule the pricing gate uses (`planState.js`): a
 * learner is a minor unless `isMinor === false` positively says otherwise. The
 * asymmetry is deliberate — routing an adult through a guardian step is an
 * inconvenience they can escalate out of in seven days, while letting a
 * twelve-year-old delete their account unsupervised because a field was
 * missing is not recoverable.
 *
 * Non-learner roles are adults by definition. A teacher has no guardian to ask
 * and a parent IS the guardian; sending either into `pending_guardian` would
 * open a request nobody can ever answer.
 *
 * @param {object|null} profile  users/{uid}
 * @return {boolean}
 */
function resolveIsMinor(profile) {
  const role = String(profile?.role || "learner");
  if (role !== "learner") return false;
  return profile?.isMinor !== false;
}

/* ── Transitions ─────────────────────────────────────────────────────── */

/**
 * The guardian's answer.
 *
 * `park` is the third button on the decision screen and it is a real outcome
 * rather than a way of doing nothing: it leaves the request open and says so
 * to the child. What it explicitly does NOT do is stop the clock — the 7-day
 * escalation keeps running underneath, because a guardian who parks a request
 * and then forgets it is indistinguishable, from the child's side, from one
 * who ignored it.
 *
 * @param {object} input
 * @param {object} input.request     the stored request
 * @param {string} input.actorUid    who is answering
 * @param {'approve'|'decline'|'park'} input.decision
 * @param {number} input.now
 * @return {{ok: boolean, code?: string, message?: string, patch?: object,
 *           notify?: object}}
 */
function guardianDecision({request, actorUid, decision, now}) {
  assertNow(now);

  if (!request) return refuse("not_found", "That request no longer exists.");
  if (request.state !== STATE.PENDING_GUARDIAN) {
    return refuse("wrong_state", alreadyAnsweredMessage(request));
  }
  // The guardian NAMED ON THE REQUEST, not any guardian of this child. A
  // co-guardian who was not asked answering on behalf of the one who was is a
  // different decision, and would let the least careful adult in a family
  // settle it.
  if (!actorUid || actorUid !== request.guardianUid) {
    return refuse("not_your_request", "This request was sent to a different guardian.");
  }

  if (decision === "approve") {
    return {
      ok: true,
      patch: {
        state: STATE.SCHEDULED,
        guardianRespondedAt: now,
        scheduledDeleteAt: now + GRACE_DAYS * MS_PER_DAY,
        parkedAt: null,
      },
      notify: {learner: "approved", graceDays: GRACE_DAYS},
    };
  }

  if (decision === "decline") {
    return {
      ok: true,
      patch: {
        state: STATE.DECLINED,
        guardianRespondedAt: now,
        parkedAt: null,
      },
      notify: {learner: "declined"},
    };
  }

  if (decision === "park") {
    return {
      ok: true,
      // No `state` key: parking is explicitly not an answer, and writing one
      // would take the request out of the escalation query — quietly removing
      // the child's seven-day guarantee through a button labelled "decide
      // later".
      patch: {parkedAt: now},
      notify: {learner: "parked"},
    };
  }

  return refuse("bad_decision", "That is not something we can do with this request.");
}

/**
 * The child withdraws their own request.
 *
 * Allowed from `pending_guardian`, `scheduled` and `escalated_support` — every
 * state in which the account still exists. Changing your mind must be at least
 * as easy as asking, at every point before the data is gone.
 */
function cancelRequest({request, actorUid, now, actor = "learner"}) {
  assertNow(now);
  if (!request) return refuse("not_found", "That request no longer exists.");
  if (TERMINAL_STATES.includes(request.state)) {
    return refuse("wrong_state", alreadyAnsweredMessage(request));
  }

  const isLearner = actorUid && actorUid === request.learnerId;
  const isGuardian = actorUid && actorUid === request.guardianUid;
  if (!isLearner && !isGuardian) {
    return refuse("not_yours", "Only you or your guardian can cancel this.");
  }

  return {
    ok: true,
    patch: {
      state: STATE.CANCELLED,
      cancelledAt: now,
      cancelledBy: isLearner ? "learner" : "guardian",
      cancelReason: actor === "sign_in" ? "learner_signed_in" : "withdrawn",
    },
    notify: isGuardian ? {learner: "restored"} : null,
  };
}

/**
 * The 7-day sweep: a request nobody answered becomes ours.
 *
 * Returns null when the request is not due, so the caller writes nothing —
 * a sweep that touches every document it reads is a sweep that cannot be run
 * often.
 */
function escalateIfStale({request, now}) {
  assertNow(now);
  if (!request || request.state !== STATE.PENDING_GUARDIAN) return null;
  const due = toMillis(request.requestedAt) + GUARDIAN_RESPONSE_DAYS * MS_PER_DAY;
  if (now < due) return null;
  return {
    patch: {
      state: STATE.ESCALATED_SUPPORT,
      escalatedAt: now,
      escalationReason: "guardian_did_not_respond",
    },
    notify: {learner: "escalated"},
  };
}

/**
 * The 30-day sweep: the window has closed and the purge may run.
 *
 * This returns the INSTRUCTION to delete, never the deletion. The caller runs
 * the existing purge and only then writes `completed` — so a purge that throws
 * leaves the request in `scheduled` and the next sweep retries it, rather than
 * marking an account deleted that still exists.
 */
function dueForDeletion({request, now}) {
  assertNow(now);
  if (!request || request.state !== STATE.SCHEDULED) return null;
  const at = toMillis(request.scheduledDeleteAt);
  // A `scheduled` request with no date is a bug upstream, and the safe reading
  // of "we do not know when this was due" is NOT "now".
  if (!at) return null;
  if (now < at) return null;
  return {learnerId: request.learnerId, dueAt: at};
}

/**
 * Should either side be reminded that the window is closing?
 *
 * Returns the days remaining so the caller can put a real number in the
 * message, and null when it is not time — including when a reminder has
 * already been sent, because the one thing worse than no reminder is five of
 * them.
 */
function reminderDue({request, now}) {
  assertNow(now);
  if (!request || request.state !== STATE.SCHEDULED) return null;
  if (request.graceReminderSentAt) return null;
  const at = toMillis(request.scheduledDeleteAt);
  if (!at) return null;
  const remainingMs = at - now;
  if (remainingMs <= 0) return null;
  if (remainingMs > REMINDER_DAYS_BEFORE * MS_PER_DAY) return null;
  return {daysLeft: Math.max(1, Math.ceil(remainingMs / MS_PER_DAY))};
}

/**
 * Does this account currently have a deletion hanging over it, and what should
 * the banner say?
 *
 * `scheduled` is the only state that shows a countdown, because it is the only
 * one with a date. `pending_guardian` shows a waiting state and
 * `escalated_support` shows that a person is handling it — both matter, since
 * a child who asked and then sees nothing assumes the request vanished.
 */
function pendingBanner({request, now}) {
  assertNow(now);
  if (!request) return null;
  if (request.state === STATE.SCHEDULED) {
    const at = toMillis(request.scheduledDeleteAt);
    const daysLeft = at ? Math.max(0, Math.ceil((at - now) / MS_PER_DAY)) : null;
    return {kind: "scheduled", daysLeft, deleteAt: at || null, canRestore: true};
  }
  if (request.state === STATE.PENDING_GUARDIAN) {
    const askedAt = toMillis(request.requestedAt);
    const daysLeft = askedAt ?
      Math.max(0, Math.ceil((askedAt + GUARDIAN_RESPONSE_DAYS * MS_PER_DAY - now) / MS_PER_DAY)) :
      null;
    return {kind: "pending_guardian", daysLeft, deleteAt: null, canRestore: false};
  }
  if (request.state === STATE.ESCALATED_SUPPORT) {
    return {kind: "escalated_support", daysLeft: null, deleteAt: null, canRestore: false};
  }
  return null;
}

/**
 * May this learner open a NEW request?
 *
 * One open request at a time. Two would mean two clocks, two guardians
 * potentially answering differently, and a cancel button that cancels one of
 * them — so a second ask returns the FIRST request rather than creating
 * another. That is also what makes the child's "Cancel this request" button
 * unambiguous.
 */
function canOpenRequest({existing}) {
  if (!existing) return {ok: true};
  if (TERMINAL_STATES.includes(existing.state)) return {ok: true};
  return {
    ok: false,
    code: "already_open",
    existingId: existing.id || null,
    message: "You already asked. We are still waiting on an answer.",
  };
}

/* ── Audit ───────────────────────────────────────────────────────────── */

/**
 * One append-only trail entry per transition.
 *
 * `actorUid` is who DID it and `actor` is what they were acting as, and both
 * are recorded because they answer different questions: a support agent
 * cancelling on a child's behalf and the child cancelling look identical if you
 * only keep one of them.
 */
function auditEntry({requestId, learnerId, from, to, actor, actorUid, reason, now}) {
  assertNow(now);
  return {
    requestId: String(requestId || ""),
    learnerId: String(learnerId || ""),
    from: from || null,
    to: to || null,
    actor: actor || "system",
    actorUid: actorUid || null,
    reason: reason || null,
    at: now,
  };
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function refuse(code, message) {
  return {ok: false, code, message};
}

function alreadyAnsweredMessage(request) {
  const map = {
    [STATE.SCHEDULED]: "This request has already been agreed to.",
    [STATE.DECLINED]: "This request has already been answered.",
    [STATE.CANCELLED]: "This request was already cancelled.",
    [STATE.COMPLETED]: "This account has already been deleted.",
    [STATE.ESCALATED_SUPPORT]: "Our team is handling this one now.",
  };
  return map[request?.state] || "This request cannot be changed.";
}

/**
 * Epoch ms from a Firestore Timestamp, a Date, or a number. Returns 0 for
 * anything unreadable — and every caller checks for the falsy case rather than
 * treating 0 as "1970", because a missing date must never resolve to "due".
 */
function toMillis(value) {
  if (!value) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The clock is injected everywhere, so a caller that forgets is a bug that
 * would otherwise surface as an account deleted on the wrong day.
 */
function assertNow(now) {
  if (!Number.isFinite(now)) {
    throw new TypeError("deletionRequestCore: `now` (epoch ms) is required");
  }
}

module.exports = {
  STATE,
  TERMINAL_STATES,
  REQUESTED_BY,
  GUARDIAN_RESPONSE_DAYS,
  GRACE_DAYS,
  REMINDER_DAYS_BEFORE,
  DELETED_SUMMARY,
  MS_PER_DAY,
  openRequest,
  chooseGuardian,
  isActiveLink,
  resolveIsMinor,
  guardianDecision,
  cancelRequest,
  escalateIfStale,
  dueForDeletion,
  reminderDue,
  pendingBanner,
  canOpenRequest,
  auditEntry,
  toMillis,
};
