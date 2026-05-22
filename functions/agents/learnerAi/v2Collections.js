/**
 * functions/agents/learnerAi/v2Collections.js
 *
 * Canonical v2 collection names + status enums for the server side.
 * Mirrors the Zod schemas in src/schemas/learnerAi.js. Keep these two
 * files in sync — there's no build step that derives one from the
 * other. The SPA side carries the runtime Zod validation; the server
 * side writes via the admin SDK (bypasses Firestore rules) so type
 * safety here relies on this constants table + code review.
 *
 * Imported by dispatcher.js, every runner, healthCheck.js, logger.js.
 */

const COLLECTIONS = Object.freeze({
  TASKS:                  "aiAgentTasks",
  LOGS:                   "aiAgentLogs",
  CONTENT:                "aiGeneratedContent",
  LIVE_STATES:            "aiLiveAgentStates",
  STEPS:                  "aiTaskSteps",
  CONTROLS:               "aiAgentControls",
  SUPERVISOR_LOGS:        "aiSupervisorLogs",
  CURRICULUM_REPORTS:     "curriculumUpdateReports",
  ASSESSMENT_STANDARDS:   "assessmentStandards",
  WEAKNESS_PROFILES:      "learnerWeaknessProfiles",
  APPROVED_SYLLABI:       "approvedSyllabi",
});

const TASK_STATUS = Object.freeze({
  QUEUED:                  "queued",
  RUNNING:                 "running",
  THINKING:                "thinking",
  GENERATING:              "generating",
  CHECKING:                "checking",
  WAITING:                 "waiting",
  COMPLETED:               "completed",
  PASSED_QUALITY_CHECK:    "passed_quality_check",
  FAILED_QUALITY_CHECK:    "failed_quality_check",
  NEEDS_REVIEW:            "needs_review",
  APPROVED:                "approved",
  PUBLISHED:               "published",
  REJECTED:                "rejected",
  REGENERATING:            "regenerating",
  ERROR:                   "error",
});

const CONTENT_STATUS = Object.freeze({
  DRAFT:                   "draft",
  NEEDS_REVIEW:            "needs_review",
  APPROVED:                "approved",
  PUBLISHED:               "published",
  REJECTED:                "rejected",
  REGENERATE_REQUIRED:     "regenerate_required",
});

const TASK_STEP_STATUS = Object.freeze({
  QUEUED:    "queued",
  RUNNING:   "running",
  COMPLETED: "completed",
  FAILED:    "failed",
  SKIPPED:   "skipped",
});

const SEVERITY = Object.freeze({
  INFO:    "info",
  WARNING: "warning",
  ERROR:   "error",
});

// Sources the Standards agent owns. Used as `assessmentType` values.
const ASSESSMENT_TYPES = Object.freeze([
  "practice_quiz",
  "topic_test",
  "monthly_test",
  "midterm_test",
  "end_of_term_test",
  "composite_exam",
]);

module.exports = {
  COLLECTIONS,
  TASK_STATUS,
  CONTENT_STATUS,
  TASK_STEP_STATUS,
  SEVERITY,
  ASSESSMENT_TYPES,
};
