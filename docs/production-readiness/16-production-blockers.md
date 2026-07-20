# 16 — Production Blockers

> Snapshot as of 2026-07-19. A "blocker" here meets the audit's definition: it can reasonably
> cause permanent data loss, inability to restore, unrestricted expensive AI spend, a repeatable
> system-wide failure, deployment of untested security rules, payment fraud, privilege escalation,
> cross-school/learner-data exposure, or public access to private files.
>
> ZedExams is **already live**, so these are framed as "must-fix to be *safely* in production,"
> not "must-fix before first deploy." Cosmetic issues are deliberately excluded.

## Tier 0 — Hard blockers (fix immediately)

### B1 · DR-001 — Backup / restore — **Status: Implemented, pending runtime verification**
- **Why a blocker:** "inability to restore the database" + "permanent data loss." The daily export is
  gated on `FIRESTORE_BACKUP_BUCKET`, which is absent from committed config.
- **Implemented (this PR):** the runner now distinguishes **`misconfigured`** (production, no bucket →
  **error alert**) from **`skipped-non-production`** (dev/emulator, no alert), emits **structured logs
  with a correlationId**, and records `started`/`failed` with error category. A tested pure retention
  selector (`selectExportsToDelete`, never deletes the newest/incomplete) + a dry-run `runBackupRetention`,
  a tested `buildImportRequest`, a guarded `scripts/restore-firestore.mjs`, and a full setup/restore
  **runbook** (`runbooks/firestore-restore.md`) now exist. Tests: `firestoreBackup.test.js` (46).
- **Operator infra now provisioned (2026-07-19):** bucket `gs://zedexams-backups` (africa-south1,
  versioning), IAM (via existing `roles/editor` + `firestore.serviceAgent`), DB deletion protection +
  7-day PITR — see [`remediation/dr-001-infrastructure-readiness.md`](./remediation/dr-001-infrastructure-readiness.md).
  `FIRESTORE_BACKUP_BUCKET` committed to the env; restore script import bug fixed + **16 tests**.
- **Export runtime-verified (2026-07-19):** a managed export reached `done:true` with a
  `.overall_export_metadata` object at `gs://zedexams-backups/firestore-exports/2026-07-19`
  (evidence in [`remediation/dr-001-infrastructure-readiness.md`](./remediation/dr-001-infrastructure-readiness.md) §12).
  Interim status: **"Backup export runtime-verified; restore drill pending."**
- **Still pending: the non-production restore drill** (+ Auth/Storage DR gaps + DR-007 same-UTC-date
  collision). **Not closed until the restore drill is evidenced.**
- **Runtime check:** read `opsBackups/{today}.status` in prod.

### B2 · SEC-007 — `adm-zip` DoS + critical `websocket-driver` — **Status: Implemented, pending runtime verification**
- **Why it was a blocker:** "repeatable system-wide failure." `adm-zip <0.6.0` (HIGH) parses uploaded
  DOCX in `extractAssessmentFormat.js`; a crafted ZIP triggers a 4 GB allocation. `websocket-driver`
  was a live CRITICAL advisory (transitive).
- **Reachability correction:** `extractAssessmentFormat` is **admin-only**
  (`extractAssessmentFormat.js:298`), so the path is reachable only by a platform admin — lower real
  severity than "any teacher."
- **Implemented (this PR):** `adm-zip`→`^0.6.0` + `websocket-driver` override `^0.7.5` (lockfile
  regenerated; `functions/ npm audit --omit=dev` **1 critical + 1 high → 0**). New pure
  `docxArchiveGuard.js` enforces magic-byte + DOCX-signature validation, entry-count / per-entry /
  total-uncompressed / compression-ratio caps, and rejects traversal / absolute-path / encrypted /
  duplicate entries — assessed on **central-directory metadata before any decompression**. Wired into
  `stageDocxImages` (best-effort skip + structured security log, workflow preserved) with a per-user
  **rate limit** (6/min). Tests: `docxArchiveGuard.test.js` (25 synthetic-archive cases).
- **Follow-up (2026-07-19):** the guard now runs **before every DOCX decompression path** (shared
  `docxArchiveInspect.js` → `mammoth` text path + `adm-zip` image path), not just image staging; tests
  prove the guard runs before the parser (14 checks).
