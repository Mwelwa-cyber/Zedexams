# ZedExams Concurrency & Data-Race Audit

> Snapshot as of 2026-07-18 — verify before acting. Line numbers drift; treat
> file:line references as pointers, not guarantees.

A platform-wide audit of data races, stale writes, lost updates, duplicate
operations, and counter/trigger corruption. It states, per subsystem, the
**invariant**, the **current protection**, the **failure scenario**, and the
**verdict**. Fixes shipped alongside this document are marked ✅ FIXED; genuine
residual gaps are marked ⚠️ and prioritised at the end.

The headline finding is that ZedExams is **already concurrency-mature on its
highest-risk server paths** — payments, AI budget/metering, and attendance
day-marking all enforce their invariants transactionally at the database layer.
The real gaps were concentrated in duplicate-operation and counter/trigger
paths, which this change set closes, plus a Phase-2 optimistic-concurrency gap
in teacher document editors that is documented as prioritised follow-up.

Frontend button-disabling is treated as UX only; every verdict below is about
the authoritative server/database layer.

---

## 1. Race classification (the categories used below)

| Category | One-line definition |
|---|---|
| Stale-response | An older async read resolves after a newer one and overwrites correct UI state. |
| Lost-update | Two writers read the same version and one silently clobbers the other. |
| Check-then-act | A condition is checked, then acted on, but changed in between (TOCTOU). |
| Duplicate-operation | The same logical operation starts more than once (double-tap, retry, second tab). |
| Counter | Concurrent read-modify-write of a total loses increments. |
| Trigger | A DB event / background job is delivered or retried more than once. |
| Context-switch | A delayed op from a previous document/curriculum writes into the new context. |
| Multi-tab | Two tabs edit/publish/save the same resource concurrently. |
| Offline-reconciliation | Queued offline writes replay after newer server changes. |

---

## 2. Application invariants

1. One logical AI generation ⇒ one provider call and one usage charge.
2. A document revision may only move forward; an older save cannot overwrite a newer one.
3. Exactly one final attendance record per class per date; a locked term cannot be edited by a stale client.
4. One learner submission may be finalised only once.
5. A payment reference maps to one authoritative transaction; success is applied at most once.
6. A published assessment corresponds to the revision that was reviewed.
7. CBC results must never populate an OBC (previous-curriculum) selection, and vice-versa.
8. A background event affects a summary at most once.
9. Assigned work is created once per logical assign action — no duplicate assignments.
10. XP / streak / examsCompleted increments exactly once per unique attempt.

---

## 3. Subsystem verdicts

### 3.1 Payments & subscriptions — ✅ SAFE (no change needed)

- **Invariant:** 5 (one authoritative transaction per payment; success applied once).
- **Entry points:** `lencoWebhook` (`functions/index.js`), `initiateLencoPayment`, `submitLencoOtp`, `getLencoPaymentStatus`, `verifyGooglePlayPurchase`, and the `hourlyRevenueReconcile` (Till) cron.
- **Current protection:** every success path funnels through one chokepoint,
  `activateSubscriptionFromPayment` (`functions/subscriptionActivation.js:87`),
  whose idempotency is a **transactional status guard**:
  ```js
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(payRef);
    if (pay.status === "successful" || pay.status === "confirmed") return; // no-op
    ...
  });
  ```
  Of N concurrent activators for one `payments/{id}`, exactly one flips the
  status; the rest re-read the committed doc and return. Reinforced by:
  duplicate-initiation lock `paymentLocks/{uid}` (`functions/paymentInitiationCore.js`);
  payment doc id = Lenco reference (duplicate webhook resolves the same doc);
  deterministic Google Play doc id `gp_<sha256(token|expiry)>`
  (`functions/googlePlayBillingCore.js:89`); invoice doc id = payment id.
- **Cron ↔ webhook race:** both serialise on the same `payments/{id}`
  transaction; whichever commits first activates, the other no-ops.
- **Failure scenario:** none for double-processing.
- ⚠️ **Residual (low, inverse):** invoice/referral/notification side effects run
  *after* the transaction commits. A crash between commit and side-effects
  leaves them **un-emitted** (lost, not doubled) because a retry hits the status
  guard and returns `alreadyActive`. See Residual R1.

### 3.2 AI usage metering & budget — ✅ SAFE checks; ⚠️ generation not idempotent

- **Invariant:** 1 (one generation ⇒ one charge).
- **Three layers, all transactional for the CHECK:**
  - Learner daily call cap `assertDailyLimit` — single transaction on
    `aiDailyLimits/{uid}_{day}` (`functions/aiService.js:124`).
  - Teacher tool monthly/daily meter `assertAndIncrement` — single transaction
    on `usageMeters/{uid}/periods/{period}` + `users/{uid}`
    (`functions/teacherTools/usageMeter.js:110`); credit spend is atomic.
  - Global $ ceiling `reserveBudget` — atomic per-bucket reservation whose
    caps sum exactly to the budget, so total reserved can never exceed it
    (`functions/aiBudgetReservation.js:121-190`). Reserve/settle/release are
    idempotent on `generationId`; expired reservations are reclaimed hourly.
    Settlement and reclaim both guard on `status === "open"`, so they cannot
    double-adjust a bucket.
