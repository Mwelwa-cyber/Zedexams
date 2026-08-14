/**
 * RE-EXPORT SHIM — the real component is
 * `src/shared/components/ReadingSettingsSheet.jsx`.
 *
 * DO NOT ADD LOGIC HERE, and do not import it from anywhere new. One consumer
 * keeps this path alive: `components/exams/DailyExamRunner.jsx` (and its spec),
 * which is named on the architecture.md §14 freeze list in its own right. The
 * 2026-08-14 ruling released `components/quiz/`; it did not release the daily
 * exam runner, which is outside Phase 3 entirely and retires with the Daily
 * Quiz rework.
 *
 * So the migration goes around that file rather than through it, and the runner
 * is byte-identical to `main`. Unlike a shim into a feature, this one costs no
 * entry on `test:import-boundaries`' debt list: it points at
 * `src/shared/components/`, and the legacy tree is allowed to read the shared
 * layer. `src/shared/components/index.js` records why the component landed
 * there rather than in `features/quiz`.
 *
 * RETIREMENT CONDITION: delete this file and repoint `DailyExamRunner.jsx` at
 * `../../shared/components/ReadingSettingsSheet` when the Daily Quiz rework
 * replaces that runner — or sooner, if the freeze lifts first. Five siblings
 * retire with it, and that empties `src/components/quiz/reading/` and
 * `src/components/quiz/review/`.
 */

export { default } from '../../../shared/components/ReadingSettingsSheet'
