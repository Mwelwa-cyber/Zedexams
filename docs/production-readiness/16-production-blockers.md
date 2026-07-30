# 16 — Production Blockers

> Snapshot as of 2026-07-19; verification status reconciled 2026-07-22 (see the next section).
> A "blocker" here meets the audit's definition: it can reasonably
> cause permanent data loss, inability to restore, unrestricted expensive AI spend, a repeatable
> system-wide failure, deployment of untested security rules, payment fraud, privilege escalation,
> cross-school/learner-data exposure, or public access to private files.
>
> ZedExams is **already live**, so these are framed as "must-fix to be *safely* in production,"
> not "must-fix before first deploy." Cosmetic issues are deliberately excluded.

## Verification status (reconciled 2026-07-22)

A finding is **not "closed" just because its code PR merged.** Each carries one of four labels:

- **Runtime-verified** — evidenced working on the real deploy.
- **Impl · operator config pending** — code shipped; needs an env var / bucket / setting the operator owns.
- **Impl · staged verification pending** — code shipped + deployed; needs a runtime check to confirm behaviour.
- **Open residual** — a distinct sub-gap still needs code or a decision.

**Release checkpoint (verifiable from the repo, 2026-07-22):** `main` contains all eight remediation PRs
(#1805, #1806, #1811, #1823, #1825, #1829, #1833, #1834); the four new scheduled functions
(`backupCompletionCheck`, `storageBackupCheck`, `rateLimitHealthCheck`, `opsHeartbeatCheck`) are registered
in `functions/index.js`; and **`deploy-firebase` completed `success`** for the cron-adding commits and the
latest `main`, so the functions deployed cleanly. *Not verifiable from here (operator/console):* Cloud
Scheduler job active-state, runtime missing-secret/env warnings.

| Finding | Label | Outstanding (owner) |
|---|---|---|
| **DR-001** backup/restore | Runtime-verified (Firestore loop) | Auth DR, Storage mirror, provider reconciliation, PITR — *operator* |
| **DR-002** restore rehearsal | **Runtime-verified** (27,192 docs, RTO 25m50s) | none for the Firestore restore |
| **DR-003** Storage backup | Impl · operator config pending | provision STS mirror + `STORAGE_BACKUP_BUCKET`; confirm `opsStorageBackups=fresh` — *operator* |
| **DR-006** secrets recovery | Impl · operator config pending | populate escrow vault; confirm Play App Signing; run recovery drill — *operator* |
| **DR-007** same-date collision | Impl · staged verification pending | cron trigger now deploys (CICD-002 fixed); awaiting the nightly `opsBackups/{date}`→`completed:true` — *operator* |
| **CICD-002** scheduler deploy | **Resolved (2026-07-29)** | deploy SA granted `roles/cloudscheduler.admin`; every scheduler trigger upserts clean in deploy `410de624` (green on attempt 1 with the guard) — the four crons now deploy |
| **SEC-007** adm-zip/websocket | Impl · staged verification pending | valid-DOCX runtime extraction test on the deploy — *operator* |
| **OBS-002** audit ledger | Impl · staged verification pending | confirm a failed audit write raises an alert; server-only rules = *open residual (emulator PR)* |
| **OBS-004** alerting | Impl · operator config pending | set `OPS_ALERT_WEBHOOK_URL`; send one test alert; confirm email + webhook — *operator* |
| **OBS-005 / B3** budget+limits | Impl · staged verification pending | confirm budget env; short-answer→provisional→regrade; large throttled import; limiter-health alert — *operator* |
| **B4** branch protection | Open residual | require CI/build/coverage/rules-emulator checks — *operator (GitHub settings)* |

**Operator runtime/governance checklist — do in this order** (protects every future PR, incl. REL-001):
1. **B4 branch protection** — require the `Lint`, `Tests (importer+sanitize+schema)`, `Build + mobile smoke`,
   `Tests (Functions coverage)`, and both rules-emulator checks on `main`.
2. ✅ **CICD-002 — DONE (2026-07-29):** deploy SA granted `roles/cloudscheduler.admin`; scheduler triggers
   now upsert clean. Remaining: confirm the four `firebase-schedule-*` jobs in Cloud Scheduler + the
   nightly `completed:true` (folds into DR-007 below).
3. **DR-007** — read `opsBackups/{recent}`: `started`→`completed:true`, matching `opsBackupRuns/{correlationId}`.
4. **OBS-004** — set `OPS_ALERT_WEBHOOK_URL`; trigger one controlled alert; confirm BOTH email + webhook arrive.
5. **OBS-005/B3** — confirm `AI_MONTHLY_BUDGET_USD`/`AI_BUDGET_MODE` live; short-answer throttle → pending →
   regrade recomputes once; large scanned import throttles with no missing/duplicate pages; limiter-health alert fires.
5. **DR-003** — provision the cross-region Storage mirror; set `STORAGE_BACKUP_BUCKET`; confirm `opsStorageBackups=fresh`.
6. **OBS-002** — confirm a failed audit write alerts (server-only-rules is the separate emulator follow-up).
7. **DR-006** — populate the escrow vault; confirm Play App Signing; run the non-prod recovery drill.
8. **SEC-007** — run a valid DOCX through the deployed admin-only import; confirm text + images extract.

## Tier 0 — Hard blockers (fix immediately)

### B1 · DR-001 — Backup / restore — **Status: Verified in staging (restore drill PASSED); cross-DR residuals open**
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
- **DR-007 same-UTC-date collision — fixed in code (follow-up PR):** immutable `opsBackupRuns/{correlationId}`
  record + transactional ownership lease (`duplicate-skipped`, never `failed`) + owner-guarded monotonic
  daily summary + an async `backupCompletionCheck` (03:30 Lusaka) that stamps `completed:true`. Stale
  `storage.objectAdmin` guidance corrected. 68 tests. Read-only unattended-operation confirmation owed
  after the 2026-07-21 01:30 Lusaka cron (UTC key `2026-07-20`).
- **DR-003 Storage backup — monitor + runbook added (follow-up):** a daily `storageBackupCheck`
  (04:00 Lusaka) verifies the operator's cross-region Storage Transfer Service mirror ran, recording
  `opsStorageBackups/{date}` and alerting on `misconfigured`/`empty`/`stale`. 31 tests. The mirror
  itself (versioning + STS job + backup bucket + `STORAGE_BACKUP_BUCKET`) is still operator-provisioned
  (Runbook §D).
- **Restore drill — PASSED (operator, 2026-07-22):** 27,192 documents restored, **RTO 25m50s**, scratch
  DB deleted, nothing imported into `(default)` (evidence: `remediation/dr-001-infrastructure-readiness.md`
  §13). The Firestore restore path is proven and does **not** need re-running.
- **Open residuals (NOT the Firestore drill):** Firebase **Auth** DR gap; **Storage** mirror provisioning
  (DR-003 monitor exists, #1811); **provider (Lenco/Play) reconciliation** after a restore; enable PITR.
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
  - **Degraded-limit alert wired (code); runtime email verification pending.** A degraded limiter
    (Firestore contention / outage) emits a structured `rate_limit_degraded` log, AND a scheduled
    synthetic canary (`rateLimitHealthCheck`, hourly) now probes the limiter and raises an edge-triggered
    email ops alert when it is degraded (kill-switch aware). What remains is the runtime check that the
    alert email actually arrives on the deploy. The hard monthly-budget reservation gate is never
    bypassed, so a degraded limiter cannot exhaust the wallet on its own.
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
  deploy; confirm the degraded-limiter canary's alert email arrives. **Effort:** Low.

### B4 · CICD-001 — Untested security rules can merge & deploy
- **Why a blocker:** "deployment of untested security rules." The behavioural rules-emulator and build
  jobs run in CI but are likely **not** required status checks (`ci.yml:19-21` + CLAUDE.md), so a red
  rules test can still merge to the branch-protected `main` and deploy.
- **Failure scenario:** a rules regression that opens cross-school/learner reads ships because only
  Lint + node tests gate the merge.
- **Runtime check:** confirm `main` branch-protection required checks in GitHub settings.
- **Fix:** add the rules-emulator + storage-rules + build jobs to required checks. **Effort:** Trivial.

### B4b · CICD-002 — Deploy SA can't create Cloud Scheduler jobs; failures shipped green — **found 2026-07-22 · RESOLVED 2026-07-29**
- **Resolution (2026-07-29):** the deploy SA was granted `roles/cloudscheduler.admin`. Deploy `410de624`
  then upserted **every** scheduler trigger cleanly (no 403, no `Failed to upsert schedule function`) and
  went **green on attempt 1 with the new guard active** — proving the four crons now deploy with their
  triggers. Residual is only the operator confirming the jobs in Cloud Scheduler + the nightly
  `completed:true` (tracked under DR-007). The code guard below stays as the permanent regression trap.
- **Why it matters:** "repeatable system-wide failure that ships silently." Every scheduled function's
  Cloud Scheduler **trigger** fails to upsert — the Firebase deploy service account lacks
  `cloudscheduler.jobs.create/update` (**HTTP 403** on every `firebase-schedule-*` job; deploy log for
  `d0f38be`). The function CODE deploys, but new scheduled functions get **no trigger and never fire**,
  and the deploy workflow's **"no changes detected" retry masked it as `success`**.
- **Impact:** all four new observability/backup crons shipped **code-only, no trigger** —
  `backupCompletionCheck` (so backups never reach `completed:true` — the DR-007 symptom),
  `storageBackupCheck`, `rateLimitHealthCheck`, and `opsHeartbeatCheck` (the dead-man's-switch that
  would have caught this couldn't deploy, for the same reason). Existing crons keep firing on
  jobs created before the permission was lost, but **schedule changes silently don't apply**.
- **Fix (operator):** grant the deploy SA **`roles/cloudscheduler.admin`** on the project, then re-run
  `deploy-firebase` (or push any `functions/**` change). Verify the four `firebase-schedule-*` jobs
  appear in Cloud Scheduler and `opsBackups/{date}` flips to `completed:true`.
- **Fix (code — done, this PR):** `deploy-firebase.yml` now scans **all attempts'** output and **fails
  the job** on any `Failed to upsert schedule function` (with the `cloudscheduler.jobs.*` 403 root cause
  called out), so a scheduler-trigger failure can never ship green-but-dead again.
- **Effort:** Trivial (one IAM grant + redeploy).

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
