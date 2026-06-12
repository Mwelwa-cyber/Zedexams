# Notes Reading Foundation (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the learner note reader handle long, comprehensive study notes — add a table-of-contents / jump navigation derived from heading blocks, active-section tracking, a back-to-top control, and raise the study-note block cap (with a size guard) so book-length notes can be stored safely.

**Architecture:** Pure helpers (`lib/toc.js`, size helpers in `lib/studyBlocks.js`) derive the TOC and measure note size — unit-tested with plain `node`. View components (`NoteToc`, `BackToTop`) + a DOM hook (`useActiveSection`) render navigation and are verified via the preview tooling. Section anchors are injected by `StudyNoteReader` using ids that exactly match the TOC. The block cap is raised in lockstep across the Zod schema, the Firestore rule, and a rules-text guard.

**Tech Stack:** React 18, Vite, Tailwind (inline classes, notes-studio palette), Zod, Firebase Firestore, plain-`node` test scripts. This is Phase 1 of the spec at `docs/superpowers/specs/2026-06-07-notes-smart-book-notes-design.md`.

---

## File structure

**Create**
- `src/features/notes/lib/toc.js` — pure: `sectionAnchorId(key)`, `buildToc(blocks)`.
- `src/features/notes/hooks/useActiveSection.js` — IntersectionObserver hook → active section key.
- `src/features/notes/components/NoteToc.jsx` — TOC UI: xl left-gutter rail + floating "Contents" pill + slide-over drawer.
- `src/features/notes/components/BackToTop.jsx` — floating scroll-to-top button.
- `scripts/test-notes-toc.mjs` — unit tests for `buildToc` + `sectionAnchorId`.

**Modify**
- `src/features/notes/lib/studyBlocks.js` — add `STUDY_BLOCKS_MAX_BYTES`, `studyBlocksByteSize()`, `isStudyBlocksOverSize()`.
- `src/features/notes/lib/studySchema.js` — `MAX_STUDY_BLOCKS` 200 → 600.
- `firestore.rules` — `validLessonFields()` blocks bound 200 → 600.
- `scripts/test-firestore-rules-text.mjs` — assert the new 600 blocks bound.
- `scripts/test-study-blocks.mjs` — add size-helper tests.
- `src/features/notes/components/StudyNoteReader.jsx` — accept `anchorByIndex`, put ids on heading blocks.
- `src/features/notes/pages/AdminNoteEditor.jsx` — size guard in `performSave`.
- `src/features/notes/pages/LearnerNoteRead.jsx` — compute TOC, render `NoteToc` + `BackToTop`, pass `anchorByIndex`.
- `package.json` — add `test:notes-toc` and append to `test:all`.

---

## Task 1: TOC derivation library

**Files:**
- Create: `src/features/notes/lib/toc.js`
- Create: `scripts/test-notes-toc.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test**

Create `scripts/test-notes-toc.mjs`:

```js
#!/usr/bin/env node
/**
 * Tests for the study-note table-of-contents derivation.
 * Run: npm run test:notes-toc  (also via npm run test:all)
 */

