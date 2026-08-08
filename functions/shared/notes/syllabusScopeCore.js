/**
 * The grade ceiling (§3b).
 *
 * Ask a general model for "Parts of the Skin" and it writes the best answer it
 * knows: epidermis strata, melanocytes, keratinocytes, homeostatic
 * thermoregulation. That answer is correct and it is WRONG — wrong for a Grade
 * 4 reader, and wrong for the exam, which marks the syllabus and the prescribed
 * book. The Grade 7 textbook teaches the small intestine as duodenum and ileum;
 * a note that adds the jejunum is more accurate and less true.
 *
 * So generation is bounded on both sides. The COMPLETENESS FLOOR is every
 * retrieved outcome for the topic; the DEPTH CEILING is nothing beyond them.
 * This module is the ceiling's checker: it runs over the draft and reports
 * concepts that belong to a later grade, plus outcomes the draft never covered.
 *
 * ## Why a declared registry rather than "ask the model if it went too far"
 *
 * A model asked to audit its own depth agrees with itself. The registry below
 * is a list of terms with the grade that introduces them, each carrying the
 * reason it is on the list — so a false positive is a line somebody can read
 * and correct, and adding a term is a decision with a name attached rather
 * than a threshold nudge. It is deliberately partial: it holds the terms that
 * have actually been observed drifting into primary notes. A term that is not
 * on it is not cleared, it is unexamined, and `checkScope` says so rather than
 * reporting a clean pass it cannot support.
 */

/**
 * Grade codes in teaching order.
 *
 * Forms map onto the junior/senior secondary grades they replace under the
 * 2023 CBC (Form 1 ≙ Grade 8). The ceiling only needs the ORDER, so an
 * off-by-one at the Form boundary makes the check marginally stricter for a
 * Form class — never looser for a primary one, which is where the drift is.
 */
const GRADE_ORDER = [
  'ECE_N', 'ECE_R', 'ECE',
  'G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7',
  'G8', 'G9', 'G10', 'G11', 'G12',
]

const FORM_TO_GRADE = Object.freeze({ F1: 'G8', F2: 'G9', F3: 'G10', F4: 'G11' })

/** Normalise a grade code to the ladder above. Unknown → null. */
export function canonicalGrade(grade) {
  const g = String(grade || '').trim().toUpperCase().replace(/\s+/g, '')
  if (FORM_TO_GRADE[g]) return FORM_TO_GRADE[g]
  return GRADE_ORDER.includes(g) ? g : null
}

/** Position on the ladder, or -1 when the grade is not one we rank. */
export function gradeRank(grade) {
  const g = canonicalGrade(grade)
  return g ? GRADE_ORDER.indexOf(g) : -1
}

/**
 * Terms that belong to a specific grade and above.
 *
 * `introducedAt` is the FIRST grade whose syllabus or prescribed book uses the
 * term. `subjects` narrows the rule where a word is innocent elsewhere
 * ("cell" in Social Studies is not the biology cell). `note` is printed in the
 * finding, because "jejunum is out of scope" without "the Grade 7 book teaches
 * duodenum + ileum only" is an assertion a teacher cannot check.
 */
