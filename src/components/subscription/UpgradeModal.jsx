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
 * The third was released on 2026-08-14 and is now
 * `features/games/pages/PlayGame.jsx`. It still imports this shim, for the
 * chunk reason below rather than for the freeze — that half of the argument was
 * never about which files may be edited. The two quiz files and the three specs
 * are still frozen, so nothing here changes.
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
