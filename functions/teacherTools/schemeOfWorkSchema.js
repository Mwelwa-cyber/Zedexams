/**
 * Scheme of Work runtime validator — v2, the official 9-column CDC shape
 * (one row per week: WEEK | TOPIC | SUBTOPIC | SPECIFIC COMPETENCES |
 * LEARNING ACTIVITIES | EXPECTED STANDARD | METHODS | T/L AIDS | REF).
 *
 * Saved v1 documents (schemaVersion "1.0": subtopics/specificOutcomes/
 * materials/assessment weeks) are untouched in Firestore — the client
 * renders them via the legacy branch of SchemeOfWorkView.
 */

const {normalizeSource} = require("./schemeCurriculumOutline");

const SCHEMA_VERSION = "2.0";

function isNonEmptyString(v) { return typeof v === "string" && v.trim().length > 0; }
function isPositiveNumber(v) { return typeof v === "number" && Number.isFinite(v) && v > 0; }
function cleanString(v) { return isNonEmptyString(v) ? v.trim() : ""; }

// Curriculum drives CBC (9-column) vs OBC (7-column) rendering. Kept in step
// with normalizeCurriculum() in src/shared/utils/schemeFormat.js — 'previous'/'2013'
// mean OBC; everything else (incl. absent) is CBC, the historical default.
function normalizeCurriculum(v) {
  const s = String(v == null ? "" : v).trim().toLowerCase();
  return (s === "obc" || s === "previous" || s === "2013" ||
    s === "outcome" || s === "outcome-based") ? "obc" : "cbc";
}
function cleanStringArray(v) {
  if (!Array.isArray(v)) return [];
  return v.filter(isNonEmptyString).map((s) => s.trim());
}

function validateSchemeOfWork(input) {
  const errors = [];

  // Never bail out early: always fall through to a normalised `value` so the
  // caller (generateSchemeOfWork) can safely stamp header fields onto the
  // result even when the model returned null/garbage. A bad payload is
  // *flagged* (ok:false with a usable value), never crashed — a thrown error
  // here would escape the runner's AI try/catch and leave the generation doc
  // stuck in status:"generating" with the usage quota already consumed.
  const obj = (input && typeof input === "object") ? input : null;
  if (!obj) errors.push("Top-level payload must be an object.");

  // ── header ─────────────────────────────────────────────────
  const h = (obj && obj.header) || {};
  const header = {
    school: cleanString(h.school),
    teacherName: cleanString(h.teacherName),
    // Older drafts may say "class" where the official head prints "grade".
    grade: cleanString(h.grade) || cleanString(h.class),
    subject: cleanString(h.subject),
    term: isPositiveNumber(h.term) ? Math.round(h.term) : 1,
    numberOfWeeks: isPositiveNumber(h.numberOfWeeks) ? Math.round(h.numberOfWeeks) : 12,
    year: cleanString(h.year) || cleanString(h.academicYear) ||
      String(new Date().getUTCFullYear()),
    periodsPerWeek: cleanString(h.periodsPerWeek),
    mediumOfInstruction: cleanString(h.mediumOfInstruction) || "English",
    // 'cbc' | 'obc' — selects the printed column set (view + exporters + editor).
    curriculum: normalizeCurriculum(h.curriculum || h.framework),
  };
  if (!header.grade) errors.push("header.grade is required");
  if (!header.subject) errors.push("header.subject is required");

  // ── weeks ─────────────────────────────────────────────────
  const rawWeeks = Array.isArray(obj && obj.weeks) ? obj.weeks : [];
  const weeks = rawWeeks
    .filter((w) => w && typeof w === "object")
    .map((w, idx) => ({
      week: isPositiveNumber(w.week) ? Math.round(w.week) :
        (isPositiveNumber(w.weekNumber) ? Math.round(w.weekNumber) : idx + 1),
      topic: cleanString(w.topic) || `Week ${idx + 1}`,
      subtopic: cleanString(w.subtopic),
      specificCompetences: cleanStringArray(w.specificCompetences),
      learningActivities: cleanStringArray(w.learningActivities),
      expectedStandard: cleanString(w.expectedStandard),
      methods: cleanStringArray(w.methods),
      tlAids: cleanStringArray(w.tlAids),
      references: cleanString(w.references),
      // Provenance of the week's topic: "syllabi_studio" | "uploaded_module"
      // | "ai_inferred" | "teacher". "" when the model didn't tag it.
      source: normalizeSource(w.source),
    }));

  if (weeks.length === 0) {
    errors.push("The scheme has no weeks.");
  }

  return errors.length === 0 ?
    {ok: true, value: {schemaVersion: SCHEMA_VERSION, header, weeks}} :
    {ok: false, errors, value: {schemaVersion: SCHEMA_VERSION, header, weeks}};
}

module.exports = {SCHEMA_VERSION, validateSchemeOfWork};
