/**
 * RE-EXPORT SHIM — the real component is
 * `src/shared/components/GameStickerStyles.jsx`.
 *
 * DO NOT ADD LOGIC HERE, and do not import it from anywhere new. This file
 * exists for exactly one reason: `components/quiz/QuizList.jsx` renders the
 * games sticker stylesheet, and `components/quiz/` is FROZEN by owner
 * instruction until the Phase 3 Assessment Engine rollout flags reach 100%.
 * The games migration of 2026-08-14 was released from that freeze;
 * `components/quiz/` was not.
 *
 * So the migration goes around the frozen file instead of through it. The old
 * path keeps resolving, `QuizList.jsx` is byte-identical to `main`, and the
 * feature moves. That is the pattern #2342 established for `UpgradeModal`,
 * whose docblock in `components/subscription/` states the reasoning in full:
 * editing one import line in a frozen file is individually harmless, which is
 * precisely the kind of change a freeze during a measured cutover exists to
 * stop.
 *
 * Unlike that one, this shim costs no entry on the boundary scan's debt list —
 * it points at `src/shared/components/`, not into a feature, and the legacy
 * tree is allowed to read the shared layer. The component landed there rather
 * than in `features/games/` because four surfaces outside games render it and
 * it imports nothing at all; `src/shared/components/index.js` records the §14.6
 * measurement.
 *
 * RETIREMENT CONDITION, so this is not left to be rediscovered: delete this
 * file and repoint `components/quiz/QuizList.jsx` at
 * `../../shared/components/GameStickerStyles` the moment the Phase 3 rollout
 * flags reach 100% and the freeze lifts. That also removes the last file from
 * `src/components/games/`, which this shim is the only remaining occupant of.
 */

export { default } from '../../shared/components/GameStickerStyles'
