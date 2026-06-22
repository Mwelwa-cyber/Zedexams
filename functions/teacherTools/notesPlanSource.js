/**
 * Pure helpers for resolving the "source lesson plan" that the Teacher
 * Notes Studio builds notes from.
 *
 * Split out of generateNotes.js (which pulls firebase-functions/v2 and
 * firebase-admin) so this logic can be unit-tested at the repo root with
 * plain `node` — same split pattern as functions/cors.js + cors.test.js
 * and uploadCurriculumModuleHelpers.js.
 */

/**
 * The library normalises the legacy studio tool name ("lesson-plan", with
 * a hyphen) to the canonical "lesson_plan" on read, so BOTH shapes appear
 * in the plan picker. The server must mirror that, otherwise a perfectly
 * valid legacy plan the user can see and select is rejected with the
 * confusing "isn't a lesson plan we can build notes from" error.
 */
function isLessonPlanTool(tool) {
  return tool === "lesson_plan" || tool === "lesson-plan";
}

/**
 * Extract the structured plan body. The Cloud Functions pipeline stores it
 * in `output`; the legacy studio editor stored it in `data`. Returns the
 * first usable object, or null when the plan has no body yet (still
 * generating, or the generation failed).
 */
function lessonPlanBody(plan) {
  if (!plan || typeof plan !== "object") return null;
  if (plan.output && typeof plan.output === "object") return plan.output;
  if (plan.data && typeof plan.data === "object") return plan.data;
  return null;
}

/**
 * Fill any missing note inputs from the source lesson plan. Reads from the
 * Cloud Functions shape (`inputs` + `output.header`) and the legacy studio
 * shape (`meta`) so notes can be built from either. `base` always wins when
 * it carries a value (the teacher's own form input / URL default).
 */
function deriveInputsFromLessonPlan(plan, base) {
  const body = lessonPlanBody(plan);
  if (!body) return base;
  const planInputs = (plan && plan.inputs) || {};
  const planMeta = (plan && plan.meta) || {};
  const planHeader = body.header || {};
  return {
    ...base,
    grade: base.grade || planInputs.grade || planMeta.klass ||
      planMeta.grade || planHeader.class || "",
    subject: base.subject || planInputs.subject || planMeta.subject ||
      planHeader.subject || "",
    topic: base.topic || planInputs.topic || planMeta.topic ||
      planHeader.topic || "",
    subtopic: base.subtopic || planInputs.subtopic || planMeta.subtopic ||
      planHeader.subtopic || "",
    durationMinutes: base.durationMinutes || planInputs.durationMinutes ||
      planHeader.durationMinutes || 40,
    language: base.language || planInputs.language ||
      planHeader.mediumOfInstruction || "english",
    teacherName: base.teacherName || planInputs.teacherName ||
      planHeader.teacherName || "",
    school: base.school || planInputs.school || planHeader.school || "",
  };
}

module.exports = {
  isLessonPlanTool,
  lessonPlanBody,
  deriveInputsFromLessonPlan,
};
