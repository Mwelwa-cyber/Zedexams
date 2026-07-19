/**
 * Professional, sanitised export filenames — e.g.
 *   GRADE_4_END_OF_TERM_1_TEST_2026.docx
 *   GRADE_4_END_OF_TERM_1_TEST_2026_MARKING_KEY.docx
 *
 * The name is derived entirely server-side from the assessment metadata so the
 * download endpoint never trusts a client-supplied filename. Pure (only the
 * server-side ASSESSMENT_TYPE_LABELS map) → unit-testable under plain `node`.
 */

const {ASSESSMENT_TYPE_LABELS} = require("../teacherTools/assessmentFormats");

/** Uppercase, underscore-joined, filesystem-safe token stream. */
function slugUpper(str) {
  return String(str || "")
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, " ") // drop punctuation
    .trim()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .toUpperCase();
}

/** Numeric grade → "GRADE_4"; form/ECE labels pass through slugged. */
function gradeToken(grade) {
  const g = String(grade ?? "").trim();
  if (!g) return "";
  if (/^\d+$/.test(g)) return `GRADE_${g}`;
  // e.g. "G8" → "FORM_1" is out of scope; keep the raw label slugged.
  return slugUpper(g.toLowerCase().startsWith("grade") ? g : `GRADE_${g}`);
}

/**
 * Build the export filename (without directory) for an assessment + export type.
 *
 * @param {object} assessment    the assessment doc (grade/assessmentType/term/year/title/subject)
 * @param {string} format        'docx' | 'pdf'
 * @param {string} mode          'paper' | 'scheme'
 * @returns {string} e.g. "GRADE_4_END_OF_TERM_1_TEST_2026.docx"
 */
function buildExportFilename(assessment, format, mode) {
  const a = assessment || {};
  const ext = format === "pdf" ? "pdf" : "docx";
  const parts = [];

  const gt = gradeToken(a.grade);
  if (gt) parts.push(gt);

  const typeLabel = ASSESSMENT_TYPE_LABELS[a.assessmentType] || "";
  if (typeLabel) {
    // "End-of-Term Test" + term 1 → "END OF TERM 1 TEST"
    const term = String(a.term ?? "").trim();
    if ((a.assessmentType === "end_of_term" || a.assessmentType === "mid_term") && term) {
      const base = a.assessmentType === "mid_term" ? "MID TERM" : "END OF TERM";
      parts.push(slugUpper(`${base} ${term} TEST`));
    } else {
      parts.push(slugUpper(typeLabel));
    }
  } else if (a.title) {
    parts.push(slugUpper(a.title));
  }

  const year = a.year || a.assessmentYear ||
    (a.assessmentDate ? new Date(a.assessmentDate).getFullYear() : "");
  if (year) parts.push(String(year));

  if (mode === "scheme") parts.push("MARKING_KEY");

  let base = parts.filter(Boolean).join("_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (!base) base = mode === "scheme" ? "ASSESSMENT_MARKING_KEY" : "ASSESSMENT";
  // Cap length so the header value stays reasonable.
  base = base.slice(0, 160).replace(/_+$/g, "");
  return `${base}.${ext}`;
}

module.exports = {slugUpper, gradeToken, buildExportFilename};
