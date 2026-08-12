/**
 * Does a merge commit on the trunk stop the build, or just get reported?
 *
 * The merge-commit guard in scripts/test-release-notes-core.mjs asserts a
 * property of REPOSITORY HISTORY, not of the code under test — and it sat in
 * the blocking path of every deploy, because scripts/run-all-tests.mjs
 * discovers it and so it runs inside npm run test:all.
 *
 * That cost the site five deploys. Deploy Hosting #2000 to #2004 were all red
 * on 53a65f45, the merge of PR 583, which had come into range; nothing was
 * wrong with the artefact being shipped. Scoping the query to fourteen days
 * (#2302) cleared the jam but left the shape of it — the next real merge
 * commit on main would red every deploy for a fortnight, and every pull
 * request with it.
 *
 * So severity is explicit now. The guard is ENFORCED where the premise is
 * load-bearing: Ledger walks --first-parent to assemble the changelog, and
 * Ledger output is what a merge commit would corrupt, so
 * .github/workflows/agent-release-notes.yml sets the variable below.
 * Everywhere else — every deploy, every pull request — it is ADVISORY.
 *
 * Advisory is not silent. run-all-tests.mjs prints a script output only when
 * that script FAILS, so console.log from a passing test is never read; that is
 * the same hole the old shallow-checkout skip hid in. The advisory therefore
 * goes to GITHUB_STEP_SUMMARY, which this process writes directly and which
 * shows on the run Summary tab whatever the harness does with stdout.
 */

export const GUARD_MODE_ENV = "RELEASE_NOTES_TRUNK_GUARD";

/** Enforcing is opt-in by name, so no context acquires it by accident. */
export function resolveGuardMode(env) {
  const requested = (env || {})[GUARD_MODE_ENV];
  return requested === "enforce" ? "enforce" : "advise";
}

/**
 * One line somebody can act on: what was found, which ref it was found on, and
 * how that ref was chosen — the last part matters because HEAD and origin/main
 * fail for very different reasons.
 */
export function formatTrunkFinding(finding) {
  const {sha, ref, source} = finding;
  return (
    "a merge commit (" + sha + ") is on the first-parent chain of the trunk (" +
    ref + ", resolved via " + source + ") within the last 14 days — re-check " +
    "whether --first-parent is still the right selector for " +
    "scripts/agents/release-notes.mjs"
  );
}

/**
 * Write an advisory where it will be read. Returns the text written, or null
 * when there is nowhere to write it: a local run has no step summary, and a
 * failed write must not turn an advisory back into the failure it replaced.
 */
export function reportAdvisory(finding, env, append) {
  const target = (env || {}).GITHUB_STEP_SUMMARY;
  if (!target || typeof append !== "function") return null;
  const body = "> [!WARNING]\n> Trunk hygiene: " + finding + "\n";
  try {
    append(target, body);
  } catch {
    return null;
  }
  return body;
}
