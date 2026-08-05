/**
 * Assessment Engine — the ONE runner (docs/architecture.md §4).
 *
 * ## What is here today
 *
 * The CONTRACT and the NORMALISER: the canonical shape every source is turned
 * into, and the single door that turns each one into it. Nothing consumes this
 * yet, deliberately — the contract is reviewed before it grows consumers,
 * because a contract with four consumers is no longer a decision, it is a
 * migration.
 *
 * ## What is deliberately NOT here yet
 *
 * Session (navigation, timing, answer capture, autosave), the question
 * renderers, marking, and the per-target write adapters. Each arrives with the
 * cutover that needs it, so that every part of the engine ships against a real
 * consumer rather than a guess about one.
 *
 * Marking, when it lands, ships as `clientKey` + `none` behind ONE isolated
 * verdict seam — the session asks a single function for a verdict and never
 * scores inline. No `serverCallable` strategy until a real consumer defines its
 * shape (owner decision, 2026-08-05): the Daily Quiz rework is committed but
 * not yet SHAPED, and an interface designed from the runner being retired is a
 * guess that gets refactored anyway.
 *
 * ## Scope
 *
 * Three sources: learner quizzes, past-paper quizzes, and `timed_quiz` games.
 * `DailyExamRunner` is deliberately out of Phase 3 (architecture.md §13, §14.5)
 * and keeps its own path until the Daily Quiz rework replaces the product.
 *
 * ## Constraints
 *
 *   • Seeded from `functions/shared/assessment/` — never a third definition of
 *     the assessment contract (§4.1 note 5, §14.10).
 *   • No Firebase, no React, no DOM: an engine sits below features and reaches
 *     Firebase through `src/services/` (§14.2). Everything here loads under
 *     plain `node`, which is what lets the contract be tested at all.
 *   • Results and leaderboard writes stay byte-compatible while old runners are
 *     live, because both write the same collections.
 */

export {
  normaliseAssessment,
  fromQuiz,
  fromGame,
} from './normalise/index.js'

export {
  // The contract itself
  assessmentSchema,
  questionSchema,
  richContentSchema,
  assessmentSettingsSchema,
  // Validation at a boundary
  assertAssessment,
  safeAssessment,
  // Building blocks a consumer legitimately needs
  toRichContent,
  ASSESSMENT_SCHEMA_VERSION,
  RICH_CONTENT_VERSION,
  ASSESSMENT_SOURCES,
} from './schemas/index.js'
