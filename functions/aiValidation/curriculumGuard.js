/**
 * functions/aiValidation/curriculumGuard.js
 *
 * Deterministic curriculum-context validation (Prompt 14 §7 "curriculum-context
 * validation", §8 "prevent CBC and OBC mixing", §9 "grade and subject
 * validation"). Pure — no firebase imports — so it runs under plain
 * `node functions/aiValidation/curriculumGuard.test.js`.
 *
 * The rule the spec insists on: never accept an AI-provided grade / subject /
 * framework merely because the model echoed it. Compare what the response CLAIMS
 * against the context the teacher actually SELECTED, and reject on a definite
 * mismatch. This is fail-OPEN on genuine ambiguity (a response that simply omits
 * its grade is not "wrong", just unverifiable) and fail-CLOSED on contradiction
 * (a Grade 4 request that comes back tagged Form 1, or CBC-only fields appearing
 * in a response the teacher requested on the 2013 syllabus).
 *
 * ZedExams frameworks: the app models "2023" (the current CBC syllabus) and
 * "2013" (the older outcomes-based syllabus, "OBC" in the spec's terms). This
 * module maps both to the spec's CBC/OBC vocabulary and flags the field
 * contamination the two must never mix.
 */

const {issue} = require("./validationResult");

// CBC-only structural fields. Their presence in a response the teacher asked
// for on the 2013/OBC syllabus is framework contamination (§8).
const CBC_ONLY_FIELDS = new Set([
  "competencies", "competency", "keyCompetencies", "learningActivities",
  "expectedStandards", "learningEnvironment", "learningEnvironments",
]);

// OBC/2013-only fields. Their presence in a CBC response is the reverse
// contamination.
const OBC_ONLY_FIELDS = new Set([
  "specificOutcomes", "specificOutcome", "generalOutcomes", "generalOutcome",
]);

/** Normalise a framework value from either vocabulary to "cbc" | "obc" | "". */
function normalizeFramework(value) {
  const v = String(value == null ? "" : value).trim().toLowerCase();
  if (!v) return "";
  if (v === "2023" || v === "cbc") return "cbc";
  if (v === "2013" || v === "obc") return "obc";
  return "";
}

/**
 * Normalise a ZedExams grade code (G1–G12, F1–F5, ECE bands) to a canonical
 * comparable token. Forms are G8–G12; "Form 1" and "G8" compare equal. Returns
 * "" when unrecognised (→ can't contradict, fail-open).
 */
function normalizeGrade(value) {
  const g = String(value == null ? "" : value).trim().toUpperCase().replace(/\s+/g, "");
  if (!g) return "";
  if (g === "ECE_N" || g === "NURSERY") return "ECE_N";
  if (g === "ECE_R" || g === "ECE" || g === "RECEPTION") return "ECE_R";
  let m = g.match(/^G(\d{1,2})$/);
  if (m) return `G${Number(m[1])}`;
  m = g.match(/^GRADE(\d{1,2})$/);
  if (m) return `G${Number(m[1])}`;
  m = g.match(/^F(\d)$/) || g.match(/^FORM(\d)$/);
  if (m) return `G${Number(m[1]) + 7}`; // Form N === Grade N+7
  return "";
}

/** Normalise a subject to a lowercase underscore token (numeracy≠mathematics). */
function normalizeSubject(value) {
  return String(value == null ? "" : value)
    .trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Pull a claimed field from a response, searching the top level and a `header`/
 * `meta` sub-object (studios stash grade/subject there). Returns the raw value
 * or undefined.
 */
function pluck(response, keys) {
  if (!response || typeof response !== "object") return undefined;
  const scopes = [response, response.header, response.meta].filter(
    (s) => s && typeof s === "object");
  for (const scope of scopes) {
    for (const key of keys) {
      if (scope[key] != null && scope[key] !== "") return scope[key];
    }
  }
  return undefined;
}

/** Collect all object keys present anywhere in a (bounded-depth) response. */
function collectKeys(value, depth = 0, acc = new Set()) {
  if (depth > 4 || !value || typeof value !== "object") return acc;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 200)) collectKeys(item, depth + 1, acc);
    return acc;
  }
  for (const key of Object.keys(value)) {
    acc.add(key);
    collectKeys(value[key], depth + 1, acc);
  }
  return acc;
}