const { buildToc, sectionAnchorId } = await import('../src/features/notes/lib/toc.js')

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, err }); console.log(`  XX  ${name} — ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

console.log('\nnotes TOC — buildToc + sectionAnchorId')

test('buildToc returns [] for non-array / empty / heading-less input', () => {
  assert(buildToc(null).length === 0, 'null → []')
  assert(buildToc(undefined).length === 0, 'undefined → []')
  assert(buildToc([]).length === 0, 'empty → []')
  assert(buildToc([{ type: 'paragraph', text: 'x' }]).length === 0, 'no headings → []')
})

test('buildToc extracts headings in order with key/id/text/level/index', () => {
  const blocks = [
    { id: 'a1', type: 'heading', level: 2, text: 'Cells' },
    { type: 'paragraph', text: 'body' },
    { id: 'b2', type: 'heading', level: 3, text: 'Sub' },
  ]
  const toc = buildToc(blocks)
  assert(toc.length === 2, `expected 2 entries, got ${toc.length}`)
  assert(toc[0].key === 'a1' && toc[0].level === 2 && toc[0].text === 'Cells' && toc[0].index === 0, 'entry 0 wrong')
  assert(toc[0].id === sectionAnchorId('a1'), 'entry 0 id must come from sectionAnchorId')
  assert(toc[1].key === 'b2' && toc[1].level === 3 && toc[1].index === 2, 'entry 1 wrong')
})

test('buildToc strips inline markdown from heading text', () => {
  const toc = buildToc([{ id: 'h', type: 'heading', level: 2, text: '**Photosynthesis**' }])
  assert(toc[0].text === 'Photosynthesis', `expected stripped text, got "${toc[0].text}"`)
})

test('buildToc skips empty / whitespace headings', () => {
  const toc = buildToc([
    { id: 'h1', type: 'heading', level: 2, text: '   ' },
    { id: 'h2', type: 'heading', level: 2, text: 'Real' },
  ])
  assert(toc.length === 1 && toc[0].text === 'Real', 'empty heading should be skipped')
})

test('buildToc produces unique keys when ids are missing or duplicated', () => {
  const toc = buildToc([
    { type: 'heading', level: 2, text: 'One' },        // no id → idx-0
    { type: 'heading', level: 2, text: 'Two' },        // no id → idx-1
    { id: 'dup', type: 'heading', level: 3, text: 'A' },
    { id: 'dup', type: 'heading', level: 3, text: 'B' },// duplicate id → de-duped
  ])
  const keys = toc.map(e => e.key)
  assert(new Set(keys).size === keys.length, `keys must be unique: ${keys.join(', ')}`)
  assert(keys[0] === 'idx-0' && keys[1] === 'idx-1', 'missing-id headings should key by index')
})

test('sectionAnchorId is deterministic and prefixed', () => {
  assert(sectionAnchorId('idx-0') === 'note-sec-idx-0', 'unexpected anchor id')
})

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) {
  for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`)
  process.exit(1)
}
```

- [ ] **Step 2: Add the npm script so the test can run**

In `package.json`, in the `scripts` block, add this line next to the other notes tests (e.g. after `"test:study-blocks": ...`):

```json
    "test:notes-toc": "node scripts/test-notes-toc.mjs",
```

And append it to the end of the `test:all` chain (after the last `&& npm run ...`):

```
 && npm run test:notes-toc
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:notes-toc`
Expected: FAIL — `Cannot find module '.../src/features/notes/lib/toc.js'`.

- [ ] **Step 4: Write minimal implementation**

Create `src/features/notes/lib/toc.js`:

```js
// src/features/notes/lib/toc.js
//
// Pure helpers to derive a table-of-contents from a study note's blocks[].
// Sections come from `heading` blocks (level 2 = section, level 3 = sub-section).
// No React, no DOM — unit-tested and shared by the reader + the TOC UI so the
// anchor ids the reader renders always match the ids the TOC links to.

import { stripMd } from './studyBlocks'

/** Stable DOM id for a section anchor, derived from its TOC key. */
export function sectionAnchorId(key) {
  return `note-sec-${key}`
}

/**
 * Build a flat TOC from study blocks. Returns
 *   [{ key, id, text, level, index }]
 * in document order — one entry per non-empty `heading` block.
 *   • key   — unique + stable: the block id when present, else `idx-<i>`.
 *   • id    — sectionAnchorId(key); the DOM id the reader puts on the heading.
 *   • level — 2 (section) or 3 (sub-section).
 *   • index — the heading's index in the blocks array (lets the reader map
 *             block index → anchor id without re-deriving uniqueness).
 * Returns [] when there are no headings.
 */
