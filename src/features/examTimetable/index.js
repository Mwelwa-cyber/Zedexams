/**
 * Public surface of the official exam timetable — `/timetable`, the
 * per-grade ECZ examination schedule a learner checks to find out when their
 * papers are.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4).
 *
 * **This front door is deliberately empty.** `ExamTimetablePage` is reached by
 * the `lazy(() => import(…))` mount in App.jsx under the route-mount
 * exception, and nothing else imports it. (`learnerDashboard`'s
 * TimetableViewerPage names this page in a comment — it serves the
 * official PDF at `/timetable/pdf`, because Android WebViews drop external PDF
 * links — but it does not import it.)
 *
 * ── Outside the freeze, and the reason is worth stating precisely ───────
 *
 * "Exam" in the name is about the ECZ examination CALENDAR, not the Assessment
 * Engine. It reads the `examTimetables` collection and writes nothing; no
 * quiz, past paper, game or assessment module appears anywhere in its imports.
 *
 * The page does render a nav link labelled "Practice Quizzes" pointing at
 * `/quizzes` — a route STRING, not a dependency. That distinction is the whole
 * reason freeze membership is decided by what a file's imports WRITE rather
 * than by what its text mentions: the same crude keyword search that flags
 * this link would have cleared `AdminCsvImport`, which is frozen because its
 * publish step calls `createQuiz` two hops down.
 *
 * ── Two modules did NOT travel ──────────────────────────────────────────
 *
 *   - `hooks/useExamTimetables` — also read by
 *     `features/learnerHome/hooks/useLearnerDashboard`.
 *   - `utils/examTimetableLogic` — also read by `learnerHome`'s
 *     `ExamCountdownChip` and `features/papers`' timetable row, AND by
 *     `scripts/test-exam-timetable.mjs`
 *     and `scripts/seed-exam-timetables.mjs`. That second pair is the
 *     `MIGRATION_TEMPLATE.md` hiding place a path-shaped search misses:
 *     moving it would have broken `test:exam-timetable`, a suite whose name
 *     never mentions this directory.
 *
 * `config/examTimetable2026` stays too — it is config, which the layering puts
 * below features by design.
 */

export {}
