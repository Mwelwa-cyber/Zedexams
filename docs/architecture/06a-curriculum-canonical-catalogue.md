# 06a — Canonical Curriculum Catalogue

> Snapshot as of 2026-07-18 — verify before acting.
> Companion to [`06-curriculum-architecture.md`](./06-curriculum-architecture.md) (the fragmentation audit). This document describes the canonical layer introduced to fix it and the migration path.

## Root cause of the recurring "wrong subjects / no syllabus topics" regression

The subject picker and the topic picker in the Test Paper / Exam Studio were reading from **two different sources that could disagree**:

- **Grade** picker: `useSyllabusLevelOptions` (syllabi-backed) — offers Nursery/Reception for CBC.
- **Subject** picker: `useStudioSubjectChoices` (syllabi-backed) which **prepends the current subject when it isn't in the grade's list** (`syllabusTopicOptions.js:218`, `[current, ...labels]`). So a leftover default like **"Integrated Science"** stayed selected and visible after the grade was switched to **Nursery**, producing the reported list *Integrated Science, English, Expressive Arts, Numeracy (Maths & Science), Zambian Language*.
- **Topic** lookup: keyed off that stale subject (`ECE_N|integrated_science`) → no rows → **"no syllabus topics on file."**

The header's `changeGrade` cleared the topic but **never re-validated the subject**, so an invalid subject from the previous grade (or a default) persisted and broke the topic lookup. This is exactly the class of fallback Phase 3 forbids ("keeps the previous grade's subject after a grade change" / "creates placeholder subject options from saved documents").

More broadly (see 06): ~30 modules re-declared grades/subjects in four ID vocabularies with ~18 translators, so the *same* curriculum + grade produced *different* subjects in different studios.

## The canonical layer

| File | Role |
|---|---|
| `src/config/curriculumCatalog.js` | **The single API.** Pure façade over `teacherTaxonomy.js` (the complete subject × grade × curriculum authority). Stable ids, `CATALOGUE_SCHEMA_VERSION`, `normalize*`, `validateCurriculumSelection`. Fails closed. |
| `src/hooks/useCurriculumSelection.js` | Shared picker controller. Cascading resets (never preserves an invalid downstream value), fail-closed empty state, versioned persistence key, diagnostics. |
| `src/utils/curriculumDiagnostics.js` | Structured, PII-free picker telemetry (`curriculum_picker_*` events), sampled in prod. |
| `src/config/curriculumCatalogBootstrap.js` | Registers the syllabi-backed topic provider + diagnostics sink at startup (`main.jsx`). |

### Public interface (`curriculumCatalog.js`)

```
getCurricula()                                            → [{ id, label, shortLabel, year }]
getGradesForCurriculum(curriculumId)                     → [{ id, label, curriculumId, stageId, stageLabel }]
getSubjectsForGrade(curriculumId, gradeId)               → [{ id, label, curriculumId, gradeId }]   // [] fail-closed
getStudioSubjectIds(studioId, curriculumId, gradeId)     → string[]   // parity contract
getTopicsForSubject(curriculumId, gradeId, subjectId)    → Promise<string[]>   // provider-backed, [] fail-closed
getSubtopicsForTopic(curriculumId, gradeId, subjectId, topicId) → Promise<string[]>
validateCurriculumSelection(selection)                   → { valid, reason, normalized }
normalizeCurriculumId / normalizeGradeId / normalizeSubjectId
```

Canonical ids: curricula `cbc` | `obc`; grades the taxonomy G-codes (`ECE_N`, `G4`, `G8`=Form 1); subjects underscore slugs (`integrated_science`, `numeracy`). **Aliases live only inside the `normalize*` layer** and never manufacture a subject invalid for the resolved curriculum + grade.

### Guarantees enforced by tests

- `scripts/test-curriculum-catalog.mjs` — CBC Nursery expected subjects come **from the taxonomy fixture, not a duplicated array**; CBC/OBC never mix; fail-closed (no global fallback); cross-studio parity (`getStudioSubjectIds` identical across 13 studios and equal to `getSubjectsForGrade`).
- `scripts/test-curriculum-diagnostics.mjs` — event routing, PII-free payloads.
- `scripts/test-curriculum-canon.mjs` — **CI guard**: no *new* hard-coded subject list may appear in `src/components/teacher/**` beyond the frozen debt ledger.
- `src/hooks/useCurriculumSelection.spec.jsx` — the reported bug as a regression: switching grade to Nursery **clears** the stale `integrated_science` instead of preserving it.

## The concrete bug fix shipped alongside

`AssessmentBlocks.jsx` (the Test Paper / Exam Studio header) now snaps the subject to the first valid syllabus subject and drops the stale topic **on a teacher-triggered grade/curriculum change** (`selectionTouched` ref) — never on mount of a freshly-opened saved paper, so a saved subject is not silently rewritten.

## Migration path (remaining work)

The catalogue + hook are the target every studio converges on. The `test:curriculum-canon` ledger tracks the studios still holding local subject lists; each migration deletes an entry. Studios already sourcing subjects from the syllabi service (the `StudioCurriculumSelector` / `CreatePaperModal` family) are behaviourally correct once the stale-subject snap pattern above is applied; the next step is routing them through `useCurriculumSelection` so the parity guarantee is enforced structurally rather than by convention.

## Curriculum → Grade → Subject matrix

Generated from the catalogue (`getSubjectsForGrade`) — regenerate with:
`node -e "import('./src/config/curriculumCatalog.js')…"`. CBC has **no Grade 7 / Grade 12** (3-6-4 restructure); OBC has **no ECE bands**. CBC Nursery/Reception offer exactly the four ECE learning areas — **never Integrated Science** (the reported bug).

See the full table generated in the PR description; the key regression rows:

| Curriculum | Grade | Subjects |
|---|---|---|
| CBC | Nursery (ECE_N) | English Language, Zambian Languages, Pre-Maths & Science, Creative & Technology Studies |
| CBC | Grade 7 (G7) | — (abolished) |
| OBC | Nursery (ECE_N) | — (no ECE in OBC) |
