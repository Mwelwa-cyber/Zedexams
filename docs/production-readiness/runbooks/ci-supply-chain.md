# Runbook — CI supply-chain hardening (P1-5)

> Snapshot as of 2026-07-23 — verify before acting.

Covers production-readiness findings **CICD-002** (dependency scanning),
**CICD-003** (secret scanning / push protection), **CICD-004** (staging/prod
separation) and **CICD-007** (mutable action tags). Records what is now
enforced in-repo and the **operator steps** that must be done in the GitHub /
Firebase consoles (they can't live in a committed file).

## Now automated in-repo

| Control | Where | Behaviour |
|---|---|---|
| Dependency vuln gate | `.github/workflows/ci.yml` → `dependency-audit` job | `npm audit --omit=dev` on the root + `functions/` prod trees. **Blocks** the PR on a `critical`; **reports** `high` in the log (non-blocking). |
| Automated update PRs | `.github/dependabot.yml` | Weekly grouped PRs for root npm, `functions/` npm, and GitHub Actions. Firebase SDK/functions/admin majors are ignored (coordinated migrations). |

The `dependency-audit` job audits **production** deps only — dev-only tooling
vulns don't ship to a user, and blocking on them would red-wall unrelated PRs.
The 2026-07-23 remediation cleared the then-current `functions/` prod highs
(`body-parser`, `brace-expansion`, `protobufjs` — transitive patch bumps,
lockfile-only) so both trees start green at `high`.

## Operator steps (GitHub console — one-time)

1. **Make `dependency-audit` a required check.**
   Settings → Branches → `main` branch protection → Require status checks →
   add **Dependency audit (prod deps)**. Do the same for the still-missing
   required checks from CICD-001 (`Tests (Firestore rules emulator)`,
   `Tests (Storage rules emulator)`, `Build + mobile smoke`).
2. **Enable secret scanning + push protection (CICD-003).**
   Settings → Code security and analysis → enable **Secret scanning** and
   **Push protection**. Push protection blocks a commit that contains a
   recognised credential *before* it reaches the remote. This complements the
   repo's `npm run test:secret-hygiene` check (which guards committed artifacts
   + `.gitignore` policy) but is enforced by GitHub at push time.
3. **Enable Dependabot alerts + security updates.**
   Same page → enable **Dependabot alerts** and **Dependabot security updates**
   so out-of-band advisories raise PRs even between the weekly version runs.

## Follow-ups (tracked, not done here)

- **CICD-007 · SHA-pin third-party actions.** The workflows still pin
  `android-actions/setup-android@v3`, `r0adkll/upload-google-play@v1`,
  `anthropics/claude-code-action@v1` and `anthropics/claude-code-security-review@main`
  to mutable tags. Pin each to a full commit SHA (resolve the tag → SHA on a
  host with GitHub API access; it was unreachable from the remediation
  container) and let the Dependabot `github-actions` ecosystem bump the pins
  deliberately. `@main` on the security-review action is the highest-priority
  one to pin.
- **CICD-004 · Staging project.** Standing up `examsprepzambia-staging`
  (separate Firebase project + a staging deploy target) is a console/infra
  task, not a repo change — scope it with the deploy workflows so PRs validate
  on staging before prod.
