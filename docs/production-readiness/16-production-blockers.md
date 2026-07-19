# 16 — Production Blockers

> Snapshot as of 2026-07-19. A "blocker" here meets the audit's definition: it can reasonably
> cause permanent data loss, inability to restore, unrestricted expensive AI spend, a repeatable
> system-wide failure, deployment of untested security rules, payment fraud, privilege escalation,
> cross-school/learner-data exposure, or public access to private files.
>
> ZedExams is **already live**, so these are framed as "must-fix to be *safely* in production,"
> not "must-fix before first deploy." Cosmetic issues are deliberately excluded.

## Tier 0 — Hard blockers (fix immediately)

### B1 · DR-001 — No working database backup / restore (permanent data loss) — ⚠️ code-side fixed, operator config owed
- **Why a blocker:** "inability to restore the database" + "permanent data loss." The daily export is
  gated on `FIRESTORE_BACKUP_BUCKET`, which is absent from committed config — runs record
  `skipped-unconfigured` and export nothing.
- **Addressed in this PR:** the skip path now **alerts** (no longer silent); a tested
  `buildImportRequest` + guarded `scripts/restore-firestore.mjs` + a setup/restore **runbook**
  (doc 14) now exist. **Still owed by the operator (code can't do it):** create the cross-region
  bucket + IAM, set `FIRESTORE_BACKUP_BUCKET`, enable PITR/deletion-protection, and **rehearse a
  restore**. Until then, backups still do not run.
- **Failure scenario:** a bad migration, compromised admin, or accidental bulk delete → unrecoverable;
  amplified by hard deletes (DATA-004) and un-re-authed account deletion (LEGAL-003).
- **Runtime check:** read `opsBackups/{today}.status` in prod (now also emails a warning if skipped).

### B2 · SEC-007 — `adm-zip` DoS + critical `websocket-driver` — ✅ fixed in this PR
- **Why it was a blocker:** "repeatable system-wide failure." `adm-zip <0.6.0` (HIGH) parses uploaded
  DOCX in `extractAssessmentFormat.js`; a crafted ZIP triggers a 4 GB allocation. `websocket-driver`
  was a live CRITICAL advisory (transitive).
- **Reachability correction:** `extractAssessmentFormat` is **admin-only** (`extractAssessmentFormat.js:263-265`),
  so the DOCX path is reachable only by a platform admin — lower real severity than "any teacher."
- **Fixed:** `adm-zip`→`^0.6.0` + `websocket-driver` override `^0.7.5` (lockfile regenerated;
  `npm audit --omit=dev` → **0**), plus defence-in-depth size caps before parse/extract with a unit
  test. **Effort spent:** Low–Medium.

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
