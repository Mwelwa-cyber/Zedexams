/**
 * Zambian CBC Lesson Plan — runtime validator (no external deps).
 *
 * Schema v2.0 — rebuilt to match Bernard Tito's CBC Lesson Plan Template
 * (Preliminary Information 1.1–1.21, 5E Lesson Progression 2.1–2.5,
 * Competence Continuity and Strategy 3). Backward compatible with v1.0
 * plans saved before the upgrade: legacy fields are kept and older docs
 * render through a shim in LessonPlanGenerator.
 *
 * Intentionally not using `ajv` to keep the Functions bundle small.
 */

const SCHEMA_VERSION = "2.0";
const LEGACY_SCHEMA_VERSION = "1.0";

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

function normalisePhase(input = {}, defaultMinutes) {
  return {
    durationMinutes: isPositiveNumber(input.durationMinutes) ?
      Math.round(input.durationMinutes) : defaultMinutes,
    teacherActivities: isStringArray(input.teacherActivities) ?
      input.teacherActivities : [],
    learnerActivities: isStringArray(input.learnerActivities) ?
      input.learnerActivities : [],
    assessmentCriteria: isStringArray(input.assessmentCriteria) ?
      input.assessmentCriteria : [],
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

  // ── header (1.1–1.9 admin) ─────────────────────────────────────────
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
    topic: isNonEmptyString(h.topic) ? h.topic : "",
    subtopic: isNonEmptyString(h.subtopic) ? h.subtopic : "",
    termAndWeek: isNonEmptyString(h.termAndWeek) ? h.termAndWeek : "",
    mediumOfInstruction: isNonEmptyString(h.mediumOfInstruction) ?
      h.mediumOfInstruction : "English",
    // NEW — attendance breakdown required by the CBC template
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

  // ── 1.10 SMART lesson goal ─────────────────────────────────────────
  out.lessonGoal = isNonEmptyString(input.lessonGoal) ? input.lessonGoal : "";
  if (!out.lessonGoal) errors.push("lessonGoal is required (a SMART statement)");

  // ── 1.11–1.13 Competences (three tiers) ────────────────────────────
  out.broadCompetences = isStringArray(input.broadCompetences) ?
    input.broadCompetences : [];
  out.expectedTargetCompetence = isNonEmptyString(input.expectedTargetCompetence) ?
    input.expectedTargetCompetence : "";
  const lc = input.lessonCompetencies || {};
  out.lessonCompetencies = {
    competency1: isNonEmptyString(lc.competency1) ? lc.competency1 : "",
    competency2: isNonEmptyString(lc.competency2) ? lc.competency2 : "",
    competency3: isNonEmptyString(lc.competency3) ? lc.competency3 : "",
  };
  if (!out.lessonCompetencies.competency1 ||
      !out.lessonCompetencies.competency2 ||
      !out.lessonCompetencies.competency3) {
    errors.push(
        "lessonCompetencies must include competency1, competency2 (thinking process), and competency3 (tangible skill-based output)",
    );
  }

  // Legacy fields preserved for v1 docs and for backward-compatible rendering
  out.specificOutcomes = isStringArray(input.specificOutcomes) ?
    input.specificOutcomes : [];
  out.keyCompetencies = isStringArray(input.keyCompetencies) ?
    input.keyCompetencies : [];
  out.values = isStringArray(input.values) ? input.values : [];

  // ── 1.14 Methodology and strategies ────────────────────────────────
  const m = input.methodology || {};
  out.methodology = {
    approach: isNonEmptyString(m.approach) ? m.approach : "",
    strategies: isStringArray(m.strategies) ? m.strategies : [],
  };

  // ── 1.15–1.17 Assessment strategies ────────────────────────────────
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

  // ── 1.18 Learning / teaching materials ─────────────────────────────
  out.teachingLearningMaterials = isStringArray(input.teachingLearningMaterials) ?
    input.teachingLearningMaterials : [];

  // ── 1.19 Learning environment (Natural/Artificial/Technological/Classroom) ─
  const le = input.learningEnvironment || {};
  const validCats = ["natural", "artificial", "technological", "classroom"];
  out.learningEnvironment = {
    category: validCats.includes(le.category) ? le.category : "classroom",
    specific: isNonEmptyString(le.specific) ? le.specific : "",
    rationale: isNonEmptyString(le.rationale) ? le.rationale : "",
  };

  // ── 1.20 Prior knowledge ───────────────────────────────────────────
  out.prerequisiteKnowledge = isStringArray(input.prerequisiteKnowledge) ?
    input.prerequisiteKnowledge : [];

  // ── 1.21 Interdisciplinary connections ─────────────────────────────
  out.interdisciplinaryConnections = Array.isArray(input.interdisciplinaryConnections) ?
    input.interdisciplinaryConnections
        .filter((c) => c && typeof c === "object")
        .map((c) => ({
          subject: isNonEmptyString(c.subject) ? c.subject : "",
          connection: isNonEmptyString(c.connection) ? c.connection : "",
        }))
        .filter((c) => c.subject && c.connection) :
    [];

  // ── references (publisher + pages) ─────────────────────────────────
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

  // ── Section 2: 5E Lesson Progression ───────────────────────────────
  const lp = input.lessonProgression || {};
  out.lessonProgression = {
    engagement: normalisePhase(lp.engagement, 5),
    exploration: normalisePhase(lp.exploration, 15),
    explanation: normalisePhase(lp.explanation, 10),
    synthesis: normalisePhase(lp.synthesis, 10),
    evaluation: normalisePhase(lp.evaluation, 5),
  };
  const anyPhaseHasActivities = ["engagement", "exploration", "explanation",
    "synthesis", "evaluation"].some((k) =>
    out.lessonProgression[k].teacherActivities.length > 0 ||
    out.lessonProgression[k].learnerActivities.length > 0,
  );
  if (!anyPhaseHasActivities) {
    errors.push("lessonProgression must populate at least one phase with activities");
  }

  // Legacy v1 3-phase structure preserved so old docs still render.
  if (input.lessonDevelopment) {
    out.lessonDevelopment = input.lessonDevelopment;
  }

  // ── Section 3: Competence Continuity and Strategy ──────────────────
  const cc = input.competenceContinuity || {};
  out.competenceContinuity = {
    longTermProjects: isStringArray(cc.longTermProjects) ?
      cc.longTermProjects : [],
    homeworkExtensions: isStringArray(cc.homeworkExtensions) ?
      cc.homeworkExtensions : [],
    upcomingConnections: isStringArray(cc.upcomingConnections) ?
      cc.upcomingConnections : [],
    teacherActions: isStringArray(cc.teacherActions) ? cc.teacherActions : [],
  };

  // ── differentiation ────────────────────────────────────────────────
  const d = input.differentiation || {};
  out.differentiation = {
    forStruggling: isStringArray(d.forStruggling) ? d.forStruggling : [],
    forAdvanced: isStringArray(d.forAdvanced) ? d.forAdvanced : [],
  };

  // ── homework ───────────────────────────────────────────────────────
  const hw = input.homework || {};
  out.homework = {
    description: isNonEmptyString(hw.description) ? hw.description : "",
    estimatedMinutes: isPositiveNumber(hw.estimatedMinutes) ?
      Math.round(hw.estimatedMinutes) : 0,
  };

  // ── teacher reflection (blank at generation time) ──────────────────
  out.teacherReflection = {
    whatWentWell: "",
    whatToImprove: "",
    pupilsWhoNeedFollowUp: [],
  };

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
 * by the UI shim so we can render both shapes from the same viewer.
 */
function detectSchemaVersion(plan) {
  if (!plan || typeof plan !== "object") return LEGACY_SCHEMA_VERSION;
  if (plan.schemaVersion) return plan.schemaVersion;
  if (plan.lessonProgression) return SCHEMA_VERSION;
  if (plan.lessonDevelopment) return LEGACY_SCHEMA_VERSION;
  return LEGACY_SCHEMA_VERSION;
}

module.exports = {
  SCHEMA_VERSION,
  LEGACY_SCHEMA_VERSION,
  validateLessonPlan,
  detectSchemaVersion,
};
