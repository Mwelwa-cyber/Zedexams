# 17 — Remediation Roadmap

> Snapshot as of 2026-07-19. Phased by urgency. Each task: priority · finding IDs · files/systems ·
> approach · dependencies · acceptance criteria · required tests · rollback.

## Phase 0 — Emergency blockers (before *safe* continued production)

### P0-1 · Configure & verify Firestore backup + restore
- **Priority:** P0 · **Findings:** DR-001, DR-002, DR-003, DR-005 · **Systems:** GCS, IAM, `firestoreBackup.js`, Marshal
- **Approach:** create a cross-region backup bucket + retention lifecycle; grant the function SA
  `datastore.importExportAdmin` + `storage.objectAdmin`; set `FIRESTORE_BACKUP_BUCKET` in
  `functions/.env.examsprepzambia`; enable Firestore PITR; enable Storage bucket versioning; have
  Marshal assert `opsBackups/{today}.status==="started"`.
- **Dependencies:** none (do first). **Acceptance:** a real run stamps `status:"started"`; a rehearsed
  restore into a scratch project matches row counts; a skipped/failed backup raises a company-health
  alert. **Tests:** `firestoreBackup.test.js` + new "alert-on-skip" test. **Rollback:** n/a (additive).

### P0-2 · Patch `functions/` critical/high dependencies + guard the upload path
- **Priority:** P0 · **Findings:** SEC-007, STOR-003 · **Files:** `functions/package.json`,
  `teacherTools/extractAssessmentFormat.js`
- **Approach:** `npm audit fix` (websocket-driver); bump `adm-zip@^0.6.0`; before `AdmZip`, reject
  DOCX over a size + entry-count + uncompressed-size threshold; add magic-byte check.
- **Dependencies:** none. **Acceptance:** `functions/ npm audit --omit=dev` → 0 critical/high; a
  ZIP-bomb sample is rejected before allocation. **Tests:** `extractAssessmentFormat` regression +
  ZIP-bomb guard. **Rollback:** revert the dep bump if `extractAssessmentFormat` breaks (test first).

### P0-3 · Arm AI cost ceiling + stage App Check + burst-limit generators
- **Priority:** P0 (public launch) · **Findings:** AI-001, SEC-001, OBS-005
- **Approach:** set `AI_MONTHLY_BUDGET_USD` (or arm `AI_BUDGET_MODE=revenue_linked`) + a spend alert;
  enforce App Check on clean web labels via `APPCHECK_ENFORCE_LABELS`, monitor `appCheckHealth`, widen;
  add a per-user burst cap to generator callables using the existing `rateLimit` helper.
- **Dependencies:** Android Play Integrity registered before global App Check enforce. **Acceptance:**
  an over-budget call throws `resource-exhausted`; an unattested call 401s on an enforced label; a
  burst is throttled. **Tests:** budget + rate-limit unit tests; App Check enforcement integration.
  **Rollback:** unset the enforce label / budget var (fail-open restores prior behaviour).

### P0-4 · Make security-rule + build jobs required checks
- **Priority:** P0 · **Findings:** CICD-001 · **Systems:** GitHub branch protection
- **Approach:** add `Tests (Firestore rules emulator)`, `Storage rules emulator`, `Build + mobile
  smoke` to `main` required checks. **Acceptance:** a PR with a failing rules test cannot merge.
  **Rollback:** n/a (settings).

## Phase 1 — Production launch foundation

### P1-1 · Wire autosave + idempotency across all generators
- **Priority:** P1 · **Findings:** REL-001, REL-002, AI-002, AI-006 · **Files:** the 5 unprotected
  studios + all `generate*` runners
- **Approach:** add `useDraftManager` to WorksheetGenerator/RubricGenerator/FlashcardGenerator/
  HomeworkStudio/SchemeOfWorkGenerator; wrap each generator call in `useAiOperationLock` + backend
  `reserveAiOperation`/`completeAiOperation` with a deterministic doc id; refund quota on hard failure.
- **Dependencies:** none (primitives exist). **Acceptance:** refresh mid-edit restores a draft; a
  double-submit yields one provider call + one charge; a failed generation refunds the quota slot.
  **Tests:** per-studio draft test + `aiOperations` duplicate-prevention test. **Rollback:** feature-flag per studio.

