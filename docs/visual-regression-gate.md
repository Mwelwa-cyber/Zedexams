# The visual regression gate

Branch protection on `main` requires exactly one status check from the `Visual regression` workflow: `Visual regression gate`.

The other two jobs in that workflow are internal and must NOT be required. `Visual scope` classifies the pull request, and `Visual regression (Chromium + LibreOffice)` is the renderer, which is legitimately skipped when no changed file can reach a printed paper.

Requiring a job that skips would deadlock every unaffected pull request, because a check that never runs is missing rather than passed. The gate job runs with `if: always()` and turns every combination of upstream outcomes into a single pass or fail verdict, so it always reports under a stable name.

Which files count as print-affecting is decided by `scripts/visual/printAffectingPaths.js`, and the verdict logic lives in `scripts/visual/gateVerdict.js`. Both are covered by tests that the scope job runs before the classification is used.
