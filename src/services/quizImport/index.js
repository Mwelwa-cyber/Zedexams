/**
 * Quiz document IMPORT — the parser body that turns an uploaded .docx / .pdf /
 * scanned paper into quiz sections and questions.
 *
 * Moved here from `src/components/quiz/` on 2026-08-14, which emptied that
 * directory and removed it. Every moved file is BYTE-IDENTICAL to its previous
 * version except four, whose only change is the `Run: node <path>` instruction
 * in their own header comment — the destination sits at the same depth below
 * `src/`, so not one import specifier needed editing.
 *
 * ── WHY `src/services/` AND NOT A FEATURE ───────────────────────────────
 *
 * This was the last piece of the quiz split, and it is the one the two earlier
 * migrations could not place. The quiz-editor front door recorded the problem
 * exactly: the body is imported by `src/utils/paperToQuizConverter.js`, so
 * moving it into `features/quizEditor` would have created a legacy→feature
 * import, on a debt list that only shrinks — and it could not go DOWN to
 * `src/shared/` the way that migration's other forced moves did, because its
 * closure reaches Firebase through `utils/aiAssistant` and `utils/testPaperDiagram`,
 * and `shared` is in `NO_FIREBASE_LAYERS`.
 *
 * Both halves of that are still true. What changed is not the constraint but
 * the count of consumers, which the freeze had been hiding: with the editor,
 * the studio and the admin surfaces all migrated, **four separate features
 * import this body** —
 *
 *   • `features/quizEditor`     — `EditQuizV2`, `CreateQuizV2`, `ImportQuizPanel`,
 *                                 `quizReimportDiff`, `paperPageProvider`
 *   • `features/assessmentStudio` — six files, all for `QUIZ_DOCUMENT_ACCEPT`
 *   • `features/notes`          — `noteImport` (docx/pdf extraction)
 *   • `features/adminPastPapers` — via `utils/paperToQuizConverter`
 *
 * A module four features share is not a part of any one of them. `src/services/`
 * is the layer for exactly this: a bottom layer, below features, that MAY use
 * the Firebase SDK — unlike `shared`, `engines` and `curriculum`, whose ESLint
 * blocks refuse it — and that may not reach back up into `app`, `features`,
 * `engines` or `curriculum`. This body reaches only `src/utils/`,
 * `src/shared/utils/`, `src/config/` and `fflate`, so it satisfies that
 * constraint as it stands.
 *
 * The placement costs ZERO debt, which is the argument for it over any of the
 * alternatives: `feature → services` is the allowed direction, so all four
 * features import it directly; and `src/utils/paperToQuizConverter.js` and
 * `utils/paperFigureAttachCore.js` can keep reading it from the legacy tree
 * without becoming legacy→feature entries. `test:import-boundaries` records
 * 3 cross-feature and 3 legacy imports both before and after this move.
 *
 * ── THIS FILE EXPORTS NOTHING, ON PURPOSE ───────────────────────────────
 *
 * Consumers import the specific module they need — `documentQuizImporter`,
 * `documentQuizReconcile`, `pastPaperParts` — by path. A barrel here would be
 * actively harmful: six of the ten consuming files want only the
 * `QUIZ_DOCUMENT_ACCEPT` string constant, and routing them through a front door
 * would hand the assessment studio the whole 1,524-line importer, `fflate`, the
 * PDF.js loader and the scanned-import path to get it. That is the measured
 * front-door cost rule the games feature documents, in its sharpest form.
 *
 * ── WHAT IS AND IS NOT IN HERE ──────────────────────────────────────────
 *
 * In: `documentQuizImporter` (the .docx/.pdf entry point), the three parser
 * modules it delegates to (`documentQuizParserCore`, `documentQuizTableBlocks`,
 * `documentQuizParagraphRuns`), `documentQuizReconcile` (smart section-order
 * matching), `scannedQuizImporter` (the OCR path), `importFormatChecks` and
 * `pastPaperParts` — with their eight node test scripts, which run from
 * `test:importer`, `test:scanned-import`, `test:past-paper-parts` and
 * `test:import-format-checks`.
 *
 * Not in: `importRichText` and `importFormatTokens`, which the quiz-editor
 * migration sent to `src/shared/utils/` because `src/engines/export-engine/`
 * reaches them and an engine may not import a feature. They are BELOW this
 * directory and this directory imports them, which is the correct direction —
 * moving them here would put a Firebase-free pair inside a Firebase-reaching
 * package for no reason.
 */

export {}