/**
 * Validate a parsed AI response against the selected curriculum context.
 *
 * @param {Object} args
 * @param {Object} args.response   The parsed AI output.
 * @param {Object} args.selected   The teacher's selected context:
 *        {framework, grade, subject}. Any field may be omitted.
 * @param {boolean} [args.strictFramework=true]  Flag CBC/OBC field mixing.
 * @returns {{issues: Array}}  Only mismatches; empty === consistent.
 */
function validateCurriculumContext({response, selected = {}, strictFramework = true} = {}) {
  const issues = [];
  if (!response || typeof response !== "object") {
    issues.push(issue({
      path: "(root)", code: "NO_RESPONSE",
      message: "No response object to validate against curriculum context.",
      severity: "critical",
    }));
    return {issues};
  }

  const wantFramework = normalizeFramework(selected.framework);
  const wantGrade = normalizeGrade(selected.grade);
  const wantSubject = normalizeSubject(selected.subject);

  // ── Framework echo mismatch (§7) ─────────────────────────────────────────
  const claimedFramework = normalizeFramework(
    pluck(response, ["framework", "curriculum", "curriculumVersion", "syllabus"]));
  if (wantFramework && claimedFramework && claimedFramework !== wantFramework) {
    issues.push(issue({
      path: "framework",
      code: "FRAMEWORK_MISMATCH",
      message: `Selected ${wantFramework.toUpperCase()} but response is tagged ${claimedFramework.toUpperCase()}.`,
      severity: "critical",
      repairable: false,
    }));
  }

  // ── Framework field contamination (§8) ───────────────────────────────────
  // Only when we actually know the requested framework. CBC responses must not
  // carry OBC-only fields and vice-versa. Fail-closed: this is content the
  // teacher didn't ask for and can't safely appear.
  if (strictFramework && wantFramework) {
    const keys = collectKeys(response);
    const forbidden = wantFramework === "cbc" ? OBC_ONLY_FIELDS : CBC_ONLY_FIELDS;
    const otherLabel = wantFramework === "cbc" ? "OBC/2013" : "CBC/2023";
    const hits = [...keys].filter((k) => forbidden.has(k));
    if (hits.length) {
      issues.push(issue({
        path: hits[0],
        code: "FRAMEWORK_FIELD_CONTAMINATION",
        message: `Response for ${wantFramework.toUpperCase()} contains ${otherLabel}-only field(s): ${hits.join(", ")}.`,
        severity: "critical",
        repairable: false,
      }));
    }
  }

  // ── Grade echo mismatch (§9) ─────────────────────────────────────────────
  const claimedGrade = normalizeGrade(pluck(response, ["grade", "gradeId", "level"]));
  if (wantGrade && claimedGrade && claimedGrade !== wantGrade) {
    issues.push(issue({
      path: "grade",
      code: "GRADE_MISMATCH",
      message: `Selected grade ${wantGrade} but response is for ${claimedGrade}.`,
      severity: "critical",
      repairable: false,
    }));
  }

  // ── Subject echo mismatch (§9) ───────────────────────────────────────────
  const claimedSubject = normalizeSubject(pluck(response, ["subject", "subjectId"]));
  if (wantSubject && claimedSubject && claimedSubject !== wantSubject) {
    // Numeracy vs Mathematics and similar are genuine mismatches, not synonyms.
    issues.push(issue({
      path: "subject",
      code: "SUBJECT_MISMATCH",
      message: `Selected subject "${wantSubject}" but response is for "${claimedSubject}".`,
      severity: "critical",
      repairable: false,
    }));
  }

  return {issues};
}

module.exports = {
  CBC_ONLY_FIELDS,
  OBC_ONLY_FIELDS,
  normalizeFramework,
  normalizeGrade,
  normalizeSubject,
  validateCurriculumContext,
};
