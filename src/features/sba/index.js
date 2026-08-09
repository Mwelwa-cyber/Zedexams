/**
 * Public surface of School-Based Assessment — the four routes teachers plan and
 * record SBA through (`/teacher/sba`, the task studio, the mark tracker and the
 * year planner) and the three renderers that draw a saved SBA task, tracker or
 * plan.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4, teacher), following
 * docs/MIGRATION_TEMPLATE.md. A move: same components, same callable, same
 * Firestore reads and writes, same four route mounts.
 *
 * ── Three exported names ────────────────────────────────────────────────
 *
 * `SbaTaskView`, `SbaTrackerView` and `SbaPlanView` are drawn by the library
 * detail page, the public share page and the free-plan `LockedStudio` — three
 * surfaces with nothing else to do with SBA, two of them declared light pages.
 * The four studio pages are route-mounted and NOT exported.
 *
 * Five exporters went to `src/engines/export-engine/`, and their callers import
 * them from there directly rather than through this front door — the rule
 * `check:bundle-edges` enforces on every build.
 *
 * ── `sbaTaskToPaper.js` went to `src/shared/utils/`, and had to ─────────
 *
 * `SbaTaskView` renders through it AND both SBA exporters build through it. An
 * engine may not import from a feature (§12), so the one module they share
 * belongs below both — the same forced move `weeklyForecast.js` made. It is
 * pure, and reaches nothing but `src/config/sba.js`.
 *
 * ── What stayed, and why the register keeps its SBA tab ─────────────────
 *
 *   • `config/sba.js` — the grade/subject vocabulary, read by seven modules
 *     including the class register's mark grid and the studio samples.
 *   • `sbaPlanner.js` — `LibraryItemDetail` builds a plan with it.
 *   • `sbaCrossYear.js` — read ONLY by `teacher/register/SbaTab.jsx`, which is
 *     the class register's SBA tab rather than this feature's. It migrates with
 *     `register`, and the util goes with it then. Moving it here would put a
 *     module in the feature that does not use it.
 *
 * ── Firebase ────────────────────────────────────────────────────────────
 *
 * The studios call `generateSbaTask` and read/write `aiGenerations` directly,
 * which §14.2 says should go through `services/`. Not fixed here, under the
 * standing Phase 4 policy that a migration is a pure move.
 */

export { default as SbaTaskView } from './components/SbaTaskView'
export { default as SbaTrackerView } from './components/SbaTrackerView'
export { default as SbaPlanView } from './components/SbaPlanView'
