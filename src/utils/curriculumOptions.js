/**
 * Builds the Subject dropdown options for the teacher studios, sourced from
 * the Syllabi Studio (curriculum-data.json + admin overrides) with a safe
 * fall-back to the static taxonomy.
 *
 * Kept side-effect-free (imports only the pure teacherTaxonomy module — no
 * Firebase, no React) so plain `node` test scripts can exercise the option
 * builder without pulling in firebase/config. The React hook that loads the
 * live syllabi index lives in src/hooks/useCurriculumOptions.js.
 *
 * Behaviour (matches the product decision in PR for the syllabi-sourced
 * dropdowns):
 *   • Subjects that the syllabi cover for the chosen grade are listed first
 *     under a "From the syllabi" group — so a subject an admin adds to the
 *     Syllabi Studio shows up automatically with no code change.
 *   • The remaining curriculum-valid subjects follow under "Other subjects"
 *     so a teacher is never blocked from a valid grade/subject combination
 *     the syllabi don't cover yet.
 *   • When the syllabi haven't loaded, or carry no rows for the grade, the
 *     plain taxonomy list (getSubjectsForGrade) is returned unchanged.
 */

import { getSubjectsForGrade, TEACHER_SUBJECTS, ECE_SUBJECTS } from '../config/teacherTaxonomy.js'

// slug → human label, drawn from the canonical subject menus. Used only as a
// last resort for a syllabus slug the grade-filtered taxonomy doesn't list
// (the taxonomy options already carry grade-appropriate labels otherwise).
const SUBJECT_LABELS = (() => {
  const m = new Map()
  for (const o of [...TEACHER_SUBJECTS, ...ECE_SUBJECTS]) {
    if (o.value && !m.has(o.value)) m.set(o.value, o.label)
  }
  return m
})()

/** Human label for a subject slug; falls back to a title-cased slug. */
export function subjectLabel(slug) {
  if (SUBJECT_LABELS.has(slug)) return SUBJECT_LABELS.get(slug)
  return String(slug || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Build the grouped Subject options for a grade.
 *
 * @param {string} grade            grade code (e.g. 'G5', 'ECE_N')
 * @param {Set<string>|null} syllabusSubjects  subject slugs present in the
 *   syllabi for this grade, or null/empty when the index hasn't loaded.
 * @returns FieldSelect-shaped options: a flat list of `{group}` headers and
 *   `{value,label}` items (same shape getSubjectsForGrade returns).
 */
export function buildSubjectOptions(grade, syllabusSubjects) {
  const taxonomy = getSubjectsForGrade(grade)
  if (!syllabusSubjects || syllabusSubjects.size === 0) return taxonomy

  // Grade-appropriate {value,label} items (drop the group headers — we
  // re-group below into syllabus vs. other).
  const flat = taxonomy.filter((o) => o.value !== undefined)

  const inSyllabus = []
  const others = []
  const seen = new Set()
  for (const o of flat) {
    seen.add(o.value)
    if (syllabusSubjects.has(o.value)) inSyllabus.push(o)
    else others.push(o)
  }
  // Any syllabus subject the grade-filtered taxonomy doesn't list (e.g. one
  // an admin just added) still surfaces under "From the syllabi".
  for (const slug of Array.from(syllabusSubjects).sort()) {
    if (!seen.has(slug)) inSyllabus.push({ value: slug, label: subjectLabel(slug) })
  }

  // The syllabi only carried slugs we couldn't place — keep the plain list.
  if (inSyllabus.length === 0) return taxonomy

  const out = [{ group: 'From the syllabi' }, ...inSyllabus]
  if (others.length) out.push({ group: 'Other subjects' }, ...others)
  return out
}

/** The set of selectable subject slugs in a built options list. */
export function subjectValuesOf(options) {
  const set = new Set()
  for (const o of options || []) if (o.value !== undefined) set.add(o.value)
  return set
}
