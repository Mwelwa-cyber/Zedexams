/**
 * routeNotFoundSeverity — how loud a 404 should be.
 *
 * `NotFound` already reported every unmatched URL, but every report looked the
 * same, so the signal that actually matters drowned. The one that matters is a
 * LEARNER hitting a 404: a learner has no address bar habit and no second
 * portal to wander into — they arrive by tapping something we rendered. So a
 * learner-role 404 is, essentially always, a broken link we shipped, and it is
 * sitting between a child and the thing they were about to study. That is the
 * report that should page someone; a teacher mistyping /teacher/assessmnts is
 * not.
 *
 * Why a separate pure module rather than a ternary in the component: the rule
 * is the load-bearing part (which 404s get escalated), the JSX is not. Kept
 * here it is node-testable without a DOM — see
 * `scripts/test-route-not-found-severity.mjs`.
 */

export const SEVERITY = Object.freeze({
  HIGH: 'high',
  NORMAL: 'normal',
})

/**
 * Both spellings are live in stored profiles — `getRoleLandingPath` accepts
 * either, so this must too. A profile that says neither is not a learner.
 */
const LEARNER_ROLES = new Set(['learner', 'student'])

export function isLearnerRole(role) {
  return LEARNER_ROLES.has(String(role || '').trim())
}

/**
 * True when the 404 was reached from inside our own app rather than typed,
 * bookmarked or followed in from elsewhere.
 *
 * An in-app referrer is proof we rendered the dead link. `document.referrer`
 * is '' on a typed URL and carries the FULL origin on an in-app navigation, so
 * comparing origins answers it — but only when we have an origin to compare
 * against, which a node test does not. Unknown reads as false: escalating on a
 * guess would put a mistyped address in the same bucket as a shipped bug.
 */
export function isInAppReferrer(from, origin) {
  if (!from || !origin) return false
  try {
    return new URL(String(from)).origin === String(origin)
  } catch {
    return false
  }
}

/**
 * The verdict for one unmatched URL.
 *
 * `reason` travels with the report so a triaging admin reads WHY it was
 * escalated instead of re-deriving the rule from this file. Returns a plain
 * object (never throws) because the caller is an effect on an error screen —
 * the reporter must not be the thing that breaks the page.
 *
 * @param {{ role?: string, path?: string, from?: string, origin?: string }} input
 * @returns {{ severity: string, isLearner: boolean, inApp: boolean, reason: string }}
 */
export function resolveRouteNotFoundSeverity(input = {}) {
  const isLearner = isLearnerRole(input.role)
  const inApp = isInAppReferrer(input.from, input.origin)

  if (isLearner) {
    return {
      severity: SEVERITY.HIGH,
      isLearner: true,
      inApp,
      // The in-app case is the stronger evidence, but the verdict is the same
      // either way: we do not make a learner prove our link was broken before
      // we treat it as broken.
      reason: inApp ? 'learner_role_in_app_link' : 'learner_role',
    }
  }

  return {
    severity: SEVERITY.NORMAL,
    isLearner: false,
    inApp,
    reason: inApp ? 'in_app_link' : 'external_or_typed',
  }
}
