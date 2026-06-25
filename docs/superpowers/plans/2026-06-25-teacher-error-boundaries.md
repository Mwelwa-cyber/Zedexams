# Teacher Studio Error Boundaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap all teacher studio pages in error boundaries so a render crash never produces a blank screen — the sidebar stays visible, the form stays live, and the teacher gets a recovery button.

**Architecture:** Two boundaries at different granularities: (1) `TeacherLayout` gets a catch-all `ErrorBoundary inline resetKey={pathname}` around `{children}` so any teacher page crash stays within the layout shell; (2) each studio's output panel gets wrapped in a new `StudioOutputBoundary` so a crash in the rendered result (e.g. a malformed API response) leaves the form intact. Also fixes 11 silently swallowed `attachLibraryToGeneration` errors.

**Tech Stack:** React 18, JSX (`.jsx`), existing `src/components/ui/ErrorBoundary.jsx`, TailwindCSS utility classes, existing `studio-btn-primary` CSS class.

**Spec:** `docs/superpowers/specs/2026-06-25-teacher-error-boundaries-design.md`

---

## File Map

| Action | Path |
|--------|------|
| **Create** | `src/components/teacher/StudioOutputBoundary.jsx` |
| **Modify** | `src/components/teacher/TeacherLayout.jsx` |
| **Modify** | `src/components/teacher/generate/ExamStudio.jsx` |
| **Modify** | `src/components/teacher/generate/QuizStudio.jsx` |
| **Modify** | `src/components/teacher/generate/NotesStudio.jsx` |
| **Modify** | `src/components/teacher/generate/HomeworkStudio.jsx` |
| **Modify** | `src/components/teacher/generate/FullLessonStudio.jsx` |
| **Modify** | `src/components/teacher/generate/FlashcardGenerator.jsx` |
| **Modify** | `src/components/teacher/generate/WorksheetGenerator.jsx` |
| **Modify** | `src/components/teacher/generate/SchemeOfWorkGenerator.jsx` |
| **Modify** | `src/components/teacher/generate/RubricGenerator.jsx` |
| **Modify** | `src/components/teacher/generate/LessonPlanGenerator.jsx` |
| **Modify** | `src/components/teacher/generate/AssessmentGenerator.jsx` |
| **Modify** | `src/components/teacher/AssessmentStudio.jsx` |
| **Modify** | `src/components/teacher/generate/LessonPlanStudio.jsx` |

---

## Task 1: Create `StudioOutputBoundary`

**Files:**
- Create: `src/components/teacher/StudioOutputBoundary.jsx`

- [ ] **Step 1: Create the file**

```jsx
import ErrorBoundary from '../ui/ErrorBoundary'

export default function StudioOutputBoundary({ children, onRetry }) {
  return (
    <ErrorBoundary
      inline
      fallback={({ retry }) => (
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center px-4">
          <div className="text-4xl">⚠️</div>
          <p className="studio-display" style={{ fontSize: 18, color: '#0e2a32' }}>
            Couldn&apos;t display the result
          </p>
          <p className="text-sm" style={{ color: '#566f76', maxWidth: 360 }}>
            The content generated but something went wrong while displaying it.
            Try regenerating — it usually works on the next attempt.
          </p>
          <button
            type="button"
            onClick={() => { retry(); onRetry?.() }}
            className="studio-btn-primary"
          >
            ↻ Regenerate
          </button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/teacher/StudioOutputBoundary.jsx
git commit -m "feat: add StudioOutputBoundary for studio output panel isolation"
```

---

## Task 2: Update `TeacherLayout` — catch-all boundary

**Files:**
- Modify: `src/components/teacher/TeacherLayout.jsx`

The layout currently renders `{children}` without any error isolation. A crash on any teacher page propagates to the root boundary in `main.jsx`, replacing the entire screen. Adding a boundary here keeps the sidebar, topbar, and bottom nav visible on any crash.

- [ ] **Step 1: Add `useLocation` import and `ErrorBoundary` import**

Find the existing line:
```jsx
import { Link, NavLink, useNavigate } from 'react-router-dom'
```

Replace with:
```jsx
import { Link, NavLink, useNavigate, useLocation } from 'react-router-dom'
import ErrorBoundary from '../ui/ErrorBoundary'
```

- [ ] **Step 2: Destructure `pathname` from `useLocation`**

Inside `TeacherLayout`, add after the existing `const navigate = useNavigate()` line:
```js
const { pathname } = useLocation()
```

- [ ] **Step 3: Wrap `{children}` — keep `<TeacherTopBar />` outside the boundary**

Find:
```jsx
<TeacherTopBar />
{children}
```

