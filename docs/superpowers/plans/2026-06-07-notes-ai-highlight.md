# Notes AI Auto-Highlight (Phase 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin generate AI auto-highlights for a study note (the key sentences/terms per block), cached in `noteSmart/{noteId}`, which the learner reader renders as `<mark>` highlights with a learner toggle (ON by default).

**Architecture:** Mirror the existing `noteInsights` pattern: a staff-only `generateNoteSmart` Cloud Function (Anthropic) reads the note's blocks, extracts the important verbatim excerpts per block, and writes `noteSmart/{noteId}` (server-only write, learner read — same Firestore rule shape as `noteInsights`). The reader fetches that doc and a pure, unit-tested matcher wraps matching sentences/items in `<mark class="note-hl">`, composing with the existing `**bold**`/`*italic*` inline renderer. A toggle in `ReaderControls` (localStorage, default ON) shows/hides highlights.

**Tech Stack:** Firebase Cloud Functions (Node 22, `onCall`, admin SDK), Anthropic `aiService.callAnthropic`, React 18, Vite, Firestore, plain-`node` tests. Phase 3 of `docs/superpowers/specs/2026-06-07-notes-smart-book-notes-design.md`.

**Decisions (brainstorming):** single uniform highlight style (not color-coded by kind); generation is **admin-triggered** (a button in the editor), not lazy-on-first-view; highlights ON by default.

