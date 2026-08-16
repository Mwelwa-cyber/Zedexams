/**
 * frameworkSubjectMatch — bridge a Scheme of Work subject (the KB slug the
 * curriculum selector emits, e.g. 'integrated_science') to its official
 * weekly allocation in the 2023 Curriculum Framework (curriculumFramework.js).
 *
 * This is how the studio auto-fills "periods per week" + "time per week"
 * without a Class Timetable. Coverage: CBC Primary bands, the 2013 OBC Primary
 * bands (Grades 1–7), and 2013 OBC Senior Secondary (Grades 10–12, via the flat
 * per-subject lookup). For anything else — CBC secondary, OBC Junior Secondary
 * (Grades 8–9), or a subject the framework doesn't list — this returns null and
 * the studio shows the "time allocation missing → enter manually" path.
 *
 * The lookup is curriculum-AWARE: pass the scheme's curriculum ('cbc'/'obc',
 * or the selector's 'previous'/framework year) so a Grade 7 resolves to the
 * right table. Grade 7 is Upper Primary under the 2013 OBC (real allocation)
 * but has NO prescribed allocation under the 2023 CBC — so the same grade
 * legitimately resolves one way for OBC and returns null for CBC. Defaults to
 * CBC when no curriculum is given (backward compatible).
 *
 * Pure + dependency-light so `node` can exercise it.
 */

import { getFrameworkForGrade, obcSeniorSecondaryAllocation } from '../../utils/curriculumFramework.js'
import { normalizeCurriculum } from '../../shared/utils/schemeFormat.js'
import { resolveStoredSubject } from '../../config/canonicalEducation.js'

// Normalised curriculum ('cbc'|'obc') → the framework id its allocations live
// under in curriculumFramework.js.
const FRAMEWORK_ID_BY_CURRICULUM = {
  cbc: 'cbc-2023',
  obc: 'obc-2013',
}

// KB subject slug → substrings to look for in a framework subject label.
//
// SECONDARY PATH ONLY. Every framework subject that corresponds to a canonical
// subject now carries a `canonicalSubjectId` foreign key, and the match below
// uses that first. This substring table remains for the framework rows that
// have NO canonical subject behind them — Physical Education and Religious
// Education are taught inside the Expressive Arts allocation rather than
// getting a line of their own, and Sign Language / Braille / Activities for
// Daily Living are adapted-curriculum provisions rather than syllabus subjects.
//
// It used to be the ONLY path, which is why a scheme of work for
// `integrated_science` could not find the framework's "Science" row under the
// CBC until 'science' was added as a substring — the two vocabularies were
// reconciled by guessing at labels rather than by a shared key.
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
  // The 2013 senior RE syllabi are two subjects but one line on the timetable —
  // the framework tables say "Religious Education", not a syllabus number, so
  // both must match it. Without these the slug fallback would look for the
  // literal token "religious education 2044" and find no allocation at all.
  religious_education_2044: ['religious'],
  religious_education_2046: ['religious'],
}

function tokensFor(subjectSlug) {
  const slug = String(subjectSlug || '').trim().toLowerCase()
  if (SLUG_ALIASES[slug]) return SLUG_ALIASES[slug]
  // Fallback: turn the slug itself into a loose token ('social_studies' → 'social studies').
  return [slug.replace(/_/g, ' ')]
}

/** 'agricultural_science' → 'Agricultural Science' (display label only). */
function prettifySlug(subjectSlug) {
  return String(subjectSlug || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim()
}

/**
 * The official allocation for a grade + subject in a given curriculum, or null
 * when the framework doesn't cover it (secondary, an unmatched subject, or a
 * curriculum with no catalogued table for that grade).
 *
 * @param {string} grade       KB grade code / label (e.g. 'G7', 'Grade 7')
 * @param {string} subjectSlug KB subject slug (e.g. 'integrated_science')
 * @param {string} [curriculum] 'cbc'|'obc'|'previous'|'2013'|'2023' — defaults
 *   to CBC when omitted, preserving the historical behaviour.
 * @returns {{ label:string, periodsPerWeek:number, timeAllocation:string,
 *             band:string, periodMinutes:number }|null}
 */
export function matchFrameworkSubject(grade, subjectSlug, curriculum) {
  const normalized = normalizeCurriculum(curriculum)
  const curriculumId = FRAMEWORK_ID_BY_CURRICULUM[normalized]
  const framework = getFrameworkForGrade(grade, curriculumId)
  if (!framework) {
    // OBC Senior Secondary (Grades 10–12) is pathway-based, so it has no
    // resolveTimetableCurriculum band — consult its flat per-subject table.
    if (normalized === 'obc') {
      const senior = obcSeniorSecondaryAllocation(grade, subjectSlug)
      if (senior) {
        return {
          label: prettifySlug(subjectSlug),
          periodsPerWeek: senior.periodsPerWeek,
          timeAllocation: senior.timeAllocation,
          band: 'obc_senior_secondary',
          periodMinutes: senior.periodMinutes,
        }
      }
    }
    return null
  }
  const subjects = framework.subjects || []

  // PRIMARY: match on the canonical subject id both sides now carry. This is
  // what makes a scheme of work for `integrated_science` resolve against the
  // CBC framework's "Science" row and the OBC framework's "Integrated Science"
  // row alike — the two curricula name the subject differently, and neither
  // name is the identity.
  const canonicalId = resolveStoredSubject(subjectSlug)?.id || ''
  let matches = canonicalId
    ? subjects.filter((s) => s.canonicalSubjectId === canonicalId)
    : []

  // SECONDARY: the label-substring fallback, for framework rows with no
  // canonical subject behind them (see SLUG_ALIASES).
  if (matches.length === 0) {
    const tokens = tokensFor(subjectSlug)
    matches = subjects.filter((s) => {
      const label = String(s.label || '').toLowerCase()
      return tokens.some((tok) => label.includes(tok))
    })
  }
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
export function periodsPerWeekLabel(grade, subjectSlug, curriculum) {
  const m = matchFrameworkSubject(grade, subjectSlug, curriculum)
  if (!m || !m.periodsPerWeek) return ''
  return `${m.periodsPerWeek} period${m.periodsPerWeek === 1 ? '' : 's'} × ${m.periodMinutes} minutes`
}
