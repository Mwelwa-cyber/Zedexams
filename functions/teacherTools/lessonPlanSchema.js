/**
 * Zambian CBC Lesson Plan — runtime validator (no external deps).
 *
 * Schema v3.0 — rebuilt to match the SAMPLE LESSON PLAN appendices of the
 * official 2023-curriculum CDC teaching modules: general competences,
 * coded specific competence, lesson goal, rationale, prior knowledge,
 * references, learning environment (natural/artificial/technological),
 * materials, expected standard, and a stages array using
 * the official progression (INTRODUCTION → LESSON DEVELOPMENT →
 * EXERCISE / ASSESSMENT → HOMEWORK → CONCLUSION), closing with remedial
 * work / extension activity.
 *
 * validateLessonPlan() only runs on NEW generations, so it validates v3
 * exclusively. Older stored documents (v2 5E lessonProgression, v1
 * lessonDevelopment) are never re-validated — they are detected via
 * detectSchemaVersion() and rendered through their own UI shims.
 *
 * Intentionally not using `ajv` to keep the Functions bundle small.
 */

const SCHEMA_VERSION = "3.0";
const V2_SCHEMA_VERSION = "2.0";
const LEGACY_SCHEMA_VERSION = "1.0";

// The five official stage names from the CDC module samples. LESSON
// DEVELOPMENT may appear as several "LESSON DEVELOPMENT — Activity k: ..."
// entries, so matching is by prefix after normalisation.
const OFFICIAL_STAGES = [
  "INTRODUCTION",
  "LESSON DEVELOPMENT",
  "EXERCISE / ASSESSMENT",
  "HOMEWORK",
  "CONCLUSION",
];

// CBC syllabus codes (e.g. "4.5", "4.5.8", "4.5.8.1") prefix the topic,
// sub-topic and specific competence in the syllabus, but teachers asked us
// NOT to show them on the printed lesson plan — they want the plain titles.
// Strip a LEADING code (two or more dot-separated number groups, plus any
// trailing separator/space) so "4.5.8.1 Describe light energy" renders as
// "Describe light energy". A bare topic with no code is returned untouched,
// and if a value is nothing but a code we keep the original rather than
// blanking a required field. Two+ groups are required so genuine content like
// "3 states of matter" or a fraction is never mistaken for a code.
function stripCbcCode(v) {
  if (typeof v !== "string") return v;
  const stripped = v.replace(/^\s*\d+(?:\.\d+)+\s*[-–—:.)]?\s*/, "").trim();
  return stripped.length > 0 ? stripped : v.trim();
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}
function isStringArray(v, {minLen = 0} = {}) {
  return Array.isArray(v) && v.length >= minLen && v.every(isNonEmptyString);
}
function isPositiveNumber(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}
function isNonNegativeInt(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}
function cleanStringArray(v) {
  return Array.isArray(v) ?
    v.filter(isNonEmptyString).map((s) => s.trim()) : [];
}

function normaliseStage(input = {}, fallbackName) {
  return {
    name: isNonEmptyString(input.name) ?
      input.name.trim().toUpperCase() : fallbackName,
    durationMinutes: isPositiveNumber(input.durationMinutes) ?
      Math.round(input.durationMinutes) : 0,
    teacherActivities: cleanStringArray(input.teacherActivities),
    learnerActivities: cleanStringArray(input.learnerActivities),
    assessmentCriteria: cleanStringArray(input.assessmentCriteria),
  };
}

/**
 * Returns { ok: true, value } or { ok: false, errors, value }.
 * `value` is populated with defaults for missing optional fields so the
 * client never has to null-check.
 */