Replace with:
```jsx
<TeacherTopBar />
<ErrorBoundary inline resetKey={pathname}>
  {children}
</ErrorBoundary>
```

- [ ] **Step 4: Verify lint passes**

```bash
npm run lint -- --quiet
```

Expected: no errors in `TeacherLayout.jsx`.

- [ ] **Step 5: Commit**

```bash
git add src/components/teacher/TeacherLayout.jsx
git commit -m "feat: add catch-all ErrorBoundary to TeacherLayout"
```

---

## Task 3: Update `ExamStudio`

**Files:**
- Modify: `src/components/teacher/generate/ExamStudio.jsx`

`ExamStudio` renders `<PaperView paper={paper} ...>` when generation succeeds. If `paper` has an unexpected shape, the render throws and the entire page goes blank. The output panel is the `<section className="studio-card p-5 min-h-[400px]">` block.

- [ ] **Step 1: Add `StudioOutputBoundary` import**

Add after the last existing import line:
```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the output section**

Find (in the JSX return):
```jsx
<section className="studio-card p-5 min-h-[400px]">
```

Wrap the entire `<section>...</section>` block:
```jsx
<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {/* existing content unchanged */}
  </section>
</StudioOutputBoundary>
```

- [ ] **Step 3: Fix silent library-attach failure**

Find:
```js
}).catch(() => {})
```
(Inside the `if (res.data.generationId)` block after `attachLibraryToGeneration(...)`)

Replace with:
```js
}).catch((err) => console.error('[library attach]', err))
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/generate/ExamStudio.jsx
git commit -m "feat: add StudioOutputBoundary and fix silent catch in ExamStudio"
```

---

## Task 4: Update `QuizStudio`

**Files:**
- Modify: `src/components/teacher/generate/QuizStudio.jsx`

Same pattern as ExamStudio. Output state variable is `quiz`. The output section is `<section className="studio-card p-5 min-h-[400px]">`.

- [ ] **Step 1: Add import**

```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the output section**

```jsx
<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {/* existing content unchanged */}
  </section>
</StudioOutputBoundary>
```

- [ ] **Step 3: Fix silent catch**

Find `.catch(() => {})` inside the `attachLibraryToGeneration` call and replace:
```js
.catch((err) => console.error('[library attach]', err))
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/generate/QuizStudio.jsx
git commit -m "feat: add StudioOutputBoundary and fix silent catch in QuizStudio"
```

---

## Task 5: Update `NotesStudio`

**Files:**
- Modify: `src/components/teacher/generate/NotesStudio.jsx`

Output state variable is `notes`. Output section is `<section className="studio-card p-5 min-h-[400px]">`.

- [ ] **Step 1: Add import**

```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the output section**

```jsx
<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {/* existing content unchanged */}
  </section>
</StudioOutputBoundary>
```

- [ ] **Step 3: Fix silent catch**

Find `.catch(() => {})` after the `attachLibraryToGeneration` call and replace:
```js
.catch((err) => console.error('[library attach]', err))
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/generate/NotesStudio.jsx
git commit -m "feat: add StudioOutputBoundary and fix silent catch in NotesStudio"
```

---

## Task 6: Update `HomeworkStudio`

**Files:**
- Modify: `src/components/teacher/generate/HomeworkStudio.jsx`

Output state variable is `homework`. Output section is `<section className="studio-card p-5 min-h-[400px]">`.

- [ ] **Step 1: Add import**

```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the output section**

```jsx
<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {/* existing content unchanged */}
  </section>
</StudioOutputBoundary>
```

- [ ] **Step 3: Fix silent catch**

```js
.catch((err) => console.error('[library attach]', err))
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/generate/HomeworkStudio.jsx
git commit -m "feat: add StudioOutputBoundary and fix silent catch in HomeworkStudio"
```

---

## Task 7: Update `FullLessonStudio`

**Files:**
- Modify: `src/components/teacher/generate/FullLessonStudio.jsx`

Output state variable is `lesson`. Output section is `<section className="studio-card p-5 min-h-[400px]">`.

- [ ] **Step 1: Add import**

```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the output section**

```jsx
<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {/* existing content unchanged */}
  </section>
</StudioOutputBoundary>
```

- [ ] **Step 3: Fix silent catch**

```js
.catch((err) => console.error('[library attach]', err))
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/generate/FullLessonStudio.jsx
git commit -m "feat: add StudioOutputBoundary and fix silent catch in FullLessonStudio"
```

---

## Task 8: Update `FlashcardGenerator`

**Files:**
- Modify: `src/components/teacher/generate/FlashcardGenerator.jsx`

Output state variable is `flashcards`. Output section is `<section className="studio-card p-5 min-h-[400px]">`.

- [ ] **Step 1: Add import**

```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the output section**

