/**
 * Rubric schema validator.
 */

const SCHEMA_VERSION = "1.0";

const ALLOWED_TASK_TYPES = new Set([
  "essay", "project", "presentation", "practical", "oral", "performance",
]);
const REQUIRED_LEVELS = ["Excellent", "Good", "Satisfactory", "Needs Improvement"];

function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }
function isStringArray(v) { return Array.isArray(v) && v.every(isNonEmptyString); }
function isNonNegativeNumber(v) { return typeof v === "number" && Number.isFinite(v) && v >= 0; }

function validateRubric(input) {
  const errors = [];
  if (!input || typeof input !== "object") {
    return {ok: false, errors: ["Top-level payload must be an object."]};
  }

  // ── header ─────────────────────────────────────────────────
  const h = input.header || {};
  const header = {
    title: isNonEmptyString(h.title) ? h.title : "",
    grade: isNonEmptyString(h.grade) ? h.grade : "",
    subject: isNonEmptyString(h.subject) ? h.subject : "",
    taskType: ALLOWED_TASK_TYPES.has(h.taskType) ? h.taskType : "essay",
    taskDescription: isNonEmptyString(h.taskDescription) ? h.taskDescription : "",
    totalMarks: isNonNegativeNumber(h.totalMarks) ? Math.round(h.totalMarks) : 0,
    assessmentType: h.assessmentType === "formative" ? "formative" : "summative",
    gradeBands: Array.isArray(h.gradeBands) ?
      h.gradeBands
        .filter((b) => b && typeof b === "object")
        .map((b) => ({
          name: isNonEmptyString(b.name) ? b.name : "",
          range: isNonEmptyString(b.range) ? b.range : "",
          symbol: isNonEmptyString(b.symbol) ? b.symbol : "",
        }))
        .filter((b) => b.name) :
      [],
  };
  if (!header.title) errors.push("header.title is required");
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");

  // ── criteria ──────────────────────────────────────────────
  const rawCriteria = Array.isArray(input.criteria) ? input.criteria : [];
  let sumMarks = 0;
  const criteria = rawCriteria
    .filter((c) => c && typeof c === "object")
    .map((c) => {
      const maxMarks = isNonNegativeNumber(c.maxMarks) ? Math.round(c.maxMarks) : 0;
      sumMarks += maxMarks;
      // Normalise levels — we want all four in order, fill in what's missing.
      const rawLevels = Array.isArray(c.levels) ? c.levels : [];
      const byName = new Map();
      for (const l of rawLevels) {
        if (l && typeof l === "object" && isNonEmptyString(l.levelName)) {
          byName.set(l.levelName.trim(), l);
        }
      }
      const levels = REQUIRED_LEVELS.map((name, idx) => {
        const raw = byName.get(name) || {};
        // If marks isn't provided, guess a sensible fallback:
        // excellent=maxMarks, good=maxMarks*0.75, satisfactory=maxMarks*0.5, needsImprovement=maxMarks*0.2
        const fallbackMarks = [
          maxMarks,
          Math.max(0, Math.round(maxMarks * 0.75)),
          Math.max(0, Math.round(maxMarks * 0.5)),
          Math.max(0, Math.round(maxMarks * 0.2)),
        ][idx];
        return {
          levelName: name,
          marks: isNonNegativeNumber(raw.marks) ? Math.round(raw.marks) : fallbackMarks,
          descriptor: isNonEmptyString(raw.descriptor) ? raw.descriptor : "",
        };
      });
      return {
        name: isNonEmptyString(c.name) ? c.name : "",
        maxMarks,
        keyCompetencies: isStringArray(c.keyCompetencies) ? c.keyCompetencies : [],
        levels,
      };
    })
    .filter((c) => c.name);

  if (criteria.length === 0) {
    errors.push("Rubric needs at least one criterion.");
  }

  // If the stated total doesn't equal the sum of criteria marks, trust the
  // sum (more robust — AI may forget to update header.totalMarks).
  if (header.totalMarks === 0 || header.totalMarks !== sumMarks) {
    header.totalMarks = sumMarks;
  }

  const markingNotes = isNonEmptyString(input.markingNotes) ? input.markingNotes : "";

  const value = {
    schemaVersion: SCHEMA_VERSION,
    header,
    criteria,
    markingNotes,
  };

  return errors.length === 0 ?
    {ok: true, value} :
    {ok: false, errors, value};
}

module.exports = {SCHEMA_VERSION, validateRubric};
