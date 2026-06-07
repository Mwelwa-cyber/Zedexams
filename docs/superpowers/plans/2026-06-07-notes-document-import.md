# Notes Document Import (Phase 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin import a document — pasted text, DOCX, text-PDF, or scanned-PDF (OCR) — into a structured `study` note (one note per import, images extracted for DOCX/text-PDF), opened in the existing editor for review before publishing.

**Architecture:** Reuse the quiz import pipeline's document extraction (DOCX via `fflate`, PDF via `pdfjs-dist`) and image-upload helper; add a notes-specific AI structuring path. Structuring is **Anthropic-only** (Claude reads document text → `study` blocks JSON). Scanned PDFs are OCR'd to text by a Claude-vision callable (client batches pages), then structured by the same text path. Images are referenced in the document text via `[[IMAGE:<assetId>]]` markers, which the AI preserves as image blocks and the client resolves to uploaded Storage URLs. The server returns best-effort blocks JSON; the **client** validates/normalizes with the existing `coerceStudyBlocks`.

**Tech Stack:** React 18, Vite, Firebase Cloud Functions (Node 22, `onCall`), Anthropic Claude (`aiService.callAnthropic`), `pdfjs-dist`, `fflate`, Zod (`studySchema.js`), plain-`node` tests. This is Phase 2 of `docs/superpowers/specs/2026-06-07-notes-smart-book-notes-design.md`.

**Decisions (from brainstorming):** all four input types in one PR; one note per import; images extracted for DOCX/text-PDF (scanned pages are OCR'd text-only, diagrams become AI-written `picture` description blocks).

> **Pre-flight (do once before Task 1):** `main` now includes a major dependency upgrade (React 19 / pdfjs 6 / firebase 12). Run `npm install` at the repo root and `cd functions && npm install && cd ..` so the worktree's `node_modules` match `package.json` before building/testing.

---

## File structure

**Create**
- `functions/noteStructurePrompt.js` — `buildNoteStructureMessages({fileName, documentText})` + `parseStructuredNote(raw)` (+ `NOTE_OCR_SYSTEM_PROMPT`). Pure, no Firebase.
- `functions/noteImport.js` — `runNoteImport({documentText, fileName, apiKey, uid})` and `runNoteOcr({pages, apiKey, uid})`. Thin glue over `callAnthropic`.
- `functions/noteImport.test.js` — tests for `parseStructuredNote` + `buildNoteStructureMessages`.
- `src/features/notes/lib/noteImport.js` — client orchestrator `importNoteDocument(...)` + pure helpers.
- `src/features/notes/lib/noteImport.test.js` — tests for the pure helpers (marker building, image resolution).
- `src/features/notes/components/ImportNotePanel.jsx` — import UI (adapts `ImportQuizPanel`).
- `src/features/notes/pages/AdminNoteImport.jsx` — the `/admin/lessons/import` page hosting the panel + create-and-redirect flow.

**Modify**
- `src/components/quiz/documentQuizImporter.js` — add `export` to `extractDocx`, `extractPdf`, `renderPdfPageSnapshot`, `loadPdfDocument`.
- `functions/index.js` — add `structureImportedNote` + `ocrNotePages` callables.
- `src/utils/aiAssistant.js` — add `structureImportedNote` + `ocrNotePages` client wrappers.
- `src/features/notes/routes/adminRoutes.jsx` — add the `/admin/lessons/import` route.
- `src/features/notes/pages/AdminNotesList.jsx` — add the "Import document" button.
- `package.json` — add `test:note-import` + `test:note-import-client`, append both to `test:all`.

---

## Task 1: Export the reusable extraction primitives

**Files:**
- Modify: `src/components/quiz/documentQuizImporter.js`

- [ ] **Step 1: Read the file** and locate the internal declarations `async function extractDocx(file)`, `async function extractPdf(file, preloaded = null)`, `async function renderPdfPageSnapshot(page, pageNumber, warnings)`, and `loadPdfDocument` (the helper that opens a PDF → `{ pdf, pdfjsLib }`). Confirm their exact current signatures.

- [ ] **Step 2: Add `export` to each** (additive only — do NOT change bodies). Change `async function extractDocx` → `export async function extractDocx`, same for `extractPdf`, `renderPdfPageSnapshot`, and `loadPdfDocument`. Leave everything else untouched.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: clean build (these are now named exports; nothing else changes).

- [ ] **Step 4: Commit**

```bash
git add src/components/quiz/documentQuizImporter.js
git commit -m "refactor(import): export DOCX/PDF extraction primitives for reuse"
```

---

## Task 2: Notes structuring prompt + parser (server, pure)

**Files:**
- Create: `functions/noteStructurePrompt.js`
- Create: `functions/noteImport.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test** — create `functions/noteImport.test.js`:

```js
#!/usr/bin/env node
/**
 * Tests for the notes document-import structuring prompt + parser.
 * Run: npm run test:note-import  (also via npm run test:all)
 */
const {
  buildNoteStructureMessages, parseStructuredNote,
} = require('./noteStructurePrompt')

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, err }); console.log(`  XX  ${name} — ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

console.log('\nnote import — prompt + parser')

test('buildNoteStructureMessages returns a system+user message pair containing the doc text', () => {
  const msgs = buildNoteStructureMessages({ fileName: 'x.docx', documentText: 'Photosynthesis is...' })
  assert(Array.isArray(msgs) && msgs.length === 2, 'expected 2 messages')
  assert(msgs[0].role === 'system' && msgs[1].role === 'user', 'roles wrong')
  assert(msgs[1].content.includes('Photosynthesis is'), 'user message must include the document text')
})

test('parseStructuredNote parses a fenced JSON object into { blocks, warnings }', () => {
  const raw = '```json\n{"blocks":[{"type":"heading","level":2,"text":"Cells"},{"type":"paragraph","text":"A cell is..."}],"warnings":["short"]}\n```'
  const out = parseStructuredNote(raw)
  assert(Array.isArray(out.blocks) && out.blocks.length === 2, 'expected 2 blocks')
  assert(out.blocks[0].type === 'heading' && out.blocks[1].type === 'paragraph', 'block types wrong')
  assert(Array.isArray(out.warnings) && out.warnings[0] === 'short', 'warnings not parsed')
})

test('parseStructuredNote accepts a bare blocks array too', () => {
  const out = parseStructuredNote('[{"type":"paragraph","text":"hi"}]')
  assert(out.blocks.length === 1 && out.warnings.length === 0, 'bare array should yield blocks + empty warnings')
})

test('parseStructuredNote drops non-object blocks and keeps a string type', () => {
  const out = parseStructuredNote('{"blocks":[null,3,{"type":"paragraph","text":"keep"},{"noType":1}]}')
  assert(out.blocks.length === 1 && out.blocks[0].text === 'keep', 'should keep only well-formed typed blocks')
})

test('parseStructuredNote throws on unparseable input', () => {
  let threw = false
  try { parseStructuredNote('not json at all {{{') } catch { threw = true }
  assert(threw, 'expected a throw on garbage input')
})

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`); process.exit(1) }
```

- [ ] **Step 2: Add the npm script** — in `package.json` `scripts`, add after `test:note-import`-adjacent notes entries:

```json
    "test:note-import": "node functions/noteImport.test.js",
