/**
 * mathsScienceArea — the one place the combined maths/science learning area is
 * NAMED.
 *
 * The 2023 (CBC) syllabus teaches maths and science as a single learning area
 * below Grade 5, and it names that area twice:
 *
 *   • Early Childhood (Nursery / Reception) — "Pre-Mathematics and Science"
 *   • Lower Primary (Grades 1-4)            — "Mathematics and Science"
 *
 * "Numeracy" is NOT one of those names. It is the storage slug the syllabus
 * rows happen to sit under (see `numeracy` in paperTaxonomy / teacherTaxonomy)
 * and one of the CBC key competences — neither of which is a subject a teacher
 * picks or a paper prints. It reached the studios' subject dropdowns as
 * "Numeracy (Maths & Science)", and from there onto printed papers, which is
 * what this module exists to stop: the slug stays `numeracy` everywhere it
 * always was, and only the words a teacher reads change.
 *
 * Pure, dependency-free, unit-testable under plain `node`
 * (scripts/test-maths-science-naming.mjs).
 */

/** Grades 1-4: the combined area's own name. */
export const MATHS_SCIENCE_LABEL = 'Mathematics and Science'

/** Nursery + Reception: the same area, at its pre-formal stage. */
export const PRE_MATHS_SCIENCE_LABEL = 'Pre-Mathematics and Science'

/** The canonical storage slug both labels resolve back to. */
export const MATHS_SCIENCE_SUBJECT_KEY = 'numeracy'

// Every KB code / studio label that means "an Early Childhood band". Kept here
// rather than imported so this module stays dependency-free — it is imported by
// config, utils and components alike, and a cycle through the taxonomy would be
// easy to introduce and hard to see.
const ECE_LEVELS = new Set(['ece', 'ece_n', 'ece_r', 'nursery', 'reception'])

/** True for the Nursery / Reception bands, in any shape a caller holds. */
export function isEarlyChildhoodLevel(grade) {
  return ECE_LEVELS.has(String(grade || '').trim().toLowerCase())
}

/**
 * Every spelling of this learning area the repo has ever produced or ingested:
 * the storage slug, the syllabus sheet names ("Maths & Science",
 * "Pre-Maths & Science"), the old parenthesised studio label, and the framework
 * table's "Pre-Mathematics and Pre-Science". Normalised (lowercase, `&` → `and`,
 * punctuation → spaces) so a caller can match without knowing which spelling it
 * holds.
 *
 * This list is the input to the alias maps in paperTaxonomy.js and
 * curriculumCatalog.js — they fold names to the slug, this names the slug back.
 */
export const MATHS_SCIENCE_ALIASES = Object.freeze([
  'numeracy',
  'numeracy maths and science',
  'numeracy mathematics and science',
  'maths and science',
  'math and science',
  'mathematics and science',
  'mathematics science',
  'maths science',
  'pre maths and science',
  'pre mathematics and science',
  'pre maths science',
  'pre mathematics science',
  'pre mathematics and pre science',
  'pre maths and pre science',
  'mathematics and pre science',
])

const ALIAS_SET = new Set(MATHS_SCIENCE_ALIASES)

/** lowercase, `&` → `and`, everything else non-alphanumeric → a single space. */
function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** True when `name` names the combined maths/science area, however spelled. */
export function isMathsScienceName(name) {
  return ALIAS_SET.has(normalize(name))
}

/**
 * The name this learning area takes at `grade`.
 *
 * With no grade the pre-formal stage cannot be told from the formal one, so the
 * Lower-Primary name is returned — the same fallback the subject slug carries,
 * and never "Numeracy".
 */
export function mathsScienceLabelForGrade(grade) {
  return isEarlyChildhoodLevel(grade) ? PRE_MATHS_SCIENCE_LABEL : MATHS_SCIENCE_LABEL
}

/**
 * Rewrite any spelling of this area to the name its level actually uses.
 * Returns '' for anything that is not this area, so a caller can say
 * `canonicalMathsScienceLabel(x, g) || x` and leave every other subject alone.
 *
 * When `grade` is omitted the stage is read from the NAME itself — the syllabus
 * sheets already distinguish "Pre-Maths & Science" (ECE) from "Maths & Science"
 * (Lower Primary), so a caller holding only a sheet name still gets the right
 * one. A bare "numeracy" with no grade resolves to the Lower-Primary name.
 */
export function canonicalMathsScienceLabel(name, grade) {
  const norm = normalize(name)
  if (!ALIAS_SET.has(norm)) return ''
  if (grade) return mathsScienceLabelForGrade(grade)
  return norm.startsWith('pre ') ? PRE_MATHS_SCIENCE_LABEL : MATHS_SCIENCE_LABEL
}
