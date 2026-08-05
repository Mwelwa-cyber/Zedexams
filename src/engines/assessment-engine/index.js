/**
 * Assessment Engine — the ONE runner (docs/architecture.md §4).
 *
 * Public surface, once Phase 3 fills it: session, question renderers, answer
 * capture, timer, navigation, autosave, submission, marking, results,
 * remediation. Quizzes switch first, then past-paper quizzes, then the Daily
 * Quiz rework (which retires `DailyExamRunner`), then games.
 *
 * Two constraints that shape what may be written here:
 *
 *   • It is seeded from `functions/shared/assessment/` — the ESM package the
 *     client and the export callable already share — plus the best of
 *     `QuizRunnerV2`. Do not author a third definition of the assessment
 *     contract; extend the shared package (§4.1, §14.10).
 *   • Results and leaderboard writes stay byte-compatible while old runners are
 *     still live, because both write the same collections.
 *
 * Empty until Phase 3.
 */

export {}
