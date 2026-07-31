# ZedExams — Bug & Cleanup Report

> Snapshot as of 2026-06-07 — verify before acting.

**Original audit:** 2026-04-18
**Re-verified:** 2026-06-07 — almost everything below has shipped. Read "Current status" before acting on anything; the original audit's line/file references have drifted.

---

## Current status (2026-07-11)

The 2026-04-18 audit found **no P0/P1 issues** and a list of P2 hardening + P3 cleanup items. On re-verification against the current tree, **every P2 item is resolved** and **all P3 cleanup is done**.

A teacher-side audit on 2026-07-11 (157 raw findings, 24 adversarially verified) fixed 23 issues — data-loss, silent-failure, and input bugs across the studios, register, library, scan import, and dashboard. The items below were confirmed real but deliberately deferred.

### Still open

- ~~**P2 · `teacherLibraryService.getGeneration` still swallows errors**~~ — RESOLVED 2026-07-31. The `useFirestore` half shipped earlier: `getAssessmentById` + the studio-edit hydration guard in #2053, and `getMyAssessments` / `getAssessmentQuestions` re-throwing with per-surface error/retry UI (AssessmentList, both dashboards, TeacherLibrary, AssessmentResultsTab) in #2054. Final piece: `getGeneration` no longer `catch`es-and-returns-`null` — it now returns `null` ONLY for a missing/foreign doc and RE-THROWS a genuine load failure, so `LibraryItemDetail` splits those into a "Not found" panel and a retryable "Couldn't load this item — it hasn't been deleted" panel with a Try-again button (a reload-key re-runs the load, no remount). The three other callers already handled rejection (RecordOfWorkStudio `.catch(() => null)`, TimetablePanel per-id try/catch, LessonPlanStudio `.catch` → error panel). Tests: `LibraryItemDetail.spec.jsx` "load failure vs not found".
- ~~**P3 · Curriculum lookup caches don't self-heal**~~ — RESOLVED 2026-07-31. All three module-scope caches now cache only successful loads: `useCurriculumOptions` + `TopicSubtopicPicker` feed the raw (rejecting) builder to `createAsyncCache` and catch at the call site (a rejection is never cached), and `syllabusTopicOptions`'s hand-rolled `_lookupCache`/`_lookup2013Cache` no longer store the empty fallback on failure. A load that fails once degrades to free-text for that render and retries on the next mount. Regression test: `useCurriculumOptions.spec.js` "does NOT latch ... self-heals".
- **P3 · Register dirty-state guard — in-register controls done, shell nav still open** — #2063 (2026-07-31) shipped `registerUnsavedGuard.jsx`: `MarkEntryGrid` publishes its dirty flag and `ClassRegisterDetail` guards the tab `<Link>`s, "← Class List", "Edit" and "Archive" with a confirm. A follow-up then fixed the premature flag-clear (the guard now stays armed until the grid actually unmounts, so Archive-cancel / cmd-click / active-tab-click no longer disarm it). **Still open (P1 from Codex review):** every register route is wrapped by `TeacherLayout`, whose shared nav surfaces (`dashboardV2/Sidebar.jsx`, mobile `NavDrawer`, bottom dock, account menu) sit ABOVE the register's context provider — clicking Dashboard/Library there while marks are unsaved still discards them silently. Closing it means lifting the flag to a module-scope registry and wiring those shared shell nav controls (touches every teacher page's navigation — own PR). Browser back/forward likewise stays uncovered without a data router; `beforeunload` still catches tab-close/reload. Tests: `registerUnsavedGuard.spec.jsx`.

_(The console-log cleanup item — scattered intermediate "test passed" lines in `src/components/quiz/documentQuizParserCore.test.js` — was resolved on 2026-06-18: the per-section logs were removed and consolidated into a single final `All documentQuizParserCore tests passed.` summary, matching the convention used by the other node test scripts.)_

_(The two orphaned editor files — `src/editor/QuizEditor.jsx` and `src/editor/QuizViewer.jsx` — were deleted on 2026-05-29; see P3-1 below. They're recoverable from git history if the Tiptap-editor switch is ever revived.)_

### Resolved since 2026-04-18

| Original item | Resolution |
|---|---|
| P2-1 · No root error boundary | `<ErrorBoundary>` wraps `<App/>` in `src/main.jsx`; `src/components/ui/ErrorBoundary.jsx` exists |
| P2-2 · 729 kB `vendor` chunk | `vite.config.js` `manualChunks` splits firebase / sentry / posthog / icons / router / i18n / docx / sanitize / fflate into capped, independently-cached chunks |
| P2-3 · RichEditor / Tiptap chunk | Tiptap, katex, prosemirror left to auto-split as dynamic imports from lazy editor routes |
| P2-4 · PDF.js worker 2.35 MB | Own `pdfjs` chunk, excluded from precache. No action was needed. *(The original "Netlify long-cache" note is moot — hosting is Firebase Hosting.)* |
| P2-5 · Two sanitizer paths | `src/utils/quizRichText.js` now runs a final DOMPurify pass via `sanitizeQuizRichHTML` from `editor/utils/sanitize.js` — one allow-list source of truth |
| P2-6 · UpgradeModal close button | `aria-label="Close upgrade dialog"` added |
| P2-7 · 2.5 s auth watchdog | Extended to 5 s in `src/contexts/AuthContext.jsx` |
| Auth session recovery for backgrounded tabs (was "still open" #2) | Shipped on `main`: `useAuthRecovery` (token refresh + Firestore listener re-attach on `visibilitychange`/`pageshow`/`online`) wired into `AuthContext`, `expireSession` redirect on terminal auth failure, plus `OfflineBanner` + `useNetworkStatus`. Covered by `test:auth-recovery` + `test:sw-recovery` |
| P3-1 · 9 orphan files | All 9 deleted — the last 2 (`src/editor/QuizEditor.jsx`, `QuizViewer.jsx`) removed in this change |
| P3-2 · `VITE_OPENAI_API_KEY` in `.env` | No code reads it (`src/` has zero references). The `.env` line is local/gitignored — verify + remove on the workstation if it's still there |
| P3-6 · Rollup chunk-size advisory | `chunkSizeWarningLimit` raised to 900 with a documented rationale |

P3-3 (Firestore `Listen/channel` request noise) and P3-5 (root build-artifact clutter) were QA-harness / housekeeping advisories with no runtime impact, left as-is.

---

_The full point-in-time audit from 2026-04-18 (executive summary, per-item detail, verification notes) is preserved in git history — see the commit that first added this file. It was replaced here on 2026-05-29 because nearly every item had shipped and the stale detail was actively misleading._