- **Two concurrent requests near a cap cannot both pass** — Firestore serialises
  transactions on the per-user counter doc.
- ⚠️ **Failure scenario:** the *reservation* is idempotent on `generationId`,
  but the teacher tools never pass a stable one (each call mints a fresh
  `aiGenerations` doc id and `safeGenerationId` UUID). So a genuine **double
  submit** (double-tap / client retry) results in two meter increments + two
  reservations + **two provider calls**. Usage cannot go negative (all
  rollback/settle paths clamp), but it can be **double-charged**. Additionally,
  most `generate*` tools do not `refundGeneration` on a hard AI failure, so a
  failed generation still burns quota. See Residual R2 — a reusable idempotency
  primitive (`functions/idempotency.js`) shipped here is ready to apply.

### 3.3 Attendance — ✅ day-marking SAFE; ✅ FIXED term-lock TOCTOU

- **Invariant:** 3 (one record per class/date; locked term immutable to stale clients).
- **Current protection (day hot path):** one server write path
  (`saveClassAttendance`, `functions/attendance/saveClassAttendance.js`); rules
  deny all direct client writes (`firestore.rules`); a strict server-managed
  `version` re-read **inside** the transaction with a `STALE_VERSION` reject
  (`functions/attendance/attendanceServerCore.js:190-195`); counts recomputed
  server-side from merged records (client counts ignored); field-level record
  merge so two devices never clobber each other's rows; the client outbox
  rebases on `STALE_VERSION` rather than overwriting. No summary trigger exists,
  so no double-count on redelivery.
- ✅ **FIXED (gap 7d):** the term **lock state** (`attendanceTerms`) was read
  *before* the transaction, so an admin/teacher locking the term in the
  millisecond window could be bypassed. It is now re-read **inside** the
  transaction alongside the day version, so a concurrent lock is serialised
  against the write and re-validated.
- ⚠️ **Residual (low):** term lifecycle transitions (draft→submitted→locked→
  reopened) are still a client `setDoc(...,{merge:true})` guarded only by rules,
  not a transactional state machine, and the lifecycle write is not atomic with
  its audit entry. See Residual R3.

### 3.4 Teacher document editors (quiz / assessment / lesson / notes) — ⚠️ last-write-wins

- **Invariant:** 2 (revision only moves forward).
- **Current protection:** **none at the revision level.** Every teacher-editable
  doc is written with a bare `updateDoc`/`setDoc({merge:true})`;
  `updatedAt: serverTimestamp()` is written but never read back or compared
  (`src/hooks/useFirestore.js` quiz/assessment/lesson writers;
  `src/features/notes/lib/firestore.js`). Within a single tab, autosave is
  serialised by single-flight refs (`autoSavingRef`, `persistInFlightRef`,
  `createdIdRef`), which prevents same-tab A-overwrites-B and duplicate creates.
- **Failure scenario:** two tabs / two devices editing the same document → the
  later writer silently wins (lost update). No multi-tab coordination, no stale-
  write detection, no conflict UI.
- ⚠️ This is the largest residual and is **Phase 2** below (Residual R4). It is
  intentionally **not** patched blindly here: retrofitting optimistic
  concurrency across every editor plus a conflict-resolution UI is a UX change,
  not a mechanical swap, and doing it carelessly on live editors risks data loss.

### 3.5 Publishing pipeline (Pubo) & question review (Qix) — ✅ FIXED trigger dedup

- **Invariant:** 6 (published == reviewed), 8 (event affects summary once).
- **Current protection:** `agentJobsOnApproved` fires only on the
  `→ approved` transition and Pubo refuses any job not `approved`, missing
  Aria/Cala/Reva output, or with a missing reserved generation
  (`functions/agents/dispatcher.js`, `functions/agents/runners/pubo.js`). Qix
  skips any question that already has `aiReview` (idempotent on its own re-fire).
- ✅ **FIXED:** Eventarc delivers **at-least-once**; a duplicate delivery of the
  *same* approved transition carries identical before/after and previously
  sailed past the state guard to run Pubo twice. `agentJobsOnApproved` now
  claims the event id once via `claimEventOnce` (`processedEvents/{scope}_{id}`,
  atomic `.create()`), so the body runs at most once per delivery. Fails open so
  the guard never drops a real approval.
