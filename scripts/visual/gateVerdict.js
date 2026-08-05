/**
 * The one required check's verdict.
 *
 * ## Why this is a module rather than an `if:` expression
 *
 * This is the last thing standing between a changed paper and `main`, and the
 * ways it can be wrong are all quiet: pass when the render was skipped for the
 * wrong reason, pass when the render was cancelled, pass when scope resolution
 * failed and nothing ran at all. A GitHub expression cannot be tested, and a
 * gate whose logic is only exercised in production is a gate nobody has checked.
 *
 * ## The rule
 *
 * The check passes when, and only when, the pull request's printed output is
 * KNOWN to be acceptable:
 *
 *   - the scope job resolved, AND
 *   - either the visual job succeeded, or it was skipped BECAUSE the scope job
 *     proved printed output cannot be affected.
 *
 * Everything else fails. In particular a skip is only ever acceptable when the
 * scope says so: a job skipped for any other reason — a cancelled run, a
 * dependency failure, a `if:` someone edited — is an absence of evidence, and
 * this gate treats absence of evidence as failure.
 *
 * ## Two render families, one check
 *
 * The learner-SCREEN family reports through this same check, under the same
 * rule, and that is deliberate. A second required check would need a second
 * branch-protection entry and would have the same wedging risk; and the
 * question the owner of a pull request needs answered is one question — "is
 * what this ships acceptable to look at" — not two.
 *
 * Each family is judged independently and BOTH must be acceptable. A screen
 * render that failed is a failure even when the papers are untouched, and vice
 * versa, because each is the output some real user receives.
 *
 * The screen inputs are OPTIONAL: absent, they read as a family that was not
 * required and did not run, which is exactly what an older workflow produces.
 * That keeps this callable from a workflow that predates the screen job rather
 * than failing every pull request during the changeover.
 */

/** The GitHub job results this reasons about. */
export const JOB_RESULTS = Object.freeze(['success', 'failure', 'cancelled', 'skipped'])

/**
 * @param {object} input
 * @param {string} input.scopeResult      needs.scope.result
 * @param {string} input.visualResult     needs.visual.result
 * @param {string} input.requiresVisual   the scope job's `requires_visual` output ('true'/'false')
 * @param {string} input.summary          the scope job's human summary
 * @returns {{passed: boolean, conclusion: string, message: string}}
 */
/**
 * One family's verdict, under the rule above.
 *
 * Extracted so the screen family cannot drift from the paper family by being
 * judged with a second, subtly different set of branches — the exact way a
 * gate acquires a hole nobody reads.
 */
function familyVerdict({ label, result, required, summary }) {
  if (required) {
    if (result === 'success') {
      return { passed: true, conclusion: 'compared', message: summary || `${label} compared against the recorded baselines.` }
    }
    if (result === 'skipped') {
      // The dangerous one. The render was required and did not happen, which
      // reads on the run page as a tidy grey "skipped" rather than as a hole.
      return {
        passed: false,
        conclusion: 'skipped',
        message: `The ${label.toLowerCase()} comparison was required for this pull request and did not run. `
          + 'A skipped render is not a pass — nothing was compared.',
      }
    }
    return {
      passed: false,
      conclusion: result === 'cancelled' ? 'cancelled' : 'failed',
      message: result === 'cancelled'
        ? `The ${label.toLowerCase()} comparison was cancelled before it could report, so it is unverified.`
        : `The ${label.toLowerCase()} comparison failed — the output does not match the recorded baselines.`,
    }
  }

  // Not required. The only acceptable outcome is that it did not run; a render
  // that happened anyway and FAILED is still a failure, because the output it
  // rendered is the output this pull request produces.
  if (result === 'skipped' || result === '') {
    return { passed: true, conclusion: 'unaffected', message: summary || `${label} not affected by this pull request.` }
  }
  if (result === 'success') {
    return { passed: true, conclusion: 'compared', message: summary || `${label} compared against the recorded baselines.` }
  }
  return {
    passed: false,
    conclusion: result === 'cancelled' ? 'cancelled' : 'failed',
    message: result === 'cancelled'
      ? `The ${label.toLowerCase()} comparison was cancelled before it could report.`
      : `The ${label.toLowerCase()} comparison ran and failed, so the output is not acceptable `
        + 'even though the changed files were not expected to affect it.',
  }
}

export function gateVerdict({
  scopeResult = '',
  visualResult = '',
  requiresVisual = '',
  summary = '',
  screenResult = '',
  requiresScreen = '',
  screenSummary = '',
} = {}) {
  if (scopeResult !== 'success') {
    return {
      passed: false,
      conclusion: 'scope-failed',
      message: `Scope could not be resolved (the scope job ${scopeResult || 'did not report'}), `
        + 'so nothing is known about this pull request\'s printed output.',
    }
  }

  const print = familyVerdict({
    label: 'Printed output',
    result: visualResult,
    required: String(requiresVisual) === 'true',
    summary,
  })
  const screen = familyVerdict({
    label: 'Learner screen',
    result: screenResult,
    required: String(requiresScreen) === 'true',
    summary: screenSummary,
  })

  // BOTH must be acceptable. Reported failure-first so the message names what
  // is wrong rather than leading with the half that passed.
  if (!print.passed) return { passed: false, conclusion: `visual-${print.conclusion}`, message: print.message }
  if (!screen.passed) return { passed: false, conclusion: `screen-${screen.conclusion}`, message: screen.message }

  return {
    passed: true,
    conclusion: print.conclusion === 'compared' || screen.conclusion === 'compared' ? 'compared' : 'unaffected',
    message: `${print.message} ${screen.message}`,
  }
}
