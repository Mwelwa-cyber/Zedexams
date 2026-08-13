/**
 * Public surface of learner and teacher feedback — the floating "send
 * feedback" button, the dialog behind it, the suggestion nudge, and the
 * vocabulary the admin inbox triages against.
 *
 * Migrated under docs/architecture.md Phase 4 (Wave 4).
 *
 * ── Four exports, because eight places across the app render this ──────
 *
 * There are no pages here: this feature is entirely surfaces other features
 * mount inside themselves, which makes the front door the whole API.
 *
 *   - `FeedbackButton`   — `components/dashboard/StudentDashboard`,
 *                          `components/teacher/TeacherDashboard`
 *   - `SuggestionNudge`  — `components/dashboard/GradeHub`, `TeacherDashboard`
 *   - `FeedbackDialog`   — `dashboardV2`' Help & Support page,
 *                          `teacherSettings`' TipStrip and (lazily) its
 *                          Teaching Profile wizard
 *   - `FEEDBACK_TYPES` / `FEEDBACK_STATUSES` — `features/adminFeedback`'s
 *                          inbox, which triages against the same vocabulary
 *                          the submitter chose from. Exporting the constants
 *                          rather than duplicating them is what keeps the two
 *                          ends of that pipeline in step.
 *
 * `normalizeFeedbackRole` stays internal — only `FeedbackDialog` calls it.
 *
 * ── Outside the freeze, consumers checked individually ─────────────────
 *
 * The feature writes one collection (`feedback`) and reads none. Its eight
 * consumers were each checked rather than assumed: none is on the freeze list
 * — `TeacherDashboard` is the classic teacher dashboard, not `AssessmentStudio`
 * or `teacher/studio/`, and the two learner dashboards are unnamed by it.
 *
 * That check is the reason `subscription/` is NOT migrated alongside this one:
 * its consumers include `components/quiz/` and `components/games/`, which are.
 */

export { default as FeedbackButton } from './components/FeedbackButton'
export { default as FeedbackDialog } from './components/FeedbackDialog'
export { default as SuggestionNudge } from './components/SuggestionNudge'
export { FEEDBACK_TYPES, FEEDBACK_STATUSES } from './lib/feedbackOptions'
