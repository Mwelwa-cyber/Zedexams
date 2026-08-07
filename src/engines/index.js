/**
 * src/engines — the domain engines (docs/architecture.md §12).
 *
 * An engine is shared machinery a feature consumes, not a feature itself: the
 * Assessment Engine that will replace the four parallel runners, the document
 * Export Engine, the entitlement/paywall Payment Engine, and the Notification
 * Engine. No engine lives inside `src/features/` and no engine imports one
 * (§2, and the import-boundary rules in eslint.config.js).
 *
 * Scaffolded in Phase 1; every engine below is empty. The live code keeps
 * working exactly where it is — `QuizRunnerV2`, `DailyExamRunner`,
 * `PublicQuizRunner`/`PastPaperPractice` and the game loops are canonical until
 * their consumer is switched over in Phase 3, and nothing is deleted before its
 * replacement is wired into routes and verified (§14.11).
 *
 * A namespace marker, not a barrel: import the engine you need
 * (`src/engines/export-engine`), so one engine's consumers never pull the other
 * three into their chunk.
 */

export {}
