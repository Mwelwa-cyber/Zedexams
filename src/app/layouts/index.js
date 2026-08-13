/**
 * Route layouts — the target home §12 names for `App.jsx`, the route registry,
 * guards and layouts.
 *
 * **Empty, and NOT because Phase 4 has not reached the layouts yet.** Both
 * layouts this file was scaffolded for have since migrated somewhere else, as
 * features:
 *
 *   `AdminLayout`   → `src/features/adminShell/pages/`   (merged)
 *   `TeacherLayout` → `src/features/teacherShell/pages/` (in progress)
 *
 * The reason is `scripts/test-import-boundaries.mjs`, not preference.
 * `FORBIDDEN_TARGETS.features` includes `app`, and that check runs before the
 * front-door exemption and consults no allowance list — so a layout in
 * `src/app/layouts/` cannot be imported by anything under `src/features/`
 * at all. Five `features/dashboardV2` specs render `TeacherLayout` to assert
 * it; through a feature's `index.js` that is legal (`isFrontDoor` → continue),
 * and from `src/app/` it is a hard failure with no legal route.
 *
 * Recorded here rather than in §13 alone because this file is where the next
 * reader will look for the destination, and it said the opposite for a week.
 * If the layering is ever changed to let features import an app-layer layout,
 * this is the decision to revisit.
 */

export {}
