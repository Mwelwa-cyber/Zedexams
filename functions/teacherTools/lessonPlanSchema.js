/**
 * Zambian CBC Lesson Plan — runtime validator (no external deps).
 *
 * Validates the structured JSON we force Claude to return. If a field is
 * missing or malformed, we either coerce (where safe) or return a list of
 * errors the caller can log + reject on.
 *
 * Intentionally not using `ajv` to keep the Functions bundle small. Swap in
 * ajv + a JSON Schema document if the schema grows past ~10 tools.
 */

const SCHEMA_VERSION = "1.0";

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v, {minLen = 0} = {}) {
  return Array.isArray(v) && v.length >= minLen && v.every(isNonEmptyString);
}

function isPositiveNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * Returns { ok: true, value } or { ok: false, errors: [...] }.
 * `value` is the input, lightly normalised — missing optional fields filled
 * with sensible defaults so the client never has to null-check.
 */
function validateLessonPlan(input) {
  const errors = [];
  const out = {schemaVersion: SCHEMA_VERSION};

  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  // ── header ────────────────────────────────────────────────────────
  const h = input.header || {};
  out.header = {
    school: isNonEmptyString(h.school) ? h.school : "",
    teacherName: isNonEmptyString(h.teacherName) ? h.teacherName : "",
    date: isNonEmptyString(h.date) ? h.date : "",
    time: isNonEmptyString(h.time) ? h.time : "",
    durationMinutes: isPositiveNumber(h.durationMinutes) ?
      Math.round(h.durationMinutes) : 40,
    class: isNonEmptyString(h.class) ? h.class : "",
    subject: isNonEmptyString(h.subject) ? h.subject : "",
    topic: isNonEmptyString(h.topic) ? h.topic : "",
    subtopic: isNonEmptyString(h.subtopic) ? h.subtopic : "",
    termAndWeek: isNonEmptyString(h.termAndWeek) ? h.termAndWeek : "",
    numberOfPupils: isPositiveNumber(h.numberOfPupils) ?
      Math.round(h.numberOfPupils) : null,
    mediumOfInstruction: isNonEmptyString(h.mediumOfInstruction) ?
      h.mediumOfInstruction : "English",
  };
  if (!out.header.subject) errors.push("header.subject is required");
  if (!out.header.topic) errors.push("header.topic is required");
  if (!out.header.class) errors.push("header.class is required");

  // ── learning outcomes / competencies / values ─────────────────────
  out.specificOutcomes = isStringArray(input.specificOutcomes, {minLen: 1}) ?
    input.specificOutcomes : [];
  if (out.specificOutcomes.length === 0) {
    errors.push("specificOutcomes must contain at least one outcome");
  }
  out.keyCompetencies = isStringArray(input.keyCompetencies) ?
    input.keyCompetencies : [];
  out.values = isStringArray(input.values) ? input.values : [];
  out.prerequisiteKnowledge = isStringArray(input.prerequisiteKnowledge) ?
    input.prerequisiteKnowledge : [];
  out.teachingLearningMaterials = isStringArray(input.teachingLearningMaterials) ?
    input.teachingLearningMaterials : [];

  // references — array of { title, publisher, pages } objects, lenient
  out.references = Array.isArray(input.references) ?
    input.references
      .filter((r) => r && typeof r === "object")
      .map((r) => ({
        title: isNonEmptyString(r.title) ? r.title : "",
        publisher: isNonEmptyString(r.publisher) ? r.publisher : "",
        pages: isNonEmptyString(r.pages) ? r.pages : "",
      }))
      .filter((r) => r.title) :
    [];

  // ── lessonDevelopment (introduction, development[], conclusion) ───
  const ld = input.lessonDevelopment || {};
  const intro = ld.introduction || {};
  const concl = ld.conclusion || {};
  out.lessonDevelopment = {
    introduction: {
      durationMinutes: isPositiveNumber(intro.durationMinutes) ?
        Math.round(intro.durationMinutes) : 5,
      teacherActivities: isStringArray(intro.teacherActivities) ?
        intro.teacherActivities : [],
      pupilActivities: isStringArray(intro.pupilActivities) ?
        intro.pupilActivities : [],
    },
    development: Array.isArray(ld.development) ?
      ld.development
        .filter((s) => s && typeof s === "object")
        .map((s, idx) => ({
          stepNumber: isPositiveNumber(s.stepNumber) ?
            Math.round(s.stepNumber) : idx + 1,
          title: isNonEmptyString(s.title) ? s.title : `Step ${idx + 1}`,
          durationMinutes: isPositiveNumber(s.durationMinutes) ?
            Math.round(s.durationMinutes) : 10,
          teacherActivities: isStringArray(s.teacherActivities) ?
            s.teacherActivities : [],
          pupilActivities: isStringArray(s.pupilActivities) ?
            s.pupilActivities : [],
        })) :
      [],
    conclusion: {
      durationMinutes: isPositiveNumber(concl.durationMinutes) ?
        Math.round(concl.durationMinutes) : 5,
      teacherActivities: isStringArray(concl.teacherActivities) ?
        concl.teacherActivities : [],
      pupilActivities: isStringArray(concl.pupilActivities) ?
        concl.pupilActivities : [],
    },
  };
  if (out.lessonDevelopment.development.length === 0) {
    errors.push("lessonDevelopment.development must have at least one step");
  }

  // ── assessment ────────────────────────────────────────────────────
  const a = input.assessment || {};
  const s = a.summative || {};
  out.assessment = {
    formative: isStringArray(a.formative) ? a.formative : [],
    summative: {
      description: isNonEmptyString(s.description) ? s.description : "",
      successCriteria: isNonEmptyString(s.successCriteria) ?
        s.successCriteria : "",
    },
  };

  // ── differentiation ───────────────────────────────────────────────
  const d = input.differentiation || {};
  out.differentiation = {
    forStruggling: isStringArray(d.forStruggling) ? d.forStruggling : [],
    forAdvanced: isStringArray(d.forAdvanced) ? d.forAdvanced : [],
  };

  // ── homework ──────────────────────────────────────────────────────
  const hw = input.homework || {};
  out.homework = {
    description: isNonEmptyString(hw.description) ? hw.description : "",
    estimatedMinutes: isPositiveNumber(hw.estimatedMinutes) ?
      Math.round(hw.estimatedMinutes) : 0,
  };

  // ── teacher reflection (blank at generation time) ────────────────
  out.teacherReflection = {
    whatWentWell: "",
    whatToImprove: "",
    pupilsWhoNeedFollowUp: [],
  };

  return errors.length === 0 ?
    {ok: true, value: out} :
    {ok: false, errors, value: out}; // include `value` so caller can fall back
}

module.exports = {
  SCHEMA_VERSION,
  validateLessonPlan,
};
