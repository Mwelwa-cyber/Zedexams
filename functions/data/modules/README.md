# Curriculum modules (parsed from CDC teaching modules)

> Snapshot as of 2026-06-14 — verify before acting.

These JSON files are curriculum **modules** — one entry per `(sub-topic, term)`
— parsed from official Zambian **Curriculum Development Centre (CDC) 2025/26
Teaching Module** PDFs by `scripts/curriculum/parse-cdc-module.mjs`. Each entry
matches `functions/teacherTools/curriculumModuleSchema.js` (the same validator
the importer and the AI grounding resolver trust), so every row here is
schema-valid.

They are the "additional curriculum source" the studios fall back to: once
imported they ground the Scheme of Work, Lesson Plan and Weekly Forecast (see
`resolveTermModuleOutline` / `resolveCbcContext` in `cbcKnowledge.js`).

## What's here — 160 modules across 16 files

| File | Grade | Subject | Term(s) | Modules |
|---|---|---|---|---|
| `english_g8_t2.json` | G8 (Form 1) | English | 2 | 21 |
| `literacy_g1_t2.json` | G1 | Literacy | 2 | 18 |
| `expressive_arts_g4_t1-2.json` | **G4 (live)** | Expressive Arts | 1 & 2 | 16 |
| `literacy_g1_t3.json` | G1 | Literacy | 3 | 16 |
| `creative_and_technology_studies_ece_t1.json` | ECE [3–4] | CTS | 1 | 12 |
| `creative_and_technology_studies_g1_t2.json` | G1 | CTS | 2 | 11 |
| `civic_education_g8_t1.json` | G8 | Civic Education | 1 | 10 |
| `design_and_technology_g8_t1.json` | G8 | Design & Technology | 1 | 9 |
| `creative_and_technology_studies_g1_t3.json` | G1 | CTS | 3 | 8 |
| `creative_and_technology_studies_ece_t2.json` | ECE [3–4] | CTS | 2 | 7 |
| `geography_g8_t2.json` | G8 | Geography | 2 | 7 |
| `food_and_nutrition_g8_t1.json` | G8 | Food & Nutrition | 1 | 6 |
| `oral_english_g1_t3.json` | G1 | Oral English | 3 | 6 |
| `commerce_g8_t1.json` | G8 | Commerce | 1 | 5 |
| `oral_english_g1_t2.json` | G1 | Oral English | 2 | 5 |
| `civic_education_g8_t2.json` | G8 | Civic Education | 2 | 3 |

`Form 1 = Grade 8`. Only **Expressive Arts G4** is inside the platform's live
Grade 4–7 band today; the rest ground Junior-Secondary / ECE / Grade 1 when
those go live. Note the Scheme-of-Work generator's `ALLOWED_SUBJECTS` currently
covers `english`, `civic_education`, `expressive_arts`, `social_studies`, etc.,
but not yet `commerce`, `geography`, `food_and_nutrition`, `oral_english`,
`literacy`, `design_and_technology` — those modules still store and ground other
tools, and the subject just needs wiring into the generator allow-lists.

## How they were generated

```bash
cd functions && npm install   # pdf-parse lives here
node scripts/curriculum/parse-cdc-module.mjs <module.pdf> \
     [--grade G8] [--subject civic_education] [--term 1] [--out path.json]
```

Grade / subject / term are auto-detected from the cover page; pass flags to
override. Combined-term PDFs (e.g. Expressive Arts "Term 1 & 2") are split by
the in-document `TERM n` divider, so one PDF can produce both terms.

The PDFs themselves are **not** committed (large binaries). Re-run the script
against the source PDFs to regenerate. These outputs are **review drafts** —
the parser is best-effort over messy PDFs; skim a file before importing it.

## Source PDFs that didn't parse cleanly (excluded — need manual review)

The parser only keeps schema-valid rows (≥1 specific competence), and four
sources were dropped or under-extracted because their layout hides the
structure:

- **ICT (Form 1)** — `Topic 1:` / `Sub-Topic:` glued mid-line with **no
  `Specific Competence` labels** at all; nothing validated.
- **Literature in English (Form 1, T2)** — set-book / prose driven; only one
  sub-topic carried a usable competence.
- **Pre-Mathematics/Science (ECE)** — different template; competences not
  captured.
- **History (Form 1, T2)** — `TOPIC n.n:` headers parse, but most topics share
  one heavily-merged page and only 2 sub-topics extracted cleanly; treat as
  incomplete and author the rest by hand.

Author these (or fill the gaps) directly as module JSON in the same shape.

## Importing

These are **drafts for review**, not auto-loaded. After eyeballing a file, an
admin imports it with the existing callable:

```js
// from an admin context
import { getFunctions, httpsCallable } from 'firebase/functions';
const importModules = httpsCallable(getFunctions(), 'importCurriculumModules');
await importModules({ modules: <contents of one JSON file> });
```

`importCurriculumModules` validates every row again, writes to
`cbcKnowledgeBase/{activeVersion}/topics/{topicId}/lessons/{moduleId}` with
`merge:true` (idempotent — safe to re-run), and upserts the parent topic card.