- **Pending:** end-to-end confirmation that a **valid** DOCX still extracts text + stages images at
  runtime (post-deploy); the change is unit-tested but not runtime-verified here.

## Tier 1 — Blockers for a *public / marketed* launch (safe for a closed pilot)

### B3 · AI-001 + SEC-001 + OBS-005 — Denial-of-wallet — **largely resolved; verify + widen**
- **Why a blocker:** "unrestricted expensive AI calls." The monthly cost ceiling fails open when
  unset, App Check was observe-only, and per-minute rate limiting covered only ~8 of ~180 callables.
- **AI-001 — budget ARMED (confirmed in repo):** `functions/.env.examsprepzambia` sets
  `AI_MONTHLY_BUDGET_USD=100` **and** `AI_BUDGET_MODE=revenue_linked` (floor `$25`), so the treasury
  governor is active and the reservation gate runs **before** every provider call
  (`aiCostTracking.beginAiCall*`). The "fails open when unset" condition does not apply in prod.
  Residual: it also fails open on internal errors (intentional availability trade-off) — monitor
  `/admin/ai-costs`.
- **SEC-001 — App Check canary ARMED:** `APPCHECK_ENFORCE_LABELS="aiChat,generateQuizQuestions"` is
  set — two endpoints hard-enforce attestation; the rest stay observe-only. Widening is an **ops
  decision** gated on the `/admin/app-check` dashboard (do not blind-widen); global `APPCHECK_ENFORCE`
  still waits on Android Play Integrity registration.
- **OBS-005 — Implemented, pending runtime verification (corrective PR).** An earlier pass
  over-claimed "complete coverage"; a repository-wide provider-call **inventory**
  (`functions/aiProviderCallInventory.js`) found **21 provider-backed callables still uncapped**
  (incl. `explainAnswer`, `editQuizQuestion`, `generateQuizQuestions`, `checkVisualSafety`,
  `reviseQuestion`, `suggestAnswer`/`suggestQuizAnswers`, and more). All are now wired, and a **CI
  coverage guard** (`aiProviderCallInventory.test.js`, 51 surfaces) fails if any provider-backed
  endpoint loses its limiter. Plus:
  - **Structured error taxonomy** (`functions/aiErrorReasons.js` + `src/utils/aiErrorTaxonomy.js`):
    burst/daily/monthly now carry a `details.reason` so the client shows "try again in Ns" (retryable)
    vs "try tomorrow" (terminal) — previously all bare `resource-exhausted`.
  - **Learner-scoring correctness fix:** a throttle/timeout could mark a *correct* essay/short-answer
    **wrong** (`geminiChecker` laundered the error into `correct:false`). Now the grader returns an
    explicit **pending** state and `computeQuizScore` excludes it — a transient failure can never lower
    a learner's mark. **The attempt is then persisted as PROVISIONAL** (`gradingStatus: 'pending'`,
    `scoreStatus: 'provisional'`, `pendingQuestionIds`, `finalScore: null`) so a partial percentage
    (8/8 graded with 2 pending reads as 100%) is never mistaken for the settled mark by any downstream
    consumer — class analytics excludes it, and the results screen shows an honest "not final yet"
    banner. The pending state is **durable** (localStorage session pre-submit + the Firestore result
    doc post-submit), never trapped in React memory, so it survives refresh / close / another device;
    the `catch` path in `QuizRunnerV2` also marks an attempted-but-failed marking pending, closing the
    last "unmarked → scored wrong" hole. (`geminiChecker.js`, `quizScoring.js`, `schemas/result.js`,
    `classAnalytics.js`, `QuizRunnerV2.jsx`, `QuizResultsV2.jsx`.)
  - **Scanned-import regression fix:** the 8/min cap dropped ~96 pages of a 120-page paper; raised to
    40/min and the client now treats a burst throttle as **retryable** (daily/budget terminal) instead
    of dropping pages. Safety comes from the **retry pipeline**, not the number 40: bounded recovery
    rounds (`SCANNED_RECOVERY_ROUNDS`), stable page-number keys, per-page split-and-retry, dedupe on
    merge, and a `readOkPages`/`unreadPages` **partition** so failed pages surface as an explicit
    named-page warning — the import can never report clean success with pages missing, and a daily/budget
    cap mid-run keeps the partial result rather than discarding it. Invariant asserted:
    `submitted = processed + failed` (`scannedQuizImporter.test.js`).
  - **Degraded-limit telemetry implemented; operational alert verification pending.** A degraded limiter
    (Firestore contention / outage) emits a structured `rate_limit_degraded` log carrying the scope — an
    ops alert can be built on it, but wiring that alert channel is a runtime/ops follow-up, not done here.
    The hard monthly-budget reservation gate is never bypassed, so a degraded limiter cannot exhaust the
    wallet on its own.
  - **Inventory guard now AUTO-DISCOVERS the surface** (Gate 3): `aiEndpointDiscovery.js` parses every
    `exports.*` in `functions/index.js`, tags each with its Cloud Function kind + whether it binds a
    provider secret, and the guard **fails on any provider-backed callable/HTTP endpoint that is not
    classified** (LIMITED or EXEMPT-with-reason) — not just on a missing token from a hand-listed row.
    Running it found **2 endpoints the manual list missed** (`runDawnBriefing`, now rate-limited;
    `apiWhatsAppWebhook`, documented-exempt). 173 deployed exports discovered; 50 provider-backed
    callable/HTTP surfaces all classified.
  - Tests: `aiProviderCallInventory` (auto-discovery, 57 checks), `aiEndpointDiscovery` (9),
    `aiErrorTaxonomy` (15), `rateLimit` taxonomy (7), `aiErrorReasons` (6), `quizGradingStatus` (12),
    `quizScoring.spec` provisional cases, `scannedQuizImporter` (90), `generatorRateLimitCore` (10).
