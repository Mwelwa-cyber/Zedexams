/**
 * Who may sit a paper as an EXAM, and what the cover says when they may not.
 *
 * ── The asymmetry, and why it is not an oversight ────────────────────────
 *
 * Practice stays bounded by the free set — the learner meets the boundary at
 * the end of a designed section, gets their marks, their wrong answers and
 * their weakest topic free, and meets the offer inline afterwards. That is
 * unchanged and this module does not touch it.
 *
 * Exam mode is different in kind. Its entire claim is *just like the real
 * thing*: the paper's own duration, the paper's own sections, a score that
 * goes on the record. An exam a learner may only sit a third of rehearses
 * nothing — the clock would be wrong, the section breakdown would describe a
 * fragment, and "you scored 14/20" on a 60-mark paper is not a number anyone
 * can act on. So exam mode requires the WHOLE paper, and a learner without it
 * is offered practice rather than a truncated exam.
 *
 * ── What is never in here ────────────────────────────────────────────────
 *
 * No price, no plan name, no invoice, no checkout (§8). This module answers
 * "may they" and "what is the honest reason"; the unlock surface is the
 * entitlements service's, and for an under-18 learner that surface is the
 * guardian ask, which imports no pricing module at all. This one returns a
 * REASON, and the cover asks the gating service what to do about it.
 *
 * Pure: node-tested, no Firebase, no entitlements import.
 */

export const EXAM_ACCESS = Object.freeze({
  /** Go ahead. */
  OK: 'ok',
  /** Nobody is signed in — an exam has to be recorded against someone. */
  SIGNED_OUT: 'signed_out',
  /** Signed in, but the free set does not reach the end of this paper. */
  NEEDS_FULL_PAPER: 'needs_full_paper',
  /** The quiz carries no questions, so there is nothing to sit. */
  NO_QUESTIONS: 'no_questions',
})

/**
 * @param {object} args
 * @param {boolean} args.signedIn
 * @param {boolean} args.unlocked      the learner holds an entitlement
 * @param {object}  args.freeSet       resolveFreeSet(paper, total)
 * @param {number}  args.totalQuestions
 * @returns {{allowed: boolean, reason: string}}
 */
export function resolveExamAccess({ signedIn, unlocked, freeSet, totalQuestions } = {}) {
  const total = Number(totalQuestions) || 0
  if (total <= 0) return { allowed: false, reason: EXAM_ACCESS.NO_QUESTIONS }
  if (!signedIn) return { allowed: false, reason: EXAM_ACCESS.SIGNED_OUT }
  if (unlocked) return { allowed: true, reason: EXAM_ACCESS.OK }
  // A paper whose free set covers the whole thing is fully sittable by
  // everybody. This is the case that keeps a demo or short paper from being
  // gated by a rule aimed at long ones.
  if (freeSet?.coversWholePaper === true) return { allowed: true, reason: EXAM_ACCESS.OK }
  return { allowed: false, reason: EXAM_ACCESS.NEEDS_FULL_PAPER }
}

/**
 * What the cover says under a locked Exam card.
 *
 * Every one of these names the alternative in the same breath, because §8's
 * carried-over guardrail is that the leave path is never a dead end — and a
 * mode card that only says "no" is a dead end with a padlock on it.
 */
export const EXAM_ACCESS_COPY = Object.freeze({
  [EXAM_ACCESS.SIGNED_OUT]: {
    title: 'Sign in to sit this as an exam',
    body: 'An exam goes on your record, so it needs an account. Practice works right now without one.',
    action: 'Create a free account',
    actionHref: '/register',
  },
  [EXAM_ACCESS.NEEDS_FULL_PAPER]: {
    title: 'Exam mode needs the whole paper',
    body: 'An exam is only a real rehearsal if you sit all of it. Practise the free section now — your marks, your answers and your weakest part are free either way.',
    action: null,
    actionHref: null,
  },
  [EXAM_ACCESS.NO_QUESTIONS]: {
    title: 'This paper has no questions yet',
    body: 'The quiz for this paper is still being prepared.',
    action: null,
    actionHref: null,
  },
})

/**
 * The gate id the unlock sheet is opened with, or null when the reason is not
 * something a purchase or a guardian ask can fix. Signing out is not a
 * paywall, and a paper with no questions is not one either — offering an
 * unlock for either would be charging for something that would not help.
 */
export function unlockGateFor(reason) {
  return reason === EXAM_ACCESS.NEEDS_FULL_PAPER ? 'PAPER_CONTINUE' : null
}
