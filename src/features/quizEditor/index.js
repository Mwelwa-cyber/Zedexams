/**
 * Public surface of the Quiz Editor feature — the quiz AUTHORING surface.
 *
 * Migrated out of `src/components/quiz/` and `src/components/admin/` on
 * 2026-08-14 under docs/architecture.md Phase 4, following
 * docs/MIGRATION_TEMPLATE.md. It is the second half of the quiz split: the
 * learner-facing RUNTIME went to `features/quiz` hours earlier, and the note in
 * that feature's front door predicted this one by name.
 *
 * ── `CreateQuizV2` came with it, and that is the whole point ────────────
 *
 * The runtime migration left this half behind because `admin/CreateQuizV2.jsx`
 * was frozen and imported five of its modules. The owner released it on
 * 2026-08-14 — the fifth such ruling — and the honest consequence is that
 * `CreateQuizV2` is not a consumer of this feature, it is a PAGE of it. It
 * renders `QuizSectionsEditor`, `QuizEditorPreviewPanel` and
 * `QuizValidationChecklist`, and it is the admin's create-a-quiz screen sitting
 * beside `EditQuizV2`'s edit-a-quiz screen. Leaving it in `components/admin/`
 * to satisfy a directory name would have split one feature across two homes —
 * the mistake `adminImages` was explicitly not allowed to make.
 *
 * Both pages stay route-mounted lazily and unexported.
 *
 * ── Two names, for one consumer ────────────────────────────────────────
 *
 * `features/assessmentStudio` draws `ImageCropModal` (its scan flow crops an
 * imported page) and `QuizVerifyModal` (Vex's pre-publish check). Nothing else
 * outside this feature imports anything from it.
 *
 * `ImportReviewBadge` was on this list for about ten minutes and is not: its
 * only consumer anywhere is `features/adminContent/ManageContent`, so by the
 * sole-consumer rule it is that feature's component and it moved there. That
 * also discharges a debt `adminContent`'s own front door recorded — it noted
 * that `ManageContent` "still imports `ImportReviewBadge` … across the legacy
 * boundary", which is no longer true.
 *
 * ── What did NOT come, and why it is a constraint rather than a choice ──
 *
 * The document-IMPORT body stays in `src/components/quiz/`:
 * `documentQuizImporter` (1,524 lines), `documentQuizParserCore`,
 * `documentQuizTableBlocks`, `documentQuizParagraphRuns`,
 * `documentQuizReconcile`, `scannedQuizImporter`, `importFormatChecks` and
 * `pastPaperParts`.
 *
 * `documentQuizImporter` is imported by `src/utils/paperToQuizConverter.js`,
 * which is pinned in the legacy tree by the still-frozen
 * `admin/AdminPastPapers`. Moving it here would make that a legacy→feature
 * import — a debt-list entry, on a list that only shrinks. It cannot go DOWN to
 * `src/shared/` either, the way this migration's other forced moves did:
 * measured, its closure is 55 modules and reaches **eight** Firebase entry
 * points through `utils/aiAssistant`, and `shared` is in `NO_FIREBASE_LAYERS`.
 * So it stays where both callers can legally reach it, and its own dependencies
 * stay with it — a legacy module importing feature internals is the same debt
 * pointing the other way.
 *
 * This feature reaches back into it, which is what the layering allows and what
 * §2 calls the honest interim state. It follows when `AdminPastPapers` is
 * released.
 *
 * ── `importRichText` + `importFormatTokens` went to `src/shared/utils/` ─
 *
 * A forced move, and the sharpest one in the quiz split. `importRichText` is
 * reached by `src/utils/toolNotationRender.js`, which
 * `src/engines/export-engine/homeworkToPdf.js` and `worksheetToPdf.js` import —
 * and **an engine may not import from a feature** (§12). A module an engine
 * depends on belongs below the engine. That is the same rule that sent
 * `weeklyForecast.js` and `sbaTaskToPaper.js` down, and unlike
 * `documentQuizImporter` the reach permits it: closure of two modules, zero
 * packages, no DOM, no Firebase. `importFormatTokens` travels because
 * `importRichText` imports it and nothing else outside did.
 *
 * ── Two utils came IN, on the sole-consumer rule ────────────────────────
 *
 * `src/utils/paperPageProvider.js` and `src/utils/quizReimportDiff.js` (+ its
 * node test) had exactly one consumer each: `EditQuizV2`. Moving the caller
 * alone would have converted two legal legacy imports into two debt entries, so
 * they came along. `paperFigureAttach.js` did NOT — the frozen
 * `admin/PastPaperStudio` reads it too.
 */

export { default as ImageCropModal } from './components/ImageCropModal'
export { default as QuizVerifyModal } from './components/QuizVerifyModal'
