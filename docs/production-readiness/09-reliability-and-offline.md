# 09 — Reliability & Offline

> Snapshot as of 2026-07-19. Layers 1 (UX), 2 (frontend logic), 10 (reliability/offline). Finding IDs: `REL-*`.

## Verdict

The **primitives are excellent** — a production-grade draft framework (`useDraftManager`), a
synchronous request lock (`useAiOperationLock`), a durable offline outbox (`syncEngine`),
transactionally-safe payments/attendance/exam-finalisation, exceptional chunk-load recovery,
and an honest, well-prioritized `docs/concurrency-audit.md`. The gaps are **adoption/consistency**
gaps, not architectural absences: the right tools exist and are proven; they are just not applied
everywhere. The two most user-impacting are **work loss on 5 teacher generators** and
**duplicate-charge on all generators except Assessment**.

## Strengths (evidence)

- **Error boundaries** at 4 levels (app / route / layout / feature), keyed on pathname to
  auto-clear (`ErrorBoundary.jsx`, `App.jsx:387-449`); **chunk-load recovery** evicts SW precache +
  unregisters SW before reload, with a 30s loop guard (`ErrorBoundary.jsx:64-106`).
- **Draft framework** — `useDraftManager` composes IndexedDB + cloud mirror + cross-tab lock +
  `beginCriticalWork()` (both a `beforeunload` warning and PWA-update deferral), debounced,
  versioned, recovery-prompt on mount (`src/hooks/draft/useDraftManager.js`).
- **Offline outbox** — `syncEngine.js` synchronous mutex before any await, exponential backoff,
  idempotency ids, `online`/`offline` + 30s poll for flaky Android WebView; attendance outbox with
  `STALE_VERSION` rebase (`useClassRegister.js`), server-only rules-denied writes.
- **Transactionally safe** — payments (`paymentLocks/{uid}` + status guard), AI metering, attendance
  (reads-before-writes, TOCTOU-aware), exam finalisation, class assignments (idempotency key).

## Findings

### REL-001 — Five teacher generators have zero unsaved-work protection (work loss)
- **Severity:** High · **Confidence:** High confidence
- **Affected:** `WorksheetGenerator.jsx`, `RubricGenerator.jsx`, `FlashcardGenerator.jsx`,
  `HomeworkStudio.jsx`, `SchemeOfWorkGenerator.jsx` — no `useDraftManager`, no `beginCriticalWork`,
  no `beforeunload`. Nine sibling studios (Lesson Plan, Notes, SBA, Mark Schedule, Weekly Forecast,
  Record of Work, Class Timetable, …) use the shared manager.
- **Current:** A refresh or navigation loses form inputs **and** generated-then-edited output.
  Scheme of Work is a long, high-effort artifact — the worst to lose.
- **Risk:** Direct teacher work loss; trust + support impact.
- **Correction:** Wire the five studios to `useDraftManager` (mechanical — the framework exists).
- **Launch blocker:** No, but High-priority Phase 1. **Complexity:** Low per studio.

### REL-002 — Duplicate-submission unprotected on all generators except Assessment
- **Severity:** High · **Confidence:** High confidence
- **Affected:** every teacher generator except Assessment relies only on `status==='generating'`
  button-disable (async React state) — the exact insufficiency `useAiOperationLock`'s header
  documents. `docs/concurrency-audit.md:102-110,264-270` (R2).
- **Current:** A genuine double-submit → two provider calls + two meter charges. Overlaps AI-002.
- **Risk:** Double AI spend + double usage charge (financial).
- **Correction:** Apply `useAiOperationLock` + backend `reserveAiOperation` per generator.
- **Launch blocker:** No (bounded) but High-priority. **Complexity:** Medium.

### REL-003 — Teacher document editors are last-write-wins across tabs/devices
- **Severity:** Medium–High · **Confidence:** High confidence
- **Affected:** documented R4 in `docs/concurrency-audit.md:134-150` (largest residual, not fixed).
- **Current:** Two tabs/devices editing the same doc → silent lost update; no version field on
  teacher docs (see DATA-004).
- **Risk:** Silent loss of edits for a teacher working across devices.
- **Correction:** Add an optimistic-concurrency version field + conflict prompt (as attendance does
  with `STALE_VERSION`). **Launch blocker:** No. **Complexity:** Medium.

### REL-004 — Curriculum grade/subject arrays hardcoded and divergent in admin/quiz components
- **Severity:** Medium · **Confidence:** High confidence
- **Affected:** `src/config/curriculum.js` is the source of truth (`GRADES=[4..7]`), but
  `AdminCsvImport.jsx:41` (`GRADES=['1'..'12']`), `AdminResults.jsx:10,21`, `AdminLearners.jsx:11`,
  `CreateQuizV2.jsx:43,54`, `EditQuizV2.jsx:74`, `ManageContent.jsx:60` redefine local copies.
- **Current:** Canonical grades are 4–7, but CSV import allows 1–12 — a real divergence.
- **Risk:** Inconsistent validation → data that doesn't match the canonical curriculum; confusing UX.
- **Correction:** Import from `config/curriculum.js` everywhere; delete local copies.
- **Launch blocker:** No. **Complexity:** Low.

### REL-005 — Quiz persistence silently no-ops on storage-quota-exceeded
- **Severity:** Low · **Confidence:** High confidence
- **Affected:** `useQuizPersistence.js:42-47` swallows all storage errors.
- **Current:** On quota-exceeded/private-mode the save silently no-ops — the learner isn't told
  their answers aren't persisted. Prevents a crash (good) but hides a data-loss condition.
- **Correction:** Surface a non-blocking "answers may not be saved offline" notice on repeated
  save failure. **Launch blocker:** No. **Complexity:** Low.

## Cross-references
- Backend idempotency/refund: [`07-ai-readiness.md`](./07-ai-readiness.md) AI-002/AI-006.
- Multi-tab version field: [`05-data-and-firestore.md`](./05-data-and-firestore.md) DATA-004.
