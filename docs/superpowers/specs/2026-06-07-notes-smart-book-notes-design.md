# Notes Studio — Full Book Notes + Smart Reading (design)

> Snapshot as of 2026-06-07 — verify before acting.

## 1. Summary

ZedExams Notes Studio currently serves short, summarized study notes. This upgrade lets the
platform carry **comprehensive per-topic notes** (one note = one full topic/chapter, much longer
and more detailed than today's summaries) and adds a **smart reading layer** that keeps that length
digestible for learners:

- **AI auto-highlight** — important sentences / list-items are marked so the learner's eye is pulled
  to what matters. ON by default, learner-toggleable.
- **Section summaries** — a short TL;DR per section.
- **Table-of-contents navigation** — jump between sections inside a long note.
- **Document import** — the authoring path for these notes: DOCX / text-PDF / scanned-PDF (OCR) /
  pasted text → a structured `study` note draft for admin review.

Chosen approach: **extend the existing `study` note format** (one note per topic) plus a
server-cached "smart" sidecar. No multi-chapter "book" object is built (deferred — see §10).

Decisions locked during brainstorming:
- Note shape: **comprehensive per-topic** (Approach 1), not multi-chapter books.
- Highlighting: **AI auto-highlights** (system marks important info; not learner-applied highlighter).
- Authoring: **import from documents** — all of DOCX, text-PDF, scanned-PDF (OCR), pasted text.
- Highlights **ON by default**.
- Build order: **Phase 1 (reading foundation) first.**

## 2. Goals / non-goals

**Goals**
- Support long, comprehensive `study` notes without breaking the existing reader/editor.
- Make long notes navigable (TOC / jump) and digestible (auto-highlight + section summaries).
- Provide an admin import flow that turns documents (or pasted text) into structured study notes.

**Non-goals (this upgrade)**
- Multi-chapter "book" objects with cross-chapter progress (deferred; data model stays compatible).
- Per-learner manual highlighting / annotations.
- In-note conversational tutor and auto-generated practice questions (listed as future "etc").
- Changing the other note formats (`rich_text`, `file`, `visual_slides`).

## 3. Current-state baseline (what already exists)

- Notes live in the `lessons` collection. `study` format stores `blocks[]`
  (`src/features/notes/lib/studySchema.js`, `MAX_STUDY_BLOCKS = 200`), rendered by
  `StudyNoteReader.jsx`. `heading` blocks already support level 2/3 → sections are expressible.
- Learner reader: `src/features/notes/pages/LearnerNoteRead.jsx` + `ReaderControls.jsx`
  (scroll progress bar, reading-time, Listen/read-aloud) + `NoteInsights.jsx`
  (on-demand AI Summary + Key Points).
- AI insights pattern to mirror: Cloud Function `generateNoteInsights` → cached in
  `noteInsights/{noteId}`; client read-through in `src/features/notes/lib/insights.js`.
- Per-learner progress: `noteProgress/{uid}_{noteId}` via `lib/progress.js` +
  `useRecordNoteProgress.js` (open / scroll-% / completed).
- Parsing libs already installed: `mammoth` + `pdf-parse` (functions), `pdfjs-dist` (app).
  No OCR lib — Gemini vision (Firebase AI Logic / `geminiClient.js`) covers scanned pages.
- Anthropic generators pattern: `functions/teacherTools/*` (prompt + JSON schema + runner),
  shared `aiService.callAnthropic`, daily caps via `usageMeter.js` / `assertDailyLimit`.

## 4. Architecture

```
ADMIN (Phase 2)                              LEARNER (Phases 1, 3, 4)
 file/paste ─► importNoteDocument ─► draft        /notes/:id reader
   DOCX  → mammoth        (callable CF) study        ├─ TOC + jump nav        (P1, client-only, from headings)
   txtPDF→ pdf-parse                   blocks[]      ├─ auto-highlight toggle (P3)
   scanPDF→ Gemini OCR                    │          └─ section summaries     (P4)
   paste → raw text                       ▼                 ▲
        └─ AI structurer (Anthropic) ─► review/publish      │ read-through cache
                                                     noteSmart/{noteId}  ◄─ generateNoteSmart (CF, Anthropic)
                                                     { highlights, sections[] }   (mirrors noteInsights)
```

### 4.1 Data model

- **Note** (unchanged shape, `noteFormat: 'study'`): keep storing `study` blocks inline.
  - Raise `MAX_STUDY_BLOCKS` from 200 → **600**, AND add a **serialized-size guard** in the write
    path so a note can't exceed a safe fraction of Firestore's 1 MB doc limit (target ≤ ~700 KB
    serialized blocks; reject with a clear authoring error above that).
  - Sections derive from existing `heading` blocks: `level: 2` = section, `level: 3` = subsection.
    No new block type.
  - The importer assigns a **stable `id`** to every block (e.g. `b{index}` or a short uid) so the
    smart sidecar can key highlights/summaries to blocks reliably. Existing notes without ids fall
    back to array-index keys.

- **`noteSmart/{noteId}`** (new collection, mirrors `noteInsights`):
  ```
  {
    highlights: { [blockKey]: [ { text: string, kind: 'definition'|'key-fact'|'term'|'formula'|'exam' } ] },
    sections:   [ { key: string, title: string, summary: string } ],
    contentHash: string,   // hash of normalized blocks; regen trigger
    model: string,
    generatedAt: Timestamp
  }
  ```
  - `blockKey` = block `id` when present, else string index.
  - Lazy-generated + cached read-through (same flow as insights). Regenerated when `contentHash`
    differs from the live note's blocks.
  - **Firestore rules**: learners may read `noteSmart/*`; only the Cloud Function (admin/server
    context) writes — mirror the existing `noteInsights` rule.

### 4.2 Smart-layer mechanics

- **Highlight granularity = sentence / list-item level** (not arbitrary character spans). The AI
  returns important excerpts quoted exactly from a block; the reader splits each prose block into
  sentences / list items and wraps any that match an important excerpt in `<mark>`.
  - Matcher is a **pure, unit-tested** function: normalize (trim, collapse whitespace, case-fold),
    match first occurrence, **skip gracefully** when an excerpt isn't found (never throw, never
    corrupt output).
  - This deliberately avoids colliding with the existing `mdInline` `**bold**`/`*italic*` renderer;
    highlight wrapping is applied per sentence/item, composed with the existing inline markdown.
  - Key *terms* continue to use the `keyterms` block; `kind: 'term'` highlights may also mark a term
    inside prose where it's defined.
