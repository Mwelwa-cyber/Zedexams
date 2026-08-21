"use strict";

/**
 * The past-paper quiz's server-side DECISIONS, with no Firestore in them.
 *
 * The handler next door does the I/O; everything that can be got wrong lives
 * here so it can be driven under plain node — an attempt that expired while
 * the app was shut, a second start on a paper already in progress, a resume
 * three days later, a submission that arrived after the grace window.
 *
 * The marking itself is NOT here. It is in `functions/shared/paperQuiz/
 * marking.js`, which the browser imports too, because practice marks in the
 * browser and exam marks here and they have to agree. This module owns the
 * things only a server can decide: identity, expiry, and what a resumed
 * attempt is allowed to be.
 */

/** The attempt document id. One per learner per paper per START. */
function attemptDocId({uid, paperId, startedAtMs}) {
  return `${uid}_${paperId}_${startedAtMs}`;
}

/** `practiceProgress/{uid}_{paperId}` — one per learner per paper (§4.2). */
function practiceProgressId(uid, paperId) {
  return `${uid}_${paperId}`;
}

/** `learnerTopicStats/{uid}_{topicId}` — flat, so a batch write is one path each. */
function topicStatId(uid, topicId) {
  return `${uid}_${topicId}`;
}

const ATTEMPT_STATUS = Object.freeze({
  IN_PROGRESS: "in_progress",
  SUBMITTED: "submitted",
  EXPIRED: "expired",
  ABANDONED: "abandoned",
});

/** The statuses that mean the attempt is over. */
const TERMINAL_STATUSES = Object.freeze([
  ATTEMPT_STATUS.SUBMITTED,
  ATTEMPT_STATUS.EXPIRED,
  ATTEMPT_STATUS.ABANDONED,
]);

/**
 * How long an exam runs is NOT decided here.
 *
 * It is `resolveExamSpec` in `functions/shared/paperQuiz/examSpec.js`, which
 * the browser imports too — the cover a learner reads before tapping Start and
 * the `expiresAtMs` this handler stamps have to be the same number, and while
 * this module held its own copy of the rule they were only the same by
 * coincidence (both defaulted to 90). `paperQuizFns.js` loads the shared
 * module with the same `await import(...)` it already uses for marking and
 * passes the answer into `buildAttempt` below.
 */

/**
 * What to do when `startAttempt` is called and an attempt already exists.
 *
 * ── The rule that makes §1's "only one thing ends an exam early" true ────
 *
 * A refresh, a crash, a battery death, a phone call, a rotate, a low-memory
 * webview restart and an accidental pull-to-refresh all arrive here as
 * "startAttempt on a paper that already has a live attempt". Every one of them
 * must RESUME. Only the exit sheet's "Leave — don't count this" abandons, and
 * that is a different callable.
 *
 * So the answer is never "start a fresh one" while a live attempt is inside
 * its window. It is `resume`, or — once the window has passed with no
 * submission, which is what a learner who closed the app and never came back
 * looks like — `expire`, which finalises the old attempt on whatever it holds
 * rather than deleting it. Deleting would lose the answers; leaving it
 * `in_progress` forever would block the paper for good.
 */
function decideStart({existing, nowMs, mode}) {
  if (!existing) return {action: "create"};
  const status = existing.status;
  if (TERMINAL_STATUSES.includes(status)) return {action: "create"};

  const expiresAt = Number(existing.expiresAtMs);
  const expired = Number.isFinite(expiresAt) && nowMs > expiresAt;

  // A learner who left an exam running and came back to start PRACTICE gets
  // their practice. The exam is finalised on what it holds rather than
  // silently continuing underneath — but it is never discarded, because those
  // answers were real work. (The reverse — a live exam and a request to start
  // an exam — is the refresh case and resumes.)
  if (mode && mode !== existing.mode) {
    return {action: expired ? "expire" : "finalize_other", finalize: existing};
  }
  if (expired) return {action: "expire", finalize: existing};
  return {action: "resume", attempt: existing};
}

/**
 * The attempt document a fresh start writes.
 *
 * `expiresAtMs` is stored as a NUMBER beside the server timestamp, and that is
 * not redundancy. The clock the client counts against has to be readable in
 * the callable's own response — a `serverTimestamp()` sentinel is not a value
 * until the write lands and is re-read, so returning one would cost a second
 * round trip on the single most latency-sensitive action in the flow, or hand
 * the client a null to guess from.
 */
function buildAttempt({uid, paperId, quizId, mode, nowMs, durationMinutes, questionCount, strictForward, unverifiedTiming, clientVersion}) {
  const isExam = mode === "exam";
  return {
    learnerId: uid,
    paperId: String(paperId),
    quizId: String(quizId || ""),
    mode,
    status: ATTEMPT_STATUS.IN_PROGRESS,
    startedAtMs: nowMs,
    // Practice has no clock (§1), so it gets no expiry — and `null` rather
    // than a far-future number, because a number would make every "is this
    // still running" check somewhere silently mean "for the next century".
    expiresAtMs: isExam ? nowMs + durationMinutes * 60_000 : null,
    durationMinutes: isExam ? durationMinutes : null,
    submittedAtMs: null,
    answers: {},
    flags: [],
    timeUsedSec: 0,
    score: {right: 0, total: Number(questionCount) || 0, percent: 0},
    bySection: [],
    weakTopics: [],
    strictForward: strictForward === true,
    // §5.5: an offline exam start is allowed (Zambian connectivity), anchored
    // to the device clock and flagged. Such attempts count for the child's own
    // history but never for any leaderboard.
    unverifiedTiming: unverifiedTiming === true,
    clientVersion: String(clientVersion || ""),
  };
}