> **Pre-flight:** `main` has had major dependency upgrades (React 19 / pdfjs 6 / firebase 12 / Capacitor 8). Run `npm install` (root) + `cd functions && npm install && cd ..` before building/testing. This branch is off `main` and does NOT include Phase 2 (#837) — that's intended; Phase 3 only depends on Phase 1 (the reader, already on `main`).

---

## File structure

**Create**
- `functions/noteSmartPrompt.js` — `buildHighlightMessages({blocks})` + `parseHighlights(raw)`. Pure.
- `functions/noteSmart.js` — `runGenerateNoteSmart({noteId, db, apiKey})` (reads note, calls Claude, writes `noteSmart`).
- `functions/noteSmart.test.js` — tests for the prompt + parser.
- `src/features/notes/lib/highlight.js` — pure `mdInlineHighlighted` / `splitSentences` / `isHighlighted`.
- `src/features/notes/lib/highlight.test.js` — matcher tests.
- `src/features/notes/lib/smart.js` — client `fetchNoteSmart(noteId)` + `generateNoteSmart(noteId)`.

**Modify**
- `functions/index.js` — `generateNoteSmart` callable (mirror `generateNoteInsights`).
- `firestore.rules` — `noteSmart/{noteId}` rule (mirror `noteInsights`).
- `scripts/test-firestore-rules-text.mjs` — assert the `noteSmart` rule exists.
- `src/features/notes/components/StudyNoteReader.jsx` — thread `highlightsByBlock` + `highlightsOn` into the prose renderers.
- `src/features/notes/components/ReaderControls.jsx` — Highlights toggle.
- `src/features/notes/pages/LearnerNoteRead.jsx` — fetch `noteSmart`, hold toggle state, pass down.
- `src/features/notes/pages/AdminNoteEditor.jsx` — "Generate AI highlights" button.
- `src/features/notes/styles/notes.css` — `.note-hl` style.
- `package.json` — `test:note-smart` + `test:notes-highlight`, appended to `test:all`.

---

## Task 1: Highlight prompt + parser (server, pure)

**Files:** Create `functions/noteSmartPrompt.js`, `functions/noteSmart.test.js`; Modify `package.json`.

- [ ] **Step 1: Write the failing test** — `functions/noteSmart.test.js`:

```js
#!/usr/bin/env node
/** Tests for the note-highlight prompt + parser. Run: npm run test:note-smart */
const { buildHighlightMessages, parseHighlights } = require('./noteSmartPrompt')
let pass = 0, fail = 0; const failures = []
function test(n, fn){ try{ fn(); pass++; console.log(`  ok  ${n}`) } catch(e){ fail++; failures.push({n,e}); console.log(`  XX  ${n} — ${e.message}`) } }
function assert(c,m){ if(!c) throw new Error(m||'assertion failed') }

console.log('\nnote smart — highlight prompt + parser')

test('buildHighlightMessages includes only highlightable blocks with ids + text', () => {
  const msgs = buildHighlightMessages({ blocks: [
    { id:'b1', type:'paragraph', text:'A cell is the basic unit of life.' },
    { id:'b2', type:'image', url:'x' },              // not highlightable
    { type:'paragraph', text:'no id' },               // no id → skipped
  ]})
  assert(msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user', 'message shape')
  assert(msgs[1].content.includes('b1') && msgs[1].content.includes('basic unit of life'), 'must include b1 text')
  assert(!msgs[1].content.includes('"id":"b2"'), 'image block must be excluded')
  assert(!msgs[1].content.includes('no id'), 'block without id must be excluded')
})

test('parseHighlights parses a {highlights} map, drops short/non-string, caps per block', () => {
  const raw = '```json\n{"highlights":{"b1":["A cell is the basic unit of life.","x","also important enough"],"b9":[123]},"warnings":["w"]}\n```'
  const out = parseHighlights(raw)
  assert(out.highlights.b1.length === 2, `b1 should keep 2 (drop the too-short "x"), got ${out.highlights.b1?.length}`)
  assert(!('b9' in out.highlights), 'b9 had no valid strings → dropped')
  assert(out.warnings[0] === 'w', 'warnings parsed')
})

test('parseHighlights tolerates a bare object and throws on garbage', () => {
  const out = parseHighlights('{"highlights":{"b1":["long enough excerpt here"]}}')
  assert(out.highlights.b1.length === 1, 'bare object ok')
  let threw = false; try { parseHighlights('not json {{{') } catch { threw = true }
  assert(threw, 'garbage should throw')
})

console.log(`\n─── ${pass+fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail>0){ for(const f of failures) console.error(`\n✖ ${f.n}\n  ${f.e.stack||f.e.message}`); process.exit(1) }
```

- [ ] **Step 2: Add npm script** — add `"test:note-smart": "node functions/noteSmart.test.js"` and append `&& npm run test:note-smart` to `test:all`.

- [ ] **Step 3: Run → FAIL** (`npm run test:note-smart`).

- [ ] **Step 4: Implement** — `functions/noteSmartPrompt.js`:

```js
// functions/noteSmartPrompt.js
//
// Highlight extraction for a study note: given its blocks, ask Claude for the
// few most-important VERBATIM sentences/items per block. Pure (no Firebase) so
// it is unit-tested directly. The client renders these as <mark> highlights.

// Block types learners read as prose — worth highlighting. (image/table/quiz/
// quickcheck/keyterms are excluded: not free-prose or already structured.)
const HIGHLIGHTABLE = new Set(['paragraph','keyidea','bullets','numbers','note','tip','think','summary','objectives'])
const MAX_PER_BLOCK = 3

function blockText(b) {
  if (b.text) return String(b.text)
  if (Array.isArray(b.items)) return b.items.join('\n')
  if (Array.isArray(b.lines)) return b.lines.join('\n')
  return ''
}

function buildHighlightMessages({ blocks }) {
  const items = (blocks || [])
    .filter(b => b && b.id && HIGHLIGHTABLE.has(b.type) && blockText(b).trim())
    .map(b => ({ id: b.id, type: b.type, text: blockText(b) }))
  const system = `You highlight the most important parts of a study note for a learner.
For each block, pick the few VERBATIM sentences or list items that are the key things to remember (definitions, key facts, exam-critical points).
- Quote EXACTLY from the block's text — copy the sentence/item word for word, no paraphrasing.
- At most ${MAX_PER_BLOCK} per block; only the genuinely important ones (skip filler/examples).
- Output ONLY JSON: { "highlights": { "<blockId>": ["exact excerpt", ...] }, "warnings": ["..."] }.`
  const user = `Blocks (JSON):\n${JSON.stringify(items).slice(0, 50000)}`
  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

function stripFences(raw) {
  if (!raw) return ''
  const f = String(raw).match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return (f ? f[1] : String(raw)).trim()
}

function parseHighlights(raw) {
  const text = stripFences(raw)
  let data
  try { data = JSON.parse(text) } catch {
    const span = text.match(/\{[\s\S]*\}/)
    if (!span) throw new Error('Could not parse a highlights JSON object.')
    data = JSON.parse(span[0])
  }
  const src = data && typeof data.highlights === 'object' && data.highlights ? data.highlights : {}
  const highlights = {}
  for (const [id, arr] of Object.entries(src)) {
    if (!Array.isArray(arr)) continue
    const list = arr.filter(s => typeof s === 'string' && s.trim().length >= 8).map(s => s.trim()).slice(0, MAX_PER_BLOCK)
    if (list.length) highlights[id] = list
  }
  const warnings = Array.isArray(data?.warnings) ? data.warnings.filter(w => typeof w === 'string') : []
  return { highlights, warnings }
}

module.exports = { buildHighlightMessages, parseHighlights, HIGHLIGHTABLE, MAX_PER_BLOCK }
```

- [ ] **Step 5: Run → PASS** (3 tests). **Step 6: Commit** `feat(notes): highlight extraction prompt + parser`.

---

## Task 2: Server writer + callable (mirror noteInsights)

**Files:** Create `functions/noteSmart.js`; Modify `functions/index.js`.

- [ ] **Step 1: Read the reference.** Open `functions/index.js` and find `exports.generateNoteInsights` (its options, auth/app-check/role gating, `assertDailyLimit`, how it reads the note doc, and how it writes `noteInsights/{noteId}`). Find the module it delegates to (e.g. `runNoteInsights` in `functions/noteInsights*.js` or inline) — note how it gets the admin Firestore instance (`getFirestore()` / `admin.firestore()`) and the `serverTimestamp`/`FieldValue` usage. You will MIRROR this exactly for `noteSmart`.

- [ ] **Step 2: Implement `functions/noteSmart.js`** — adapt the reference's read/write to highlights:

```js
// functions/noteSmart.js
//
// Generates + caches AI auto-highlights for a study note. Mirrors the
// noteInsights writer: read lessons/{noteId}, ask Claude for important excerpts
// per block, write noteSmart/{noteId}. Server-only (admin SDK).

const { callAnthropic } = require('./aiService')
const { buildHighlightMessages, parseHighlights } = require('./noteSmartPrompt')

const SMART_MODEL = process.env.NOTE_SMART_MODEL || undefined

// Stable fingerprint of the note's textual content (so we can tell when the
// highlights are stale vs. what they were generated against).
function contentHash(blocks) {
  const text = (blocks || []).map(b => b?.id + ':' + (b?.text || (b?.items||[]).join('|') || (b?.lines||[]).join('|') || '')).join('\n')
  let h = 0
  for (let i = 0; i < text.length; i++) { h = (h * 31 + text.charCodeAt(i)) | 0 }
  return String(h)
}

// db = admin Firestore instance (passed by the callable). FieldValue from the
// caller too (to avoid importing firebase-admin here twice).
async function runGenerateNoteSmart({ noteId, db, FieldValue, apiKey, uid }) {
  const snap = await db.collection('lessons').doc(noteId).get()
  if (!snap.exists) { const e = new Error('Note not found.'); e.code = 'not-found'; throw e }
  const note = snap.data()
  const blocks = Array.isArray(note.blocks) ? note.blocks : []
  if (!blocks.length) { const e = new Error('This note has no study blocks to highlight.'); e.code = 'failed-precondition'; throw e }

  const messages = buildHighlightMessages({ blocks })
  const raw = await callAnthropic(apiKey, {
    systemPrompt: messages[0].content,
    messages: [{ role: 'user', content: messages[1].content }],
    maxTokens: 4000, temperature: 0.2, json: true, model: SMART_MODEL,
    track: { uid, tool: 'generateNoteSmart' },
  })
  const { highlights, warnings } = parseHighlights(raw)
  await db.collection('noteSmart').doc(noteId).set({
    highlights, warnings,
    contentHash: contentHash(blocks),
    model: SMART_MODEL || 'default',
    generatedAt: FieldValue.serverTimestamp(),
  })
  return { highlights, warnings }
}

module.exports = { runGenerateNoteSmart, contentHash }
```

> If `generateNoteInsights` obtains Firestore differently (e.g. a module-level `const db = getFirestore()`), follow THAT pattern: import the same way in `noteSmart.js` and drop the `db`/`FieldValue` params, using the module-level instances. The point is to match the reference's proven admin-SDK access, not to invent a new one.

- [ ] **Step 3: Add the callable** in `functions/index.js`, mirroring `generateNoteInsights` but **staff-only** (admins generate highlights). Place it near `generateNoteInsights`:

```js
exports.generateNoteSmart = onCall(
  { secrets: [anthropicApiKey], region: 'us-central1', timeoutSeconds: 90, enforceAppCheck: APPCHECK_ENFORCE_CALLABLE, consumeAppCheckToken: true },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.')
    recordAppCheckCallable(request, 'generateNoteSmart')
    const role = await getUserRole(request.auth.uid)
    if (!isStaffRole(role)) throw new HttpsError('permission-denied', 'Only teachers and admins can generate highlights.')
    const noteId = cleanAiString(request.data?.noteId, 200)
    if (!noteId) throw new HttpsError('invalid-argument', 'noteId is required.')
    await assertDailyLimit(request.auth.uid, role, 'noteSmart')
    try {
      return await runGenerateNoteSmart({
        noteId, db: getFirestore(), FieldValue, apiKey: getAnthropicApiKey(anthropicApiKey), uid: request.auth.uid,
      })
    } catch (e) {
      if (e.code === 'not-found') throw new HttpsError('not-found', e.message)
      if (e.code === 'failed-precondition') throw new HttpsError('failed-precondition', e.message)
      throw new HttpsError('internal', 'Could not generate highlights. Please try again.')
    }
  },
)
```

Add `const { runGenerateNoteSmart } = require('./noteSmart')` near the other requires. Use the SAME `getFirestore`/`FieldValue` imports the file already has (confirm their names — `generateNoteInsights` shows how this file accesses Firestore; match it exactly, adjusting the `runGenerateNoteSmart` call/signature to suit).

- [ ] **Step 4:** `npm run lint` → PASS; `node -e "require('./functions/noteSmart.js'); console.log('ok')"`. **Step 5: Commit** `feat(notes): generateNoteSmart callable + writer`.

---

## Task 3: Firestore rule for noteSmart

**Files:** Modify `firestore.rules`, `scripts/test-firestore-rules-text.mjs`.

- [ ] **Step 1:** Read the `match /noteInsights/{noteId}` block in `firestore.rules`. It should allow learner read and deny client writes (server-only). 

- [ ] **Step 2: Add a failing rules-text guard** in `scripts/test-firestore-rules-text.mjs`:

```js
test('noteSmart is learner-readable and server-write-only', () => {
  assert(rules.includes('match /noteSmart/{'), 'no noteSmart rule block found')
})
```
Run `npm run test:rules-text` → FAIL.

- [ ] **Step 3:** Add a `match /noteSmart/{noteId} { ... }` block to `firestore.rules` that MIRRORS the `noteInsights` block exactly (same read condition, same write denial). Place it next to `noteInsights`.

- [ ] **Step 4:** `npm run test:rules-text` → PASS. **Step 5: Commit** `feat(notes): noteSmart Firestore rule (learner read, server write)`.

---

## Task 4: Client read + callable wrapper

**Files:** Create `src/features/notes/lib/smart.js`.

- [ ] **Step 1: Read** `src/features/notes/lib/insights.js` (the read-through pattern). **Step 2: Implement** `src/features/notes/lib/smart.js`:

```js
// src/features/notes/lib/smart.js
//
// Client access to a note's cached AI highlights (noteSmart/{noteId}) and the
// admin-only generate callable. Mirrors insights.js.

import { doc, getDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../../../firebase/config'

const functions = getFunctions(app, 'us-central1')
const generateNoteSmartCallable = httpsCallable(functions, 'generateNoteSmart', { timeout: 90_000 })

/** Read cached highlights: { [blockId]: string[] } (empty object if none). */
export async function fetchNoteSmart(noteId) {
  if (!noteId) return null
  const snap = await getDoc(doc(db, 'noteSmart', noteId))
  if (!snap.exists()) return null
  const d = snap.data()
  return { highlights: d?.highlights && typeof d.highlights === 'object' ? d.highlights : {} }
}

/** Admin-only: (re)generate highlights for a note. */
export async function generateNoteSmart(noteId) {
  const res = await generateNoteSmartCallable({ noteId })
  return res?.data || {}
}

export function smartErrorMessage(err) {
  const code = err?.code || ''
  if (code.includes('resource-exhausted')) return 'You’ve reached today’s AI limit. Try again tomorrow.'
  if (code.includes('failed-precondition')) return 'Add some study blocks first, then generate highlights.'
  if (code.includes('permission-denied')) return 'Only staff can generate highlights.'
  return 'Could not generate highlights right now. Please try again.'
}
```

- [ ] **Step 3:** `npm run build` → clean. **Step 4: Commit** `feat(notes): client read + callable for note highlights`.

---

## Task 5: Pure highlight matcher

**Files:** Create `src/features/notes/lib/highlight.js`, `src/features/notes/lib/highlight.test.js`; Modify `package.json`.

- [ ] **Step 1: Write the failing test** — `src/features/notes/lib/highlight.test.js`:

```js
#!/usr/bin/env node
/** Tests for the highlight matcher. Run: npm run test:notes-highlight */
const { splitSentences, isHighlighted, mdInlineHighlighted } = await import('./highlight.js')
let pass=0, fail=0; const failures=[]
function test(n,fn){ try{ fn(); pass++; console.log(`  ok  ${n}`) } catch(e){ fail++; failures.push({n,e}); console.log(`  XX  ${n} — ${e.message}`) } }
function assert(c,m){ if(!c) throw new Error(m||'assertion failed') }

console.log('\nnotes highlight — matcher')

test('splitSentences splits on sentence boundaries', () => {
  const s = splitSentences('A cell is the unit of life. It is small. Why?')
  assert(s.length === 3, `expected 3 sentences, got ${s.length}`)
})

test('isHighlighted matches a contained excerpt (normalized), ignores short', () => {
  assert(isHighlighted('A cell is the basic unit of life.', ['the basic unit of life']) === true, 'should match substring')
  assert(isHighlighted('A cell is small.', ['the basic unit of life']) === false, 'no match')
  assert(isHighlighted('A cell is small.', ['cell']) === false, 'excerpt under min length should not match')
})

test('mdInlineHighlighted wraps matched sentence and preserves bold + escaping', () => {
  const html = mdInlineHighlighted('A **cell** is the basic unit of life. It is tiny.', ['the basic unit of life'])
  assert(html.includes('<mark class="note-hl">'), 'should wrap the matched sentence')
  assert(html.includes('<strong>cell</strong>'), 'should keep bold inside the mark')
  assert(!html.includes('<mark') || html.indexOf('It is tiny') > html.indexOf('</mark>'), 'second sentence not wrapped')
})

test('mdInlineHighlighted with no excerpts equals plain mdInline (no marks)', () => {
  const html = mdInlineHighlighted('Plain text with *italic*.', [])
  assert(!html.includes('<mark'), 'no marks when no excerpts')
  assert(html.includes('<em>italic</em>'), 'italic preserved')
})

console.log(`\n─── ${pass+fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail>0){ for(const f of failures) console.error(`\n✖ ${f.n}\n  ${f.e.stack||f.e.message}`); process.exit(1) }
```

- [ ] **Step 2:** add `"test:notes-highlight": "node src/features/notes/lib/highlight.test.js"` + append to `test:all`. Run → FAIL.

- [ ] **Step 3: Implement** `src/features/notes/lib/highlight.js`:

```js
// src/features/notes/lib/highlight.js
//
// Pure helpers to render study-note prose with **bold**/*italic* AND a <mark>
// around sentences that contain an AI-chosen important excerpt. Used by
// StudyNoteReader when the learner has highlights ON. No React, no DOM.

import { mdInline } from './studyBlocks'

const MIN = 8
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[.,;:!?'")\]]+$/g, '').trim()

/** Split text into sentences, keeping each sentence's trailing punctuation/space. */
export function splitSentences(text) {
  const parts = String(text || '').match(/[^.!?]+[.!?]*\s*/g)
  return parts && parts.length ? parts : (text ? [String(text)] : [])
}

/** True if `sentence` contains any excerpt (normalized, min length). */
export function isHighlighted(sentence, normExcerpts) {
  const list = Array.isArray(normExcerpts) ? normExcerpts : []
  const n = norm(sentence)
  if (n.length < MIN) return false
  return list.some(e => e.length >= MIN && n.includes(e))
}

/** Safe HTML: mdInline per sentence, matched sentences wrapped in <mark>. */
export function mdInlineHighlighted(text, excerpts) {
  const normExcerpts = (excerpts || []).map(norm).filter(e => e.length >= MIN)
  if (!normExcerpts.length) return mdInline(text)
  return splitSentences(text).map(s => {
    const html = mdInline(s)
    return isHighlighted(s, normExcerpts) ? `<mark class="note-hl">${html}</mark>` : html
  }).join('')
}
```

> `isHighlighted`'s 2nd arg in the matcher is pre-normalized excerpts; the test passes raw strings and relies on `>= MIN` — adjust the test or accept that `isHighlighted` expects normalized input. To keep the test honest, have `isHighlighted` normalize internally: change `list.some(e => ...)` to `list.some(e => { const ne = norm(e); return ne.length >= MIN && n.includes(ne) })`. Use THIS internally-normalizing version so the test (which passes raw `['the basic unit of life']`) is correct.

- [ ] **Step 4:** Run → PASS (4 tests). **Step 5: Commit** `feat(notes): pure highlight matcher`.

---

## Task 6: Reader rendering

**Files:** Modify `src/features/notes/components/StudyNoteReader.jsx`.

- [ ] **Step 1: Read** the file. The `Inline` component uses `mdInline`. Import the matcher: `import { mdInlineHighlighted } from '../lib/highlight'`.

- [ ] **Step 2: Extend `Inline`** to take optional `highlights` (string[]):

```js
function Inline({ text, as: Tag = 'span', className, highlights }) {
  const html = highlights && highlights.length ? mdInlineHighlighted(text, highlights) : mdInline(text)
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
```

- [ ] **Step 3: Thread excerpts to prose blocks.** Change `function Block({ block, anchorId })` → `function Block({ block, anchorId, hl })`. In the prose cases pass `highlights={hl}` to every `<Inline .../>`: `paragraph`, `keyidea`, each `note`/`tip`/`think` line, each `bullets`/`numbers`/`summary`/`objectives` item. (Leave heading/table/keyterms/quickcheck/exam/mistake/image/quiz unchanged.) Example for bullets:
```js
{(block.items || []).map((it, i) => <li key={i}><Inline text={it} highlights={hl} /></li>)}
```

- [ ] **Step 4: Pass per-block excerpts** from `StudyNoteReader`:
```js
export function StudyNoteReader({ blocks, anchorByIndex, highlightsByBlock, highlightsOn }) {
  if (!Array.isArray(blocks) || blocks.length === 0) {
    return <p className="text-sm text-neutral-500">This note has no content yet.</p>
  }
  return (
    <div className="study-note space-y-5">
      {blocks.map((block, i) => (
        <Block
          key={block.id || i} block={block}
          anchorId={anchorByIndex?.get(i)}
          hl={highlightsOn && block.id ? (highlightsByBlock?.[block.id] || null) : null}
        />
      ))}
    </div>
  )
}
```
(Both new props optional → admin preview + Phase-1 callers still work.)

- [ ] **Step 5:** `npm run lint && npm run build` → clean. **Step 6: Commit** `feat(notes): render AI highlights in the study-note reader`.

---

## Task 7: Toggle + fetch wiring

**Files:** Modify `src/features/notes/components/ReaderControls.jsx`, `src/features/notes/pages/LearnerNoteRead.jsx`.

- [ ] **Step 1: ReaderControls** — accept `highlightsOn` + `onToggleHighlights` props and render a toggle button next to the Listen button (only meaningful when highlights exist — the page passes a `hasHighlights` flag; hide the button when false):
```js
export function ReaderControls({ blocks, title, highlightsOn, onToggleHighlights, hasHighlights }) {
  // ...existing scroll/minutes/speak code unchanged...
  // In the controls row, before/after Listen:
  {hasHighlights && (
    <button type="button" onClick={onToggleHighlights}
      className={`notes-chip notes-chip-shadow inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold transition ${highlightsOn ? 'bg-[#FF7A1A] text-white' : 'bg-white text-[#0F1B2D]'}`}>
      ✦ Highlights {highlightsOn ? 'on' : 'off'}
    </button>
  )}
}
```

- [ ] **Step 2: LearnerNoteRead** — add highlight state + fetch (all as hooks BEFORE the early returns, like Phase 1's TOC hooks):
```js
import { fetchNoteSmart } from '../lib/smart'
// ...
const [highlightsOn, setHighlightsOn] = useState(() => {
  try { return localStorage.getItem('notes:hl') !== '0' } catch { return true }
})
const [highlightsByBlock, setHighlightsByBlock] = useState(null)
useEffect(() => {
  let cancelled = false
  if (id && note?.noteFormat === NOTE_FORMAT.STUDY) {
    fetchNoteSmart(id).then(r => { if (!cancelled) setHighlightsByBlock(r?.highlights || null) }).catch(() => {})
  }
  return () => { cancelled = true }
}, [id, note])
const toggleHighlights = () => setHighlightsOn(v => {
  const next = !v
  try { localStorage.setItem('notes:hl', next ? '1' : '0') } catch { /* ignore */ }
  return next
})
const hasHighlights = !!highlightsByBlock && Object.keys(highlightsByBlock).length > 0
```
Then pass into the study render branch:
```jsx
<ReaderControls blocks={studyBlocks} title={note.title}
  highlightsOn={highlightsOn} onToggleHighlights={toggleHighlights} hasHighlights={hasHighlights} />
<StudyNoteReader blocks={studyBlocks} anchorByIndex={anchorByIndex}
  highlightsByBlock={highlightsByBlock} highlightsOn={highlightsOn} />
```
(`useState`/`useEffect` must be imported from `react` — add to the existing `import { useMemo } from 'react'` line.)

- [ ] **Step 3:** `npm run lint && npm run build` → clean, NO rules-of-hooks errors. **Step 4: Commit** `feat(notes): highlight toggle + noteSmart fetch in the reader`.

---

## Task 8: Admin "Generate highlights" button

**Files:** Modify `src/features/notes/pages/AdminNoteEditor.jsx`.

- [ ] **Step 1: Read** the editor to find the action area (near the save/publish controls) and confirm `docId` (the saved note id) + `noteFormat` are in scope. Import `import { generateNoteSmart, smartErrorMessage } from '../lib/smart'` and a spark icon (`Sparkles`).

- [ ] **Step 2: Add state + handler** in the component:
```js
const [smartState, setSmartState] = useState('idle') // idle|loading|done|error
const [smartMsg, setSmartMsg] = useState('')
const onGenerateHighlights = async () => {
  if (!docId) { setSmartMsg('Save the note first.'); setSmartState('error'); return }
  setSmartState('loading'); setSmartMsg('')
  try {
    const { highlights } = await generateNoteSmart(docId)
    const n = highlights ? Object.keys(highlights).length : 0
    setSmartMsg(`Highlights generated for ${n} block${n === 1 ? '' : 's'}.`); setSmartState('done')
  } catch (e) { setSmartMsg(smartErrorMessage(e)); setSmartState('error') }
}
```

- [ ] **Step 3: Render the button** for study notes only, in the action area:
```jsx
{noteFormat === NOTE_FORMAT.STUDY && (
  <div className="inline-flex items-center gap-2">
    <button type="button" onClick={onGenerateHighlights} disabled={smartState === 'loading' || !docId}
      className="text-sm px-3 py-1.5 rounded-lg border border-neutral-200 hover:bg-neutral-50 inline-flex items-center gap-1.5 text-neutral-800 disabled:opacity-50">
      <Sparkles size={14} /> {smartState === 'loading' ? 'Generating…' : 'Generate AI highlights'}
    </button>
    {smartMsg && <span className={`text-xs ${smartState === 'error' ? 'text-red-600' : 'text-emerald-700'}`}>{smartMsg}</span>}
  </div>
)}
```

- [ ] **Step 4:** `npm run lint && npm run build` → clean. **Step 5: Commit** `feat(notes): admin Generate-AI-highlights button`.

---

## Task 9: Highlight style (CSS)

**Files:** Modify `src/features/notes/styles/notes.css`.

- [ ] **Step 1:** Append a `.note-hl` rule (textbook-highlighter look — a soft underline-style highlight that doesn't hurt contrast):
```css
/* AI auto-highlight — soft highlighter behind key sentences. */
.study-note mark.note-hl {
  background: linear-gradient(transparent 55%, rgba(255, 224, 138, 0.85) 55%);
  color: inherit;
  border-radius: 2px;
  padding: 0 0.05em;
}
```

- [ ] **Step 2:** `npm run build` → clean. **Step 3: Commit** `style(notes): AI highlight mark style`.

---

## Task 10: Verify + PR

- [ ] **Step 1:** `npm run test:note-smart && npm run test:notes-highlight && npm run test:rules-text && npm run test:study-blocks` → all pass.
- [ ] **Step 2:** `npm run lint && npm run build` → clean; `node -e "require('./functions/noteSmart.js'); require('./functions/noteSmartPrompt.js'); console.log('ok')"`.
- [ ] **Step 3:** In-browser/E2E (admin generates highlights → learner sees `<mark>` + toggle) needs `.env` + a deploy; if unavailable, record the visual check as deferred (do NOT claim a manual run not performed).
- [ ] **Step 4:** Push `claude/notes-phase3-highlight`; open PR via `gh pr create -R Mwelwa-cyber/Zedexams` (title "Notes Studio: AI auto-highlight (admin-generated, learner toggle)"; body = the flow, the `generateNoteSmart` callable + `noteSmart` rule, test plan, and an explicit unchecked E2E box). Hold the merge for the user.

> Deploy note: adds a Cloud Function (`generateNoteSmart`) + a Firestore rule → both ship via `deploy-firebase.yml` on merge.

---

## Self-review notes

- **Spec coverage (§4.2):** sentence/item-level highlights (Tasks 1,5,6), cached in `noteSmart/{noteId}` mirroring `noteInsights` (Tasks 2,3,4), toggle ON by default + persisted (Task 7). Admin-triggered generation (decision change from spec's lazy) = Task 8.
- **Name/type consistency:** `buildHighlightMessages`/`parseHighlights` (T1) → `runGenerateNoteSmart` (T2) → callable (T2) → client `generateNoteSmart`/`fetchNoteSmart` (T4) → `highlightsByBlock` keyed by `block.id` consumed by `StudyNoteReader` (T6) and produced by the writer keyed by the same block ids (T2 via `buildHighlightMessages` which emits `b.id`). `mdInlineHighlighted` (T5) used in `Inline` (T6). `highlightsOn` (T7) gates rendering (T6) + button (T7).
- **Open confirmations for the implementer:** exact Firestore-access pattern in `generateNoteInsights` (T2 — mirror it, adjust `runGenerateNoteSmart` signature accordingly); the exact `noteInsights` rule text to mirror (T3); `cleanAiString` name (T2, same as Phase 2); `docId` availability in the editor action area (T8); that `isHighlighted` normalizes its excerpts internally so the test passing raw strings is correct (T5).
- **No regressions:** all new reader props optional → admin preview + existing callers unaffected.