- **Toggle**: highlights **ON by default**; a control in `ReaderControls` toggles them; the
  preference persists in `localStorage` (per-device, no schema change).
- **Section summaries**: a collapsible "Section summary" chip rendered at each section start and
  echoed inside the TOC. The existing whole-note AI Summary (`NoteInsights`) is unchanged.

### 4.3 Navigation (Phase 1, client-only)

- TOC is derived **client-side** from `heading` blocks — no AI, no new storage.
- Presentation: a jump list (drawer on mobile, side rail on ≥lg) with anchor links; the active
  section is tracked on scroll via `IntersectionObserver` and highlighted in the TOC.
- Section anchors get stable ids so deep links (`/notes/:id#section-key`) and "jump" work.
- Existing scroll progress bar + reading time stay; we additionally surface the current section.

### 4.4 Import pipeline (Phase 2)

New callable Cloud Function `importNoteDocument({ kind, source, meta })`:
1. **Extract text**
   - `docx` → `mammoth` → HTML/text.
   - `pdf_text` → `pdf-parse` → text.
   - `pdf_scanned` → **Gemini vision OCR** (pages as images / PDF input) → text.
   - `paste` → raw text used directly.
2. **Structure** raw text → `blocks[]` via an Anthropic (`aiService`) call with a dedicated prompt +
   the study-block JSON schema (mirrors `teacherTools/*`). Output validated by
   `studyBlocksWriteSchema`; block ids assigned.
3. **Create draft** → `createNote` (status draft) → admin reviews/edits in the existing
   `StudyNoteEditor` → `publishNote`.

Cost/abuse control: route through `assertDailyLimit` / `usageMeter`. Admin-only (gated by existing
notes admin guard). Callable (no `firebase.json` hosting rewrite needed). Scanned-PDF OCR is the
highest-effort/highest-cost path; bound page count per import.

## 5. Phase plan (each its own self-merged PR)

- **Phase 1 — Reading foundation (learner).** TOC + jump nav + active-section tracking; raise block
  cap + size guard; long-content reader polish (section anchors, back-to-top). Ships value on
  today's notes immediately. No AI. **Built first.**
- **Phase 2 — Document import (admin).** `importNoteDocument` callable (DOCX / text-PDF /
  scanned-PDF OCR / paste → AI structurer → draft) + import UI in the notes admin.
- **Phase 3 — AI auto-highlight (learner).** `generateNoteSmart` CF + `noteSmart` cache + reader
  `<mark>` rendering + ON-by-default toggle.
- **Phase 4 — Smart section summaries (learner).** Per-section summaries in the `noteSmart` sidecar,
  surfaced in the TOC and at section starts.

## 6. Testing

Repo convention: plain `node` test scripts added to `test:all`.
- `test:notes-smart` — highlight sentence/item matcher (match, normalize, graceful no-match) and
  TOC-from-headings derivation (pure functions).
- `test:notes-import` — structurer output validates against `studyBlocksWriteSchema`; text
  extraction/cleanup helpers.
- Reuse `test:schema` / study-schema coverage for the raised cap + size guard.
- Reader UI (TOC, highlights, summaries) verified via the preview tooling, not unit assertions.

## 7. Security / rules / cost

- `noteSmart/{noteId}`: learner read; server-only write (mirror `noteInsights`).
- Import + smart generation are AI calls → daily caps via `usageMeter` / `assertDailyLimit`;
  smart layer cached per note so repeat learners pay nothing.
- Import is admin-only; OCR page count bounded per request.
- No secrets client-side; OCR/structuring run in Cloud Functions.

## 8. Risks & mitigations

- **Highlight matching drift** (AI quote ≠ source text) → normalized matcher + graceful skip; unit
  tested.
- **AI structuring quality** on messy/scanned input → admin review gate before publish.
- **Firestore 1 MB doc limit** for long notes → 600-block cap + serialized-size guard; one note per
  topic.
- **AI cost** → caching + daily caps; OCR bounded.

## 9. Deploy notes

- `noteSmart` rule + the new callables ship via CI (`deploy-firebase.yml`), never hand-deployed.
- New Firestore composite indexes (if any) deploy via `firebase deploy --only firestore:indexes`
  before code that queries them.
- Each phase = its own PR, self-merged via `gh pr merge --auto --squash` per CLAUDE.md.

## 10. Deferred / future ("etc")

- Multi-chapter **book** objects (chapters subcollection, cross-chapter progress) — `noteSmart` and
  per-topic notes remain compatible with a later book layer.
- **Ask Zed about this note** (in-context tutor) and **auto-generated practice questions** per
  section.
- Per-learner manual highlights / saved excerpts.
