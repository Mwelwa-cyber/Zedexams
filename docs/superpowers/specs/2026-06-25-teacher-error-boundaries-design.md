> Snapshot as of 2026-06-25 — verify before acting

# Teacher Studio Error Boundaries — Design Spec

## Problem

Teacher studio pages have no render-time error isolation. A single crash inside an
output view (e.g. a malformed API response shape that causes `PaperView` to throw)
propagates to the root `ErrorBoundary` in `main.jsx`, replacing the entire screen
with a full-page error card. The teacher loses their form state and has no
studio-aware recovery path.

Additionally, `attachLibraryToGeneration` failures are silently swallowed via
`.catch(() => {})` across all studios, hiding real errors from devtools.

---

## Architecture

Two boundaries at different granularities:

```
TeacherLayout
  └─ ErrorBoundary (inline, resetKey=pathname)   ← catch-all
       └─ <TeacherPage>
            └─ StudioOutputBoundary              ← output-panel isolation
                 └─ <output section>
```

### Boundary 1 — TeacherLayout catch-all

Wraps `{children}` in the existing `ErrorBoundary` with `inline` and
`resetKey={pathname}`. The sidebar, topbar, and bottom nav always stay visible.
`resetKey={pathname}` auto-clears the error state on route change so a crash on
one page doesn't bleed into the next.

`<TeacherTopBar />` sits **outside** the boundary — it never disappears.

### Boundary 2 — `StudioOutputBoundary`

New file: `src/components/teacher/StudioOutputBoundary.jsx`

A 30-line wrapper around the existing `ErrorBoundary` with a studio-specific
inline fallback card. Accepts `onRetry` — a callback the studio passes to reset
its own `status` back to `'idle'` when the boundary clears, leaving the form live
for resubmission.

Both `retry()` (clears the boundary) and `onRetry?.()` (resets studio status) fire
on a single button click — no double interaction required.

---

## New File: `StudioOutputBoundary`

**Path:** `src/components/teacher/StudioOutputBoundary.jsx`

**Props:**
- `children` — the output section to protect
- `onRetry` — optional callback; called when the teacher clicks "Regenerate"; should set studio `status` to `'idle'`

**Fallback UI:** inline card with ⚠️ icon, "Couldn't display the result" heading,
one-sentence explanation, and a `studio-btn-primary` "↻ Regenerate" button.
Uses existing `studio-display` / `studio-btn-primary` CSS classes and the
`#0e2a32` / `#566f76` colour tokens already in use across the studios.

---

## TeacherLayout Change

**File:** `src/components/teacher/TeacherLayout.jsx`

Changes:
1. Add `useLocation` to the `react-router-dom` import.
2. Import `ErrorBoundary` from `../ui/ErrorBoundary`.
3. Destructure `const { pathname } = useLocation()` in the component body.
4. Wrap `{children}` (not `<TeacherTopBar />`) with
   `<ErrorBoundary inline resetKey={pathname}>`.

No other changes to this file.

---

## Studio Output Wrapping Pattern

Each studio's result `<section>` gets wrapped. The boundary only activates on
render-time throws — it does not interfere with the existing `status === 'error'`
async-failure flow.

```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'

<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {status === 'idle'       && <Centered … />}
    {status === 'generating' && <Centered … />}
    {status === 'error'      && <Centered … />}
    {status === 'success'    && <ResultView … />}
  </section>
</StudioOutputBoundary>
```

### Studios to update (13 files)

| File | Output state var | Notes |
|------|-----------------|-------|
| `generate/ExamStudio.jsx` | `paper` | |
| `generate/QuizStudio.jsx` | `quiz` | |
| `generate/NotesStudio.jsx` | `result` | |
| `generate/HomeworkStudio.jsx` | `result` | |
| `generate/FullLessonStudio.jsx` | `result` | |
| `generate/FlashcardGenerator.jsx` | `result` | |
| `generate/WorksheetGenerator.jsx` | `result` | |
| `generate/SchemeOfWorkGenerator.jsx` | `result` | |
| `generate/RubricGenerator.jsx` | `result` | |
| `generate/LessonPlanGenerator.jsx` | `result` | |
| `generate/AssessmentGenerator.jsx` | `result` | |
| `AssessmentStudio.jsx` | multi-step | Wrap preview/output tab panel only — not the whole component |
| `generate/LessonPlanStudio.jsx` | iframe-based | Wrap the outer React shell only; do not wrap inside the iframe |

---

## Silent Failure Fix

In each studio that calls `attachLibraryToGeneration`, replace:

```js
attachLibraryToGeneration(…).catch(() => {})
```

with:

```js
attachLibraryToGeneration(…).catch((err) => console.error('[library attach]', err))
```

The library save is a background operation — generation succeeded, so we don't
surface this to the teacher. But devtools will show real failures instead of
hiding them.

---

## Out of Scope

- Retry logic for the async generation call itself (studios already handle this
  via the `status === 'error'` + "Try again" pattern)
- Converting `.jsx` files to TypeScript
- Any other studio improvements identified in the audit

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/teacher/StudioOutputBoundary.jsx` | **New** |
| `src/components/teacher/TeacherLayout.jsx` | Add boundary around children |
| `src/components/teacher/generate/ExamStudio.jsx` | Wrap output + fix catch |
| `src/components/teacher/generate/QuizStudio.jsx` | Wrap output + fix catch |
| `src/components/teacher/generate/NotesStudio.jsx` | Wrap output + fix catch |
| `src/components/teacher/generate/HomeworkStudio.jsx` | Wrap output + fix catch |
| `src/components/teacher/generate/FullLessonStudio.jsx` | Wrap output + fix catch |
| `src/components/teacher/generate/FlashcardGenerator.jsx` | Wrap output + fix catch |
| `src/components/teacher/generate/WorksheetGenerator.jsx` | Wrap output + fix catch |
| `src/components/teacher/generate/SchemeOfWorkGenerator.jsx` | Wrap output + fix catch |
| `src/components/teacher/generate/RubricGenerator.jsx` | Wrap output + fix catch |
| `src/components/teacher/generate/LessonPlanGenerator.jsx` | Wrap output + fix catch |
| `src/components/teacher/generate/AssessmentGenerator.jsx` | Wrap output + fix catch |
| `src/components/teacher/AssessmentStudio.jsx` | Wrap output tab panel only |
| `src/components/teacher/generate/LessonPlanStudio.jsx` | Wrap outer React shell only |
