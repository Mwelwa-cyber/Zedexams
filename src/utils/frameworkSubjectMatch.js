/**
 * frameworkSubjectMatch — bridge a Scheme of Work subject (the KB slug the
 * curriculum selector emits, e.g. 'integrated_science') to its official
 * weekly allocation in the 2023 Curriculum Framework (curriculumFramework.js).
 *
 * This is how the studio auto-fills "periods per week" + "time per week"
 * without a Class Timetable. The framework only catalogues Primary (Grades
 * 1–7); for secondary — or a subject the framework doesn't list — this returns
 * null and the studio shows the "time allocation missing → enter manually"
 * path.
 *
 * Pure + dependency-light so `node` can exercise it.
 */

import { getFrameworkForGrade } from './curriculumFramework.js'

// KB subject slug → substrings to look for in a framework subject label.
// First matching framework subject (in framework order) wins.
const SLUG_ALIASES = {
  mathematics: ['mathematics'],
  numeracy: ['mathematics'],
  english: ['english'],
  literacy: ['literacy', 'english'],
  zambian_language: ['zambian'],
  cinyanja: ['zambian'],
  integrated_science: ['integrated science', 'science'],
  environmental_science: ['science'],
  social_studies: ['social studies'],
  creative_and_technology_studies: ['creative', 'technology'],
  technology_studies: ['technology'],
  expressive_arts: ['expressive'],
  home_economics: ['home economics'],
  physical_education: ['expressive', 'physical'],
  religious_education: ['religious'],
}

function tokensFor(subjectSlug) {
  const slug = String(subjectSlug || '').trim().toLowerCase()
  if (SLUG_ALIASES[slug]) return SLUG_ALIASES[slug]
  // Fallback: turn the slug itself into a loose token ('social_studies' → 'social studies').
  return [slug.replace(/_/g, ' ')]
}

/**
 * The official allocation for a grade + subject, or null when the framework
 * doesn't cover it (secondary, or an unmatched subject).
 *
 * @returns {{ label:string, periodsPerWeek:number, timeAllocation:string,
 *             band:string, periodMinutes:number }|null}
 */
export function matchFrameworkSubject(grade, subjectSlug) {
  const framework = getFrameworkForGrade(grade)
  if (!framework) return null
  const tokens = tokensFor(subjectSlug)
  const subjects = framework.subjects || []

  const matches = subjects.filter((s) => {
    const label = String(s.label || '').toLowerCase()
    return tokens.some((tok) => label.includes(tok))
  })
  if (matches.length === 0) return null

  // Prefer a match that actually carries periods (choiceGroup alternates seed
  // one option at 0 — e.g. Home Economics — so fall back to its sibling's
  // allocation when the direct match is a 0-period alternate).
  const chosen = matches.find((s) => s.periodsPerWeek > 0) || matches[0]
  let periodsPerWeek = chosen.periodsPerWeek
  let timeAllocation = chosen.timeAllocation
  if (periodsPerWeek === 0 && chosen.choiceGroup) {
    const sibling = subjects.find(
      (s) => s.choiceGroup === chosen.choiceGroup && s.periodsPerWeek > 0,
    )
    if (sibling) {
      periodsPerWeek = sibling.periodsPerWeek
      timeAllocation = sibling.timeAllocation
    }
  }

  return {
    label: chosen.label,
    periodsPerWeek,
    timeAllocation,
    band: framework.band,
    periodMinutes: framework.periodMinutes,
  }
}

/**
 * A ready-to-print "periods per week" string in the CDC register the scheme
 * header expects, e.g. "6 periods × 40 minutes". Returns '' when unmatched.
 */
export function periodsPerWeekLabel(grade, subjectSlug) {
  const m = matchFrameworkSubject(grade, subjectSlug)
  if (!m || !m.periodsPerWeek) return ''
  return `${m.periodsPerWeek} period${m.periodsPerWeek === 1 ? '' : 's'} × ${m.periodMinutes} minutes`
}
