# 13 — CI/CD, Release & Dependencies

> Snapshot as of 2026-07-19. Layers 15 (CI/CD) + 19 (dependency/supply-chain). Finding IDs: `CICD-*`, `SEC-007/008`.

## Verdict

The pipeline is **mature in mechanics** — a 7-job PR gate, post-merge re-verification, explicit
deploy-order handling (functions/rules before hosting), source-maps stripped from the CDN, and a
sophisticated cosmetic-409 classifier. The weaknesses are **environmental and governance**: a
single Firebase project (no staging/prod separation), required-check enforcement that likely does
**not** include the rules-emulator/build jobs, no dependency scanning in CI, third-party Actions
pinned to mutable tags, and **two production dependency vulnerabilities in `functions/`**.

## Strengths (evidence)

- **PR gate** (`ci.yml`, PR→main): Lint, Tests (`test:all`), Functions coverage, Vitest+coverage,
  Build+mobile smoke, **Firestore rules emulator**, **Storage rules emulator**.
- **Deploy-order handled** — `deploy-hosting.yml:187-282` detects Firebase-relevant changes and
  waits for `deploy-firebase` to succeed before deploying hosting (avoids shipping a bundle that
  queries a not-yet-live index/rule).
- Lint/tests/build **re-run post-merge** in both deploy workflows.
- **Source maps** stripped from `dist/` after Sentry upload (`deploy-hosting.yml:166-175`).
- Android signing via base64 secret → `$RUNNER_TEMP` chmod 600; deploy SAs likewise.
- Root **production** `npm audit`: **0 vulnerabilities**. No AI npm SDKs (raw `fetch`) → smaller surface.

## Findings

### CICD-001 — Rules-emulator & build jobs likely not required status checks
- **Severity:** High · **Confidence:** Moderate confidence (branch-protection config lives in GitHub settings, not the repo)
- **Affected:** `ci.yml:19-21`; CLAUDE.md states only **Lint** + **Tests (importer+sanitize+schema)**
  are required, and to make build "a required check once settled."
- **Current:** A red rules-emulator or broken build can still be merged into `main` if only Lint +
  the node tests are enforced. The best security tests in the repo may not gate merges.
- **Risk:** Untested/regressed security rules or a broken build could deploy — one of the explicit
  blocker categories ("deployment of untested security rules").
- **Correction:** Add `Tests (Firestore rules emulator)`, `Storage rules emulator`, and
  `Build + mobile smoke` to `main` required checks. **Confirm current branch protection at runtime.**
- **Launch blocker:** Yes if unconfirmed (it protects rule + build integrity). **Complexity:** Trivial (settings).

### CICD-002 — No dependency scanning in CI
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** no `npm audit` / Dependabot / Snyk step in any workflow.
- **Current:** New vulnerable deps are not caught (see SEC-007 — a critical + high already present in
  `functions/`). `test:secret-hygiene` covers committed secrets but not CVEs.
- **Correction:** Add `npm audit --omit=dev` (root + functions) as a non-blocking-then-blocking CI
  step; enable Dependabot. **Launch blocker:** No, but High-value. **Complexity:** Low.

### CICD-003 — No dedicated secret scanning / push protection
- **Severity:** Low–Medium · **Confidence:** Moderate confidence
- **Affected:** `security-review.yml` is an AI diff review; no GitHub secret-scanning/push-protection
  configured in-repo. `test:secret-hygiene` is a committed-artifact guard.
- **Correction:** Enable GitHub secret scanning + push protection. **Launch blocker:** No.

### CICD-004 — Single Firebase project; no staging/prod separation
- **Severity:** High · **Confidence:** High confidence
- **Affected:** `.firebaserc` (both targets → `examsprepzambia`); no staging project. Every deploy
  hits production; payment/AI testing shares the production data plane.
- **Risk:** No safe place to validate rules/functions/index changes before they reach real users +
  real money + child data. A bad rules deploy is a production incident.
- **Correction:** Stand up a `examsprepzambia-staging` project; deploy there first with smoke +
  emulator, then promote. **Launch blocker:** No (already live) but High-priority for safe iteration.
  **Complexity:** Medium.

### CICD-005 — No documented rollback runbook for hosting/functions ✅ runbook written
- **Severity:** Medium → Low (residual) · **Confidence:** High confidence
- **Was:** `grep restore/rollback` found only migration + syllabus-version rollbacks. Firebase
  Hosting keeps prior releases (console rollback possible) but it was undocumented; the
  functions/rules rollback path was not written down.