```

and append ` && npm run test:note-import` to the end of `test:all`.

- [ ] **Step 3: Run to confirm it FAILS**

Run: `npm run test:note-import`
Expected: FAIL — `Cannot find module './noteStructurePrompt'`.

- [ ] **Step 4: Implement** — create `functions/noteStructurePrompt.js`:

```js
// functions/noteStructurePrompt.js
//
// Notes document-import: the Claude system/user prompt that turns raw document
// text into `study`-note blocks, plus a tolerant parser. Pure (no Firebase) so
// it is unit-tested directly. The CLIENT does the authoritative validation via
// coerceStudyBlocks (studySchema.js) — this parser only produces best-effort
// JSON and never trusts the model blindly.

// The block vocabulary the model may emit. Mirrors src/features/notes/lib/
// studyBlocks.js — keep in sync if block types change.
const BLOCK_SPEC = `
Allowed block objects (emit a JSON array of these, in reading order):
- { "type":"heading", "level":2|3, "text": "..." }   // level 2 = section, 3 = sub-section
- { "type":"paragraph", "text": "... use **bold** for key terms ..." }
- { "type":"bullets", "items": ["...","..."] }
- { "type":"numbers", "items": ["...","..."] }
- { "type":"keyterms", "rows": [{ "term":"...", "def":"..." }] }
- { "type":"keyidea", "text":"the one key idea" }
- { "type":"note", "lines":["..."] }      // 🧠 remember
- { "type":"tip", "lines":["..."] }       // 💡 study tip
- { "type":"summary", "items":["...","..."] }
- { "type":"quickcheck", "q":"...", "a":"...", "level":"Easy|Medium|Exam Level" }
- { "type":"exam", "q":"...", "a":"..." }
- { "type":"mistake", "wrong":"...", "correct":"..." }
- { "type":"table", "headers":["..."], "rows":[{ "cells":["..."] }] }
- { "type":"picture", "caption":"...", "lines":["describe the diagram"] }  // for a diagram you can SEE described but not extract
- { "type":"image", "assetRef":"<the id from a [[IMAGE:id]] marker>", "caption":"..." }  // ONLY when an [[IMAGE:id]] marker is present`

const SYSTEM_PROMPT = `You convert a textbook/notes document into a structured study note for Zambian CBC learners.
Rewrite the content faithfully and comprehensively into the block format below — do NOT summarize away detail; keep the full teaching content, but organize it with clear section headings, paragraphs, key-term tables, and the occasional quick-check.
${BLOCK_SPEC}

Rules:
- Output ONLY a JSON object: { "blocks": [ ... ], "warnings": [ "..." ] }. No prose outside the JSON.
- Start with a level-2 heading for the topic. Use level-2 headings for major sections so the note is navigable.
- Where you see a marker like [[IMAGE:abc123]], emit an { "type":"image", "assetRef":"abc123", "caption":"..." } block AT THAT POSITION. Never invent assetRef ids; only use ids from markers.
- Prefer keyterms blocks for definitions, summary for end-of-section recaps, quickcheck for self-testing.
- Keep learner-friendly Zambian-English wording. Put warnings (e.g. "input looked truncated") in the warnings array.`

// OCR prompt used by the scanned-PDF path (vision → plain text).
const NOTE_OCR_SYSTEM_PROMPT = `You are an OCR engine. Transcribe the text content of each page image faithfully into clean reading-order plain text (markdown headings/lists allowed). Do not summarize, do not add commentary. If a page contains a diagram you cannot transcribe, write a short line like "[Diagram: <what it shows>]". Output only the transcribed text.`