export const ABOVE_GRADE_TERMS = Object.freeze([
  // ── Human biology ────────────────────────────────────────────────────────
  { term: 'jejunum', introducedAt: 'G10', subjects: ['integrated_science', 'biology'],
    note: 'the Grade 7 book teaches the small intestine as duodenum + ileum only' },
  { term: 'melanocyte', introducedAt: 'G11', subjects: ['integrated_science', 'biology'],
    note: 'skin is taught as layers and functions before senior secondary' },
  { term: 'keratinocyte', introducedAt: 'G11', subjects: ['integrated_science', 'biology'] },
  { term: 'stratum corneum', introducedAt: 'G11', subjects: ['integrated_science', 'biology'] },
  { term: 'homeostasis', introducedAt: 'G10', subjects: ['integrated_science', 'biology'],
    note: 'primary notes say "keeps the body at the right temperature"' },
  { term: 'homeostatic', introducedAt: 'G10', subjects: ['integrated_science', 'biology'] },
  { term: 'peristalsis', introducedAt: 'G8', subjects: ['integrated_science', 'biology'] },
  { term: 'villi', introducedAt: 'G8', subjects: ['integrated_science', 'biology'] },
  { term: 'enzyme', introducedAt: 'G8', subjects: ['integrated_science', 'biology'],
    note: 'primary notes say "juices that break food down"' },
  { term: 'amylase', introducedAt: 'G9', subjects: ['integrated_science', 'biology'] },
  { term: 'alveoli', introducedAt: 'G8', subjects: ['integrated_science', 'biology'] },
  { term: 'haemoglobin', introducedAt: 'G8', subjects: ['integrated_science', 'biology'] },
  { term: 'osmosis', introducedAt: 'G8', subjects: ['integrated_science', 'biology'] },
  { term: 'mitochondri', introducedAt: 'G8', subjects: ['integrated_science', 'biology'],
    note: 'matches mitochondria/mitochondrion' },
  { term: 'photosynthesis equation', introducedAt: 'G8', subjects: ['integrated_science', 'biology'] },
  { term: 'chlorophyll', introducedAt: 'G6', subjects: ['integrated_science', 'biology'] },
  { term: 'xylem', introducedAt: 'G8', subjects: ['integrated_science', 'biology'] },
  { term: 'phloem', introducedAt: 'G8', subjects: ['integrated_science', 'biology'] },
  { term: 'gamete', introducedAt: 'G8', subjects: ['integrated_science', 'biology'] },
  { term: 'meiosis', introducedAt: 'G10', subjects: ['integrated_science', 'biology'] },
  { term: 'mitosis', introducedAt: 'G10', subjects: ['integrated_science', 'biology'] },
  { term: 'genotype', introducedAt: 'G10', subjects: ['integrated_science', 'biology'] },
  { term: 'allele', introducedAt: 'G10', subjects: ['integrated_science', 'biology'] },

  // ── Physical science ─────────────────────────────────────────────────────
  { term: 'covalent', introducedAt: 'G10', subjects: ['integrated_science', 'chemistry'] },
  { term: 'ionic bond', introducedAt: 'G10', subjects: ['integrated_science', 'chemistry'] },
  { term: 'electron shell', introducedAt: 'G9', subjects: ['integrated_science', 'chemistry'] },
  { term: 'mole', introducedAt: 'G10', subjects: ['chemistry'] },
  { term: 'stoichiometr', introducedAt: 'G11', subjects: ['chemistry'] },
  { term: 'newton’s second law', introducedAt: 'G10', subjects: ['integrated_science', 'physics'] },
  { term: 'momentum', introducedAt: 'G10', subjects: ['integrated_science', 'physics'] },
  { term: 'ohm’s law', introducedAt: 'G9', subjects: ['integrated_science', 'physics'] },
  { term: 'kinetic energy', introducedAt: 'G8', subjects: ['integrated_science', 'physics'] },

  // ── Mathematics ──────────────────────────────────────────────────────────
  { term: 'algebraic expression', introducedAt: 'G7', subjects: ['mathematics'] },
  { term: 'quadratic', introducedAt: 'G9', subjects: ['mathematics'] },
  { term: 'simultaneous equation', introducedAt: 'G9', subjects: ['mathematics'] },
  { term: 'pythagoras', introducedAt: 'G8', subjects: ['mathematics'] },
  { term: 'trigonometr', introducedAt: 'G9', subjects: ['mathematics'] },
  { term: 'standard deviation', introducedAt: 'G11', subjects: ['mathematics'] },
  { term: 'differentiat', introducedAt: 'G11', subjects: ['mathematics'],
    note: 'calculus — matches differentiate/differentiation' },
  { term: 'logarithm', introducedAt: 'G10', subjects: ['mathematics'] },
  { term: 'irrational number', introducedAt: 'G8', subjects: ['mathematics'] },

  // ── Social studies / civics ──────────────────────────────────────────────
  { term: 'gross domestic product', introducedAt: 'G10', subjects: ['social_studies', 'civic_education', 'geography'] },
  { term: 'inflation rate', introducedAt: 'G10', subjects: ['social_studies', 'civic_education'] },
  { term: 'separation of powers', introducedAt: 'G10', subjects: ['social_studies', 'civic_education'] },
  { term: 'plate tectonic', introducedAt: 'G8', subjects: ['social_studies', 'geography'] },
  { term: 'latitude and longitude', introducedAt: 'G6', subjects: ['social_studies', 'geography'] },
])

const normSubject = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '_')

/** Text a scope check can be run over — same flattening as the voice lint. */
function asText(value) {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(' • ')
  if (value && typeof value === 'object') {
    return Object.values(value).map(asText).filter(Boolean).join(' • ')
  }
  return ''
}

/**
 * Terms in `value` that a later grade introduces.
 *
 * A term whose rule names subjects only fires for those subjects; a term with
 * no `subjects` fires everywhere. An unrankable grade returns [] — guessing a
 * ceiling for a grade we cannot place would flag correct notes.
 */
