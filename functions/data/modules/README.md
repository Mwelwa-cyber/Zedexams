# Curriculum modules (parsed from CDC teaching modules)

> Snapshot as of 2026-06-14 — verify before acting.

These JSON files are curriculum **modules** — one entry per `(sub-topic, term)`
— parsed from official Zambian **Curriculum Development Centre (CDC) 2025/2026
Teaching Module** PDFs by `scripts/curriculum/parse-cdc-module.mjs`. Each entry
matches `functions/teacherTools/curriculumModuleSchema.js` (the same validator
the importer and the AI grounding resolver trust), so every row here is
schema-valid.

They are the "additional curriculum source" the studios fall back to: once
imported they ground the Scheme of Work, Lesson Plan and Weekly Forecast (see
`resolveTermModuleOutline` / `resolveCbcContext` in `cbcKnowledge.js`).

## What's here

| File | Grade | Subject | Term(s) | Modules |
|---|---|---|---|---|
| `expressive_arts_g4_t1-2.json` | **G4 (live)** | Expressive Arts | 1 & 2 | 14 |
| `english_g8_t2.json` | G8 (Form 1) | English | 2 | 6 |
| `civic_education_g8_t1.json` | G8 (Form 1) | Civic Education | 1 | 10 |
| `civic_education_g8_t2.json` | G8 (Form 1) | Civic Education | 2 | 3 |
| `commerce_g8_t1.json` | G8 (Form 1) | Commerce | 1 | 4 |
| `creative_and_technology_studies_ece_t1.json` | ECE [3–4] | CTS | 1 | 11 |
| `creative_and_technology_studies_ece_t2.json` | ECE [3–4] | CTS | 2 | 7 |
| `creative_and_technology_studies_g1_t2.json` | G1 | CTS | 2 | 9 |
| `creative_and_technology_studies_g1_t3.json` | G1 | CTS | 3 | 8 |

`Form 1 = Grade 8`. Only **Expressive Arts G4** is inside the platform's live
Grade 4–7 band today; the rest are Junior-Secondary / ECE / Grade 1 and ground
those grades when they go live. Note the Scheme-of-Work generator's
`ALLOWED_SUBJECTS` currently includes `civic_education` and `expressive_arts`
but **not** `commerce`, so a Commerce scheme won't generate until that subject
is wired up — the modules still store and ground other tools.

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
against the source PDFs to regenerate.

## Not auto-parsed (need manual authoring)

Two source PDFs don't expose competences/sub-topics cleanly enough to parse:

- **Design & Technology (Form 1)** — outcomes live in prose, with no
  `Specific Competence:` labels, so nothing validates.
- **Pre-Mathematics/Science (ECE)** — different structure; no specific
  competences captured.

Author these as module JSON by hand (same shape) when needed.

## Importing

These are **drafts for review**, not auto-loaded. After eyeballing a file,
an admin imports it with the existing callable:

```js
// from an admin context
import { getFunctions, httpsCallable } from 'firebase/functions';
const importModules = httpsCallable(getFunctions(), 'importCurriculumModules');
await importModules({ modules: <contents of one JSON file> });
```

`importCurriculumModules` validates every row again, writes to
`cbcKnowledgeBase/{activeVersion}/topics/{topicId}/lessons/{moduleId}` with
`merge:true` (idempotent — safe to re-run), and upserts the parent topic card.
