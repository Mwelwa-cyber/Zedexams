/**
 * RE-EXPORT SHIM — the real component is
 * `src/features/subscription/components/UpgradeModal.jsx`.
 *
 * DO NOT ADD LOGIC HERE. This file exists for exactly one reason: three of
 * `UpgradeModal`'s consumers are FROZEN by owner instruction —
 * `components/quiz/QuizRunnerV2.jsx`, `components/quiz/QuizList.jsx` and
 * `components/games/PlayGame.jsx` — and so are the three `QuizRunnerV2` specs
 * that `vi.mock('../subscription/UpgradeModal')`.
 *
 * **All six were released on 2026-08-14, and this file now has NO frozen
 * consumer left.** `PlayGame` is `features/games/pages/PlayGame.jsx`;
 * `QuizRunnerV2`, `QuizList` and the three runner specs are under
 * `features/quiz/pages/`. The paragraph above is the history, kept because it
 * is why this file exists — but it is no longer why it survives.
 *
 * What survives is the chunk argument below, which never depended on the
 * freeze: routing these six at `features/subscription` would put the status
 * banner, `PremiumGate` and `RenewalBanner` into the chunks of the quiz runner,
 * the quizzes hub and the play-game route. So the RETIREMENT CONDITION has
 * changed, and it is now a measurement rather than a date: build both ways,
 * compare those three chunks, and repoint if the front door costs nothing. That
 * is this shim's own work — it was deliberately not smuggled into either file
 * move, because a bundle regression hidden inside a rename is exactly what the
 * migrations of that day were measuring against.
 *
 * The freeze is not about those files' contents being delicate in the
 * abstract. Phase 3 is replacing the quiz runner behind rollout flags, and its
 * results and leaderboard writes are being measured for byte-compatibility
 * against a recorded baseline. Editing one import line there is individually
 * harmless, which is precisely the kind of change a freeze during a measured
 * cutover exists to stop — and it would alter the module graph on the
 * highest-traffic learner route mid-measurement.
 *
 * So the migration goes around them instead of through them. The old path
 * keeps resolving, the frozen files are byte-identical, and the feature moves.
 *
 * The pattern is the repo's own: `src/utils/unresolvedFigures.js` and its four
 * neighbours are re-export shims onto `functions/shared/assessment`, kept
 * honest by `test:shim-guard` for the same reason — a shim that grows a rule
 * is how a fork comes back.
 *
 * RETIREMENT CONDITION, so this is not left to be rediscovered: delete this
 * file and repoint those six references the moment the Phase 3 rollout flags
 * reach 100% and the freeze lifts. Nothing else should ever import it —
 * every non-frozen consumer already goes through `features/subscription`.
 */

export { default } from '../../features/subscription/components/UpgradeModal'
