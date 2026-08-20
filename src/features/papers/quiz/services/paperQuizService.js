/**
 * The client half of §5 — a thin wrapper over the past-paper quiz callables.
 *
 * Everything that matters is decided on the server: whether this learner may
 * sit the paper as an exam, what the questions look like (the exam's are
 * stripped), when the attempt expires, and what the paper scored. This module
 * supplies the paper id and the learner's taps, and reports the outcome.
 *
 * ── Nothing here ever rejects ────────────────────────────────────────────
 *
 * A learner mid-exam who meets an unhandled promise rejection learns nothing
 * and loses their place. Every call resolves to `{ ok, ... }` or
 * `{ ok: false, reason }`, and every reason has a sentence the runner can put
 * on screen. The one thing a failure must never do is end an attempt: §1 says
 * only the exit sheet does that, and a dropped connection is not the exit
 * sheet.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../../firebase/config'
import { reportClientError } from '../../../../utils/clientErrorReporting'

let functionsRef = null
function fns() {
  if (!functionsRef) functionsRef = getFunctions(app, 'us-central1')
  return functionsRef
}

export const QUIZ_CALL = Object.freeze({
  OK: 'ok',
  /** Signed out, or the token expired mid-exam. */
  UNAUTHENTICATED: 'unauthenticated',
  /** Exam mode on a paper this learner does not hold in full. */
  NEEDS_FULL_PAPER: 'needs_full_paper',
  /** The paper or its quiz is not ready. */
  UNAVAILABLE: 'unavailable',
  /** Transport. Retryable, and the caller should say so. */
  OFFLINE: 'offline',
  FAILED: 'failed',
})

/** Map a callable error onto a reason the runner has words for. */
function reasonFor(err) {
  const code = String(err?.code || '')
  if (code.endsWith('unauthenticated')) return QUIZ_CALL.UNAUTHENTICATED
  if (code.endsWith('permission-denied')) return QUIZ_CALL.NEEDS_FULL_PAPER
  if (code.endsWith('failed-precondition') || code.endsWith('not-found')) return QUIZ_CALL.UNAVAILABLE
  if (code.endsWith('unavailable') || code.endsWith('deadline-exceeded')) return QUIZ_CALL.OFFLINE
  return QUIZ_CALL.FAILED
}

async function call(name, payload) {
  try {
    const res = await httpsCallable(fns(), name)(payload)
    return { ok: true, reason: QUIZ_CALL.OK, data: res?.data || {} }
  } catch (err) {
    const reason = reasonFor(err)
    // A refusal the product MEANS (not entitled, paper not ready) is not an
    // error worth a Sentry event; a transport failure mid-exam is.
    if (reason === QUIZ_CALL.FAILED) reportClientError(err, `paper-quiz:${name}`)
    return { ok: false, reason, message: err?.message || '', data: {} }
  }
}

/**
 * Start — or resume — an attempt.
 *
 * `resumed: true` in the response is how the runner knows to show the "your
 * exam is still running" banner rather than starting the paper over. Note that
 * the client never decides this: a refresh and a first open are the same call,
 * and the server answers which one it was.
 */
export function startAttempt({ paperId, mode, strictForward = false, unverifiedTiming = false, clientVersion = '' }) {
  return call('startAttempt', { paperId, mode, strictForward, unverifiedTiming, clientVersion })
}

/**
 * Persist answers as they are given (§1).
 *
 * Deliberately fire-and-forget from the runner's point of view — the local
 * mirror is what the learner's next render reads, so a failed patch costs a
 * cross-device resume, never the answer on screen. It is retried on the next
 * tap rather than queued, because a queue that outlives the attempt is a queue
 * that writes answers into a submitted paper.
 */
export function patchAttempt({ attemptId, answers, flags }) {
  return call('patchAttempt', { attemptId, answers, flags })
}

/** Submit. The server marks; this returns the full marked paper (§5.2). */
export function submitAttempt({ attemptId, answers }) {
  return call('submitAttempt', { attemptId, answers })
}

/** The exit sheet's "Leave — don't count this". The one thing that voids. */
export function abandonAttempt({ attemptId }) {
  return call('abandonAttempt', { attemptId })
}

/** Practice's resume cursor. A cursor and nothing about correctness (§4.2). */
export function savePracticeProgress({ paperId, lastQuestionN, answered }) {
  return call('savePracticeProgress', { paperId, lastQuestionN, answered })
}
