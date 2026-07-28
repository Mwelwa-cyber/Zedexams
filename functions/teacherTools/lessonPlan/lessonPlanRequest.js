/**
 * The typed lesson-plan request — one shape, three entry points.
 *
 * ## What this replaced, and why it mattered
 *
 * The Lesson Plan Studio used to post `{systemPrompt, userPrompt, context}`:
 * two arbitrary strings the browser composed and the server passed to the model
 * unread. Everything downstream — the CBC grounding, the JSON contract, the
 * writing standards — was advice the client could decline to give. A payload
 * that dropped the curriculum block still produced a metered, billed,
 * library-saved "lesson plan".
 *
 * Now the client sends FIELDS. The server picks the approved system prompt from
 * `curriculumMode` and assembles the user prompt itself, so the generation
 * contract cannot be altered in transit.
 *
 * ## Why sanitisation lives here rather than in each adapter
 *
 * Three public entry points reach one operation (the studio callable, the
 * legacy callable, the legacy SSE endpoint). If each sanitised its own inputs
 * they would drift, and the drift would show up as the same logical request
 * producing two different fingerprints — which is the one thing idempotency
 * cannot survive. The fingerprint is computed from THIS output, so all three
 * doors normalise identically by construction.
 */

const {HttpsError} = require("firebase-functions/v2/https");

/** Layout families the studio renderer understands. */
const FORMATS = Object.freeze(["modern", "classic", "classic2"]);
/** How much the model should write. */
const DETAIL_LEVELS = Object.freeze(["simplified", "standard", "detailed"]);
/** Register. Read by the system prompt's WRITING STANDARDS block. */
const WRITING_STYLES = Object.freeze(["simple", "standard", "professional"]);
/** Which syllabus family the plan is written against. */
const CURRICULUM_MODES = Object.freeze(["cbc", "previous"]);
/** What the school actually has — constrains every activity and material. */
const RESOURCE_LEVELS = Object.freeze(["minimal", "basic", "moderate", "well_resourced"]);

const str = (v, max) => (typeof v === "string" ?
  v.replace(/\u0000/g, "").replace(/^@/g, "").trim().slice(0, max) : "");
const int = (v, def, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.round(n)));
};
const oneOf = (v, allowed, def) => {
  const s = String(v || "").toLowerCase().trim();
  return allowed.includes(s) ? s : def;
};
const strList = (v, maxItems, maxLen) => (Array.isArray(v) ?
  v.map((x) => str(x, maxLen)).filter(Boolean).slice(0, maxItems) : []);

/**
 * Normalise a raw request from any entry point into the canonical shape.
 *
 * Every field is bounded. Unknown fields are DROPPED rather than passed
 * through — an adapter that quietly forwarded an extra key would change the
 * fingerprint without changing the plan.
 */
function sanitizeLessonPlanRequest(raw = {}) {
  const r = raw || {};
  const advanced = r.advancedOptions || {};
  return {
    curriculumMode: oneOf(r.curriculumMode, CURRICULUM_MODES, "cbc"),
    grade: str(r.grade, 40),
    subject: str(r.subject, 80),
    topic: str(r.topic, 200),
    subtopic: str(r.subtopic, 200),
    term: str(r.term, 20),
    week: str(r.week, 20),
    lessonNumber: int(r.lessonNumber, 1, 1, 200),
    totalLessons: int(r.totalLessons, 1, 1, 200),
    duration: int(r.duration, 40, 5, 480),
    teacherName: str(r.teacherName, 120),
    school: str(r.school, 160),
    medium: str(r.medium, 40) || "English",
    learningEnvironments: strList(r.learningEnvironments, 8, 60),
    selectedOutcomes: strList(r.selectedOutcomes, 20, 400),
    lessonFocus: str(r.lessonFocus, 400),
    coveredContent: strList(r.coveredContent, 40, 300),
    format: oneOf(r.format, FORMATS, "modern"),
    detail: oneOf(r.detail, DETAIL_LEVELS, "standard"),
    writingStyle: oneOf(r.writingStyle, WRITING_STYLES, "standard"),
    resourceLevel: oneOf(r.resourceLevel, RESOURCE_LEVELS, "basic"),
    // Syllabus row for the chosen sub-topic. Typed rather than pre-rendered
    // prose, so the server decides how it reaches the prompt.
    syllabusContext: {
      specificCompetence: str(r.syllabusContext && r.syllabusContext.specificCompetence, 600),
      learningActivities: strList(r.syllabusContext && r.syllabusContext.learningActivities, 20, 300),
      expectedStandard: str(r.syllabusContext && r.syllabusContext.expectedStandard, 600),
    },
    // Teacher Settings → My AI. Booleans and an enum, never prose.
    aiPreferences: {
      preferredEnglish: oneOf(
          r.aiPreferences && r.aiPreferences.preferredEnglish, ["british", "american"], "british"),
      include: {
        competencies: r.aiPreferences?.include?.competencies !== false,
        specificOutcomes: r.aiPreferences?.include?.specificOutcomes !== false,
        teachingAids: r.aiPreferences?.include?.teachingAids !== false,
        homework: r.aiPreferences?.include?.homework !== false,
        exercises: r.aiPreferences?.include?.exercises !== false,
        reflection: r.aiPreferences?.include?.reflection !== false,
      },
    },
    advancedOptions: {
      localLanguage: advanced.localLanguage === true,
      includeLessonEvaluation: advanced.includeLessonEvaluation === true,
      includeEnrolment: advanced.includeEnrolment === true,
      includeAttendance: advanced.includeAttendance === true,
      compactMetadata: advanced.compactMetadata === true,
    },
  };
}

/**
 * What a request must have before it is worth paying a provider for.
 *
 * Returns a list of messages; empty means valid. Kept separate from
 * sanitisation so a caller can report every problem at once rather than the
 * first one.
 */
function validateLessonPlanRequest(inputs) {
  const errors = [];
  if (!inputs.grade) errors.push("Please select a class or grade.");
  if (!inputs.subject) errors.push("Please select a subject.");
  if (!inputs.topic) errors.push("Please select a topic.");
  if (inputs.lessonNumber > inputs.totalLessons) {
    errors.push("The lesson number cannot be greater than the total number of lessons.");
  }
  return errors;
}

/** Throw the way a callable should when validation fails. */
function assertValidLessonPlanRequest(inputs) {
  const errors = validateLessonPlanRequest(inputs);
  if (errors.length > 0) {
    throw new HttpsError("invalid-argument", errors.join(" "));
  }
}

module.exports = {
  FORMATS,
  DETAIL_LEVELS,
  WRITING_STYLES,
  CURRICULUM_MODES,
  RESOURCE_LEVELS,
  sanitizeLessonPlanRequest,
  validateLessonPlanRequest,
  assertValidLessonPlanRequest,
};