function buildNoteStructureMessages({ fileName = '', documentText = '' }) {
  const user = `File: ${String(fileName || 'document')}\n\nDocument text to convert into a study note:\n"""\n${String(documentText || '').slice(0, 60000)}\n"""`
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ]
}

function stripFences(raw) {
  if (!raw) return ''
  const fence = String(raw).match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return (fence ? fence[1] : String(raw)).trim()
}

// Tolerant parse: accept { blocks, warnings } or a bare blocks array. Keep only
// objects with a string `type`. Throws if no JSON can be recovered at all.
function parseStructuredNote(raw) {
  const text = stripFences(raw)
  let data
  try {
    data = JSON.parse(text)
  } catch {
    // last-ditch: grab the first {...} or [...] span
    const span = text.match(/[[{][\s\S]*[\]}]/)
    if (!span) throw new Error('Could not parse a JSON note from the model output.')
    data = JSON.parse(span[0])
  }
  const rawBlocks = Array.isArray(data) ? data : Array.isArray(data?.blocks) ? data.blocks : null
  if (!rawBlocks) throw new Error('Model output had no blocks array.')
  const blocks = rawBlocks.filter(b => b && typeof b === 'object' && typeof b.type === 'string')
  const warnings = Array.isArray(data?.warnings) ? data.warnings.filter(w => typeof w === 'string') : []
  return { blocks, warnings }
}

module.exports = { buildNoteStructureMessages, parseStructuredNote, NOTE_OCR_SYSTEM_PROMPT, SYSTEM_PROMPT }
```

- [ ] **Step 5: Run to confirm it PASSES**

Run: `npm run test:note-import`
Expected: 5/5 pass.

- [ ] **Step 6: Commit**

```bash
git add functions/noteStructurePrompt.js functions/noteImport.test.js package.json
git commit -m "feat(notes): document-import structuring prompt + parser"
```

---

## Task 3: Server import runners

**Files:**
- Create: `functions/noteImport.js`

- [ ] **Step 1: Read `functions/aiService.js`** to confirm the exact `callAnthropic` signature (it is `callAnthropic(apiKey, { systemPrompt, messages, maxTokens, temperature, json, track, model, tools, toolChoice })`, returns a string). Confirm `parseStructuredNote`/`buildNoteStructureMessages`/`NOTE_OCR_SYSTEM_PROMPT` are exported from `./noteStructurePrompt` (Task 2).

- [ ] **Step 2: Implement** — create `functions/noteImport.js`:

```js
// functions/noteImport.js
//
// Server glue for Notes document import. Anthropic-only:
//   • runNoteImport — document text → study blocks (best-effort JSON; client
//     validates with coerceStudyBlocks)
//   • runNoteOcr    — page images → plain text (vision), for the scanned path
// Both are thin wrappers over aiService.callAnthropic. assertDailyLimit / app
// check / role gating live in the index.js callables that call these.

const { callAnthropic } = require('./aiService')
const { buildNoteStructureMessages, parseStructuredNote, NOTE_OCR_SYSTEM_PROMPT } = require('./noteStructurePrompt')

const STRUCTURE_MODEL = process.env.NOTE_IMPORT_MODEL || undefined // default = aiService default (Sonnet)

async function runNoteImport({ documentText, fileName = '', apiKey, uid }) {
  const messages = buildNoteStructureMessages({ fileName, documentText })
  const systemPrompt = messages[0].content
  const userMessages = [{ role: 'user', content: messages[1].content }]
  const raw = await callAnthropic(apiKey, {
    systemPrompt,
    messages: userMessages,
    maxTokens: 8000,
    temperature: 0.2,
    json: true,
    model: STRUCTURE_MODEL,
    track: { uid, tool: 'structureImportedNote' },
  })
  return parseStructuredNote(raw)
}

// pages: [{ pageNumber, dataUrl }]. Returns { text } — concatenated transcription.
async function runNoteOcr({ pages, apiKey, uid }) {
  const content = []
  for (const p of pages) {
    const m = String(p?.dataUrl || '').match(/^data:(image\/[a-z]+);base64,(.+)$/i)
    if (!m) continue
    content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } })
    content.push({ type: 'text', text: `Page ${p.pageNumber}` })
  }
  if (content.length === 0) return { text: '' }
  const raw = await callAnthropic(apiKey, {
    systemPrompt: NOTE_OCR_SYSTEM_PROMPT,
    messages: [{ role: 'user', content }],
    maxTokens: 8000,
    temperature: 0,
    track: { uid, tool: 'ocrNotePages' },
  })
  return { text: String(raw || '').trim() }
}