- ⚠️ **Residual (low):** Qix's `pending_review → judged` transition is guarded by
  a read of the current snapshot, not a transaction, so two *concurrent*
  deliveries could both run a review (wasted model call; last verdict wins). The
  same `claimEventOnce` primitive can be applied. See Residual R5.

### 3.6 Learner XP / streak / stats — ✅ FIXED counter double-count

- **Invariant:** 10 (one increment per unique attempt).
- **Was:** `recordExamCompletion` (`src/utils/gamificationService.js`) did a
  **non-transactional** read → dedup-check → `+xp/+streak/+examsCompleted` →
  `setDoc`. Two concurrent completions of the same attempt both read the
  pre-write doc, both miss the dedup, and both awarded XP.
- ✅ **FIXED:** the read-modify-write now runs inside a `runTransaction`, so a
  concurrent duplicate re-reads the committed doc and dedups cleanly. The pure
  transform is extracted to `src/utils/gamificationCore.js`
  (`computeExamCompletion`) and unit-tested for idempotency + no-double-count
  (`scripts/test-gamification-core.mjs`).
- ⚠️ **Residual (medium, trust):** `learnerStats` is client-writable, so a
  tampered client can still forge its own totals. The transaction fixes the
  *race*; full integrity needs a server-authoritative writer. See Residual R6.

### 3.7 Class assignments — ✅ FIXED duplicate work

- **Invariant:** 9 (one assignment per logical assign).
- **Was:** `createClassAssignment` (`functions/classManagement.js`) did a
  random-id `.add()` with no dedup, so a double-tap / callable retry created N
  duplicate assignments that fanned out N notifications to every learner.
- ✅ **FIXED:** the client mints an idempotency key per assign action
  (`src/utils/quizAssignments.js`, `src/utils/assignments.js`); the server
  derives a deterministic, per-teacher-namespaced doc id
  (`deriveIdempotentId`) and does a **transactional create-if-absent**, plus a
  fast pre-transaction replay check. A retry with the same key returns the
  existing assignment without a second create or notification fan-out. Malformed
  / absent keys fall back to the legacy path (older clients).

### 3.8 Frontend stale-response (curriculum / subject / topic loading) — ✅ SAFE

- **Invariant:** 7 (CBC results never populate an OBC selection).
- **Current protection:** the studio curriculum hooks
  (`src/components/teacher/studio/hooks/useSubjectTopics.js`,
  `useSubjectsForGrade.js`, `useSubtopicDetail.js`, `useAvailableGrades.js`,
  `useCoverageAnalysis.js`) all use the effect-cleanup `cancelled` guard: when
  subject/grade/curriculumMode changes, the previous effect's cleanup sets
  `cancelled = true`, so a late response for the old context is discarded. This
  is the recommended stale-response pattern (effect cleanup + unmount safety).
- **Verdict:** no context-switch race in these hooks. New async-read surfaces
  should follow the same pattern (or an AbortController / sequence token).

### 3.9 Quiz attempts & daily-exam grading — ✅ SAFE (finalisation); ⚠️ minor start race

- **Finalisation (invariant 4):** `submitDailyExam`
  (`functions/dailyExamGradingFns.js:144`) runs a full `runTransaction`, re-reads
  the attempt inside it, and returns early if `status === "submitted"` — cannot
  grade the same attempt twice. Grader is pure/deterministic; scores are
  server-authoritative.
- ⚠️ **Residual (low):** `startExam` (`src/utils/examService.js`) checks a
  deterministic `daily_exam_locks/{uid_subject_date}` doc then writes the attempt
  + lock **without a transaction**, so two concurrent starts can orphan an
  attempt doc (finalisation stays safe). And `checkAndConsumeAttempt`
  (`src/hooks/useFirestore.js`) reads-then-increments the free-tier daily cap:
  the counter uses atomic `increment(1)` (safe) but the *gate* is racy, so a
  burst can slip a couple over the cap. See Residual R7.

### 3.10 Summaries, dashboards, notifications — ✅ mostly derived

- Dashboard/leaderboard totals are **read-time aggregations** (`getCountFromServer`,
  live queries, sharded-then-summed AI cost rollups), not maintained counters —
  nothing to skew.
- `onQuizWritten` mirror fully overwrites a summary doc (idempotent on redelivery).
- ⚠️ **Residual (low):** `createNotification` dedup is a query-then-add TOCTOU
  over a 24h window (reduces, doesn't eliminate, duplicate notifications under
  concurrency); `writeAgentRollup` (`functions/agents/rollups.js:58`) does a
  non-atomic `coalescedRuns + 1`. Neither corrupts money or academic records.
  See Residual R8.

---

## 4. Fixes shipped in this change set

