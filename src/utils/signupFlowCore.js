/**
 * signupFlowCore — the sign-up step machine, as rules rather than as JSX.
 *
 * The sign-up page used to be one screen: role cards, a Google button, and an
 * email form. The age question lived INSIDE the email form, which made the
 * Google button a way around it — and a bypassable age screen is, for Play's
 * Families policy, the same thing as no age screen at all. It also asked
 * teachers and parents for a birthday that serves no feature and no
 * obligation, which is a data type we then have to declare and defend.
 *
 * So the page is now a sequence, and the sequence is decided HERE rather than
 * by whichever component happens to render. Two reasons that matters:
 *
 *   1. THE GUARANTEE IS "NO ROUTE REACHES AUTH WITHOUT AN ANSWER", not "the
 *      button is hidden". A deep link, a refresh that loses state, a browser
 *      back button and a Google redirect round-trip all land somewhere, and
 *      each of those is a component-level `if` waiting to be forgotten.
 *      `resolveStep` answers all four with one rule.
 *
 *   2. IT IS TESTABLE WITHOUT A BROWSER. The claim being made is a compliance
 *      claim; it should be checkable by a plain `node` script, not only by
 *      driving a form.
 *
 * Pure: no DOM, no storage, no React (the one import is the date rules in
 * ageAnswerCore.js, which is pure on the same terms). The storage half lives
 * in src/utils/signupOnboarding.js.
 */

import { MAX_PLAUSIBLE_AGE, MIN_PLAUSIBLE_AGE } from './ageAnswerCore.js'

/** The screens, in the order a learner meets them. */
export const STEP = Object.freeze({
  ROLE: 'role',
  AGE: 'age',
  AUTH: 'auth',
  GUARDIAN: 'guardian',
})

const KNOWN_STEPS = Object.freeze(Object.values(STEP))

/**
 * How long a device is held to its first age answer.
 *
 * Backing out of sign-up and returning must not be a way to try a different
 * birthday — that is retry with extra steps, and it is the one outcome the
 * neutral age screen exists to prevent. The window is deliberately finite:
 * a shared phone in a household or a school computer lab is a real thing in
 * Zambia, and a permanent lock would mean the second child to touch the
 * device can never sign up at all.
 *
 * This is the CLIENT half of the lock and it is a convenience, not the
 * enforcement — a client-owned cooldown is one a client can clear. The
 * enforcement is `recordAgeGateAttempt` on the server. Both are good-faith
 * speed bumps, which is what the policy asks for.
 */
export const AGE_ANSWER_TTL_MS = 24 * 60 * 60 * 1000

/** Roles a person can pick for themselves at sign-up. */
export const SIGNUP_ROLES = Object.freeze(['learner', 'teacher', 'parent'])

/**
 * Only learners are asked their age.
 *
 * An allow-list on the LEARNER side rather than a deny-list on the others: a
 * missing or misspelled role must fall towards being asked, not towards
 * skipping the screen.
 */
export function needsAgeAnswer(role) {
  return role === 'learner'
}

/**
 * Only adults-by-declaration are asked to confirm they are adults.
 * Teachers and parents attest with a checkbox; the learner path answers the
 * same question with a date, so asking twice would be noise.
 */
export function needsAdultConfirmation(role) {
  return role === 'teacher' || role === 'parent'
}

/** The steps this role actually walks through, in order. */
export function stepsForRole(role) {
  if (needsAgeAnswer(role)) return [STEP.ROLE, STEP.AGE, STEP.AUTH, STEP.GUARDIAN]
  return [STEP.ROLE, STEP.AUTH]
}

/**
 * Is a stored age answer still binding?
 *
 * A record with no timestamp is treated as EXPIRED rather than as permanent.
 * The failure mode being avoided is a corrupt or hand-edited storage entry
 * locking a real learner out of sign-up forever with no way to clear it; the
 * cost of getting it wrong in this direction is one extra chance to re-answer,
 * which the server-side cooldown still sees.
 */
