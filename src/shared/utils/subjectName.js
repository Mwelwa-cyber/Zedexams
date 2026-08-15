import { canonicalMathsScienceLabel } from '../../config/mathsScienceArea.js'

/**
 * subjectName — turn a raw syllabi subject KEY into the clean subject name a
 * teacher expects to read on the finished lesson plan.
 *
 * The syllabi data is keyed by verbose strings like
 *   "Integrated Science Syllabus (Grades 1-7)"
 *   "Mathematics Syllabus (Grades 4-6)"
 *   "Lower Primary Syllabi (Grades 1-3)"
 * The studio MUST keep that exact key in state so the topic/subtopic lookups
 * match, but the key must never leak into the generated plan, the AI prompt, the
 * Word/PDF header or the download filename — otherwise the document's SUBJECT
 * line reads "Integrated Science Syllabus (Grades 1-7)" instead of "Integrated
 * Science" (the bug visible in the studio preview).
 *
 * The ECE + Lower-Primary sheets abbreviate the combined maths/science area
 * ("Grade 1 - Maths & Science", "3-4 Years - Pre-Maths & Science"). Those are
 * ingestion spellings, not the names the syllabus gives the learning area, so
 * they are expanded to "Mathematics and Science" / "Pre-Mathematics and
 * Science" here — the stage is read from the sheet's own "Pre-" prefix. Only
 * the printed words change; the key stays whatever the caller passed in.
 *
 * Pure, unit-testable under plain `node`.
 *
 * @param {string} key  raw syllabi subject key
 * @returns {string}    clean subject name (falls back to the key when no suffix)
 */
export function cleanSubjectName(key) {
  const s = String(key || '')
  // Strand-scoped key ("Lower Primary Syllabi (Grades 1-3)::Grade 1 - English
  // Language") → the strand name with its grade / age-band prefix stripped
  // ("English Language"). Keep in step with SUBJECT_KEY_SEP in
  // curriculumDataService.js.
  const sep = s.indexOf('::')
  if (sep !== -1) {
    const sheet = s.slice(sep + 2)
    const strand = sheet
      .replace(/^\s*(grade\s*\d+|\d+\s*-\s*\d+\s*years?|form\s*\d+)\s*[-–:]\s*/i, '')
      .trim() || sheet
    return canonicalMathsScienceLabel(strand) || strand
  }
  const name = s.replace(/\s*Syllab(?:us|i)\s*\([^)]*\)\s*$/i, '').trim() || s
  return canonicalMathsScienceLabel(name) || name
}
