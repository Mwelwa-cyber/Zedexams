/**
 * Public surface of the Daily Exams feature — `/exams`, `/exams/leaderboard`,
 * `/exam/:examId` and `/exam-results/:attemptId`.
 *
 * Migrated out of `src/components/exams/` on 2026-08-14 under
 * docs/architecture.md Phase 4, following docs/MIGRATION_TEMPLATE.md. It is a
 * move: no behaviour changed, no module was split, and the only edits to the
 * moved files are the import specifiers a change of depth forces — plus the
 * six shim paths this migration retires, described below.
 *
 * ── THE FRONT DOOR IS DELIBERATELY EMPTY ────────────────────────────────
 *
 * Nothing in `src/` imports anything from this feature. All four pages are
 * reached only by `lazy(() => import(…))` in App.jsx, under the route-mount
 * exception Phase 1 recorded, and the one remaining component
 * (`ExamCelebrations`) is used only by a page beside it.
 *
 * So this file exports nothing, exactly as `features/quiz`'s does. An empty
 * front door is the honest answer when a feature has no consumers: the
 * alternative — re-exporting the four pages "for completeness" — would put the
 * runner, the leaderboard subscription and the Firebase client into the chunk
 * of anything that imported one name from here.
 *
 * ── `DailyExamRunner` and the freeze it was the last member of ──────────
 *
 * `DailyExamRunner` was named individually on architecture.md §14's owner
 * freeze — not as part of `components/quiz/` or the Assessment Engine cutover,
 * but in its own right, because it is **outside Phase 3 entirely**. The engine
 * plan settled on 2026-08-05 that the Daily Quiz rework builds on the engine as
 * a NEW consumer and this runner retires with that product switch, rather than
 * being migrated onto the engine first and reworked after.
 *
 * That reasoning is about the Phase 3 CUTOVER, and this migration is a Phase 4
 * MOVE — the distinction the freeze clause itself draws ("the test is whether
 * the file moved"). Nothing here puts the runner on the engine: it carries no
 * `useAssessmentEngineFlag` branch, before or after, and its marking, privacy
 * split and lock behaviour are untouched. When the Daily Quiz rework lands it
 * still retires this runner wholesale; it now does so from a feature folder
 * instead of `components/`, which changes nothing about that plan.
 *
 * This proceeds on the owner ruling of 2026-08-14 releasing the whole
 * remaining freeze list. Unlike the five single-surface rulings before it, that
 * one closes the clause rather than carving one name out of it.
 *
 * ── SIX SHIMS RETIRED, ON THE CONDITION THEY WROTE FOR THEMSELVES ───────
 *
 * The quiz migration promoted eight components three areas share into
 * `src/shared/components/`, but could not repoint this runner at them, because
 * the runner was frozen and editing an import line inside a frozen file is
 * still editing it. It left six one-line re-export shims at the old
 * `components/quiz/` paths instead, each carrying the same retirement
 * condition: *"delete this file and repoint `DailyExamRunner.jsx` … when the
 * Daily Quiz rework replaces that runner — or sooner, if the freeze lifts
 * first."*
 *
 * The freeze lifted first. All six are deleted and the runner imports
 * `shared/components/{PassageViewer,ReadingSettingsButton,ReadingSettingsSheet,
 * TextToSpeechButton,QuizReviewScreen,ExtraQuestionImages}` directly. That
 * empties `src/components/quiz/reading/` and `src/components/quiz/review/`,
 * both of which are removed — the second time in this phase a shim has been
 * retired by the event its own docblock predicted, which is the argument for
 * writing retirement conditions down rather than tracking them in a list
 * somewhere else.
 *
 * ── NO `src/utils/` MODULE TRAVELLED, AND THERE IS NO `services/` ───────
 *
 * The rule is that a util moves into a feature when the feature is its only
 * consumer. All three of the candidates have "exam" or "exam-adjacent" in the
 * name, and none of them qualifies:
 *
 *   • `examService.js` — fifteen files outside this feature read it:
 *     `QuizRunnerV2` and its three specs, `GradeHub`, `ManageContent`,
 *     `useStudyPlanData`, `schemas/attempt.js` (the count predates step 5
 *     retiring `PracticePage`, another reader).
 *   • `gamificationService.js` — `useLearnerStats`, `StreakXpCard` and
 *     `RecoveryCentre` read it.
 *   • `examLeaderboardService.js` — **this one is worth recording, because the
 *     first pass got it wrong.** Grepping for `utils/examLeaderboardService`
 *     found only this feature's three files, so it was moved into `services/`.
 *     It has a fourth consumer: `utils/gamificationService.js` imports it as a
 *     SIBLING, `from './examLeaderboardService'`, which that pattern cannot
 *     match. `test:import-boundaries` caught it — it resolves every import to a
 *     file on disk, so the orphaned sibling import failed loudly instead of
 *     becoming a runtime chunk-load error on the leaderboard route. The module
 *     was moved back, and it stayed in `src/utils/` because
 *     `gamificationService` stayed there too.
 *
 *     **That sibling import is now gone** (2026-08-17). It existed only to
 *     serve `getWeeklyChampions`, which the weekly board replaced and which
 *     was deleted with it, so `examLeaderboardService` today has exactly one
 *     consumer: `ExamResultsPage` — inside this feature. By the rule above it
 *     has therefore become eligible to move down into `services/`. It is NOT
 *     moved here, because that is a refactor of the results screen rather
 *     than of the board, and doing it as a side effect of an unrelated
 *     change is how a migration stops being reviewable. It moves when
 *     `ExamResultsPage` is next worked on. The lesson stands unchanged: a
 *     path-substring grep cannot see a sibling import, so re-measure with
 *     `test:import-boundaries` rather than trusting this note.
 *
 * So none of the three travelled, and for a while there was deliberately no
 * `services/` directory at all. There is one now, and it was not created by
 * moving a util down: `weeklyLeaderboardService.js` is NEW code, written for
 * the prototype-v23 weekly board, and this feature is its only consumer.
 *
 * §14.2 is still NOT satisfied. The remaining pages reach `utils/examService`,
 * `utils/examLeaderboardService` and `utils/gamificationService` directly, and
 * that is recorded debt rather than a shortcut. It does not clear by moving
 * those three — they are read across half the learner app and belong below any
 * one feature — it clears as the Daily Quiz rework replaces the surfaces that
 * read them. The weekly board is the first of those replacements: it reaches
 * Firebase only through `services/`, which is why `getWeeklyChampions` could
 * be deleted from `utils/gamificationService` when its last caller went.
 *
 * The lesson generalises past this feature: when deciding whether a util is
 * feature-only, a path-substring grep is not the measurement. A sibling import
 * inside `src/utils/` is invisible to it.
 */

export {}