module.exports = { runNoteImport, runNoteOcr }
```

> Note: `callAnthropic`'s `messages` accepts Anthropic-shaped content arrays (the quiz vision path uses the same image-block shape). If the local `callAnthropic` expects a different content shape for images, mirror exactly what `functions/scannedQuizImport.js` passes to its Anthropic call (read it and match). Adjust the `content` array shape in `runNoteOcr` to match that proven shape.

- [ ] **Step 3: Verify it requires cleanly**

Run: `node -e "require('./functions/noteImport.js'); console.log('ok')"`
Expected: prints `ok` (no import-time errors).

- [ ] **Step 4: Commit**

```bash
git add functions/noteImport.js
git commit -m "feat(notes): server import runners (structure + OCR)"
```

---

## Task 4: Wire the server callables

**Files:**
- Modify: `functions/index.js`

- [ ] **Step 1: Read** the existing `exports.structureImportedQuiz` and `exports.structureScannedQuiz` blocks in `functions/index.js` and the destructured `require('./aiService')` line at the top. Note the helpers in scope: `getUserRole`, `isStaffRole`, `assertDailyLimit`, `getAnthropicApiKey`, `cleanAiString` (or `cleanString`), `LIMITS`, `recordAppCheckCallable`, `APPCHECK_ENFORCE_CALLABLE`, `anthropicApiKey`, `HttpsError`, `onCall`.

- [ ] **Step 2: Add the require** near the other local requires:

```js
const { runNoteImport, runNoteOcr } = require('./noteImport')
```

- [ ] **Step 3: Add the two callables** (place them right after `exports.structureScannedQuiz`). Match the exact helper names used by the neighbouring quiz callables — if the doc-text cleaner is `cleanAiString`, use it; if it is `cleanString`, use that:

```js
exports.structureImportedNote = onCall(
  {
    secrets: [anthropicApiKey],
    region: 'us-central1',
    timeoutSeconds: 120,
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.')
    recordAppCheckCallable(request, 'structureImportedNote')
    const role = await getUserRole(request.auth.uid)
    if (!isStaffRole(role)) throw new HttpsError('permission-denied', 'Only teachers and admins can import notes.')
    const fileName = cleanAiString(request.data?.fileName, LIMITS.importFileName)
    const documentText = cleanAiString(request.data?.documentText, LIMITS.importDocumentText)
    if (!documentText || documentText.length < 80) {
      throw new HttpsError('invalid-argument', 'Not enough document text was available to build a note.')
    }
    await assertDailyLimit(request.auth.uid, role, 'importNote')
    return runNoteImport({ documentText, fileName, apiKey: getAnthropicApiKey(anthropicApiKey), uid: request.auth.uid })
  },
)

exports.ocrNotePages = onCall(
  {
    secrets: [anthropicApiKey],
    region: 'us-central1',
    timeoutSeconds: 240,
    memory: '1GiB',
    enforceAppCheck: APPCHECK_ENFORCE_CALLABLE,
    consumeAppCheckToken: true,
  },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Please sign in first.')
    recordAppCheckCallable(request, 'ocrNotePages')
    const role = await getUserRole(request.auth.uid)
    if (!isStaffRole(role)) throw new HttpsError('permission-denied', 'Only teachers and admins can import notes.')
    const pages = Array.isArray(request.data?.pages) ? request.data.pages : []
    if (!pages.length) throw new HttpsError('invalid-argument', 'No page images were supplied.')
    if (pages.length > 8) throw new HttpsError('invalid-argument', 'Too many pages in one OCR call (max 8).')
    await assertDailyLimit(request.auth.uid, role, 'importNote')
    return runNoteOcr({ pages, apiKey: getAnthropicApiKey(anthropicApiKey), uid: request.auth.uid })
  },
)
```

> If `cleanAiString` is not the name used by the quiz callables (it may be `cleanString`), use whichever those callables use, with the same `LIMITS.*` length constants.

- [ ] **Step 4: Lint the functions**

Run: `npm run lint`
Expected: PASS (no new errors in `functions/index.js`).

- [ ] **Step 5: Commit**

```bash
git add functions/index.js
git commit -m "feat(notes): structureImportedNote + ocrNotePages callables"
```

---

## Task 5: Client AI callable wrappers

**Files:**
- Modify: `src/utils/aiAssistant.js`

- [ ] **Step 1: Read** `src/utils/aiAssistant.js` — note the `functions` instance, the existing `httpsCallable(functions, 'structureImportedQuiz')` pattern, `withTimeout`, `messageFromError`, and the timeout constants.

- [ ] **Step 2: Add** the two callables + wrappers (mirror `structureImportedQuiz`/`structureScannedQuiz`):

```js
const structureImportedNoteCallable = httpsCallable(functions, 'structureImportedNote')
const ocrNotePagesCallable = httpsCallable(functions, 'ocrNotePages')

