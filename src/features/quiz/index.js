/**
 * Public surface of the Quiz feature — the learner-facing quiz RUNTIME.
 *
 * Migrated out of `src/components/quiz/` on 2026-08-14 under docs/architecture.md
 * Phase 4, following docs/MIGRATION_TEMPLATE.md.
 *
 * ── EMPTY ON PURPOSE ────────────────────────────────────────────────────
 *
 * All three screens are route-mounted lazily from `App.jsx` (`/quizzes`,
 * `/quiz/:quizId`, `/results/:resultId`) and nothing else in `src/` imports
 * them. `QuizTip` is drawn only by the runner. So there is nothing to export,
 * on the `blog` / `uiAudit` / `adminSettings` precedent — an empty front door
 * is the honest answer when every consumer is the router.
 *
 * ── This is a PART of `components/quiz/`, and the split was measured ────
 *
 * The 2026-08-14 owner ruling released `components/quiz/`; it did NOT release
 * `admin/CreateQuizV2.jsx`, which imports five modules from that directory —
 * `QuizSectionsEditor` (2,946 lines), `QuizEditorPreviewPanel`,
 * `QuizValidationChecklist`, `generatedQuizRichText` and `documentQuizImporter`.
 *
 * The editor's transitive closure inside `components/quiz/` is **29 modules** —
 * effectively the whole import / parse / review body. Moving the runner and
 * leaving the editor is only a migration if those two halves are separable, so
 * that was measured before anything moved rather than assumed. They are, and
 * the seam is unusually clean: the runner trio's closure is 12 modules, and it
 * shares exactly **two** with the editor — `ExtraQuestionImages` and
 * `ZoomableImage`. Both had already earned a place in `src/shared/components/`
 * on their own consumer count, so promoting them cost nothing and removed the
 * only overlap.
 *
 * What stayed in `src/components/quiz/` was therefore not a leftover; it was the
 * quiz AUTHORING surface, pinned there by a file the ruling did not cover.
 *
 * **That happened the same day.** A fifth ruling released `CreateQuizV2`, and
 * the editor is now `features/quizEditor` — including `CreateQuizV2` itself,
 * which turned out to be a PAGE of that feature rather than a consumer of it.
 * What remains at the old path is narrower again: the document-IMPORT body,
 * held there by `utils/paperToQuizConverter.js` and the still-frozen
 * `admin/AdminPastPapers`, plus the six `DailyExamRunner` shims below.
 *
 * ── The Phase 3 cutover moved with the runner, intact ───────────────────
 *
 * `pages/QuizRunnerV2.jsx` reads `useAssessmentEngineFlag('quiz')` and carries
 * both paths. All THREE of its specs travelled beside it —
 * `.spec.jsx`, `.engine.spec.jsx` and `.characterisation.spec.jsx` — and the
 * last of those is the recorded byte-compatibility baseline the cutover is
 * measured against, so it is load-bearing rather than incidental. Each differs
 * from `main` only in its import and `vi.mock` paths.
 *
 * This migration deliberately waited for #2372 to merge. That PR edited
 * `QuizRunnerV2.jsx` and `QuizRunnerV2.spec.jsx` while this was being planned,
 * and a rename landing across an open edit is the one collision git resolves
 * textually while silently dropping a side — here, a Phase 3 behaviour decision
 * and its two new regression cases.
 *
 * ── Eight components went DOWN to `src/shared/components/` ─────────────
 *
 * The reading-assist cluster (`PassageViewer`, `ReadingSettingsButton`,
 * `ReadingSettingsSheet`, `TextToSpeechButton`, `ThemePreview`) and
 * `QuizReviewScreen`, plus the two above. Each is drawn from three different
 * areas — this runner, `features/papers/PublicQuizRunner`, and the frozen
 * `features/dailyExams/DailyExamRunner` — so a module three areas share belongs
 * below all of them. All eight pass §14.6 on reach: six import nothing but
 * React, and `PassageViewer` reaches only `editor/RichContent`.
 *
 * `DailyExamRunner` is on the freeze list in its own right and was NOT part of
 * the ruling, so it is reached by six one-line shims at the old paths and is
 * byte-identical to `main`. Those cost no debt entry, because they point at
 * `shared/` rather than into a feature.
 *
 * ── One shim RETIRED, and one had its justification change ──────────────
 *
 * `components/games/GameStickerStyles.jsx` — created hours earlier by the games
 * migration for `QuizList`, its only consumer — is **deleted** here: `QuizList`
 * moved, so it now imports `shared/components/GameStickerStyles` directly. That
 * empties and removes `src/components/games/`.
 *
 * `components/subscription/UpgradeModal.jsx` is NOT retired, and the reason is
 * recorded because it changed: after this migration it has **no frozen consumer
 * left** — all six references are now in `features/quiz` and `features/games`.
 * What still holds it is the chunk measurement in #2342, which never depended
 * on the freeze. Retiring it means measuring what the `features/subscription`
 * front door adds to the quiz-runner and play-game chunks, which is that shim's
 * own work rather than something to smuggle into a file move.
 */

export {}