- **B3 status: substantially implemented, not closed.** Code-complete for AI-001 (budget armed),
  SEC-001 (canary armed), and OBS-005 (full burst coverage + inventory guard + the correctness fixes).
  **Remaining (runtime/ops, not code):** confirm the budget env is live in the deployed runtime; widen
  App Check labels per `/admin/app-check`; verify the scanned-import + short-answer flows on a real
  deploy. **Effort:** Low.

### B4 · CICD-001 — Untested security rules can merge & deploy
- **Why a blocker:** "deployment of untested security rules." The behavioural rules-emulator and build
  jobs run in CI but are likely **not** required status checks (`ci.yml:19-21` + CLAUDE.md), so a red
  rules test can still merge to the branch-protected `main` and deploy.
- **Failure scenario:** a rules regression that opens cross-school/learner reads ships because only
  Lint + node tests gate the merge.
- **Runtime check:** confirm `main` branch-protection required checks in GitHub settings.
- **Fix:** add the rules-emulator + storage-rules + build jobs to required checks. **Effort:** Trivial.

## Tier 2 — Legal launch conditions (require counsel, not just code)

### B5 · LEGAL-001 — No verifiable parental consent for child users
- COPPA-style / Zambia DPA exposure; consent is disclosure-only. Clear the consent model with counsel
  before scaling direct-to-learner signups.

### B6 · LEGAL-002 — ECZ past-paper licensing basis not evident
- Redistribution of ECZ-copyright papers without a documented licence. Confirm rights with counsel.

## Explicitly NOT blockers (High but bounded / already-live)
- **REL-001 / AI-002 (work loss + duplicate AI charge on generators):** real and High-priority, but
  bounded (one studio protected proves the pattern; the rest lose *unsaved* work / double-charge — a
  cost + UX issue, not data-integrity or security). Phase 1, not Tier 0.
- **DATA-001 / PERF-002 (no `schoolId` multi-school):** a scaling wall for the multi-school ambition,
  not a defect for current single-teacher use. Fix before selling to multi-teacher schools.
- **LEGAL-003 (account-delete re-auth):** Medium–High; strongly recommended, listed in Phase 1.

## Confidence note
B1, B2, B4 depend partly on **runtime/GitHub-settings state** not visible in the repo (env vars,
branch protection). Each carries an explicit runtime check above — verify those first; if any is
already configured, downgrade accordingly.