function validateLessonPlan(input) {
  const errors = [];
  const out = {schemaVersion: SCHEMA_VERSION};

  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  // ── header ─────────────────────────────────────────────────────────
  const h = input.header || {};
  const boysPresent = isNonNegativeInt(h.boysPresent) ? h.boysPresent : null;
  const girlsPresent = isNonNegativeInt(h.girlsPresent) ? h.girlsPresent : null;
  const totalFromParts = boysPresent !== null && girlsPresent !== null ?
    boysPresent + girlsPresent : null;
  out.header = {
    school: isNonEmptyString(h.school) ? h.school : "",
    teacherName: isNonEmptyString(h.teacherName) ? h.teacherName : "",
    date: isNonEmptyString(h.date) ? h.date : "",
    time: isNonEmptyString(h.time) ? h.time : "",
    durationMinutes: isPositiveNumber(h.durationMinutes) ?
      Math.round(h.durationMinutes) : 40,
    class: isNonEmptyString(h.class) ? h.class : "",
    subject: isNonEmptyString(h.subject) ? h.subject : "",
    topic: isNonEmptyString(h.topic) ? stripCbcCode(h.topic) : "",
    subtopic: isNonEmptyString(h.subtopic) ? stripCbcCode(h.subtopic) : "",
    termAndWeek: isNonEmptyString(h.termAndWeek) ? h.termAndWeek : "",
    mediumOfInstruction: isNonEmptyString(h.mediumOfInstruction) ?
      h.mediumOfInstruction : "English",
    boysPresent,
    girlsPresent,
    totalPupils: isNonNegativeInt(h.totalPupils) ? h.totalPupils : totalFromParts,
    // Legacy field kept so old UI can still read the number
    numberOfPupils: isNonNegativeInt(h.numberOfPupils) ?
      h.numberOfPupils : totalFromParts,
  };
  if (!out.header.subject) errors.push("header.subject is required");
  if (!out.header.topic) errors.push("header.topic is required");
  if (!out.header.class) errors.push("header.class is required");

  // ── pre-table sections (official order) ────────────────────────────
  out.generalCompetences = cleanStringArray(input.generalCompetences);
  if (out.generalCompetences.length === 0) {
    errors.push("generalCompetences must list 3-5 CBC competences");
  }

  out.specificCompetence = isNonEmptyString(input.specificCompetence) ?
    stripCbcCode(input.specificCompetence) : "";
  if (!out.specificCompetence) {
    errors.push("specificCompetence is required (with its syllabus code)");
  }

  out.lessonGoal = isNonEmptyString(input.lessonGoal) ? input.lessonGoal : "";
  if (!out.lessonGoal) errors.push("lessonGoal is required (a SMART statement)");

  out.rationale = isNonEmptyString(input.rationale) ? input.rationale : "";
  if (!out.rationale) {
    errors.push("rationale is required (content, value, methods, position)");
  }

  out.priorKnowledge = isNonEmptyString(input.priorKnowledge) ?
    input.priorKnowledge : "";

  out.references = cleanStringArray(input.references);

  const le = input.learningEnvironment || {};
  out.learningEnvironment = {
    natural: isNonEmptyString(le.natural) ? le.natural : "",
    artificial: isNonEmptyString(le.artificial) ? le.artificial : "",
    technological: isNonEmptyString(le.technological) ? le.technological : "",
  };

  out.materials = cleanStringArray(input.materials);
  if (out.materials.length === 0) {
    errors.push("materials must list the teaching and learning materials");
  }

  out.expectedStandard = isNonEmptyString(input.expectedStandard) ?
    input.expectedStandard : "";
  if (!out.expectedStandard) {
    errors.push("expectedStandard is required (passive voice, from the syllabus)");
  }

  // ── LESSON PROGRESSION (official stages) ───────────────────────────
  const rawStages = Array.isArray(input.stages) ? input.stages : [];
  out.stages = rawStages
      .filter((s) => s && typeof s === "object")
      .map((s) => normaliseStage(s, "LESSON DEVELOPMENT"));
  if (out.stages.length === 0) {
    errors.push("stages must contain the official lesson progression");
  } else {
    const names = out.stages.map((s) => s.name);
    const missing = OFFICIAL_STAGES.filter((official) =>
      !names.some((n) => n.replace(/\s+/g, " ").replace(/\s*\/\s*/g, " / ")
          .startsWith(official.split(" — ")[0])));
    if (missing.length > 0) {
      errors.push(`stages is missing the official stage(s): ${missing.join(", ")}`);
    }
    const anyStageHasActivities = out.stages.some((s) =>
      s.teacherActivities.length > 0 || s.learnerActivities.length > 0);
    if (!anyStageHasActivities) {
      errors.push("stages must populate teacher and learner activities");
    }
  }

  // ── closing block ──────────────────────────────────────────────────
  out.remedialWork = isNonEmptyString(input.remedialWork) ?
    input.remedialWork : "";
  out.extensionActivity = isNonEmptyString(input.extensionActivity) ?
    input.extensionActivity : "";

  // ── coveredContent ─────────────────────────────────────────────────
  // Short bullets of what THIS lesson actually taught — feeds the
  // no-repeat tracker so a later lesson of the same sub-topic doesn't
  // re-teach it.
  out.coveredContent = isStringArray(input.coveredContent) ?
    input.coveredContent.slice(0, 40) : [];

  return errors.length === 0 ?
    {ok: true, value: out} :
    {ok: false, errors, value: out};
}

/**
 * Detect which schema version a stored plan was written against. Used
 * by the UI shims so we can render all shapes from the same viewer.
 */
function detectSchemaVersion(plan) {
  if (!plan || typeof plan !== "object") return LEGACY_SCHEMA_VERSION;
  if (plan.schemaVersion) return plan.schemaVersion;
  if (Array.isArray(plan.stages)) return SCHEMA_VERSION;
  if (plan.lessonProgression) return V2_SCHEMA_VERSION;
  if (plan.lessonDevelopment) return LEGACY_SCHEMA_VERSION;
  return LEGACY_SCHEMA_VERSION;
}

module.exports = {
  SCHEMA_VERSION,
  V2_SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
  OFFICIAL_STAGES,
  validateLessonPlan,
  detectSchemaVersion,
};
