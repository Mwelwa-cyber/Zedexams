/**
 * Class Register — public API.
 *
 * The teacher's class register: rosters, mark entry, attendance, term reports,
 * SBA and progress. Routes are mounted lazily from `pages/` and are deliberately
 * NOT exported here (§13's route-mount exception) — re-exporting a page would
 * put the whole studio into the chunk of anything that wanted one panel.
 *
 * Everything below is exported because something outside this feature imports it
 * TODAY, and nothing is exported speculatively:
 *
 *   • `NewLearnerSyncModal` — `features/classList/components/ClassListWorkspace`
 *     opens it when a roster import turns up learners with no account yet.
 *   • the six attendance panels — `features/classList/pages/ClassListRegisterPreview`
 *     (`/teacher/register-preview`) renders the Class List and Class Register
 *     redesign against mock fixtures, and six of the eleven screens it shows are
 *     this feature's.
 *
 * Both consumers live in `features/classList`, so these names were already
 * evaluated together in that feature's chunk before this migration; the front
 * door does not group anything new.
 *
 * NOT here, on purpose:
 *
 *   • `shellNavGuardCore` is NOT here and never was — it now lives at
 *     `src/shared/utils/shellNavGuardCore.js`. Its consumers are the app shell
 *     — `TeacherLayout`, `Sidebar`, `MobileChrome`, `NotificationCenter` — and
 *     `TeacherLayout` mounts on EVERY `/teacher/*` route. Exporting it here
 *     would have made every teacher route evaluate the whole class register at
 *     import time (the trap §13 records against `dashboardV2`), and importing
 *     it deeply would have added four legacy→feature debt entries. It is shell
 *     infrastructure that the register registers INTO, not register internals,
 *     so it belongs below both. The register reaches it downward like any other
 *     shared module; the shell does the same.
 */

export { default as NewLearnerSyncModal } from './components/NewLearnerSyncModal'

export { default as MarkAttendanceView } from './components/attendance/MarkAttendanceView'
export { default as AttendanceGridView } from './components/attendance/AttendanceGridView'
export { default as AttendanceSummaryPanel } from './components/attendance/AttendanceSummaryPanel'
export { default as AttendanceInsightsPanel } from './components/attendance/AttendanceInsightsPanel'
export { default as RegisterValidationPanel } from './components/attendance/RegisterValidationPanel'
export { default as RegisterPaperPreview } from './components/attendance/RegisterPaperPreview'
