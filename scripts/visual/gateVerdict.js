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
export function gateVerdict({
  scopeResult = '',
  visualResult = '',
  requiresVisual = '',
  summary = '',
} = {}) {
  const needed = String(requiresVisual) === 'true'

  if (scopeResult !== 'success') {
    return {
      passed: false,
      conclusion: 'scope-failed',
      message: `Scope could not be resolved (the scope job ${scopeResult || 'did not report'}), `
        + 'so nothing is known about this pull request\'s printed output.',
    }
  }

  if (needed) {
    if (visualResult === 'success') {
      return {
        passed: true,
        conclusion: 'compared',
        message: summary || 'Printed output compared against the recorded baselines.',
      }
    }
    if (visualResult === 'skipped') {
      // The dangerous one. The render was required and did not happen, which
      // reads on the run page as a tidy grey "skipped" rather than as a hole.
      return {
        passed: false,
        conclusion: 'visual-skipped',
        message: 'The visual comparison was required for this pull request and did not run. '
          + 'A skipped render is not a pass — nothing was compared.',
      }
    }
    return {
      passed: false,
      conclusion: visualResult === 'cancelled' ? 'visual-cancelled' : 'visual-failed',
      message: visualResult === 'cancelled'
        ? 'The visual comparison was cancelled before it could report, so printed output is unverified.'
        : 'The visual comparison failed — the printed output does not match the recorded baselines.',
    }
  }

  // Not required. The only acceptable outcome is that it did not run; a render
  // that happened anyway and FAILED is still a failure, because the paper it
  // rendered is the paper this pull request produces.
  if (visualResult === 'skipped' || visualResult === '') {
    return {
      passed: true,
      conclusion: 'unaffected',
      message: summary || 'Printed output not affected by this pull request.',
    }
  }
  if (visualResult === 'success') {
    return {
      passed: true,
      conclusion: 'compared',
      message: summary || 'Printed output compared against the recorded baselines.',
    }
  }
  return {
    passed: false,
    conclusion: visualResult === 'cancelled' ? 'visual-cancelled' : 'visual-failed',
    message: visualResult === 'cancelled'
      ? 'The visual comparison was cancelled before it could report.'
      : 'The visual comparison ran and failed, so printed output is not acceptable '
        + 'even though the changed files were not expected to affect it.',
  }
}
