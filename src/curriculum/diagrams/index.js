/**
 * The curriculum diagram library — the catalogue of drawable figures a paper,
 * quiz or worksheet can reference, and the two React surfaces that render and
 * pick from it.
 *
 * `diagramCatalog.js` · `DiagramSvg.jsx` · `DiagramPicker.jsx`
 *
 * Migrated from `src/components/diagrams/` under docs/architecture.md Phase 4,
 * following docs/MIGRATION_TEMPLATE.md. A move: same catalogue, same rendering,
 * same picker.
 *
 * ── This layer now holds React, and that is a deliberate extension ──────
 *
 * `src/curriculum/index.js` frames this layer as RESOLUTION LOGIC over the
 * taxonomy root — `catalog/`, `resolvers/`, `validators/`, `adapters/`,
 * `aliases/`. Two React components are new in kind here, so the reasoning is
 * recorded rather than left to be inferred. **Owner ruling, 2026-08-14.**
 *
 * It is the only layer that satisfies every constraint at once, and each one
 * was measured rather than assumed:
 *
 *   • `src/engines/export-engine/sbaTaskToPdf.js` imports the catalogue, and
 *     `FORBIDDEN_TARGETS.engines` includes `features` — so this cannot become a
 *     feature, however many features draw it.
 *   • Six migrated features import it (`assessmentStudio`, `quiz`, `quizEditor`,
 *     `papers`, `visualStudio`, `teacherLibrary`), plus `uiAudit`, `src/utils/`
 *     exporters and two frozen legacy readers — so it cannot live inside any
 *     one of them either.
 *   • It fails §14.6 on the closure: `diagramCatalog` re-exports
 *     `functions/shared/assessment/diagramCatalogCore.js`, which imports
 *     `curriculumDiagramsCore.js`. That is curriculum knowledge by the test as
 *     written, so `src/shared/components/` is out.
 *
 * **A split was checked and does not work.** Putting the catalogue here and the
 * components in `src/shared/components/` fails immediately: `shared` forbids
 * importing `curriculum`, and the components import the catalogue. Renderer and
 * data have to share a layer, and the data is what fixes which layer.
 *
 * ── What unblocked this, and what did NOT ───────────────────────────────
 *
 * Recorded in #2369 as pinned by SIX frozen readers. Four of them stopped being
 * frozen on their own: #2374 moved the quiz runtime to `features/quiz` and
 * #2379 moved the editor to `features/quizEditor`. Only `DailyExamRunner` and
 * `components/teacher/views/PaperBlocks` remained, and the owner released those
 * two import lines. **The freeze itself is untouched** — both files stay where
 * they are, byte-identical apart from one specifier each, and no other frozen
 * surface moved.
 *
 * **UPDATE 2026-08-14: the freeze is CLOSED and both of those readers have
 * moved.** A sixth owner ruling released the whole remaining list;
 * `DailyExamRunner` is now `features/dailyExams/pages/` and `PaperBlocks` is
 * `src/engines/paper-render/`. Neither changes the argument above — this
 * catalogue is still shared too widely to live in any one feature, and an
 * engine importing `curriculum` is the allowed direction. Recorded because
 * this paragraph was the thing that caught `PaperBlocks` still being in the
 * legacy tree when the freeze-closure PR had claimed otherwise.
 *
 * ── The visual gate knows this path by string ───────────────────────────
 *
 * `scripts/visual/printAffectingPaths.js` listed `src/components/diagrams/**`
 * as print-affecting. A glob for a directory that no longer exists still
 * PARSES, still reads like a working rule, and silently stops triggering the
 * render — that file's own note says "a pattern for a moved file protects
 * nothing and reads exactly like one that works." Repointed here, with its test
 * fixture, in the migration commit.
 */

export {}