### P1-2 · Harden account deletion + purge completeness
- **Priority:** P1 · **Findings:** LEGAL-003, LEGAL-004 · **Files:** `index.js:787`, `accountDeletion.js`
- **Approach:** require recent re-auth (or emailed token) + rate limit; soft-delete grace window;
  per-collection retry; a drift test that the purge list covers every user-scoped rules collection.
- **Acceptance:** deletion needs re-auth; purge-list drift fails CI. **Tests:** re-auth + drift guard.

### P1-3 · Learner-safety moderation + image safety gate
- **Priority:** P1 · **Findings:** AI-003, AI-004, AI-005 · **Files:** `apiAiChat`/`aiChat`,
  `checkShortAnswer`, `generate{Diagram,NotePictures,VisualNotes}`, import prompts
- **Approach:** add a moderation pass on learner input + model output; invoke `visualSafety` in the
  image write path; add the untrusted-document fence to import prompts.
- **Acceptance:** flagged content is blocked + logged; generated images pass safety before learner
  exposure. **Tests:** moderation + visualSafety integration.

### P1-4 · Observability + audit completeness + rollback runbook
- **Priority:** P1 · **Findings:** OBS-001, OBS-002, OBS-004, CICD-005
- **Approach:** confirm/enable Sentry DSN; close the admin direct-write audit bypass (server-only
  rules or audit-on-fallback) + alert on audit-write failure; add a second alert channel + heartbeat;
  write + rehearse a hosting/functions/rules rollback runbook.
- **Acceptance:** every admin mutation appears in `adminAuditLogs`; a missed backup/summary alerts;
  a rollback drill succeeds.

### P1-5 · Staging environment + dependency/secret scanning in CI
- **Priority:** P1 · **Findings:** CICD-002, CICD-003, CICD-004, CICD-007
- **Approach:** stand up `examsprepzambia-staging`; deploy there first; add `npm audit` (root +
  functions) + Dependabot + GitHub secret scanning/push protection; SHA-pin third-party actions.
- **Acceptance:** changes validate on staging pre-prod; a new critical dep fails CI.

## Phase 2 — Reliability & operational maturity (shortly after launch)

- **P2-1 · Multi-tab conflict handling** (REL-003, DATA-004): add version fields + conflict prompt to
  teacher docs.
- **P2-2 · Structured logging + correlation IDs** (OBS-003): thread a request id UI→function→data.
- **P2-3 · Trigger retry / dead-letter** (OBS-006): enable retry on idempotent triggers + a DLQ alert.
- **P2-4 · Authenticated E2E + payment sandbox tests** (TEST-001, TEST-002, TEST-003, TEST-004).
- **P2-5 · Storage orphan reaping + magic-byte/malware scan** (STOR-003, STOR-004): `onPaperDeleted`
  cascade; schedule orphan reaper for image/paper/invoice classes.
- **P2-6 · `lesson-files/` read scoping** (STOR-001); audit tokened-URL persistence (STOR-002).

## Phase 3 — Scale & optimisation (as volume grows)

- **P3-1 · Wire `paginationCore` into admin/list callables** (DATA-002, PERF-001) — remove the 200-row cap.
- **P3-2 · Class roster → subcollection** (DATA-003, PERF-003).
- **P3-3 · `minInstances`/concurrency on hot generators; server-side export for low-end devices**
  (PERF-004, PERF-005).
- **P3-4 · Per-school AI quota** (AI-008), once tenancy lands.

## Phase 4 — Compliance & enterprise readiness (schools / publishers / government)

- **P4-1 · Multi-school tenancy** (DATA-001, PERF-002): `schoolId` on core docs + backfill +
  school-scoped queries/indexes + wire the dormant membership RBAC; implement `adminSetPlatformAdmin`
  (SEC-002) for self-serve provisioning.
- **P4-2 · Verifiable parental-consent flow** (LEGAL-001) per counsel.
- **P4-3 · ECZ past-paper licensing** (LEGAL-002) per counsel; document processor/DPA agreements.
- **P4-4 · Incident-response + breach-notification runbook** (LEGAL-005); defined retention + TTL
  cleanup incl. AI logs (LEGAL-006).
- **P4-5 · HSTS + preload, SHA-pinned actions, secret rotation policy** (SEC-003, CICD-007).

## Sequencing note
Phase 0 tasks are independent and can run in parallel. P0-1 (backups) gates any risky data migration.
P0-3 (budget/App Check) should precede any marketing push. Phase 4 (tenancy) is the largest single
effort and should be scoped as its own project.