export async function structureImportedNote(payload) {
  try {
    const response = await withTimeout(
      structureImportedNoteCallable(payload),
      AI_IMPORT_TIMEOUT_MS,
      'Building the note is taking too long. Please try again.',
    )
    const data = response.data || {}
    return {
      blocks: Array.isArray(data.blocks) ? data.blocks : [],
      warnings: Array.isArray(data.warnings) ? data.warnings : [],
    }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}

export async function ocrNotePages(payload) {
  try {
    const response = await withTimeout(
      ocrNotePagesCallable(payload),
      AI_SCANNED_IMPORT_TIMEOUT_MS,
      'Reading the scanned pages is taking too long. Please try a smaller file.',
    )
    return { text: String(response.data?.text || '') }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}
```

(Use the same timeout constants the quiz wrappers use — `AI_IMPORT_TIMEOUT_MS`, `AI_SCANNED_IMPORT_TIMEOUT_MS`.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/utils/aiAssistant.js
git commit -m "feat(notes): client wrappers for note import callables"
```

---

## Task 6: Client orchestrator + pure helpers

**Files:**
- Create: `src/features/notes/lib/noteImport.js`
- Create: `src/features/notes/lib/noteImport.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing test** — create `src/features/notes/lib/noteImport.test.js` (tests ONLY the pure helpers; the File/pdf/Storage parts are integration-only):

```js
#!/usr/bin/env node
/**
 * Tests for the pure helpers in the notes document-import orchestrator.
 * Run: npm run test:note-import-client  (also via npm run test:all)
 */
const {
  buildDocumentTextWithMarkers, resolveImageBlocks, IMAGE_MARKER_RE,
} = await import('../../../../src/features/notes/lib/noteImport.js')

let pass = 0, fail = 0
const failures = []
function test(name, fn) {
  try { fn(); pass++; console.log(`  ok  ${name}`) }
  catch (err) { fail++; failures.push({ name, err }); console.log(`  XX  ${name} — ${err.message}`) }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed') }

console.log('\nnote import (client) — pure helpers')

test('buildDocumentTextWithMarkers interleaves [[IMAGE:id]] markers in block order', () => {
  const blocks = [
    { text: 'Intro paragraph.', assets: [{ id: 'a1' }] },
    { text: 'Second paragraph.', assets: [] },
  ]
  const text = buildDocumentTextWithMarkers(blocks)
  assert(text.includes('Intro paragraph.'), 'keeps text')
  assert(text.includes('[[IMAGE:a1]]'), 'adds marker for asset a1')
  assert(text.indexOf('Intro') < text.indexOf('[[IMAGE:a1]]'), 'marker comes after its block text')
  assert(text.indexOf('[[IMAGE:a1]]') < text.indexOf('Second paragraph'), 'marker stays in document order')
})

test('resolveImageBlocks replaces assetRef with an uploaded url and drops unresolved', () => {
  const blocks = [
    { type: 'paragraph', text: 'hi' },
    { type: 'image', assetRef: 'a1', caption: 'Cell diagram' },
    { type: 'image', assetRef: 'missing', caption: 'gone' },
  ]
  const urls = new Map([['a1', 'https://store/a1.jpg']])
  const out = resolveImageBlocks(blocks, urls)
  assert(out.length === 2, `expected 2 blocks (unresolved image dropped), got ${out.length}`)
  const img = out.find(b => b.type === 'image')
  assert(img && img.url === 'https://store/a1.jpg' && !('assetRef' in img), 'image block must carry url and drop assetRef')
  assert(img.caption === 'Cell diagram', 'caption preserved')
})

test('IMAGE_MARKER_RE matches the marker and captures the id', () => {
  const m = '[[IMAGE:xY_9]]'.match(IMAGE_MARKER_RE)
  assert(m && m[1] === 'xY_9', 'should capture the asset id')
})

console.log(`\n─── ${pass + fail} tests · ${pass} passed · ${fail} failed ───`)
if (fail > 0) { for (const f of failures) console.error(`\n✖ ${f.name}\n  ${f.err.stack || f.err.message}`); process.exit(1) }
```

- [ ] **Step 2: Add the npm script** — in `package.json`, add `"test:note-import-client": "node src/features/notes/lib/noteImport.test.js",` and append ` && npm run test:note-import-client` to `test:all`.

- [ ] **Step 3: Run to confirm it FAILS**

Run: `npm run test:note-import-client`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** — create `src/features/notes/lib/noteImport.js`:

```js
// src/features/notes/lib/noteImport.js
//
// Client orchestrator for Notes document import. Reuses the quiz importer's
// DOCX/PDF extraction primitives and image-upload helper; calls the
// structureImportedNote / ocrNotePages callables; resolves [[IMAGE:id]] markers
// to uploaded Storage URLs. Returns { blocks, warnings } for the editor.
//
// Pure helpers (buildDocumentTextWithMarkers, resolveImageBlocks) are unit
// tested; the File/pdf/Storage paths are integration-only.

import { extractDocx, extractPdf, loadPdfDocument, renderPdfPageSnapshot } from '../../../components/quiz/documentQuizImporter.js'
import { uploadImportedAssets } from '../../../utils/quizDocumentImport.js'
import { structureImportedNote, ocrNotePages } from '../../../utils/aiAssistant'
import { coerceStudyBlocks } from './studySchema'
import { storage } from '../../../firebase/config'

export const IMAGE_MARKER_RE = /\[\[IMAGE:([A-Za-z0-9_-]+)\]\]/

const OCR_BATCH = 6      // pages per ocrNotePages call (server caps at 8)
const MAX_OCR_PAGES = 40 // bound total scanned pages per import

/** Build the document text the AI sees: each block's text followed by an
 *  [[IMAGE:id]] marker for every asset on that block, in document order. */
export function buildDocumentTextWithMarkers(blocks) {
  const parts = []
  for (const b of blocks || []) {
    if (b?.text) parts.push(String(b.text))
    for (const a of b?.assets || []) {
      if (a?.id) parts.push(`[[IMAGE:${a.id}]]`)
    }
  }
  return parts.join('\n\n')
}

/** Replace each image block's assetRef with the uploaded url; drop unresolved. */
export function resolveImageBlocks(blocks, urlById) {
  const out = []
  for (const b of blocks || []) {
    if (b?.type === 'image') {
      const url = b.assetRef ? urlById.get(b.assetRef) : (b.url || '')
      if (!url) continue
      const next = { ...b, url }
      delete next.assetRef
      out.push(next)
    } else {
      out.push(b)
    }
  }
  return out
}

// Collect the flat {id: asset} map + id list referenced by markers in `blocks`.
function assetMapFor(extractedBlocks) {
  const map = {}
  for (const b of extractedBlocks || []) {
    for (const a of b?.assets || []) if (a?.id) map[a.id] = a
  }
  return map
}

async function extractTextNote(file) {
  const isPdf = /\.pdf$/i.test(file.name)
  const extracted = isPdf ? await extractPdf(file) : await extractDocx(file)
  const documentText = buildDocumentTextWithMarkers(extracted.blocks)
  return { documentText, assets: assetMapFor(extracted.blocks), warnings: extracted.warnings || [] }
}

async function ocrScannedPdf(file, onProgress) {
  const { pdf } = await loadPdfDocument(file)
  const total = Math.min(pdf.numPages, MAX_OCR_PAGES)
  const pageImages = []
  for (let n = 1; n <= total; n++) {
    onProgress?.({ phase: 'rendering', current: n, total })
    const page = await pdf.getPage(n)
    const asset = await renderPdfPageSnapshot(page, n, [])
    if (asset?.blob) {
      const dataUrl = await blobToDataUrl(asset.blob)
      pageImages.push({ pageNumber: n, dataUrl })
    }
  }
  let text = ''
  for (let i = 0; i < pageImages.length; i += OCR_BATCH) {
    onProgress?.({ phase: 'reading', current: i, total: pageImages.length })
    const batch = pageImages.slice(i, i + OCR_BATCH)
    const res = await ocrNotePages({ pages: batch })
    text += '\n\n' + (res.text || '')
  }
  return { documentText: text.trim(), assets: {}, warnings: [] }
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result)
    r.onerror = reject
    r.readAsDataURL(blob)
  })
}

