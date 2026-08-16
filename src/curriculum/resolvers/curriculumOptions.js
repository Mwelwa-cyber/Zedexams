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
 * Behaviour:
 *   • When the syllabi cover the chosen grade, the dropdown lists ONLY the
 *     subjects those syllabi actually carry — so a Grade 1 teacher sees the
 *     four lower-primary learning areas, not the full CBC subject menu. A
 *     subject an admin adds to the Syllabi Studio shows up automatically with
 *     no code change.
 *   • When the syllabi haven't loaded, or carry no rows for the grade (e.g.
 *     Grade 7 / Grade 12, which have no syllabi on file yet), the plain
 *     taxonomy list (getSubjectsForGrade) is returned unchanged — so the
 *     dropdown is never empty and a teacher is never fully blocked.
 */

import { getSubjectsForGrade, TEACHER_SUBJECTS, ECE_SUBJECTS } from '../../config/teacherTaxonomy.js'

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
 * Build the Subject options for a grade, restricted to the subjects the
 * syllabi actually cover for that grade.
 *
 * @param {string} grade            grade code (e.g. 'G5', 'ECE_N')
 * @param {Set<string>|null} syllabusSubjects  subject slugs present in the
 *   syllabi for this grade, or null/empty when the index hasn't loaded.
 * @returns FieldSelect-shaped options — a flat list of `{value,label}` items
 *   (same shape getSubjectsForGrade returns, which also accepts `{group}`
 *   headers when we fall back to the full taxonomy).
 */
export function buildSubjectOptions(grade, syllabusSubjects) {
  const taxonomy = getSubjectsForGrade(grade)
  // No syllabi for this grade (not loaded, or a grade with no sheets on file
  // like G7 / G12) → keep the full taxonomy so the dropdown is never empty.
  if (!syllabusSubjects || syllabusSubjects.size === 0) return taxonomy

  // Grade-appropriate {value,label} items in taxonomy order, kept only when
  // the syllabi actually carry that subject for this grade.
  const flat = taxonomy.filter((o) => o.value !== undefined)

  const inSyllabus = []
  const seen = new Set()
  for (const o of flat) {
    if (syllabusSubjects.has(o.value)) {
      inSyllabus.push(o)
      seen.add(o.value)
    }
  }
  // Any syllabus subject the grade-filtered taxonomy doesn't list (e.g. one
  // an admin just added) still surfaces, sorted after the canonical ones.
  for (const slug of Array.from(syllabusSubjects).sort()) {
    if (!seen.has(slug)) {
      inSyllabus.push({ value: slug, label: subjectLabel(slug) })
      seen.add(slug)
    }
  }

  // The syllabi only carried slugs we couldn't place — keep the plain list
  // rather than returning an empty dropdown.
  if (inSyllabus.length === 0) return taxonomy

  return inSyllabus
}

/** The set of selectable subject slugs in a built options list. */
export function subjectValuesOf(options) {
  const set = new Set()
  for (const o of options || []) if (o.value !== undefined) set.add(o.value)
  return set
}