```jsx
<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {/* existing content unchanged */}
  </section>
</StudioOutputBoundary>
```

- [ ] **Step 3: Fix silent catch**

```js
.catch((err) => console.error('[library attach]', err))
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/generate/FlashcardGenerator.jsx
git commit -m "feat: add StudioOutputBoundary and fix silent catch in FlashcardGenerator"
```

---

## Task 9: Update `WorksheetGenerator`

**Files:**
- Modify: `src/components/teacher/generate/WorksheetGenerator.jsx`

Output state variable is `worksheet`. Output section is `<section className="studio-card p-5 min-h-[400px]">` (comment `{/* Output panel */}` immediately above it).

- [ ] **Step 1: Add import**

```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the output section**

Find the comment `{/* Output panel */}` and the `<section>` immediately after it:
```jsx
<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {/* existing content unchanged */}
  </section>
</StudioOutputBoundary>
```

- [ ] **Step 3: Fix silent catch**

```js
.catch((err) => console.error('[library attach]', err))
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/generate/WorksheetGenerator.jsx
git commit -m "feat: add StudioOutputBoundary and fix silent catch in WorksheetGenerator"
```

---

## Task 10: Update `SchemeOfWorkGenerator`

**Files:**
- Modify: `src/components/teacher/generate/SchemeOfWorkGenerator.jsx`

Output state variable is `scheme`. Output section is `<section className="studio-card p-5 min-h-[400px]">`.

- [ ] **Step 1: Add import**

```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the output section**

```jsx
<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {/* existing content unchanged */}
  </section>
</StudioOutputBoundary>
```

- [ ] **Step 3: Fix silent catch**

```js
.catch((err) => console.error('[library attach]', err))
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/generate/SchemeOfWorkGenerator.jsx
git commit -m "feat: add StudioOutputBoundary and fix silent catch in SchemeOfWorkGenerator"
```

---

## Task 11: Update `RubricGenerator`

**Files:**
- Modify: `src/components/teacher/generate/RubricGenerator.jsx`

Output state variable is `rubric`. Output section is `<section className="studio-card p-5 min-h-[400px]">`.

- [ ] **Step 1: Add import**

```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the output section**

```jsx
<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {/* existing content unchanged */}
  </section>
</StudioOutputBoundary>
```

- [ ] **Step 3: Fix silent catch**

```js
.catch((err) => console.error('[library attach]', err))
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/generate/RubricGenerator.jsx
git commit -m "feat: add StudioOutputBoundary and fix silent catch in RubricGenerator"
```

---

## Task 12: Update `LessonPlanGenerator`

**Files:**
- Modify: `src/components/teacher/generate/LessonPlanGenerator.jsx`

Output state variable is `lessonPlan`. Output section is `<section className="studio-card p-5 min-h-[400px]">` (comment `{/* ── Output panel ────────────────────────────────────── */}` immediately above it).

- [ ] **Step 1: Add import**

```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the output section**

Find the comment `{/* ── Output panel ... */}` and the `<section>` after it:
```jsx
<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {/* existing content unchanged */}
  </section>
</StudioOutputBoundary>
```

- [ ] **Step 3: Fix silent catch**

```js
.catch((err) => console.error('[library attach]', err))
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/generate/LessonPlanGenerator.jsx
git commit -m "feat: add StudioOutputBoundary and fix silent catch in LessonPlanGenerator"
```

---

## Task 13: Update `AssessmentGenerator`

**Files:**
- Modify: `src/components/teacher/generate/AssessmentGenerator.jsx`

Output state variable is `assessment`. Output section is `<section className="studio-card p-5 min-h-[400px]">`.

- [ ] **Step 1: Add import**

```jsx
import StudioOutputBoundary from '../StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the output section**

```jsx
<StudioOutputBoundary onRetry={() => setStatus('idle')}>
  <section className="studio-card p-5 min-h-[400px]">
    {/* existing content unchanged */}
  </section>
