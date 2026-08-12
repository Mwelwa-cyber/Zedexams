/**
 * Which git ref actually holds the trunk?
 *
 * The merge-commit guard in scripts/test-release-notes-core.mjs asserts that
 * no merge commit has landed on the trunk recently — the premise behind
 * Ledger walking --first-parent instead of --merges. It used to ask that
 * question of HEAD.
 *
 * HEAD is the wrong ref on a pull_request build. actions/checkout resolves a
 * pull_request event to refs/pull/N/merge: an ephemeral commit GitHub creates
 * by merging the PR branch into its base. That commit has two parents, so it
 * IS a merge commit by construction, and
 *
 *   git log --merges --first-parent -n 1 HEAD
 *
 * finds it every single time. PR #2303 proved it — a PR whose only change was
 * a workflow file failed the guard with 'f222bc31' !== ''. The guard had only
 * ever looked green on PRs because ci.yml checked out shallow (depth 1) and
 * the query could not see far enough to find anything. Deepening the checkout
 * alone therefore does not fix it; it just makes the false failure visible.
 *
 * So the guard has to name the trunk rather than trust HEAD. On a
 * pull_request build the trunk is the base branch GitHub fetched for us,
 * addressable as origin/$GITHUB_BASE_REF once the checkout has full history.
 *
 * Kept as a pure module with an injected `refExists` probe so the resolution
 * table can be tested without building git repositories in five shapes.
 */

/**
 * Resolve the ref the merge-commit guard should inspect.
 *
 * @param {Record<string, string|undefined>} env  Usually process.env.
 * @param {(ref: string) => boolean} refExists    Probe: does this ref resolve
 *                                                to a commit in the checkout?
 * @returns {{ref: string|null, source: string, reason: string}}
 *
 * source is one of:
 *   "head"        No GITHUB_BASE_REF — a push build, or a local run. HEAD IS
 *                 the trunk, so inspecting it is correct.
 *   "base-ref"    A pull_request build. ref names the fetched base branch;
 *                 HEAD is deliberately not consulted.
 *   "unavailable" A pull_request build whose base branch is not in the
 *                 checkout — a shallow clone cannot see the trunk. ref is
 *                 null and the caller MUST skip loudly. Falling back to HEAD
 *                 here would resurrect the false failure; silently passing
 *                 would turn the guard into decoration.
 */
export function resolveTrunkRef(env = {}, refExists = () => false) {
  const base = String(env.GITHUB_BASE_REF || "").trim();

  if (!base) {
    return {
      ref: "HEAD",
      source: "head",
      reason: "no GITHUB_BASE_REF, so HEAD is the trunk",
    };
  }

  // origin/<base> is what actions/checkout leaves behind with fetch-depth: 0.
  // The bare <base> fallback covers a local checkout that has the branch but
  // no remote-tracking ref for it.
  for (const candidate of [`origin/${base}`, `refs/remotes/origin/${base}`, base]) {
    if (refExists(candidate)) {
      return {
        ref: candidate,
        source: "base-ref",
        reason: `pull_request base "${base}" resolved to ${candidate}`,
      };
    }
  }

  return {
    ref: null,
    source: "unavailable",
    reason:
      `pull_request base "${base}" is not in this checkout — a shallow clone ` +
      "cannot see the trunk, so the merge-commit guard cannot run here",
  };
}
