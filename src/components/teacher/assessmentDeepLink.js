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

import { STUDIO_SUBJECTS } from './assessmentStudioMeta'
import { subjectLabel, normalizePaperGrade, isPaperGrade } from './paperTaxonomy'

// CBC subject slug → one of AssessmentStudio's 8 subjects. Secondary-only
// subjects (biology, geography, history, …) have no studio equivalent and are
// intentionally absent so they fall through to the default.
const KIT_SUBJECT_TO_STUDIO = {
  english: 'English',
  mathematics: 'Mathematics',
  numeracy: 'Mathematics',
  integrated_science: 'Integrated Science',
  environmental_science: 'Integrated Science',
  science: 'Integrated Science',
  social_studies: 'Social Studies',
  expressive_arts: 'Expressive Art',
  creative_and_technology_studies: 'Technology Studies',
  technology_studies: 'Technology Studies',
  home_economics: 'Home Economics',
  zambian_language: 'Cinyanja',
}

function studioSubjectFromCbc(slug) {
  const k = String(slug || '').trim().toLowerCase()
  if (!k) return ''
  if (KIT_SUBJECT_TO_STUDIO[k]) return KIT_SUBJECT_TO_STUDIO[k]
  // Fall back to the generic label only if it is itself one of the 8 studio
  // subjects (so an already-canonical display name still resolves).
  const label = subjectLabel(k)
  return STUDIO_SUBJECTS.includes(label) ? label : ''
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