export function buildToc(blocks) {
  if (!Array.isArray(blocks)) return []
  const out = []
  const seen = new Set()
  blocks.forEach((b, i) => {
    if (!b || b.type !== 'heading') return
    const text = stripMd(String(b.text || '')).trim()
    if (!text) return
    let key = b.id != null && b.id !== '' ? String(b.id) : `idx-${i}`
    if (seen.has(key)) key = `${key}-${i}` // guarantee uniqueness on duplicate ids
    seen.add(key)
    const level = b.level === 2 ? 2 : 3
    out.push({ key, id: sectionAnchorId(key), text, level, index: i })
  })
  return out
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:notes-toc`
Expected: PASS — all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/features/notes/lib/toc.js scripts/test-notes-toc.mjs package.json
git commit -m "feat(notes): TOC derivation from study-note headings"
```

---

## Task 2: Study-note size helpers

**Files:**
- Modify: `src/features/notes/lib/studyBlocks.js`
- Modify: `scripts/test-study-blocks.mjs`

- [ ] **Step 1: Write the failing test**

In `scripts/test-study-blocks.mjs`, add `studyBlocksByteSize, isStudyBlocksOverSize, STUDY_BLOCKS_MAX_BYTES` to the existing import from `studyBlocks.js` so the top destructure reads:

```js
const {
  blankStudyBlocks, newStudyBlock, STUDY_BLOCK_TYPES,
  buildStudyExcerpt, studyReadingTime, studySpeechText,
  studyBlocksByteSize, isStudyBlocksOverSize, STUDY_BLOCKS_MAX_BYTES,
} = await import('../src/features/notes/lib/studyBlocks.js')
```

Then add these tests just before the final `console.log(...)` summary line:

```js
test('studyBlocksByteSize grows with content and is > 0', () => {
  const empty = studyBlocksByteSize([])
  const some  = studyBlocksByteSize(blankStudyBlocks())
  assert(empty >= 0 && some > empty, `expected size to grow: empty=${empty} some=${some}`)
})

test('isStudyBlocksOverSize is false for small notes, true past the cap', () => {
  assert(isStudyBlocksOverSize(blankStudyBlocks()) === false, 'a blank note must not be over size')
  const huge = [{ id: 'big', type: 'paragraph', text: 'x'.repeat(STUDY_BLOCKS_MAX_BYTES + 1000) }]
  assert(isStudyBlocksOverSize(huge) === true, 'a note past the byte cap must be flagged')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:study-blocks`
Expected: FAIL — `studyBlocksByteSize is not a function` (and the new asserts error).

- [ ] **Step 3: Write minimal implementation**

In `src/features/notes/lib/studyBlocks.js`, add this block at the end of the file (after `studySpeechText`):

```js
// ─── size guard ───────────────────────────────────────────────────────

// Keep a study note safely under Firestore's ~1 MB per-document limit. The
// importer (Phase 2) and the admin editor both check this before writing so a
// book-length note fails with a friendly message instead of an opaque
// "document too large" Firestore error.
export const STUDY_BLOCKS_MAX_BYTES = 700 * 1024 // ~700 KB, margin under 1 MB

/** UTF-8 byte length of the serialized blocks. */
export function studyBlocksByteSize(blocks) {
  const json = JSON.stringify(blocks || [])
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(json).length
  return json.length
}

/** True when the blocks would serialize past the safe size cap. */
export function isStudyBlocksOverSize(blocks) {
  return studyBlocksByteSize(blocks) > STUDY_BLOCKS_MAX_BYTES
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:study-blocks`
Expected: PASS — existing tests plus the 2 new size tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/notes/lib/studyBlocks.js scripts/test-study-blocks.mjs
git commit -m "feat(notes): study-note serialized-size helpers"
```

---

## Task 3: Raise the block cap (schema + rule + rules-text guard)

**Files:**
- Modify: `src/features/notes/lib/studySchema.js:17`
- Modify: `firestore.rules:154`
- Modify: `scripts/test-firestore-rules-text.mjs`

- [ ] **Step 1: Write the failing rules-text guard**

In `scripts/test-firestore-rules-text.mjs`, find the section that reads the rules file into a `rules` string (used by the existing `test(...)` calls). Add this test alongside the other `test(...)` blocks:

```js
test('lessons rule allows up to 600 study blocks (book-length notes)', () => {
  assert(
    rules.includes('incoming().blocks.size() <= 600'),
    'lessons blocks cap is not 600 — study notes longer than the cap will be rejected by rules',
  )
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:rules-text`
Expected: FAIL — the rule still says `<= 200`, so the assertion fails.

- [ ] **Step 3: Raise the cap in the Zod schema**

In `src/features/notes/lib/studySchema.js`, change line 17:

```js
export const MAX_STUDY_BLOCKS = 600
```

- [ ] **Step 4: Raise the cap in the Firestore rule**

In `firestore.rules`, in `validLessonFields()`, change the blocks bound (currently line 154):

```
        && (!('blocks' in incoming()) || incoming().blocks == null || (incoming().blocks is list && incoming().blocks.size() <= 600))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:rules-text` then `npm run test:study-blocks`
Expected: PASS for both.

- [ ] **Step 6: Commit**

```bash
git add src/features/notes/lib/studySchema.js firestore.rules scripts/test-firestore-rules-text.mjs
git commit -m "feat(notes): raise study-note block cap to 600 (schema + rule)"
```

> Deploy note: `firestore.rules` ships via CI (`deploy-firebase.yml`) on merge to main — never hand-deployed. No long notes exist yet in Phase 1, so there is no ordering risk between the rule deploy and the app deploy.

---

## Task 4: Size guard in the admin save path

**Files:**
- Modify: `src/features/notes/pages/AdminNoteEditor.jsx`

- [ ] **Step 1: Add the import**

In `src/features/notes/pages/AdminNoteEditor.jsx`, find the import of study helpers (it already imports `buildStudyExcerpt` from `../lib/studyBlocks`). Add `isStudyBlocksOverSize` to that import. If `buildStudyExcerpt` is imported from `../lib/studyBlocks`, make it:

```js
import { buildStudyExcerpt, isStudyBlocksOverSize } from '../lib/studyBlocks'
```

(If `buildStudyExcerpt` is currently imported from a different specifier, add a new import line: `import { isStudyBlocksOverSize } from '../lib/studyBlocks'`.)

- [ ] **Step 2: Guard the write in `performSave`**

In `performSave`, immediately after the `const payload = { ... }` object is built (right after the line `assetBatchId: batchId,` closes the object with `}`), insert:

```js
      // Block a write that would exceed Firestore's per-document limit. The
      // helper measures the same coerced blocks we're about to save.
      if (noteFormat === NOTE_FORMAT.STUDY && isStudyBlocksOverSize(payload.blocks)) {
        setSaveError(new Error('This note is too large to save (over ~700 KB). Split it into more than one note or shorten the content.'))
        setSaveState('error')
        return
      }
```

- [ ] **Step 3: Verify it compiles and lints**

Run: `npm run lint`
Expected: PASS (no new lint errors in `AdminNoteEditor.jsx`).

- [ ] **Step 4: Commit**

```bash
git add src/features/notes/pages/AdminNoteEditor.jsx
git commit -m "feat(notes): block oversized study-note saves with a friendly error"
```

---

## Task 5: Section anchors in the reader

**Files:**
- Modify: `src/features/notes/components/StudyNoteReader.jsx`

- [ ] **Step 1: Accept an `anchorId` on the `Block` heading case**

In `src/features/notes/components/StudyNoteReader.jsx`, change the `Block` function signature from `function Block({ block }) {` to:

```js
function Block({ block, anchorId }) {
```

Then replace the `case 'heading':` return with one that adds the id + `scroll-mt-24` (so a jumped-to heading clears the sticky `ReaderControls` bar):

```js
    case 'heading':
      return block.level === 2
        ? <h2 id={anchorId} className="font-display text-2xl sm:text-3xl text-neutral-900 mt-4 scroll-mt-24"><Inline text={block.text} /></h2>
        : <h3 id={anchorId} className="font-display text-xl sm:text-2xl text-neutral-900 mt-2 scroll-mt-24"><Inline text={block.text} /></h3>
```

- [ ] **Step 2: Pass `anchorByIndex` through `StudyNoteReader`**

Change the `StudyNoteReader` signature and the `.map` so each heading gets its id from a `Map` of `index → id`:

```js
export function StudyNoteReader({ blocks, anchorByIndex }) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return <p className="text-sm text-neutral-500">This note has no content yet.</p>
  }
  return (
    <div className="study-note space-y-5">
      {blocks.map((block, i) => <Block key={block.id || i} block={block} anchorId={anchorByIndex?.get(i)} />)}
    </div>
  )
}
```

(`anchorByIndex` is optional — the admin editor's live preview renders without it, so headings simply get no id there, which is fine.)

- [ ] **Step 3: Verify it builds and lints**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/features/notes/components/StudyNoteReader.jsx
git commit -m "feat(notes): render stable section anchors on study-note headings"
```

---

## Task 6: Active-section hook

**Files:**
- Create: `src/features/notes/hooks/useActiveSection.js`

- [ ] **Step 1: Write the hook**

Create `src/features/notes/hooks/useActiveSection.js`:

```js
// src/features/notes/hooks/useActiveSection.js
//
// Tracks which section heading is currently in view, for TOC highlighting.
// Pass the memoized TOC entries ([{ key, id }]); returns the active section
// `key` (or null). Uses IntersectionObserver and no-ops safely when there are
// no sections or the DOM isn't ready.

import { useEffect, useState } from 'react'

export function useActiveSection(toc) {
  const [activeKey, setActiveKey] = useState(null)

  useEffect(() => {
    if (!Array.isArray(toc) || toc.length === 0) return
    if (typeof IntersectionObserver === 'undefined') return

    const els = toc.map(e => document.getElementById(e.id)).filter(Boolean)
    if (els.length === 0) return

    const keyById = new Map(toc.map(e => [e.id, e.key]))
    const visible = new Set()

    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) visible.add(en.target.id)
          else visible.delete(en.target.id)
        }
        // The active section is the top-most heading currently in the band.
        const top = els.find(el => visible.has(el.id))
        if (top) setActiveKey(keyById.get(top.id))
      },
      // Band sits just under the sticky controls; -65% bottom margin means a
      // heading is "active" once it reaches the upper third of the viewport.
      { rootMargin: '-72px 0px -65% 0px', threshold: [0, 1] },
    )

    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [toc])

  return activeKey
}
```

- [ ] **Step 2: Verify it builds and lints**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/notes/hooks/useActiveSection.js
git commit -m "feat(notes): useActiveSection hook for TOC highlighting"
```

---

## Task 7: TOC UI component

**Files:**
- Create: `src/features/notes/components/NoteToc.jsx`

- [ ] **Step 1: Write the component**

Create `src/features/notes/components/NoteToc.jsx`:

```jsx
// src/features/notes/components/NoteToc.jsx
//
// Table-of-contents navigation for a long study note. Three surfaces, one
// data source:
//   • xl screens  → a fixed rail in the left gutter ("On this page")
//   • < xl        → a floating "Contents" pill that opens a slide-over drawer
// Active section is highlighted (driven by useActiveSection). Hidden entirely
// for notes with fewer than 2 sections. Pure presentational + local open state.

import { useState } from 'react'
import { List, X } from '../../../components/ui/icons'

function jumpTo(id, after) {
  const el = typeof document !== 'undefined' ? document.getElementById(id) : null
  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  after?.()
}

function TocList({ toc, activeKey, onJump }) {
  return (
    <nav aria-label="Contents" className="space-y-0.5">
      {toc.map(e => (
        <button
          key={e.key}
          type="button"
          onClick={() => onJump(e.id)}
          className={`block w-full text-left rounded-lg px-3 py-1.5 transition ${
            e.level === 3 ? 'pl-6 text-[13px]' : 'text-sm font-semibold'
          } ${
            activeKey === e.key
              ? 'bg-[#0F1B2D] text-white'
              : 'text-[#4A5A6E] hover:bg-white hover:text-[#0F1B2D]'
          }`}
        >
          {e.text}
        </button>
      ))}
    </nav>
  )
}

export function NoteToc({ toc, activeKey }) {
  const [open, setOpen] = useState(false)
  if (!Array.isArray(toc) || toc.length < 2) return null

  const onJump = (id) => jumpTo(id, () => setOpen(false))

  return (
    <>
      {/* xl: fixed rail in the left gutter (only where the centered article leaves room) */}
      <aside className="hidden xl:block fixed top-28 left-[max(1rem,calc(50%-37rem))] w-56 max-h-[70vh] overflow-auto">
        <div className="notes-card p-3">
          <div className="text-[10.5px] font-extrabold tracking-[0.16em] uppercase text-[#053541] mb-2 px-2">On this page</div>
          <TocList toc={toc} activeKey={activeKey} onJump={onJump} />
        </div>
      </aside>

      {/* < xl: floating Contents pill */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open contents"
        className="xl:hidden fixed bottom-5 right-4 z-30 notes-chip notes-chip-shadow inline-flex items-center gap-1.5 rounded-full px-4 py-2.5 bg-[#0F1B2D] text-white text-sm font-semibold"
      >
        <List size={15} /> Contents
      </button>

      {/* < xl: slide-over drawer */}
      {open && (
        <div className="xl:hidden fixed inset-0 z-40" role="dialog" aria-modal="true" aria-label="Contents">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-[82%] max-w-xs bg-[#F5EFE1] border-l-2 border-[#0F1B2D] p-4 overflow-auto">
            <div className="flex items-center justify-between mb-3">
              <span className="font-display text-xl text-[#0F1B2D]">Contents</span>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close contents" className="w-8 h-8 grid place-items-center rounded-lg border-2 border-[#0F1B2D] bg-white">
                <X size={15} />
              </button>
            </div>
            <TocList toc={toc} activeKey={activeKey} onJump={onJump} />
          </div>
        </div>
      )}
    </>
  )
}

export default NoteToc
```

- [ ] **Step 2: Verify it builds and lints**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/notes/components/NoteToc.jsx
git commit -m "feat(notes): TOC rail + drawer navigation component"
```

---

## Task 8: Back-to-top button

**Files:**
- Create: `src/features/notes/components/BackToTop.jsx`

- [ ] **Step 1: Write the component**

Create `src/features/notes/components/BackToTop.jsx`:

```jsx
// src/features/notes/components/BackToTop.jsx
//
// Floating "scroll to top" control for long notes. Appears once the learner
// has scrolled past ~600px. Sits above the Contents pill on small screens.

import { useEffect, useState } from 'react'
import { ChevronUp } from '../../../components/ui/icons'

export function BackToTop() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    const onScroll = () => setShow((window.scrollY || 0) > 600)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  if (!show) return null

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      aria-label="Back to top"
      className="fixed bottom-20 right-4 xl:bottom-5 z-30 w-11 h-11 grid place-items-center rounded-full border-2 border-[#0F1B2D] bg-white text-[#0F1B2D] notes-chip-shadow hover:-translate-y-px transition"
    >
      <ChevronUp size={18} />
    </button>
  )
}

export default BackToTop
```

- [ ] **Step 2: Verify it builds and lints**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/features/notes/components/BackToTop.jsx
git commit -m "feat(notes): back-to-top control for long notes"
```

---

## Task 9: Wire navigation into the learner reader

**Files:**
- Modify: `src/features/notes/pages/LearnerNoteRead.jsx`

- [ ] **Step 1: Add imports**

In `src/features/notes/pages/LearnerNoteRead.jsx`, add `useMemo` to the React import and add the new modules. At the top of the existing imports, ensure these lines exist:

```js
import { useMemo } from 'react'
import { buildToc } from '../lib/toc'
import { useActiveSection } from '../hooks/useActiveSection'
import { NoteToc } from '../components/NoteToc'
import { BackToTop } from '../components/BackToTop'
```

(`useNavigate`, `useParams`, `Navigate`, `useSearchParams` are already imported from `react-router-dom`; keep them. `coerceStudyBlocks` and `NOTE_FORMAT` are already imported.)

- [ ] **Step 2: Compute the TOC + anchors as hooks BEFORE the early returns**

In the `LearnerNoteRead` component body, directly after the existing `useRecordNoteProgress(...)` call (and before the `if (loading)` early return), add:

```js
  // Derived study data + TOC. Computed as hooks (unconditionally, before the
  // early returns) so hook order is stable. Safe when `note` is null/loading.
  const studyData = useMemo(
    () => (note?.noteFormat === NOTE_FORMAT.STUDY ? coerceStudyBlocks(note.blocks) : null),
    [note],
  )
  const toc = useMemo(() => buildToc(studyData || []), [studyData])
  const anchorByIndex = useMemo(() => new Map(toc.map(e => [e.index, e.id])), [toc])
  const activeKey = useActiveSection(toc)
```

- [ ] **Step 3: Use the memoized study data and pass anchors to the reader**

Find the line (after the early returns) that reads:

```js
  const studyBlocks = note.noteFormat === NOTE_FORMAT.STUDY ? coerceStudyBlocks(note.blocks) : null
```

Replace it with (reusing the memo computed above):

```js
  const studyBlocks = studyData
```

Then, in the render branch for the study format, pass `anchorByIndex` to `StudyNoteReader`:

```js
            ) : note.noteFormat === NOTE_FORMAT.STUDY ? (
            <>
              <ReaderControls blocks={studyBlocks} title={note.title} />
              <StudyNoteReader blocks={studyBlocks} anchorByIndex={anchorByIndex} />
            </>
          ) : (
```

- [ ] **Step 4: Render the TOC + back-to-top**

Inside the `<main>` for the loaded note, after the closing `</article>` tag (and before `</main>`), add:

```jsx
        {note.noteFormat === NOTE_FORMAT.STUDY && (
          <>
            <NoteToc toc={toc} activeKey={activeKey} />
            <BackToTop />
          </>
        )}
```

- [ ] **Step 5: Verify it builds and lints**

Run: `npm run lint && npm run build`
Expected: PASS — clean build, no React-hooks lint warnings about conditional hooks.

- [ ] **Step 6: Commit**

```bash
git add src/features/notes/pages/LearnerNoteRead.jsx
git commit -m "feat(notes): wire TOC, active-section + back-to-top into the note reader"
```

---

## Task 10: Verification (tests + build + preview)

**Files:** none (verification only)

- [ ] **Step 1: Run the affected tests**

Run: `npm run test:notes-toc && npm run test:study-blocks && npm run test:rules-text`
Expected: PASS for all three.

- [ ] **Step 2: Run lint + production build**

Run: `npm run lint && npm run build`
Expected: PASS — no errors.

- [ ] **Step 3: Preview-verify the reader UI**

Start the dev server (preview_start) and open a `study` note that has at least two `heading` blocks (e.g. one of the seeded Grade-7 notes at `/notes/<id>`). Verify with the preview tools:
- A "Contents" pill is visible bottom-right (below xl) and a left-gutter rail appears at xl width (use preview_resize to 1440+).
- Tapping a TOC entry smooth-scrolls to that heading and the heading clears the sticky progress bar (not hidden under it).
- The active entry highlights as you scroll (preview_eval `window.scrollTo` to a section, then preview_snapshot).
- "Back to top" appears after scrolling down and returns to the top.
- Open a note with **0–1** headings (or a `rich_text`/`file` note) and confirm **no** Contents pill / rail renders.

Capture a `preview_screenshot` at mobile (375) and desktop (1440) widths as proof.

- [ ] **Step 4: Commit (only if preview surfaced fixes)**

If the preview pass required code changes, commit them:

```bash
git add -A
git commit -m "fix(notes): reading-foundation preview fixes"
```

---

## Task 11: Open the PR

**Files:** none

- [ ] **Step 1: Push the branch**

```bash
git push -u origin claude/magical-bhabha-1b73f9
```

- [ ] **Step 2: Open the PR** (per CLAUDE.md deploy flow)

```bash
gh pr create -R Mwelwa-cyber/Zedexams --title "Notes upgrade (phase 1b): long-note reading foundation — TOC nav + size guard" --body "Phase 1 of the Full Book Notes + Smart Reading spec (docs/superpowers/specs/2026-06-07-notes-smart-book-notes-design.md).

- Table-of-contents nav for long study notes: xl left-gutter rail + Contents drawer + active-section highlighting
- Stable section anchors on headings (smooth jump, clears the sticky bar)
- Back-to-top control
- Raised study-note block cap 200 -> 600 (Zod schema + Firestore rule, with a rules-text guard) and a ~700 KB serialized-size guard on save

Tests: test:notes-toc, test:study-blocks (size helpers), test:rules-text (cap guard). Lint + build clean. Reader UI verified in preview at 375 + 1440.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

- [ ] **Step 3: Self-merge with auto** (only after the user confirms they want it merged)

```bash
gh pr merge <num> --auto --squash --delete-branch -R Mwelwa-cyber/Zedexams
```

---

## Self-review notes

- **Spec coverage (Phase 1 rows):** TOC + jump nav → Tasks 1, 5, 6, 7, 9. Active-section tracking → Tasks 6, 9. Stable anchors / deep-link targets → Tasks 1, 5. Raised block cap + size guard → Tasks 2, 3, 4. Long-content polish (back-to-top, scroll-margin) → Tasks 5, 8. Tests → Tasks 1, 2, 3, 10.
- **Type/name consistency:** `buildToc` entries `{ key, id, text, level, index }` are produced in Task 1 and consumed unchanged in Tasks 5 (`anchorByIndex` from `index`/`id`), 6 (`id`/`key`), 7 (`key`/`id`/`text`/`level`), 9. `sectionAnchorId` defines ids in Task 1; the reader renders the same ids via `anchorByIndex` (Task 5) — no second derivation, so no drift. `isStudyBlocksOverSize`/`STUDY_BLOCKS_MAX_BYTES` defined in Task 2, used in Task 4 and tested in Task 2. `MAX_STUDY_BLOCKS = 600` (Task 3) matches the Firestore `<= 600` bound (Task 3) and the rules-text guard (Task 3).
- **No placeholders:** every code/step shows the exact content; no TBD/TODO.
