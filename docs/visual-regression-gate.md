# The visual regression gate

Branch protection on `main` requires exactly one status check from the `Visual regression` workflow: `Visual regression gate`.

The other two jobs in that workflow are internal and must NOT be required. `Visual scope` classifies the pull request, and `Visual regression (Chromium + LibreOffice)` is the renderer, which is legitimately skipped when no changed file can reach a printed paper.

Requiring a job that skips would deadlock every unaffected pull request, because a check that never runs is missing rather than passed. The gate job runs with `if: always()` and turns every combination of upstream outcomes into a single pass or fail verdict, so it always reports under a stable name.

Which files count as print-affecting is decided by `scripts/visual/printAffectingPaths.js`, and the verdict logic lives in `scripts/visual/gateVerdict.js`. Both are covered by tests that the scope job runs before the classification is used.

## Re-recording baselines

Baselines are recorded by CI, never by hand: `baselineIdentity` keys each one to
the renderer versions and the font digest that drew it, and
`assertComparableEnvironment` refuses a comparison across environments. A
baseline recorded on a laptop is dead weight the gate will never match — the
font digest alone is enough to make it unusable, and the `docx` family needs
LibreOffice's Writer filters, which a developer machine often lacks entirely.

`visual-baseline-update.yml` has two scopes, both `workflow_dispatch`-only and
both requiring a written reason and a source:

- **`one-baseline`** — the original path. Names one fixture and one renderer
  family, and opens its own draft pull request against `main`. Use it when one
  fixture's appearance legitimately changed.
- **`every-moved-baseline`** — a sweep, for a change that legitimately moves
  every fixture (the paper's header wording, the Word export's margins). It
  re-records them in one run and commits to the branch it was dispatched
  against, which must be the branch of the pull request named in
  `pull_request`. Sixteen dispatches producing sixteen pull requests is how a
  gate ends up permanently red, which is the same reason the bootstrap path
  already relaxes the one-fixture rule.

The sweep does not weaken the review guarantee, it relocates it. The baselines
land on a pull request that is already under review, next to the diff that
explains them — which tells a reviewer more than a standalone baseline pull
request, where changed pixels arrive with nothing to account for them. Two
guards keep that true, and both are tested rather than documented-and-hoped:
`validateSweepUpdateRequest` refuses a sweep with no pull request, and
`assertBaselineDestination` refuses the default branch (checked before anything
renders, and again in the step that pushes).

### After a sweep, the gate does not restart on its own

A push made with `GITHUB_TOKEN` does not trigger workflows, and on a
bot-authored pull request the run that does appear sits in `action_required`
until a maintainer approves it. So a sweep leaves the baselines committed and
**unverified**. Either press "Approve and run workflows" on the pull request, or
push a further commit from a normal account.

This is not theoretical: on #1995 the sweep committed the re-recorded baselines
and no gate run started on that commit. The workflow's final log now says so
too, because the failure is silent — a green dispatch and an absent gate look
like success until somebody checks.
