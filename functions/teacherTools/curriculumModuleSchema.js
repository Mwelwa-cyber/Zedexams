/**
 * Curriculum Module — runtime validator (no external deps), same style as
 * lessonPlanSchema.js / worksheetSchema.js.
 *
 * A "module" is ONE lesson of a sub-topic. Modules are stored under
 *   cbcKnowledgeBase/{KB_VERSION}/topics/{topicId}/lessons/{lessonId}
 * and are the source of truth the generators ground against. grade/subject/
 * term/topic are denormalised onto the module so each row is self-contained
 * for bulk import and collection-group queries (e.g. lesson-progression
 * "what was covered already" lookups in a later phase).
 *
 * Required (per product spec): grade, subject, term, topic, subtopic,
 * totalLessons, lessonNumber, and at least one specific outcome.
 */

const {LEARNING_ENVIRONMENT_VALUES} = require("./learningEnvironments");

const SCHEMA_VERSION = "1.0";
const LE_SET = new Set(LEARNING_ENVIRONMENT_VALUES);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function cleanStr(v, max) {
  return isNonEmptyString(v) ? String(v).trim().slice(0, max) : "";
}

function cleanStrArray(v, {max = 400, cap = 60} = {}) {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isNonEmptyString)
    .map((s) => String(s).trim().slice(0, max))
    .slice(0, cap);
}

function isPositiveInt(v) {
  return Number.isInteger(v) && v > 0;
}

function normGrade(v) {
  return String(v || "").toUpperCase().replace(/\s+/g, "").slice(0, 10);
}

function normSubject(v) {
  return String(v || "").toLowerCase().replace(/[^a-z_]/g, "_").slice(0, 40);
}

/**
 * Deterministic doc id for a sub-topic module within its topic subcollection.
 * One module per (sub-topic, term) — the SAME sub-topic is genuinely taught
 * with different content in different terms (common in the CDC modules), and
 * the teacher always selects a term, so term is part of the identity. The
 * teacher chooses how many lessons to split it into at generation time, so
 * lessonNumber is NOT part of the identity. Returns null on a bad sub-topic.
 */
function buildModuleId(subtopic, term) {
  const sub = String(subtopic || "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  if (!sub) return null;
  const t = Number(term);
  const tn = Number.isInteger(t) && t >= 1 && t <= 3 ? t : 1;
  return `${sub}-t${tn}`;
}

/**
 * Returns { ok: true, value } or { ok: false, errors, value }.
 * `value` is normalised with defaults so callers never null-check.
 */
function validateCurriculumModule(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Module must be an object."]};
  }

  const grade = normGrade(input.grade);
  const subject = normSubject(input.subject);
  const term = Number(input.term);
  const topic = cleanStr(input.topic, 200);
  const subtopic = cleanStr(input.subtopic, 200);
  const outcomes = cleanStrArray(input.outcomes, {max: 500});

  if (!grade) errors.push("grade is required");
  if (!subject) errors.push("subject is required");
  if (!(term >= 1 && term <= 3)) errors.push("term must be 1, 2 or 3");
  if (!topic) errors.push("topic is required");
  if (!subtopic) errors.push("subtopic is required");
  if (outcomes.length === 0) {
    errors.push("at least one specific learning outcome is required");
  }

  // A module is one sub-topic. The teacher chooses how many lessons to split
  // it into at generation time; `totalLessons` here is only a SUGGESTED
  // default (one lesson per specific outcome is the natural fallback).
  const sl = Number(input.totalLessons);
  const suggestedLessons = isPositiveInt(sl) ?
    sl : Math.max(1, outcomes.length);

  const learningEnvironmentOptions =
    cleanStrArray(input.learningEnvironmentOptions, {max: 40, cap: 12})
        .map((s) => s.toLowerCase().replace(/[^a-z_]/g, "_"))
        .filter((s) => LE_SET.has(s));

  const value = {
    schemaVersion: SCHEMA_VERSION,
    grade,
    subject,
    term: term >= 1 && term <= 3 ? term : 1,
    topic,
    subtopic,
    suggestedLessons,
    learningEnvironmentOptions,
    outcomes,
    competencies: cleanStrArray(input.competencies, {max: 300}),
    vocabulary: cleanStrArray(input.vocabulary, {max: 300}),
    contentSummary: cleanStr(input.contentSummary, 8000),
    teacherActivities: cleanStrArray(input.teacherActivities, {max: 600}),
    learnerActivities: cleanStrArray(input.learnerActivities, {max: 600}),
    teachingMaterials: cleanStrArray(input.teachingMaterials, {max: 300}),
    assessmentCriteria: cleanStrArray(input.assessmentCriteria, {max: 400}),
    exercises: cleanStrArray(input.exercises, {max: 800}),
    remedialActivities: cleanStrArray(input.remedialActivities, {max: 600}),
    extensionActivities: cleanStrArray(input.extensionActivities, {max: 600}),
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {
  SCHEMA_VERSION,
  validateCurriculumModule,
  buildModuleId,
};