</StudioOutputBoundary>
```

- [ ] **Step 3: Fix silent catch**

```js
.catch((err) => console.error('[library attach]', err))
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/generate/AssessmentGenerator.jsx
git commit -m "feat: add StudioOutputBoundary and fix silent catch in AssessmentGenerator"
```

---

## Task 14: Update `AssessmentStudio` — preview and marking-key views

**Files:**
- Modify: `src/components/teacher/AssessmentStudio.jsx`

`AssessmentStudio` is a multi-view editor (`view` state: `'home' | 'builder' | 'preview' | 'marking-key'`). The two output views — `preview` and `marking-key` — render `<PaperRenderView>` with computed `blocks` arrays. A crash in either view should fall back to `'builder'` view so the teacher's work is never lost.

There is no `attachLibraryToGeneration` call in this file — skip the catch fix.

- [ ] **Step 1: Add `StudioOutputBoundary` import**

Add at the top of the existing import block (after other local imports):
```jsx
import StudioOutputBoundary from './StudioOutputBoundary'
```

- [ ] **Step 2: Wrap the `preview` view**

Find (around line 1334):
```jsx
{view === 'preview' && (
  <PaperRenderView
    mode="paper"
    blocks={paperBlocks}
    assessment={assessmentDoc}
    changeView={changeView}
    onExport={(kind) => handleExport(kind, 'paper')}
    onSave={handleSave}
    saving={saving}
    exporting={exporting}
    showSave
  />
)}
```

Replace with:
```jsx
{view === 'preview' && (
  <StudioOutputBoundary onRetry={() => setView('builder')}>
    <PaperRenderView
      mode="paper"
      blocks={paperBlocks}
      assessment={assessmentDoc}
      changeView={changeView}
      onExport={(kind) => handleExport(kind, 'paper')}
      onSave={handleSave}
      saving={saving}
      exporting={exporting}
      showSave
    />
  </StudioOutputBoundary>
)}
```

- [ ] **Step 3: Wrap the `marking-key` view**

Find (around line 1348):
```jsx
{view === 'marking-key' && (
  <PaperRenderView
    mode="scheme"
    blocks={markingKeyBlocks}
    assessment={assessmentDoc}
    changeView={changeView}
    onExport={(kind) => handleExport(kind, 'scheme')}
    onSave={handleSave}
    saving={saving}
    exporting={exporting}
  />
)}
```

Replace with:
```jsx
{view === 'marking-key' && (
  <StudioOutputBoundary onRetry={() => setView('builder')}>
    <PaperRenderView
      mode="scheme"
      blocks={markingKeyBlocks}
      assessment={assessmentDoc}
      changeView={changeView}
      onExport={(kind) => handleExport(kind, 'scheme')}
      onSave={handleSave}
      saving={saving}
      exporting={exporting}
    />
  </StudioOutputBoundary>
)}
```

- [ ] **Step 4: Commit**

```bash
git add src/components/teacher/AssessmentStudio.jsx
git commit -m "feat: wrap AssessmentStudio preview and marking-key views in StudioOutputBoundary"
```

---

## Task 15: Update `LessonPlanStudio` — wrap outer shell

**Files:**
- Modify: `src/components/teacher/generate/LessonPlanStudio.jsx`

`LessonPlanStudio` is bridge-driven (generation happens via `window.__studioCallClaude`). It has no `status` state — so `onRetry` is not applicable. Wrap the outer return in the existing `ErrorBoundary` directly (not `StudioOutputBoundary`) with `inline` mode so a React render crash doesn't escape to the root boundary.

- [ ] **Step 1: Add `ErrorBoundary` import**

Add to the existing import block:
```jsx
import ErrorBoundary from '../../../components/ui/ErrorBoundary'
```

Note: `LessonPlanStudio` is at `src/components/teacher/generate/`, so the relative path to `ui/ErrorBoundary` is `../../ui/ErrorBoundary`:
```jsx
import ErrorBoundary from '../../ui/ErrorBoundary'
```

- [ ] **Step 2: Wrap the return JSX**

Find:
```jsx
return (
  <>
    <SeoHelmet title="Lesson plan studio" noIndex />
    {/* ... rest of the JSX */}
  </>
)
```

Replace with:
```jsx
return (
  <ErrorBoundary inline>
    <SeoHelmet title="Lesson plan studio" noIndex />
    {/* ... rest of the JSX unchanged */}
  </ErrorBoundary>
)
```

- [ ] **Step 3: Commit**

```bash
git add src/components/teacher/generate/LessonPlanStudio.jsx
git commit -m "feat: wrap LessonPlanStudio outer shell in ErrorBoundary"
```

---

## Task 16: Final lint and build verification

- [ ] **Step 1: Run lint**

```bash
npm run lint
```

Expected: 0 errors. If warnings appear about `console.error`, those are expected — they are the intentional replacements from Tasks 3–13.

- [ ] **Step 2: Run build**

```bash
npm run build
```

Expected: build completes with no errors. Bundle warnings about chunk size are pre-existing and not introduced by this change.

- [ ] **Step 3: Manual smoke test** (open `http://localhost:5173` after `npm run dev`)

1. Navigate to any teacher studio (e.g. `/teacher/quiz-studio`)
2. Open browser DevTools → Console
3. Confirm no new errors on page load
4. Navigate between teacher pages — confirm the layout (sidebar, topbar) is always visible

- [ ] **Step 4: Commit any lint fixes, then push branch**

```bash
git push -u origin HEAD
```