/**
 * Import a document into study blocks.
 * @param {{ kind:'paste'|'file', file?:File, text?:string, uid:string, onProgress?:Function }} args
 * @returns {Promise<{ blocks: object[], warnings: string[] }>}
 */
export async function importNoteDocument({ kind, file, text, uid, onProgress }) {
  let documentText = ''
  let assets = {}
  let warnings = []

  if (kind === 'paste') {
    documentText = String(text || '')
  } else if (file) {
    const isScanned = /\.pdf$/i.test(file.name) && (await looksScanned(file))
    const r = isScanned ? await ocrScannedPdf(file, onProgress) : await extractTextNote(file)
    documentText = r.documentText; assets = r.assets; warnings = r.warnings
  }

  if (!documentText || documentText.trim().length < 80) {
    throw new Error('Not enough readable text was found in this document.')
  }

  const structured = await structureImportedNote({ fileName: file?.name || 'pasted text', documentText })
  warnings = warnings.concat(structured.warnings || [])

  // Resolve any [[IMAGE]] blocks the model emitted.
  const referenced = new Set(structured.blocks.filter(b => b?.type === 'image' && b.assetRef).map(b => b.assetRef))
  let urlById = new Map()
  if (referenced.size > 0 && Object.keys(assets).length > 0) {
    urlById = await uploadImportedAssets({
      storage, uid, assets, assetIds: [...referenced], kindSlug: 'note',
      sourceFileName: file?.name || '',
    })
  }
  const resolved = resolveImageBlocks(structured.blocks, urlById)
  return { blocks: coerceStudyBlocks(resolved), warnings }
}

// Heuristic: a PDF with almost no extractable text is "scanned". Extract first,
// fall back to OCR when the text is too thin.
async function looksScanned(file) {
  try {
    const extracted = await extractPdf(file)
    const txt = buildDocumentTextWithMarkers(extracted.blocks).replace(IMAGE_MARKER_RE, '').trim()
    return txt.length < 200
  } catch {
    return true
  }
}
```

> Implementation note: `extractPdf` is called twice for a scanned check + OCR fallback — acceptable for correctness; if the extracted text is sufficient, `extractTextNote` re-extraction is the only redundancy. If profiling shows this is slow on large PDFs, thread the first extraction result through. Keep it simple for v1.

- [ ] **Step 5: Run to confirm it PASSES**

Run: `npm run test:note-import-client`
Expected: 3/3 pass. (Only the pure helpers are exercised; the imports of firebase/pdf modules are tree-shaken away by Node? — if Node errors on importing the firebase/pdf modules, move the two pure helpers into a sibling `noteImportCore.js` with NO heavy imports and import THAT from both `noteImport.js` and the test. Prefer this split if the test can't load the module.)

- [ ] **Step 6: Commit**

```bash
git add src/features/notes/lib/noteImport.js src/features/notes/lib/noteImport.test.js package.json
git commit -m "feat(notes): client document-import orchestrator + helpers"
```

> If Step 5 required the `noteImportCore.js` split, include that file in the commit and adjust imports.

---

## Task 7: Import panel UI

**Files:**
- Create: `src/features/notes/components/ImportNotePanel.jsx`

- [ ] **Step 1: Read** `src/components/quiz/ImportQuizPanel.jsx` for structure/styling reference and `QUIZ_DOCUMENT_ACCEPT` from `documentQuizImporter.js`.

- [ ] **Step 2: Implement** — create `src/features/notes/components/ImportNotePanel.jsx`:

```jsx
// src/features/notes/components/ImportNotePanel.jsx
//
// Admin UI to import a document (paste / DOCX / PDF / scanned PDF) into a study
// note. Presentational: it collects input + shows progress/warnings and calls
// onImport({ kind, file, text }). The page owns the actual import + navigation.

import { useRef, useState } from 'react'
import { Upload, Loader2, FileType, AlertCircle } from '../../../components/ui/icons'

const ACCEPT = '.doc,.docx,.pdf'

