/**
 * The legacy lesson-plan request shape, translated into the typed one.
 *
 * ## Why a translation layer rather than a rename
 *
 * `generateLessonPlan` and `apiGenerateLessonPlan` have been public callables
 * for a long time. Somewhere out there is a cached client bundle, a retried
 * request, or an integration that still posts the old field names. Renaming
 * the fields and calling it done would refuse those callers with a validation
 * error they cannot act on and would not understand.
 *
 * So the old names keep working, and the mapping lives in one obvious place
 * rather than as `raw.durationMinutes || raw.duration` scattered through the
 * operation. When the legacy doors close, this file is what gets deleted —
 * and nothing else has to change.
 *
 * ## The differences are small and boring, which is the point
 *
 * `durationMinutes` → `duration`; `learningEnvironment` (one string) →
 * `learningEnvironments` (a list); `instructions` → `lessonFocus`. The legacy
 * callers never had `format`, `detail`, `writingStyle` or the advanced
 * toggles, so those fall to the typed request's defaults — which are the
 * values the schema-based generator effectively used anyway.
 *
 * `numberOfPupils` and `language` have no home in the typed request. That is
 * deliberate rather than an oversight: neither reached the studio prompt, and
 * silently dropping them is honest where inventing a field for them would
 * imply the model reads something it does not. `language` is close to
 * `medium`, so it maps; `numberOfPupils` is recorded here as dropped.
 */

/** Legacy field names that have no typed equivalent, and why. */
const DROPPED_LEGACY_FIELDS = Object.freeze({
  numberOfPupils: "never reached the prompt; the plan does not vary by class size",
});

/**
 * Translate a legacy `generateLessonPlan` payload into a typed request.
 *
 * Unknown keys are dropped by `sanitizeLessonPlanRequest` downstream, so this
 * only has to rename what genuinely moved.
 */
function legacyToTypedLessonPlanRequest(raw = {}) {
  const r = raw || {};
  const env = r.learningEnvironment;
  return {
    // Same names, same meaning.
    curriculumMode: r.curriculumMode || r.framework || "cbc",
    grade: r.grade,
    subject: r.subject,
    topic: r.topic,
    subtopic: r.subtopic,
    term: r.term,
    lessonNumber: r.lessonNumber,
    totalLessons: r.totalLessons,
    teacherName: r.teacherName,
    school: r.school,
    resourceLevel: r.resourceLevel,
    // Renamed.
    duration: r.durationMinutes != null ? r.durationMinutes : r.duration,
    learningEnvironments: Array.isArray(env) ? env : (env ? [env] : []),
    lessonFocus: r.instructions || r.lessonFocus || "",
    medium: r.language || r.medium || "English",
    // The legacy callers never sent these; the typed defaults match what the
    // schema-based generator produced.
    format: r.format,
    detail: r.detail,
    writingStyle: r.writingStyle,
  };
}

module.exports = {
  DROPPED_LEGACY_FIELDS,
  legacyToTypedLessonPlanRequest,
};
