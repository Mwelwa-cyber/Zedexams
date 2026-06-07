# Notes Section Summaries (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extend the existing `generateNoteSmart` flow so it also produces a 1–2 sentence summary per section (level-2 heading), stored in `noteSmart/{noteId}.sections`, surfaced in the reader as a collapsible chip under each section heading AND inside the TOC drawer.

**Architecture:** No new callable, no new collection. `runGenerateNoteSmart` (Phase 3) makes a second Anthropic call with a focused summary prompt → `{ headingId: summary }` → the writer builds `sections: [{ key, title, summary }]` (key = the level-2 heading block id, matching the Phase-1 TOC key) and stores it alongside `highlights` in the same `noteSmart` doc. The reader (`fetchNoteSmart` → `LearnerNoteRead`) maps summaries by heading block id and renders them in `StudyNoteReader` (chip under each level-2 heading) and `NoteToc` (under each section entry).

**Tech Stack:** Firebase Cloud Functions (Node 22), Anthropic `aiService.callAnthropic`, React 18, Vite, plain-`node` tests. Phase 4 of `docs/superpowers/specs/2026-06-07-notes-smart-book-notes-design.md`. Branch off `main` (has Phases 1–3).

> **Pre-flight:** `npm install` (root) + `cd functions && npm install && cd ..` (deps may have advanced on `main`).

**Decisions:** surfaces in BOTH section-start chips and the TOC; one admin "Generate AI highlights" action regenerates highlights + summaries (a second AI call inside the same callable); section-start chips are collapsed by default.

---

## File structure

**Modify**
- `functions/noteSmartPrompt.js` — add `buildSummaryMessages({blocks})` + `parseSummaries(raw)`.
- `functions/noteSmart.test.js` — add tests for the two new functions.
- `functions/noteSmart.js` — `runGenerateNoteSmart`: second AI call → build `sections` → store + return.
- `src/features/notes/lib/smart.js` — `fetchNoteSmart` returns `{ highlights, sections }`.
- `src/features/notes/components/StudyNoteReader.jsx` — collapsible section-summary chip under level-2 headings.
- `src/features/notes/components/NoteToc.jsx` — show the section summary under each entry.
- `src/features/notes/pages/LearnerNoteRead.jsx` — capture `sections`, derive `summaryByBlockId`, pass to reader + TOC.
- `src/features/notes/pages/AdminNoteEditor.jsx` — update the generate button's success message to mention summaries.

---

## Task 1: Summary prompt + parser (server, pure)

**Files:** Modify `functions/noteSmartPrompt.js`, `functions/noteSmart.test.js`.

- [ ] **Step 1: Add failing tests** to `functions/noteSmart.test.js` (add the new names to the existing `require('./noteSmartPrompt')` destructure: `buildSummaryMessages, parseSummaries`), then add before the summary line:

```js
test('buildSummaryMessages includes headings + content and asks for per-section summaries', () => {
  const msgs = buildSummaryMessages({ blocks: [
    { id:'h1', type:'heading', level:2, text:'Cells' },
    { id:'p1', type:'paragraph', text:'A cell is the basic unit of life.' },
    { id:'h2', type:'heading', level:3, text:'Sub' },
  ]})
  assert(msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user', 'shape')
  assert(msgs[1].content.includes('h1') && msgs[1].content.includes('basic unit of life'), 'includes heading id + content')
})

test('parseSummaries keeps {headingId: summary} strings, drops short/non-string', () => {
  const out = parseSummaries('```json\n{"summaries":{"h1":"This section explains what a cell is and why it matters.","h9":"x","h8":5},"warnings":["w"]}\n```')
  assert(out.summaries.h1 && !('h9' in out.summaries) && !('h8' in out.summaries), 'filtering wrong')
  assert(out.warnings[0] === 'w', 'warnings')
})

test('parseSummaries throws on garbage', () => {
  let threw = false; try { parseSummaries('nope {{{') } catch { threw = true }
  assert(threw, 'should throw')
})
```
Run `npm run test:note-smart` → FAIL.

- [ ] **Step 2: Implement** in `functions/noteSmartPrompt.js` (add before `module.exports`, and add `buildSummaryMessages, parseSummaries` to the exports). Reuse the existing `blockText`, `stripFences`, `HIGHLIGHTABLE` helpers already in the file:

