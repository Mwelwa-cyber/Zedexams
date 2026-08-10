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

### The renderer is pinned, because its version IS the baseline's identity

The Chromium that draws the `browser-print` family comes from **puppeteer** —
`renderEnvironment.js` resolves the binary through `puppeteer.executablePath()`
and stamps the version into the identity as `browser-print/chromium-<version>`.
So a puppeteer bump is not a dev-dependency bump; it silently rewrites what every
browser-print baseline is comparable to.

Two things hold that still, and both are needed:

- **An exact pin in `package.json`** (`"puppeteer": "25.4.0"`, no caret). A caret
  lets any lockfile regeneration move Chromium with no pull request to notice it
  in — the same breakage, arriving unannounced.
- **A Dependabot `ignore`** covering all three semver update types. Without it the
  weekly run reopens the same bump indefinitely, and each one fails the REQUIRED
  `Visual regression gate`. #2255 is what that looks like: nine fixtures reported
  as infrastructure failures over `chromium: 151.0.7922.47 → 151.0.7922.71`, with
  nothing wrong in the diff and nothing to fix in the code.

Upgrading the renderer is therefore a **paired** act — bump puppeteer and
re-record the baselines through `Visual baseline update` in the same change, so
the gate compares like with like. Doing only the first half produces a red
required check that no code change can clear, which is the state a permanently
red gate gets routed around from.

### The OS is compared as a family, not as a kernel build

`os` is **recorded** in full (`Linux 6.17.0-1021-azure`) and **compared** as its
family (`Linux`). On 2026-08-06 GitHub rolled its hosted runner image from
`-1020` to `-1021` and every paper baseline became incomparable within the hour:
the gate refused every comparison, on every print-affecting pull request and on
`main`, over a change that cannot move a glyph. Keying a required check on a
string somebody else bumps fortnightly makes it red for reasons unrelated to
printed output, and a permanently red required check is one people route around.

Nothing else was loosened, and that is testable rather than asserted: every
genuine cause of a pixel shift — the Chromium build, the LibreOffice build,
`fonts.digest`, DPI, scale factor, page size, locale, time zone and both flag
lists — is still refused, and `renderEnvironment.test.js` proves each one is
still refused *across* a kernel bump. An image change that really does alter
rendering moves one of those; in particular a different font set moves the
digest. What remains in the OS field is the distinction it was actually for:
Linux → macOS → Windows.

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