| # | Race category | Fix | Files | Test |
|---|---|---|---|---|
| F1 | Duplicate-operation | Idempotent `createClassAssignment` (deterministic id + transactional create-if-absent + client key) | `functions/classManagement.js`, `functions/idempotency.js`, `src/utils/quizAssignments.js`, `src/utils/assignments.js` | `functions/idempotency.test.js` |
| F2 | Check-then-act (TOCTOU) | Attendance term-lock re-read inside the transaction | `functions/attendance/saveClassAttendance.js` | `test:attendance-server` (TERM_LOCKED) |
| F3 | Counter | Transactional `recordExamCompletion` + extracted pure core | `src/utils/gamificationService.js`, `src/utils/gamificationCore.js` | `scripts/test-gamification-core.mjs` |
| F4 | Trigger (at-least-once) | `processedEvents` dedup on the Pubo publish trigger | `functions/agents/dispatcher.js`, `functions/idempotency.js` | `functions/idempotency.test.js` |
| — | Security rules | `processedEvents` made server-write-only | `firestore.rules` | `test:rules-text` |

New reusable primitive: **`functions/idempotency.js`** —
`deriveIdempotentId(namespace, key)` (deterministic, actor-namespaced doc id for
a client idempotency key; returns null for malformed input so callers never
trust raw input as a doc id) and `claimEventOnce(db, {scope, eventId})`
(atomic `.create()` at-least-once trigger dedup, fail-open). Both are pure /
injectable-`db` and unit-tested under plain `node`.

---

## 5. Residual risks — prioritised follow-up

**Phase 1 — financial / AI**
- **R2 (AI generation idempotency).** Thread a client idempotency key through the
  `generate*` callables and dedupe the whole operation (reserve key → run →
  store result → replay returns the stored result). The `idempotency.js`
  primitive is ready; the work is per-tool wiring + the client key. Also add
  `refundGeneration` to the `generate*` tools that lack it so a hard AI failure
  doesn't burn quota.
- **R1 (payment post-commit side effects).** Make invoice / referral / success-
  notification a re-drivable step (idempotent, keyed on payment id) so a crash
  between commit and emit doesn't silently drop an invoice.

**Phase 2 — user work preservation**
- **R4 (teacher-doc optimistic concurrency).** Add a `revision` field to
  quiz/assessment/lesson/note docs, send the loaded revision on save, reject a
  stale write server-side with a structured `REVISION_CONFLICT`
  `{expectedRevision, actualRevision, retryable:false}`, preserve the local
  draft, and surface a conflict UI (view latest / save-as-copy / merge /
  overwrite-with-confirm). Add `BroadcastChannel` multi-tab notices as UX only.
  This is a deliberate, staged change — not a blind LWW→OCC swap on live editors.

**Phase 3 — academic records**
- **R3 (attendance term lifecycle).** Route draft→submitted→locked→reopened
  through a transactional callable that enforces the state machine and writes the
  audit entry atomically, instead of client `setDoc` + rules.
- **R5 (Qix double-review).** Apply `claimEventOnce` to `questionReviewOnWrite`.
- **R7 (exam start / free-tier gate).** Make `startExam` transactional to avoid
  orphan attempts; tighten `checkAndConsumeAttempt` to a transactional gate.

**Phase 4 — derived data**
- **R6 (learnerStats trust).** Move XP/streak writes server-side (a callable or
  a trigger off the authoritative attempt) so totals can't be client-forged.
- **R8 (notification / rollup dedup).** Replace query-based notification dedup
  with a deterministic `dedupeKey` doc id (create-if-absent) and make
  `writeAgentRollup.coalescedRuns` an atomic `increment()`.

---

## 6. Testing

- New: `functions/idempotency.test.js` (24 assertions — key validation,
  deterministic id, actor namespacing, `claimEventOnce` first/duplicate/fail-open)
  and `scripts/test-gamification-core.mjs` (20 assertions — completion idempotency,
  no double-count on replay, bounded window). Both auto-discovered by `test:all`.
- Full suite green: `npm run test:all` (390 node scripts), the affected Vitest
  specs (`gamificationService`, `useLearnerStats`, `ExamResultsPage`),
  `npm run lint`, `npm run build`, and `test:rules-text`.
- **Not run here (needs the Firestore emulator / a load rig):** multi-transaction
  contention tests for the new transactional paths, and the load/contention
  scenarios (attendance-morning, exam-period, high AI-generation traffic). These
  are the Phase-5 items and are called out rather than claimed.

---

## 7. What this change set does and does not claim

It does **not** claim ZedExams is globally concurrency-safe. It claims that the
**duplicate-assignment, attendance term-lock TOCTOU, gamification counter, and
publish-trigger redelivery** races are closed with server/database-layer
enforcement and tests, that the **payment, AI-metering, attendance day-marking,
daily-exam finalisation, and curriculum stale-response** paths were audited and
found already-protected, and that the remaining risks — chiefly teacher-document
optimistic concurrency and full AI-generation idempotency — are documented with a
concrete, prioritised implementation path.