```js
function buildSummaryMessages({ blocks }) {
  const items = (blocks || [])
    .filter(b => b && b.id && (b.type === 'heading' || HIGHLIGHTABLE.has(b.type)))
    .map(b => ({ id: b.id, type: b.type, level: b.level, text: blockText(b) }))
  const system = `You write a short summary for each SECTION of a study note.
A section starts at a level-2 heading (type "heading", level 2) and includes the blocks under it until the next level-2 heading.
- For each level-2 heading, write a 1-2 sentence plain-English TL;DR (max ~40 words) of what that section teaches — what a learner would read before the section.
- Key each summary by the EXACT id of its level-2 heading block. Do NOT summarize level-3 sub-headings.
- Use clear Zambian-English. Output ONLY JSON: { "summaries": { "<exact level-2 heading id>": "summary" }, "warnings": ["..."] }.`
  const user = `Blocks (JSON):\n${JSON.stringify(items).slice(0, 50000)}`
  return [{ role: 'system', content: system }, { role: 'user', content: user }]
}

function parseSummaries(raw) {
  const text = stripFences(raw)
  let data
  try { data = JSON.parse(text) } catch {
    const span = text.match(/\{[\s\S]*\}/)
    if (!span) throw new Error('Could not parse a summaries JSON object.')
    data = JSON.parse(span[0])
  }
  const src = data && typeof data.summaries === 'object' && data.summaries ? data.summaries : {}
  const summaries = {}
  for (const [id, s] of Object.entries(src)) {
    if (typeof s === 'string' && s.trim().length >= 8) summaries[id] = s.trim()
  }
  const warnings = Array.isArray(data?.warnings) ? data.warnings.filter(w => typeof w === 'string') : []
  return { summaries, warnings }
}
```
Update `module.exports` to include `buildSummaryMessages, parseSummaries`.

- [ ] **Step 3:** `npm run test:note-smart` → PASS (now 6 tests). **Step 4: Commit** `feat(notes): section-summary prompt + parser`.

---

## Task 2: Writer — second AI call + sections

**Files:** Modify `functions/noteSmart.js`.

- [ ] **Step 1: Read** `functions/noteSmart.js`. After the highlights `callAnthropic` + `parseHighlights`, add the summary call and build `sections`. Import the new functions: change the require to `const { buildHighlightMessages, parseHighlights, buildSummaryMessages, parseSummaries } = require('./noteSmartPrompt')`.

- [ ] **Step 2:** In `runGenerateNoteSmart`, after `const { highlights, warnings } = parseHighlights(raw)` and BEFORE the `db.collection('noteSmart')...set(...)` write, add:

```js
  // Second pass: a 1-2 sentence summary per section (level-2 heading).
  let sections = []
  try {
    const sumMsgs = buildSummaryMessages({ blocks })
    const rawSum = await callAnthropic(apiKey, {
      systemPrompt: sumMsgs[0].content,
      messages: [{ role: 'user', content: sumMsgs[1].content }],
      maxTokens: 2000, temperature: 0.3, json: true, model: SMART_MODEL,
      track: { uid, tool: 'generateNoteSmart' },
    })
    const { summaries } = parseSummaries(rawSum)
    sections = blocks
      .filter(b => b?.type === 'heading' && b.level === 2 && b.id)
      .map(b => ({ key: String(b.id), title: String(b.text || ''), summary: summaries[b.id] || '' }))
      .filter(s => s.summary)
  } catch (e) {
    warnings.push('Section summaries could not be generated.')
  }
```

