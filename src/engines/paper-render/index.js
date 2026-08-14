/**
 * Paper Render Engine — the on-screen/print renderer for an assessment paper.
 *
 * `PaperBlocks.jsx` walks the typed, rendering-agnostic blocks that
 * `utils/assessmentPaperLayout.buildPaperLayout()` returns and draws them as
 * React. It is one of the four renderers `utils/paperRenderersSync.test.js`
 * keeps in step — the studio preview, and the PDF by way of `window.print()`.
 *
 * Created 2026-08-14, when the sixth owner ruling closed the §14 freeze and
 * released `views/PaperBlocks` + `views/AssessmentPaperView`, the last two
 * entries on that list still sitting in the legacy tree.
 *
 * ── WHY A NEW ENGINE, WHICH IS THE ONLY QUESTION HERE ───────────────────
 *
 * The layer was forced, not chosen. `PaperBlocks` is read by THREE features —
 * `assessmentStudio` (`PaperPagesPreview`), `sba` (`SbaTaskView`) and
 * `teacherLibrary` (through `AssessmentPaperView`) — so it has to live below
 * all of them. From there each remaining layer eliminates itself:
 *
 *   • `src/shared/components/` — OUT. It imports `curriculum/diagrams/DiagramSvg`,
 *     and `shared` forbids importing `curriculum`. This is the same trap
 *     `src/curriculum/diagrams/index.js` documents for the diagram catalogue,
 *     hit by a different module for the same reason.
 *   • `src/services/` — OUT. That layer is Firebase-backed data access; a React
 *     renderer with no I/O is not a service, and putting it there would make
 *     the one directory that means "this touches the backend" stop meaning it.
 *   • `src/curriculum/` — OUT. It renders a paper; it holds no curriculum
 *     knowledge. `DiagramSvg` is a dependency, not a classification.
 *   • `src/engines/export-engine/` — OUT, and this is the near miss worth
 *     recording. It is the obvious home by topic, and `paperRenderersSync`
 *     already treats `PaperBlocks` and `assessmentToDocx` as one family. But
 *     that directory's index is an explicit CONTRACT: every module there
 *     exposes `build<Thing>Document` / `build<Thing>PrintableHtml` and produces
 *     a FILE, and `test:exporter-home` polices the boundary. `PaperBlocks`
 *     builds no file — it returns JSX. Filing it there would have made that
 *     index's first sentence false to keep a directory count down.
 *
 * So: `src/engines/`, in its own directory. `engines/assessment-engine/render/`
 * is the precedent for JSX inside an engine.
 *
 * ── This index is a CONTRACT, not a barrel ──────────────────────────────
 *
 * Same rule as `export-engine`'s, and for the same measured reason: consumers
 * import the module they need by path
 * (`../../engines/paper-render/PaperBlocks`). `PaperBlocks.jsx` pulls in
 * `assessmentStudio.css`, so a barrel would put that stylesheet into the chunk
 * of anything importing any name from here.
 *
 * ── `assessmentStudio.css` came down to `src/shared/styles/` ────────────
 *
 * Forced by the same rule one layer further down. The stylesheet lived in
 * `src/components/teacher/studio/`, and `features/assessmentStudio`'s own front
 * door recorded why it had to stay there — *"`views/PaperBlocks.jsx` imports
 * it"* — which was a statement about the freeze, not about the CSS. Its two
 * consumers are now this engine and that feature, so it belongs below both.
 * `src/shared/styles/` already held `dashboardV2.css` for the same reason.
 *
 * ── `AssessmentPaperView` did NOT come here ─────────────────────────────
 *
 * It went to `features/teacherLibrary/components/`, on the sole-consumer rule:
 * its only readers anywhere are `LibraryItemDetail` and `PublicShareView` (and
 * their two specs), all in that one feature. It is a 40-line adapter that maps
 * a saved AI paper onto `PaperDocument` — a consumer of this engine, not a part
 * of it. Being named on the same freeze-list line as `PaperBlocks` is not a
 * reason to file the two together.
 *
 * ── THIS DIRECTORY IS PRINT-AFFECTING ───────────────────────────────────
 *
 * `scripts/visual/printAffectingPaths.js` named all three moved paths by exact
 * string and they were repointed with the move. That file's own note is the
 * reason: "a pattern for a moved file protects nothing and reads exactly like
 * one that works." `utils/monochrome.test.js` and `utils/paperRenderersSync.test.js`
 * name `PaperBlocks.jsx` by path too, and were repointed for the same reason —
 * three ledgers that would each have failed silently rather than loudly.
 */

export {}