export function ImportNotePanel({ importing, progress, warnings, onImport }) {
  const fileRef = useRef(null)
  const [text, setText] = useState('')

  const pickFile = () => fileRef.current?.click()
  const onFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onImport({ kind: 'file', file })
  }

  return (
    <div className="space-y-5">
      <div className="notes-card p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-10 h-10 rounded-xl grid place-items-center border-2 border-[#0F1B2D] bg-[#FFEDD5]" style={{ boxShadow: '0 2px 0 #0F1B2D' }}>
            <FileType size={18} className="text-[#C2410C]" />
          </span>
          <div>
            <h2 className="font-display text-xl text-[#0F1B2D]">Import a document</h2>
            <p className="text-[13px] text-[#4A5A6E]">Word, PDF, or a scanned PDF — we’ll turn it into a study note for you to review.</p>
          </div>
        </div>
        <button
          type="button" onClick={pickFile} disabled={importing}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-white text-sm font-bold disabled:opacity-50"
          style={{ backgroundColor: '#FF7A1A' }}
        >
          {importing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {importing ? 'Importing…' : 'Choose a file'}
        </button>
        <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={onFile} />
        {progress && (
          <p className="text-xs text-[#4A5A6E] mt-3">
            {progress.phase === 'rendering' ? 'Rendering pages' : 'Reading pages'} · {progress.current}/{progress.total}
          </p>
        )}
      </div>

      <div className="notes-card p-6">
        <h3 className="font-display text-lg text-[#0F1B2D] mb-2">…or paste text</h3>
        <textarea
          value={text} onChange={e => setText(e.target.value)} rows={8} disabled={importing}
          placeholder="Paste notes or a chapter here…"
          className="w-full rounded-xl border-2 border-[#0F1B2D] p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF7A1A]/40"
        />
        <button
          type="button" disabled={importing || text.trim().length < 80}
          onClick={() => onImport({ kind: 'paste', text })}
          className="mt-3 inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0F1B2D] text-white text-sm font-semibold disabled:opacity-50"
        >
          {importing ? <Loader2 size={15} className="animate-spin" /> : null} Build note from text
        </button>
      </div>

      {warnings?.length > 0 && (
        <div className="notes-card p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-[#9F1239] mb-2"><AlertCircle size={15} /> Warnings</div>
          <ul className="list-disc pl-5 text-[13px] text-[#4A5A6E] space-y-1">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

export default ImportNotePanel
```

> Confirm `Upload`, `Loader2`, `FileType`, `AlertCircle` are exported from `../../../components/ui/icons` (they are used elsewhere in the notes feature). If any is missing, pick the nearest existing icon and note it.

- [ ] **Step 3: Build + lint**

Run: `npm run lint && npm run build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/features/notes/components/ImportNotePanel.jsx
git commit -m "feat(notes): import panel UI"
```

---

## Task 8: Import page + route + entry button

**Files:**
- Create: `src/features/notes/pages/AdminNoteImport.jsx`
- Modify: `src/features/notes/routes/adminRoutes.jsx`
- Modify: `src/features/notes/pages/AdminNotesList.jsx`

- [ ] **Step 1: Read** `src/features/notes/routes/adminRoutes.jsx` (route definitions + how pages are imported — lazy or direct), `src/features/notes/pages/AdminNotesList.jsx` (the action-bar JSX), and the top of `AdminNoteEditor.jsx` to confirm `createNote` usage + the metadata fields a draft needs (`title`, `subject`, `grade`, `createdBy`, `noteFormat:'study'`, `blocks`).

- [ ] **Step 2: Create the page** — `src/features/notes/pages/AdminNoteImport.jsx`:

```jsx
// src/features/notes/pages/AdminNoteImport.jsx
//
// /admin/lessons/import — pick a document or paste text, run the import, then
// create a draft study note and hand off to the editor for review.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../../contexts/AuthContext'
import { ImportNotePanel } from '../components/ImportNotePanel'
import { importNoteDocument } from '../lib/noteImport'
import { createNote } from '../lib/firestore'
import { buildStudyExcerpt } from '../lib/studyBlocks'
import { ArrowLeft } from '../../../components/ui/icons'

export function AdminNoteImport() {
  const navigate = useNavigate()
  const { currentUser } = useAuth()
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState(null)
  const [warnings, setWarnings] = useState([])
  const [error, setError] = useState('')

  const onImport = async ({ kind, file, text }) => {
    setImporting(true); setError(''); setWarnings([]); setProgress(null)
    try {
      const { blocks, warnings: w } = await importNoteDocument({
        kind, file, text, uid: currentUser.uid, onProgress: setProgress,
      })
      if (!blocks.length) throw new Error('No note content could be built from this document.')
      const title = (file?.name || 'Imported note').replace(/\.[^.]+$/, '')
      const id = await createNote({
        title, subject: 'Integrated Science', grade: '7',
        noteFormat: 'study', blocks, excerpt: buildStudyExcerpt(blocks),
        createdBy: currentUser.uid,
      })
      setWarnings(w || [])
      navigate(`/admin/lessons/${id}/edit`)
    } catch (e) {
      setError(e.message || 'Import failed.')
    } finally {
      setImporting(false); setProgress(null)
    }
  }

  return (
    <div className="notes-studio min-h-screen" style={{ backgroundColor: '#F5EFE1' }}>
      <main className="max-w-2xl mx-auto px-4 py-8">
        <button onClick={() => navigate('/admin/lessons')} className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0F1B2D] mb-6">
          <ArrowLeft size={15} /> All notes
        </button>
        <h1 className="font-display text-3xl text-[#0F1B2D] mb-1">Import a note</h1>
        <p className="text-sm text-[#4A5A6E] mb-6">Subject + grade default to Integrated Science · Grade 7 — change them in the editor after import.</p>
        {error && <div className="notes-card p-3 mb-4 text-sm text-[#9F1239]">{error}</div>}
        <ImportNotePanel importing={importing} progress={progress} warnings={warnings} onImport={onImport} />
      </main>
    </div>
  )
}

export default AdminNoteImport
```

> The created draft defaults subject/grade to `Integrated Science` / `7`; the admin sets the real values in the editor (the editor already requires them before publish). If `createNote` rejects a default subject not in the curriculum, use a valid subject label from `src/config/curriculum.js` — read `getSubjectsForGrade('7')` to confirm a safe default.

- [ ] **Step 3: Add the route** in `src/features/notes/routes/adminRoutes.jsx` — mirror how the existing `/admin/lessons/new` route is declared (lazy import + element). Add a route for `path: 'import'` (relative) → `<AdminNoteImport />`, placed alongside the `new` and `:id/edit` routes. Match the file's existing lazy/eager import style exactly.

- [ ] **Step 4: Add the entry button** in `src/features/notes/pages/AdminNotesList.jsx` action bar — add, before the "New note" button:

```jsx
  <button
    onClick={() => navigate('/admin/lessons/import')}
    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-white text-sm font-medium transition hover:scale-[1.02] active:scale-[0.98] shadow-sm bg-emerald-700"
  >
    <Upload size={16} /> Import document
  </button>
```

Add `Upload` to the icon import in `AdminNotesList.jsx` if not already imported.

- [ ] **Step 5: Build + lint**

Run: `npm run lint && npm run build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/features/notes/pages/AdminNoteImport.jsx src/features/notes/routes/adminRoutes.jsx src/features/notes/pages/AdminNotesList.jsx
git commit -m "feat(notes): import page, route, and admin entry button"
```

---

## Task 9: Full verification

**Files:** none

- [ ] **Step 1: Tests**

Run: `npm run test:note-import && npm run test:note-import-client && npm run test:study-blocks`
Expected: all pass.

- [ ] **Step 2: Lint + build**

Run: `npm run lint && npm run build`
Expected: clean.

- [ ] **Step 3: Functions lint/syntax**

Run: `node -e "require('./functions/noteImport.js'); require('./functions/noteStructurePrompt.js'); console.log('functions ok')"`
Expected: `functions ok`.

- [ ] **Step 4: Preview note** — in-browser verification of the import flow needs the owner's `.env` + a signed-in admin; if unavailable in this environment, record that the visual/end-to-end check is deferred to the deployed site (same limitation as Phase 1). Do NOT claim a passing manual run that wasn't performed.

---

## Task 10: Open the PR

**Files:** none

- [ ] **Step 1: Push** `git push -u origin claude/notes-phase2-import`
- [ ] **Step 2: Open the PR** with `gh pr create -R Mwelwa-cyber/Zedexams` — title "Notes Studio: document import (paste / DOCX / PDF / scanned OCR → study note)"; body summarizing the import flow, the new callables (`structureImportedNote`, `ocrNotePages`), reuse of the quiz extraction pipeline, the test plan (`test:note-import`, `test:note-import-client`), and an explicit unchecked box for the in-browser end-to-end check (no `.env` in build env). End the body with the Claude Code footer.
- [ ] **Step 3: Self-merge** (only after the user confirms) `gh pr merge <num> --auto --squash --delete-branch -R Mwelwa-cyber/Zedexams`.

> Deploy note: this PR adds Cloud Functions (`structureImportedNote`, `ocrNotePages`) → `deploy-firebase.yml` ships them on merge. No `firebase.json` hosting rewrite is needed (callables, not `onRequest`).

---

## Self-review notes

- **Spec coverage (§4.4):** extract DOCX/text-PDF (Task 1 export + Task 6), scanned OCR (Tasks 3,4,6), paste (Task 6), AI structuring (Tasks 2,3,4), draft→review→publish (Task 8 + existing editor), images extracted (Task 6 markers + `uploadImportedAssets`), daily caps + app check + staff guard (Task 4), one note per import (Task 8). Tests (Tasks 2,6).
- **Name/type consistency:** `buildNoteStructureMessages`/`parseStructuredNote`/`NOTE_OCR_SYSTEM_PROMPT` defined in Task 2, consumed in Task 3. `runNoteImport`/`runNoteOcr` (Task 3) consumed in Task 4. `structureImportedNote`/`ocrNotePages` callables (Task 4) ↔ client wrappers (Task 5) ↔ orchestrator (Task 6). `[[IMAGE:id]]` marker built in `buildDocumentTextWithMarkers` and consumed by the prompt (Task 2) + `resolveImageBlocks` (Task 6); `IMAGE_MARKER_RE` shared. `coerceStudyBlocks` is the single validation authority (client).
- **Reuse, not rebuild:** extraction (`extractDocx`/`extractPdf`/`renderPdfPageSnapshot`/`loadPdfDocument`), `uploadImportedAssets`, `callAnthropic`/`assertDailyLimit`/`getAnthropicApiKey` all reused.
- **Open risks the implementer must confirm against real code:** exact `cleanAiString` vs `cleanString` name + `LIMITS.*` keys in `functions/index.js` (Task 4); the Anthropic image-content shape `callAnthropic` expects (Task 3 — mirror `scannedQuizImport.js`); whether the Node test can import `noteImport.js` given its firebase/pdf imports (Task 6 — split into `noteImportCore.js` if not); the adminRoutes import style (Task 8).
