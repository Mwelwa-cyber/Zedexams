/**
 * Public surface of Teacher Settings — the teaching profile a teacher records
 * once (school, classes, subjects, timetable) and every studio then reads to
 * pre-fill itself.
 *
 * This front door exists because Wave 4 needed it, not as scaffolding.
 * `useTeachingProfile` had FIVE importers reaching past the feature into
 * `lib/`, all of them recorded as legacy debt (§13) and all of them warnings
 * because the legacy tree is not held to the boundary. When the class-timetable
 * studio migrated it became a FEATURE reaching into another feature's
 * internals, which is an error rather than a warning — and the migration
 * contract's own rule is that a migration which would grow a debt list is
 * telling you to fix the design instead.
 *
 * So the hook is exported here, the class-timetable studio imports it through
 * this door, and one legacy debt line was deleted rather than moved.
 *
 * One name, because one is consumed across a boundary. The four remaining
 * legacy importers (`TeacherDashboard`, `TeacherTopBar`,
 * `useTeacherDashboardData`, `useActiveAssignmentContext`) still reach `lib/`
 * directly; each clears when its own caller migrates, and re-pointing them now
 * would be a change to files this pull request has no other reason to touch.
 *
 * The panels are route-mounted and deliberately NOT exported.
 */

export { useTeachingProfile } from './lib/useTeachingProfile'
