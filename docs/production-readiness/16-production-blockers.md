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
- **OBS-005 — generator burst caps ADDED (this work):** every teacher-tool generator (14) now calls
  `assertGeneratorRateLimit(request, tool)` — a per-user, per-minute, per-tool cap (default 10/min,
  `RATE_LIMIT_GENERATOR_PER_MIN`-tunable) via the shared fail-open Firestore limiter. Closes the
  "burst hundreds/min up to the daily wall" gap on the highest-cost surface. Tests:
  `generatorRateLimitCore.test.js` (10). (`extractAssessmentFormat` + past-paper import already had it.)
- **Remaining (next tranche):** extend the same burst cap to the index.js-inline AI callables that
  still lack it (`checkShortAnswer`, `verifyQuiz`, `structureImportedQuiz`/`structureScannedQuiz`,
  `ocrNotePages`, `generateNoteInsights`/`Smart`, `generateStudyPlan`); confirm the budget env is live
  in the deployed runtime; widen App Check per the dashboard. **Effort:** Low.

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