export function isFreshAgeAnswer(record, now = Date.now()) {
  if (!record || typeof record !== 'object') return false
  if (typeof record.dob !== 'string' || !record.dob.trim()) return false
  const at = Number(record.at)
  if (!Number.isFinite(at) || at <= 0) return false
  // A timestamp in the future is a clock change or a tampered record, not an
  // answer from later today. Treat it as stale.
  if (at > now) return false
  return now - at < AGE_ANSWER_TTL_MS
}

/**
 * The step the user may actually be on, given what has been answered.
 *
 * This is the single guard. It is total — every requested step, including
 * garbage and undefined, resolves to a legal one — because the whole point is
 * that there is no input that reaches a screen it has not earned.
 *
 * @param {object} state
 * @param {string} [state.requested]  The step the URL/back-button asked for.
 * @param {string} [state.role]       The chosen role, if any.
 * @param {string} [state.dob]        The captured date of birth, if any.
 * @param {boolean} [state.isMinor]   Whether that date is under the consent age.
 * @param {boolean} [state.accountCreated]  Whether auth has already succeeded.
 * @return {string} one of STEP.
 */
export function resolveStep(state = {}) {
  const { requested, role, dob, isMinor, accountCreated } = state

  // The guardian hand-off is the only step that exists AFTER the account
  // does, so it is checked first: once auth has succeeded there is nothing to
  // go back to, and offering the age screen again would be offering a second
  // birthday for an account that already has one.
  if (accountCreated) {
    return isMinor && needsAgeAnswer(role) ? STEP.GUARDIAN : STEP.AUTH
  }

  // No role, no flow. A deep link to any later step lands here.
  if (!SIGNUP_ROLES.includes(role)) return STEP.ROLE

  const allowed = stepsForRole(role)
  const step = KNOWN_STEPS.includes(requested) && allowed.includes(requested)
    ? requested
    : STEP.ROLE

  // THE RULE. A learner reaches the auth screen only with a date on file.
  // This is what a refresh, a deep link and a browser back-button all hit.
  if (needsAgeAnswer(role) && !isNonEmptyString(dob)) {
    return step === STEP.ROLE ? STEP.ROLE : STEP.AGE
  }

  // The guardian screen belongs to an account that exists; without one there
  // is nothing to attach a consent request to.
  if (step === STEP.GUARDIAN) return STEP.AUTH

  return step
}

/**
 * Where auth success sends someone.
 *
 * `existingAccount` short-circuits everything: a person who already has a
 * ZedExams account is signing IN through the sign-up page, and running
 * onboarding for them would overwrite a date of birth they gave us years ago
 * with one they just typed to get past a screen.
 */
export function nextStepAfterAuth({ role, isMinor, existingAccount = false } = {}) {
  if (existingAccount) return 'dashboard'
  if (needsAgeAnswer(role) && isMinor === true) return STEP.GUARDIAN
  return 'done'
}

/**
 * Is this date of birth usable as an age answer?
 *
 * Deliberately narrow: it checks that the date is REAL and PLAUSIBLE, and
 * says nothing about whether the resulting age is welcome. Within the
 * plausible range there is no minimum age to reject — routing by age is the
 * age screen's job, and a screen that refuses young answers teaches the user
 * which answer to give.
 *
 * The two bounds are TYPOS, not policy, and the screen refuses them in
 * identical language at both ends ("that would make you N years old — check
 * the year"). Nobody signs themselves up for exam practice at three, and a
 * stray digit in the year box is far likelier than a toddler; refusing that
 * silently — or, worse, accepting it — is how a mistyped year becomes an
 * account nobody can explain. The numbers live in ageAnswerCore.js, which is
 * where the screen's own copy is built from them.
 *
 * @param {number|null} age  Result of ageInYears() — null for an unreadable date.
 * @return {{ok: boolean, reason?: string}}
 *   reason ∈ unreadable | future | too_young | implausible
 */
export function checkAgeAnswer(age) {
  if (age === null || age === undefined) return { ok: false, reason: 'unreadable' }
  if (age < 0) return { ok: false, reason: 'future' }
  if (age < MIN_PLAUSIBLE_AGE) return { ok: false, reason: 'too_young' }
  if (age > MAX_PLAUSIBLE_AGE) return { ok: false, reason: 'implausible' }
  return { ok: true }
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0
}
