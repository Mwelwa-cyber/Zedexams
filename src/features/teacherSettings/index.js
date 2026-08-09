/**
 * Teacher Settings — public API (docs/architecture.md §3, §14.7).
 *
 * This front door exists because a migrating feature needed one. `useTeachingProfile`
 * is read by five callers outside this feature, and while all five sat in the
 * legacy tree they were ESLint *warnings* on the shrink-only legacy list in
 * `test:import-boundaries`. The moment one of those callers becomes a feature —
 * `features/classTimetable`'s studio, in Wave 4 — the same import is a
 * feature-reaching-into-a-feature ERROR, and recording it on the cross-feature
 * list would GROW a list that only shrinks.
 *
 * So the hook is exported here and the migrated caller imports the front door.
 * The four callers still in `src/components/teacher/` keep their relative
 * imports and their warnings; each clears when its own surface migrates, which
 * is what those entries are for.
 *
 * ONE exported name, because one is consumed from outside. The settings pages
 * are reached only by route mounts, and the panels have no consumer beyond
 * them.
 */

export { useTeachingProfile } from './lib/useTeachingProfile'
