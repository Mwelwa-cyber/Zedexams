# 16 — Production Blockers

> Snapshot as of 2026-07-19. A "blocker" here meets the audit's definition: it can reasonably
> cause permanent data loss, inability to restore, unrestricted expensive AI spend, a repeatable
> system-wide failure, deployment of untested security rules, payment fraud, privilege escalation,
> cross-school/learner-data exposure, or public access to private files.
>
> ZedExams is **already live**, so these are framed as "must-fix to be *safely* in production,"
> not "must-fix before first deploy." Cosmetic issues are deliberately excluded.

## Tier 0 — Hard blockers (fix immediately)

### B1 · DR-001 — No working database backup / restore (permanent data loss)
- **Why a blocker:** "inability to restore the database" + "permanent data loss." The daily export is
  gated on `FIRESTORE_BACKUP_BUCKET`, which is absent from committed config — runs record
  `skipped-unconfigured` and export nothing. No restore script/test. No Storage backup.
- **Failure scenario:** a bad migration, compromised admin, or accidental bulk delete → unrecoverable;
  amplified by hard deletes (DATA-004) and un-re-authed account deletion (LEGAL-003).
- **Runtime check:** read `opsBackups/{today}.status` in prod. **Fix:** configure bucket + IAM + PITR,
  then rehearse a restore (DR-001, DR-002). **Effort:** Low config, Medium to rehearse restore.

### B2 · SEC-007 — `adm-zip` ZIP-bomb DoS reachable via teacher DOCX upload (+ critical `websocket-driver`)
- **Why a blocker:** "repeatable system-wide failure." `adm-zip <0.6.0` (HIGH) parses uploaded DOCX in
  `functions/teacherTools/extractAssessmentFormat.js:87-90`; a crafted ZIP triggers a 4 GB allocation
  → function OOM/crash on demand. `websocket-driver` is a live CRITICAL advisory (transitive).
- **Failure scenario:** any authenticated teacher uploads a malicious "assessment format sample" →
  repeated function crashes / cost. **Fix:** `npm audit fix` (websocket-driver, non-breaking); bump
  `adm-zip` to `^0.6.0` (test `extractAssessmentFormat`) + validate DOCX size/entry-count before unzip.
- **Effort:** Low–Medium. **Blocker only if** teacher DOCX-sample upload is enabled at launch (it is).

## Tier 1 — Blockers for a *public / marketed* launch (safe for a closed pilot)

### B3 · AI-001 + SEC-001 + OBS-005 — Unrestricted expensive AI calls (denial-of-wallet)
- **Why a blocker:** "unrestricted expensive AI calls." The monthly cost ceiling fails open when
  `AI_MONTHLY_BUDGET_USD`/`AI_BUDGET_MODE` are unset (`aiCostTracking.js:711-714`), App Check is
  observe-only (`appCheckEnforcement.js`), and per-minute rate limiting covers only ~8 of ~180
  callables. The only backstop is per-user daily caps.
- **Failure scenario:** a leaked/scripted ID token (no attestation required) hammers a generator with
  no monthly ceiling → runaway Anthropic/OpenAI spend.
- **Runtime check:** confirm the budget env var + App Check enforcement labels are set in prod.
- **Fix:** set the budget ceiling + alerting (AI-001), stage App Check enforcement (SEC-001), add a
  per-user burst cap to generators (OBS-005). **Effort:** Low–Medium.

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
