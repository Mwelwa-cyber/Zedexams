# CLAUDE.md

Project-wide instructions loaded by Claude Code in every session on this repo.

## Deploy flow

ZedExams ships via GitHub Actions, not via direct `firebase deploy` calls. As of 2026-05-14 the project owner has delegated the merge step to Claude — there is no human-merge gate.

After finishing a code change, Claude should:

1. Verify locally — `npm run lint && npm run build` at minimum; run the relevant feature tests too. The deploy workflow re-runs these on CI, but failing the gate there wastes a deploy slot.
2. Commit + push the branch (`git push -u origin <branch>`).
3. Open a PR with `gh pr create -R Mwelwa-cyber/Zedexams ...`.
4. Self-merge with `gh pr merge <num> --squash --delete-branch -R Mwelwa-cyber/Zedexams`. Do **not** wait for the human to merge.
5. The push to `main` triggers [.github/workflows/deploy-hosting.yml](.github/workflows/deploy-hosting.yml), which re-runs `npm run lint` and `npm run test:all` before the firebase deploy step. A failing lint/test fails the deploy rather than shipping broken code to learners.

### Off-limits

- `firebase deploy --only hosting` (any flavor) — production deploys go through CI only. This is also enforced via `permissions.deny` in [.claude/settings.json](.claude/settings.json).
- `firebase deploy --only functions` — same reasoning; CI ships Cloud Functions via [deploy-firebase.yml](.github/workflows/deploy-firebase.yml).
- Direct push to `main` — open a PR (even for trivial changes) so there's an audit trail.

### Allowed direct CLI

- `firebase deploy --only firestore:indexes` — index changes don't affect the hosted bundle and need to land before the code that queries against them.

## Repo notes

- The repo has two identical remotes. `gh pr ...` commands need `-R Mwelwa-cyber/Zedexams`; `gh api` uses the URL path directly.
- `main` is not branch-protected — `gh pr merge` succeeds immediately. The real safety net is the lint+tests inside [deploy-hosting.yml](.github/workflows/deploy-hosting.yml) (lines 93–97), which re-run on the post-merge push and fail the deploy if anything is broken.
- The dev server needs `.env` from the project owner's environment. CI builds use repo secrets ([deploy-hosting.yml:60-83](.github/workflows/deploy-hosting.yml#L60-L83)).