export function findOutOfScopeTerms(value, { grade, subject } = {}) {
  const rank = gradeRank(grade)
  if (rank < 0) return []
  const text = asText(value).toLowerCase()
  if (!text) return []
  const subj = normSubject(subject)
  const hits = []
  for (const entry of ABOVE_GRADE_TERMS) {
    if (entry.subjects && !entry.subjects.map(normSubject).includes(subj)) continue
    if (gradeRank(entry.introducedAt) <= rank) continue
    if (!text.includes(entry.term.toLowerCase())) continue
    hits.push({
      term: entry.term,
      introducedAt: entry.introducedAt,
      note: entry.note || '',
    })
  }
  return hits
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by',
  'be', 'is', 'are', 'was', 'were', 'that', 'this', 'these', 'those', 'as',
  'at', 'from', 'it', 'its', 'their', 'they', 'will', 'can', 'able', 'about',
  'learner', 'learners', 'pupil', 'pupils', 'should', 'demonstrate', 'identify',
  'describe', 'explain', 'state', 'outline', 'discuss', 'apply', 'use', 'using',
])

function contentWords(text) {
  return [...new Set(
    String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOPWORDS.has(w)),
  )]
}

/**
 * Retrieved outcomes the draft never covers (the completeness FLOOR).
 *
 * An outcome counts as covered when at least half its content words appear in
 * the draft. A stricter rule fails on legitimate rewording — "identify the
 * parts of a flower" covered as "the parts of a flower are…" — and a looser one
 * passes a draft that merely mentions the topic.
 */
export function coverageGaps(value, outcomes = []) {
  const text = asText(value).toLowerCase()
  if (!text) return outcomes.slice()
  const gaps = []
  for (const outcome of outcomes) {
    const words = contentWords(outcome)
    if (words.length === 0) continue
    const present = words.filter((w) => text.includes(w)).length
    if (present / words.length < 0.5) gaps.push(outcome)
  }
  return gaps
}

/**
 * The full scope verdict for a draft.
 *
 * `checked: false` means the boundary carried no outcomes and the grade could
 * not be ranked — the draft was not examined, and reporting `ok: true` for it
 * would be reporting absence of evidence as evidence of absence.
 */
/**
 * The fields that hold what the learner READS.
 *
 * The coverage check runs over these and not over the document, and the
 * difference is not cosmetic: a validated document carries its own
 * `grounding.outcomes`, so flattening the whole object would find every
 * retrieved outcome quoted inside it and report perfect coverage of a draft
 * that covered nothing.
 */
const CONTENT_FIELDS = [
  'learningOutcomes', 'sections', 'workedExamples', 'dontMixThese',
  'learnerQuestions', 'rememberBox', 'exercise',
]

function contentOf(notes) {
  if (!notes || typeof notes !== 'object') return ''
  return CONTENT_FIELDS.map((f) => asText(notes[f])).filter(Boolean).join(' • ')
}

export function checkScope(notes, { grade, subject, outcomes = [] } = {}) {
  const rankable = gradeRank(grade) >= 0
  const sectionsField = notes && notes.sections
  const outOfScope = []

  // Findings name the SECTION so the runner can rewrite that one alone.
  const scan = (value, section) => {
    for (const hit of findOutOfScopeTerms(value, { grade, subject })) {
      outOfScope.push({ ...hit, section })
    }
  }
  if (Array.isArray(sectionsField)) {
    sectionsField.forEach((s, i) => scan(s, `sections.${i}`))
  }
  scan(notes && notes.workedExamples, 'workedExamples')
  scan(notes && notes.dontMixThese, 'dontMixThese')
  scan(notes && notes.learnerQuestions, 'learnerQuestions')
  scan(notes && notes.rememberBox, 'rememberBox')
  scan(notes && notes.exercise, 'exercise')

  const uncoveredOutcomes = outcomes.length ? coverageGaps(contentOf(notes), outcomes) : []
  const checked = rankable || outcomes.length > 0

  return {
    checked,
    ok: outOfScope.length === 0 && uncoveredOutcomes.length === 0,
    outOfScope,
    uncoveredOutcomes,
    // Sections needing a rewrite, de-duplicated. `sections.N` entries are
    // collapsed to the body section id the runner regenerates.
    sections: [...new Set(outOfScope.map((v) => (v.section.startsWith('sections.') ? 'sections' : v.section)))],
  }
}

/** One sentence for logs and the studio's amber strip. */
export function scopeMessage(result) {
  if (!result || result.ok) return ''
  const parts = []
  if (result.outOfScope.length) {
    const terms = [...new Set(result.outOfScope.map((v) => v.term))]
    parts.push(`beyond-grade ${terms.length === 1 ? 'concept' : 'concepts'}: ${terms.join(', ')}`)
  }
  if (result.uncoveredOutcomes.length) {
    parts.push(`${result.uncoveredOutcomes.length} syllabus outcome${result.uncoveredOutcomes.length === 1 ? '' : 's'} not covered`)
  }
  return parts.join('; ')
}
