# 05 — Data & Firestore Architecture

> Snapshot as of 2026-07-19. Layer 5. Finding IDs: `DATA-*`.

## Verdict

Schemas are consistent and disciplined: uniform ownership keys
(`userId`/`ownerId`/`createdBy`), `status`/`createdAt` conventions, Zod schemas for the
core domains, **sharded** high-frequency counters, cron-recomputed global stats (no write
hotspot), and a mature, idempotent, dry-run-by-default migration culture with guard tests.
The one structural limitation is that **the core content collections are keyed on the user,
not on a school tenant** — so the platform is effectively single-tenant-per-teacher today and
cannot express "my school's data" without a schema rollout. This is the dominant scaling
constraint (see also [`10`](./10-performance-and-scalability.md)).

## Strengths (evidence)

- **Sharded counters** for the hottest write path — daily/monthly/per-tool AI usage fanned
  across 16→256 shards (`functions/shardedCounter.js:14-23`).
- **No global write hotspot** — `publicStats/global` is recomputed every 30 min via `count()`
  aggregations, not incremented per event (`functions/publicStats.js:41-71`); daily-exam locks
  are per-user (`dailyExamGradingFns.js:266`).
- **Indexes** — 130 composite indexes; leaderboard, results, quiz-library, pagination paths all
  covered (`firestore.indexes.json`; verified against `examLeaderboardService.js:12-19`).
- **Migrations** — ~18 `migrate-*`/`backfill-*` scripts, each with a `test-migrate-*` companion,
  dry-run + idempotent + batched; legacy values normalized on read (`normalizeAssessmentType`,
  `paperTaxonomy.js:306`) rather than destructively migrated.
- **Denormalization kept honest** — `quizSummaries` mirrors `quizzes` with byte-for-byte
  constraint parity; curriculum client/server split guarded by CI drift tests
  (`test-grade-rules-consistency.mjs`).

## Findings

### DATA-001 — Core collections are not school-tenanted (multi-school scaling blocker)
- **Severity:** High (for the multi-school ambition) · **Confidence:** High confidence
- **Affected:** `results`, `exam_attempts`, `quizzes`/`quizSummaries`, `questionBank`,
  `classes`, `classRegisters` — all keyed on `userId`/`ownerId`/`createdBy`. `schoolId` appears
  ~40× repo-wide, almost entirely in infra modules (`cache/`, `pagination/`, `aiOperations`),
  not in these schemas. The `schools/{schoolId}/members/{uid}` RBAC model exists **only** in
  `firestore.rules:64-82` + a **dry-run** migration; no `src`/`functions` runtime code reads
  `schools`/`members`.
- **Current behaviour:** A school-admin cannot query "all results/quizzes/attendance for my
  school" — there is no `schoolId` to filter on. `questionBank` is one global collection shared
  across all teachers; `classes` are teacher-owned islands with no school rollup.
- **Risk:** The advertised multi-school RBAC is half-laid and dormant. Onboarding real schools
  with cross-teacher/cross-class visibility requires a `schoolId` backfill + query + rules rework.
- **Correction:** Decide the tenancy model. If multi-school is a near-term goal, add `schoolId`
  to core docs (write-time + backfill), add school-scoped indexes, and wire membership-scoped
  reads. If not, explicitly scope the product as single-teacher and shelve the dormant RBAC.
- **Launch blocker:** No for single-teacher/pilot use; Yes before selling to multi-teacher schools.
- **Complexity:** High. **Dependencies:** SEC-002 (`platformAdmin` provisioning). **Tests:**
  extend the school-membership emulator suite to school-scoped content reads.

### DATA-002 — Admin list views hard-cap at 200 rows; server pagination built but unused
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** `src/hooks/useFirestore.js:17,546-554` (`ADMIN_QUERY_LIMIT=200`),
  `AdminLearners.jsx:248`, `AdminResults.jsx:100`; `functions/paginationCore.js` (complete,
  tested, HMAC-signed cursor engine with **zero callers**).
- **Current:** `getAllLearners`/`getResultsInWindow` fetch ≤200 rows then paginate client-side;
  beyond 200 the surplus is **silently invisible** (the UI even notes this). A fully-built
  server cursor engine is not imported anywhere.
- **Risk:** At >200 learners/results the admin cannot see or act on the full dataset — an
  operational correctness ceiling, not a security issue.
- **Correction:** Wire `paginationCore` into the admin list callables; replace the client cap
  with server cursors. **Launch blocker:** No (small deployments); Yes at ~10k users.
- **Complexity:** Medium. **Tests:** `paginationCore.test.js` exists; add callable integration tests.

### DATA-003 — Class roster stored as an in-document capped array
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** `functions/classManagement.js:199-246` (`learners: arrayUnion`, cap 200),
  `src/utils/classes.js:69-74` (`array-contains` query).
- **Current:** Every join/approve reads+rewrites the whole class doc; "my classes" uses
  `array-contains`. Under the 1 MB doc limit at 200 members, but concurrent joins contend on the
  single doc's ~1 write/sec soft limit, and `array-contains` cannot combine with a second one.
- **Risk:** Write contention during a class-signup rush; no path to a school-wide roster.
- **Correction:** Move rosters to a `members` subcollection before large classes onboard.
- **Launch blocker:** No. **Complexity:** Medium (migration + query rewrite).

### DATA-004 — No soft-delete / version-field convention on core docs
- **Severity:** Low–Medium · **Confidence:** High confidence
- **Affected:** quizzes/results/lessons etc. — no `deletedAt` convention; version fields exist
  only in `aiOperations` and attendance (`STALE_VERSION`).
- **Current:** Deletes are hard deletes (with Storage cascade cleanup). No optimistic-concurrency
  version on teacher documents → multi-tab last-write-wins (see REL-003).
- **Risk:** Accidental deletion is unrecoverable without a working backup (see DR-001);
  concurrent edits silently clobber.
- **Correction:** Introduce a `schemaVersion` + optional soft-delete/version field on
  high-value docs; pairs with the backup fix. **Launch blocker:** No. **Complexity:** Medium.

## Cross-references
- Scaling estimates: [`10-performance-and-scalability.md`](./10-performance-and-scalability.md).
- Backup dependency for delete-recovery: [`14-backup-and-disaster-recovery.md`](./14-backup-and-disaster-recovery.md).