- **Fixed here:** [`runbooks/deploy-rollback.md`](./runbooks/deploy-rollback.md) — a per-surface
  decision tree (hosting / functions / rules / indexes), the audit-trailed `git revert → PR → CI`
  primary path, the emergency console fast-paths (Hosting release rollback, Firestore/Storage rules
  history publish), the feature-flag/kill-switch options for functions, post-rollback verification,
  and a safe rehearsal drill. `DEPLOY.md`'s "Rolling back" section links to it.
- **Residual:** run the rehearsal drill once and record the measured hosting RTO (operator step).
  **Launch blocker:** No.

### CICD-006 — New composite index async-build ordering risk
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** `deploy-firebase.yml` deploys `firestore,storage,functions` together, but index
  builds are asynchronous — code depending on a brand-new composite index can 500 until the index
  finishes. CLAUDE.md itself flags "deploy indexes before querying code."
- **Correction:** For index-dependent changes, land `firebase deploy --only firestore:indexes`
  first (the allowed manual step), wait for build, then merge the querying code. **Blocker:** No.

### CICD-007 — Third-party GitHub Actions pinned to mutable tags / `@main`
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** `actions/checkout@v5`, `setup-node@v5`, `r0adkll/upload-google-play@v1`, and notably
  `anthropics/claude-code-security-review@main` (`security-review.yml:46`, its own comment flags this).
- **Risk:** A compromised/retagged action executes in a workflow with repo + secret access.
- **Correction:** SHA-pin third-party actions (especially `@main`). **Launch blocker:** No. **Complexity:** Low.

### SEC-007 — Two production dependency vulnerabilities in `functions/` ✅ fixed in this PR
- **Severity:** High → Resolved · **Confidence:** Confirmed (verified via `npm audit --omit=dev`
  before **and after**: 1 critical + 1 high → **0 vulnerabilities**)
- **Affected:** `functions/package.json` — **`websocket-driver` (CRITICAL:** resource-limit bypass /
  message corruption, transitive) and **`adm-zip <0.6.0` (HIGH:** crafted ZIP triggers 4 GB
  allocation, DoS). `adm-zip` parses uploaded DOCX in
  `functions/teacherTools/extractAssessmentFormat.js`.
- **Reachability correction (vs. earlier draft):** `extractAssessmentFormat` is **admin-only**
  (`role !== "admin"` → `permission-denied`, `extractAssessmentFormat.js:263-265`), so the DOCX
  path is reachable only by a platform admin, **not any teacher** — a materially lower real
  severity than a public DoS. The dependency CVEs are still worth patching as hygiene.
- **Fixed here:** bumped `adm-zip`→`^0.6.0` (fixes the parse-time allocation) and added a
  `websocket-driver` override `^0.7.5` (both regenerated in `functions/package-lock.json`);
  `npm audit --omit=dev` now reports **0**. Added **defence-in-depth caps** in
  `assessmentFormatExtractHelpers.js` (`MAX_DOCX_BUFFER_BYTES` before parse,
  `capMediaByTotalBytes` before extraction) wired into `extractAssessmentFormat.js`, with a
  unit test for the total-size cap.
- **Follow-up (2026-07-19):** the guard was moved into a shared
  `docxArchiveInspect.js` and now runs **before every DOCX decompression path** —
  the `mammoth` text path (`pastPaperImport.extractDocxText`) as well as the
  `adm-zip` image path — not just embedded-image staging. Tests
  (`docxArchiveInspect.test.js`, 14) prove the guard executes before the parser.
- **Residual:** general upload magic-byte/malware verification for non-DOCX types
  remains a separate item (STOR-003).
- **Launch blocker:** cleared. **Tests:** `docxArchiveGuard.test.js` (25) +
  `docxArchiveInspect.test.js` (14) — passing.

### SEC-008 — Committed non-secret env + public build vars (accepted)
- **Severity:** Informational · **Confidence:** Confirmed
- `functions/.env.examsprepzambia` is committed **on purpose** for non-secret config (real secrets in
  Functions secrets); frontend `VITE_*` are public-by-design. Appropriate — noted so it's not
  mistaken for a leak. (One hygiene item from `docs/PRODUCTION_READINESS.md`: delete the dead
  `RECRAFT_API_KEY` Actions secret.)

## Cross-references
- Untested security rules risk: [`12-testing-and-quality.md`](./12-testing-and-quality.md).
- Upload DoS + magic-byte: [`06-storage-and-files.md`](./06-storage-and-files.md) STOR-003.