- [ ] **Step 3:** Add `sections` to the `set(...)` payload and the return value:
```js
  await db.collection('noteSmart').doc(noteId).set({
    highlights, sections, warnings,
    contentHash: contentHash(blocks),
    model: SMART_MODEL || 'default',
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  })
  return { highlights, sections, warnings }
```
(Match the file's actual existing write shape — only ADD `sections` to the object and the return.)

- [ ] **Step 4:** `npm run lint` → PASS; `node -e "require('./functions/noteSmart.js'); console.log('ok')"`; `npm run test:note-smart` → still passes. **Step 5: Commit** `feat(notes): generate section summaries in noteSmart`.

---

## Task 3: Client read returns sections

**Files:** Modify `src/features/notes/lib/smart.js`.

- [ ] **Step 1:** In `fetchNoteSmart`, return `sections` too:
```js
  return {
    highlights: d?.highlights && typeof d.highlights === 'object' ? d.highlights : {},
    sections: Array.isArray(d?.sections) ? d.sections : [],
  }
```
- [ ] **Step 2:** `npm run build` → clean. **Step 3: Commit** `feat(notes): fetchNoteSmart returns sections`.

---

## Task 4: Section-summary chip in the reader

**Files:** Modify `src/features/notes/components/StudyNoteReader.jsx`.

- [ ] **Step 1: Read** the file. It already has `import { useState } from 'react'` (used by QuickCheck). Add a `SectionSummary` component near `QuickCheck`:
```jsx
// Collapsible per-section TL;DR shown under a level-2 heading.
function SectionSummary({ summary }) {
  const [open, setOpen] = useState(false)
  if (!summary) return null
  return (
    <div className="not-prose -mt-1 mb-1">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
        className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-[#6D28D9]">
        ✦ Section summary <span className="text-[#9CA3AF] text-[9px]">{open ? '▲' : '▼'}</span>
      </button>
      {open && <p className="mt-1 text-[13px] leading-relaxed text-neutral-600 font-display-italic">{summary}</p>}
    </div>
  )
}
```

- [ ] **Step 2:** Add `summary` to `Block`'s signature: `function Block({ block, anchorId, hl, summary })`. In the `heading` case, render the chip after a level-2 heading:
```js
    case 'heading':
      return block.level === 2
        ? <><h2 id={anchorId} className="font-display text-2xl sm:text-3xl text-neutral-900 mt-4 scroll-mt-24"><Inline text={block.text} /></h2><SectionSummary summary={summary} /></>
        : <h3 id={anchorId} className="font-display text-xl sm:text-2xl text-neutral-900 mt-2 scroll-mt-24"><Inline text={block.text} /></h3>
```

- [ ] **Step 3:** `StudyNoteReader` signature gains `summaryByBlockId`; pass `summary` to each Block:
```js
export function StudyNoteReader({ blocks, anchorByIndex, highlightsByBlock, highlightsOn, summaryByBlockId }) {
  // ...empty guard unchanged...
      {blocks.map((block, i) => (
        <Block
          key={block.id || i} block={block}
          anchorId={anchorByIndex?.get(i)}
          hl={highlightsOn && block.id ? (highlightsByBlock?.[block.id] || null) : null}
          summary={block.type === 'heading' && block.level === 2 && block.id ? (summaryByBlockId?.[block.id] || null) : null}
        />
      ))}
}
```
(All new props optional → admin preview unaffected.)

- [ ] **Step 4:** `npm run lint && npm run build` → clean. **Step 5: Commit** `feat(notes): collapsible section summary under headings`.

---

## Task 5: Summaries in the TOC

**Files:** Modify `src/features/notes/components/NoteToc.jsx`.

- [ ] **Step 1: Read** the file. `TocList` maps `toc` entries (`{key,id,text,level}`). Add an optional `summaryByKey` prop threaded `NoteToc` → `TocList`. Under each entry's button, render the summary when present:
```jsx
function TocList({ toc, activeKey, onJump, summaryByKey }) {
  return (
    <nav aria-label="Contents" className="space-y-0.5">
      {toc.map(e => (
        <div key={e.key}>
          <button type="button" onClick={() => onJump(e.id)}
            className={`block w-full text-left rounded-lg px-3 py-1.5 transition ${e.level === 3 ? 'pl-6 text-[13px]' : 'text-sm font-semibold'} ${activeKey === e.key ? 'bg-[#0F1B2D] text-white' : 'text-[#4A5A6E] hover:bg-white hover:text-[#0F1B2D]'}`}>
            {e.text}
          </button>
          {summaryByKey?.[e.key] && activeKey !== e.key && (
            <p className="px-3 pb-1 text-[11px] leading-snug text-[#6B7280]">{summaryByKey[e.key]}</p>
          )}
        </div>
      ))}
    </nav>
  )
}
```
- [ ] **Step 2:** `NoteToc({ toc, activeKey, summaryByKey })` — thread `summaryByKey` into BOTH `TocList` usages (the xl rail + the drawer).

- [ ] **Step 3:** `npm run lint && npm run build` → clean. **Step 4: Commit** `feat(notes): show section summaries in the TOC`.

---

## Task 6: Wire summaries through the reader + admin message

**Files:** Modify `src/features/notes/pages/LearnerNoteRead.jsx`, `src/features/notes/pages/AdminNoteEditor.jsx`.

- [ ] **Step 1: LearnerNoteRead** — the `useEffect` that calls `fetchNoteSmart` currently does `setHighlightsByBlock(r?.highlights || null)`. Add section state + derive a map. Add `const [sectionSummaries, setSectionSummaries] = useState(null)` next to `highlightsByBlock`; in the `.then`, also `setSectionSummaries(r?.sections || null)`. Then add a memo (with the other memos, before early returns):
```js
const summaryByBlockId = useMemo(() => {
  const m = {}
  for (const s of sectionSummaries || []) { if (s?.key && s?.summary) m[s.key] = s.summary }
  return m
}, [sectionSummaries])
```
Pass to both components in the STUDY branch:
```jsx
<StudyNoteReader blocks={studyBlocks} anchorByIndex={anchorByIndex}
  highlightsByBlock={highlightsByBlock} highlightsOn={highlightsOn} summaryByBlockId={summaryByBlockId} />
```
and
```jsx
<NoteToc toc={toc} activeKey={activeKey} summaryByKey={summaryByBlockId} />
```
(`summaryByBlockId` is keyed by heading block id; TOC entry `key` equals the heading block id for normal notes, so the lookup matches.)

- [ ] **Step 2: AdminNoteEditor** — the `onGenerateHighlights` handler destructures `{ highlights }` from `generateNoteSmart(docId)`. Change to `{ highlights, sections }` and update the success message:
```js
const { highlights, sections } = await generateNoteSmart(docId)
const nB = highlights ? Object.keys(highlights).length : 0
const nS = Array.isArray(sections) ? sections.length : 0
setSmartMsg(`Generated highlights for ${nB} block${nB === 1 ? '' : 's'} and summaries for ${nS} section${nS === 1 ? '' : 's'}.`)
```
(Optionally relabel the button "Generate AI study aids" — not required.)

- [ ] **Step 3:** `npm run lint && npm run build` → clean, no rules-of-hooks errors. **Step 4: Commit** `feat(notes): wire section summaries into reader + admin`.

---

## Task 7: Verify + PR

- [ ] **Step 1:** `npm run test:note-smart && npm run test:notes-highlight && npm run test:study-blocks && npm run test:notes-toc && npm run test:rules-text` → all pass.
- [ ] **Step 2:** `npm run lint && npm run build` → clean; `node -e "require('./functions/noteSmart.js'); require('./functions/noteSmartPrompt.js'); console.log('ok')"`.
- [ ] **Step 3:** In-browser/E2E (admin regenerates → learner sees section chips + TOC summaries) needs `.env`/deploy; record as deferred if unavailable.
- [ ] **Step 4:** Push `claude/notes-phase4-summaries`; open PR (`gh pr create -R Mwelwa-cyber/Zedexams`, title "Notes Studio: AI section summaries (chip + TOC)"; body = the flow, that it extends `generateNoteSmart`/`noteSmart`, test plan, unchecked E2E box). Hold the merge for the user (or queue `--auto` if they ask).

> Deploy note: changes the `generateNoteSmart` Cloud Function only (no new function/rule) → ships via `deploy-firebase.yml` on merge.

---

## Self-review notes

- **Spec coverage (§4):** per-section summaries generated (T1, T2), stored in `noteSmart.sections` (T2), surfaced at section start (T4) + in the TOC (T5), one admin action regenerates both (T2, T6). Tests T1.
- **Name/type consistency:** `buildSummaryMessages`/`parseSummaries` (T1) → writer (T2) → `noteSmart.sections=[{key,title,summary}]` → `fetchNoteSmart` returns `sections` (T3) → `summaryByBlockId` keyed by `s.key` (= heading block id) (T6) → `StudyNoteReader` looks up by `block.id` (T4) and `NoteToc` by `entry.key` (T5). Heading block id === TOC entry key for normal (non-duplicate-id) notes — consistent with Phase 1.
- **No regressions:** all new props optional; the summary AI call is wrapped in try/catch so a summary failure still saves highlights.
- **Confirm during impl:** the exact existing `set(...)` shape in `noteSmart.js` (only ADD `sections`); that `useState` is already imported in StudyNoteReader (it is — QuickCheck uses it); the two `TocList` call sites in NoteToc both get `summaryByKey`.
