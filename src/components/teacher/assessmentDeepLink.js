// Lesson-kit deep-link → AssessmentStudio form defaults.
//
// The Lesson Plan Studio's "Create for this lesson" bar deep-links into the
// companion studios with CBC query params (grade=G5, subject=mathematics,
// topic, term). AssessmentStudio's level picker now speaks the curriculum-aware
// level scheme (bare numbers for primary grades, 'G8'…'G12' for the forms, ECE
// bands), so a CBC grade code maps straight through — a Form-1 (G8) kit seeds
// Form 1, an ECE kit seeds Nursery, and nothing is relabelled a Grade. Subjects
// with no studio equivalent (secondary-only subjects) still fall back to the
// form default. This module owns that mapping so it stays unit-testable.

import { normalizePaperGrade, isPaperGrade } from './paperTaxonomy'
import { resolveStoredSubject, subjectName } from '../../config/canonicalEducation'

/**
 * A lesson kit's subject slug → the name the studio prints on the paper.
 *
 * This was a hand-kept table folding twelve slugs onto the studio's own eight
 * labels, which is where a kit for `zambian_language` became a paper for
 * "Cinyanja" and a kit for `creative_and_technology_studies` became one for
 * "Technology Studies" — both silent relabellings of the teacher's subject.
 * The canonical model resolves the slug and names it, so a kit for a subject
 * the studio previously had no label for (Biology, Geography, History) now
 * carries through instead of falling back to the form default.
 */
function studioSubjectFromCbc(slug) {
  const subject = resolveStoredSubject(slug)
  return subject ? subjectName(subject.id) : ''
}

/**
 * Convert lesson-kit query params into AssessmentStudio form overrides.
 * Accepts a URLSearchParams (or anything with a .get(key) method). Only values
 * valid for the studio's level/subject/term scheme are returned; everything
 * else is omitted so the caller keeps its default.
 *
 * @returns {{ grade?: string, subject?: string, topic?: string, term?: string }}
 */
export function assessmentDefaultsFromParams(params) {
  const get = (k) => (params && typeof params.get === 'function' ? params.get(k) : null)
  const out = {}

  const rawGrade = get('grade')
  if (rawGrade) {
    // 'G5' → '5', 'G8' → 'G8' (Form 1), 'ECE'/'ECE_N' → 'ECE_N'; unknown → omit.
    const g = normalizePaperGrade(rawGrade)
    if (isPaperGrade(g)) out.grade = g
  }

  const subject = studioSubjectFromCbc(get('subject'))
  if (subject) out.subject = subject

  const topic = get('topic')
  if (topic && String(topic).trim()) out.topic = String(topic).trim()

  const rawTerm = get('term')
  if (rawTerm && ['1', '2', '3'].includes(String(rawTerm).trim())) out.term = String(rawTerm).trim()

  return out
}