/**
 * What the client is told about an attempt it is resuming or starting.
 *
 * `serverNowMs` rides along so the client can measure its own clock skew
 * (`examClock.clockOffset`). A Zambian phone minutes out of true would
 * otherwise be shown minutes of an exam it does not have, or an exam that
 * never ends.
 */
function attemptSummary(attempt, {serverNowMs}) {
  return {
    attemptId: attempt.attemptId || null,
    mode: attempt.mode,
    status: attempt.status,
    startedAtMs: attempt.startedAtMs ?? null,
    expiresAtMs: attempt.expiresAtMs ?? null,
    durationMinutes: attempt.durationMinutes ?? null,
    answers: attempt.answers || {},
    flags: Array.isArray(attempt.flags) ? attempt.flags : [],
    strictForward: attempt.strictForward === true,
    unverifiedTiming: attempt.unverifiedTiming === true,
    serverNowMs,
  };
}

/**
 * Answers a client may write onto a live attempt.
 *
 * §1: "Answers persist as they are given, debounced to the attempt document
 * and mirrored locally — never batched in memory until submit, because memory
 * is exactly what a reload destroys." So the runner PATCHES answers during the
 * exam, and this decides what that patch may contain: option indices for
 * questions on this paper, and nothing else. Never a score, never a status,
 * never a timestamp — those are the server's, and a client that could write
 * them could mark its own paper.
 */
function sanitizeAnswerPatch(patch, {questionIds}) {
  const known = new Set((questionIds || []).map(String));
  const out = {};
  Object.keys(patch || {}).forEach((k) => {
    const key = String(k);
    if (!known.has(key)) return;
    const v = patch[k];
    if (v === null) { out[key] = null; return; }  // deselecting is legitimate
    if (Number.isInteger(v) && v >= 0 && v < 64) out[key] = v;
  });
  return out;
}

/** Flags are question ids, deduped and bounded. Nothing else rides in. */
function sanitizeFlags(flags, {questionIds}) {
  const known = new Set((questionIds || []).map(String));
  const seen = new Set();
  (Array.isArray(flags) ? flags : []).forEach((f) => {
    const id = String(f);
    if (known.has(id)) seen.add(id);
  });
  return [...seen].slice(0, 500);
}

/**
 * Is this attempt still writable?
 *
 * The grace window is honoured here too, so a submission and a final answer
 * patch racing each other over a slow connection do not disagree about whether
 * the paper was still open.
 */
function attemptIsWritable(attempt, nowMs, graceSeconds = 20) {
  if (!attempt || attempt.status !== ATTEMPT_STATUS.IN_PROGRESS) return false;
  if (attempt.mode !== "exam") return true;   // practice has no clock
  const expires = Number(attempt.expiresAtMs);
  if (!Number.isFinite(expires)) return true;
  return nowMs <= expires + graceSeconds * 1000;
}

/**
 * How long the attempt took, for §4.2's `timeUsedSec`.
 *
 * Capped at the paper's duration: a submission that arrives inside the grace
 * window a moment after expiry would otherwise record 90m 07s on a 90-minute
 * paper, which reads as a bug every time anyone sees it.
 */
function timeUsedSeconds(attempt, submittedAtMs) {
  const start = Number(attempt?.startedAtMs);
  if (!Number.isFinite(start)) return 0;
  const used = Math.max(0, Math.floor((submittedAtMs - start) / 1000));
  const dur = Number(attempt?.durationMinutes);
  if (Number.isFinite(dur) && dur > 0) return Math.min(used, dur * 60);
  return used;
}

/**
 * The abandoned record (§4.2).
 *
 * "Abandoned attempts are written but carry NO SCORE and are excluded from
 * history, averages and weak-topic maths. They exist only so we can see in
 * PostHog how often children walk out and why."
 *
 * So this deliberately does not mark. Marking an abandoned attempt and then
 * filtering it out downstream is one forgotten filter away from a voided
 * paper appearing in a child's results.
 */
function buildAbandon(attempt, nowMs) {
  return {
    status: ATTEMPT_STATUS.ABANDONED,
    submittedAtMs: nowMs,
    timeUsedSec: timeUsedSeconds(attempt, nowMs),
    score: null,
    bySection: [],
    weakTopics: [],
  };
}

module.exports = {
  ATTEMPT_STATUS,
  TERMINAL_STATUSES,
  attemptDocId,
  practiceProgressId,
  topicStatId,
  decideStart,
  buildAttempt,
  attemptSummary,
  sanitizeAnswerPatch,
  sanitizeFlags,
  attemptIsWritable,
  timeUsedSeconds,
  buildAbandon,
};
