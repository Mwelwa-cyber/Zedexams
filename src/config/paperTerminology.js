/**
 * paperTerminology — the words a Zambian paper is allowed to use (§4.1).
 *
 * The owner's decision: *"Use terminology that teachers and learners in Zambia
 * normally recognise. Do not use developer vocabulary or overly technical
 * mathematical language on the learner paper."*
 *
 * Two things this file is, and one it is not.
 *
 * It IS the single declaration of the classroom vocabulary — so a generator
 * prompt, a validation message and a printed instruction all draw the same word
 * for the same idea. Scattering wording rules through rendering code is how a
 * paper comes to say "quotient" in one place and "the answer to the division"
 * three questions later.
 *
 * It IS keyed to the level, because the same idea has a different name
 * depending on who is reading. "Share equally" and "Express your answer in its
 * lowest terms" describe overlapping mathematics to a Nursery child and a Form 4
 * candidate, and using either at the wrong level makes the paper unusable —
 * incomprehensible in one direction, condescending in the other. The key is the
 * band's existing `instructionFormality`, so the ladder is declared once
 * (assessmentBands.js) rather than twice.
 *
 * It is NOT a translator. Bemba and Nyanja generation are explicitly out of
 * scope; every term here is English.
 *
 * ## Curriculum-specific wording
 *
 * CBC and the previous curriculum accept different words for the same
 * operation — the clearest case being what a learner does when subtracting
 * across a place value. CBC teaches "regroup"; the previous curriculum's
 * materials say "borrow", and a teacher who trained on those will mark with it.
 * Neither is wrong, so the SELECTED CURRICULUM decides, and neither spelling is
 * hard-coded anywhere else.
 */

/**
 * Curriculum keys. CBC is the current national curriculum; OBC is the
 * outcome-based curriculum that preceded it and is still taught where a school
 * has not transitioned.
 *
 * The repo spells this concept three ways depending on the surface — the
 * generator carries a framework YEAR ('2023'/'2013'), the class register says
 * 'previous', and `generateAssessment` already maps year → 'cbc'/'obc'. All of
 * them are accepted here and canonicalise to these two, so a caller never has to
 * know which spelling its neighbour uses.
 */
export const CURRICULA = ['cbc', 'obc']

/** Every other spelling of the same two curricula, in use across the repo. */
export const CURRICULUM_ALIASES = {
  previous: 'obc',
  2013: 'obc',
  2023: 'cbc',
  cbc: 'cbc',
  obc: 'obc',
}

/**
 * The vocabulary itself, by topic. These are the words on a Zambian
 * blackboard and in a Zambian examination paper — the test for inclusion is
 * "would a teacher write this on the board", not "is it technically precise".
 *
 * A term with a `byCurriculum` map is chosen by the selected curriculum; every
 * other term is shared.
 *
 * `technical: true` marks a term whose appearance on a paper is UNAMBIGUOUS
 * evidence of advanced vocabulary. The distinction carries weight: "denominator"
 * has no other meaning, but "ones", "carry", "divide", "working" and "answer" are
 * ordinary English, and a Nursery paper saying "Circle the red ones" is not using
 * place-value vocabulary. A checker that flagged those would be noise, and a
 * noisy checker is one a teacher learns to ignore — so only the unambiguous
 * terms are used to detect advanced wording leaking down a level.
 * `technical: 'cbc'` marks a term technical in one curriculum only.
 */
export const PAPER_TERMS = {
  fractions: {
    numerator: { term: 'numerator', technical: true },
    denominator: { term: 'denominator', technical: true },
    fraction: { term: 'fraction' },
    mixedNumber: { term: 'mixed number', technical: true },
    improperFraction: { term: 'improper fraction', technical: true },
    equivalentFraction: { term: 'equivalent fraction', technical: true },
    simplify: { term: 'simplify', technical: true },
    lowestTerms: { term: 'lowest terms', technical: true },
  },
  division: {
    divide: { term: 'divide' },
    dividend: { term: 'dividend', technical: true },
    divisor: { term: 'divisor', technical: true },
    quotient: { term: 'quotient', technical: true },
    remainder: { term: 'remainder', technical: true },
  },
  columnArithmetic: {
    working: { term: 'working' },
    carry: { term: 'carry' },
    // The one term the curriculum decides. See the file header. Only CBC's word
    // is technical — "borrow" is ordinary English ("borrow a pencil"), so
    // flagging it would report a problem a paper does not have.
    regroup: { byCurriculum: { cbc: 'regroup', obc: 'borrow' }, technical: 'cbc' },
  },
  placeValue: {
    placeValue: { term: 'place value', technical: true },
    ones: { term: 'ones' },
    tens: { term: 'tens' },
    hundreds: { term: 'hundreds' },
    thousands: { term: 'thousands' },
    decimalPoint: { term: 'decimal point', technical: true },
  },
  answering: {
    answer: { term: 'answer' },
    showWorking: { term: 'Show your working' },
  },
}

/**
 * How an instruction is phrased at each level, keyed to the band's
 * `instructionFormality` so the ladder is declared once.
 *
 * `verbs` are the instruction words a paper at this level may open with.
 * `phrases` are complete instructions it may use verbatim.
 * `topics` are the vocabulary groups that apply — because the words are graded
 * too, not only the instructions. A Nursery paper has no business naming a
 * denominator, and offering the term to the generator is how it ends up on the
 * page.
 *
 * The progression is deliberate: a Nursery instruction is something a teacher
 * SAYS to a child who cannot yet read it, and a Form 4 instruction is the
 * register of an examination the learner will sit for real.
 */
export const INSTRUCTION_REGISTER = {
  spoken: {
    label: 'spoken aloud by the teacher',
    verbs: ['Work out', 'Share equally', 'Match', 'Circle', 'Colour', 'Count', 'Draw'],
    phrases: ['Work out the answer', 'Share the sweets equally', 'Circle the right picture'],
    // Counting and "how many" only. No fraction or division vocabulary exists
    // for a child who is still learning that numbers name quantities.
    topics: ['answering'],
  },
  simple: {
    label: 'short and plain',
    verbs: ['Work out', 'Share equally', 'Write', 'Complete', 'Fill in', 'Match', 'Circle'],
    phrases: ['Work out the answer', 'Show your working', 'Write your answer in the box'],
    topics: ['placeValue', 'columnArithmetic', 'answering'],
  },
  standard: {
    label: 'ordinary classroom English',
    verbs: ['Work out', 'Calculate', 'Simplify', 'Write', 'Complete', 'Explain', 'Name'],
    phrases: ['Show your working', 'Give your answer in its lowest terms', 'Explain your answer'],
    topics: ['fractions', 'division', 'columnArithmetic', 'placeValue', 'answering'],
  },
  formal: {
    label: 'subject register',
    verbs: ['Calculate', 'Simplify', 'Determine', 'Express', 'Explain', 'Describe', 'State'],
    phrases: [
      'Show your working',
      'Express your answer in its lowest terms',
      'Give your answer correct to two decimal places',
    ],
    topics: ['fractions', 'division', 'columnArithmetic', 'placeValue', 'answering'],
  },
  examination: {
    label: 'examination register',
    verbs: ['Calculate', 'Simplify', 'Determine', 'Express', 'Evaluate', 'Justify', 'Prove'],
    phrases: [
      'Show your working',
      'Express your answer in its lowest terms',
      'Give your answer to three significant figures',
    ],
    topics: ['fractions', 'division', 'columnArithmetic', 'placeValue', 'answering'],
  },
}

/**
 * Words that must never reach a learner's paper.
 *
 * These are the names of our own machinery. A learner seeing "raster fallback"
 * on a printed maths paper is not a cosmetic problem — it is evidence that an
 * internal failure was printed instead of being handled, and it destroys a
 * teacher's confidence in the whole tool.
 *
 * Checked against RENDERED OUTPUT rather than source code, because every one of
 * these words appears legitimately in the exporters' own identifiers and
 * comments. See `paperTerminology.spec.js`.
 */
export const FORBIDDEN_ON_PAPER = [
  'MathML',
  'LaTeX',
  'SVG',
  'raster fallback',
  'render node',
  'model output',
  'validation schema',
  'question payload',
]

const FORMALITY_FALLBACK = 'standard'

/** The instruction register for a band's formality, never undefined. */
export function instructionRegisterFor(formality) {
  return INSTRUCTION_REGISTER[String(formality || '')] || INSTRUCTION_REGISTER[FORMALITY_FALLBACK]
}

/**
 * The curriculum an unrecognised value falls back to. Declared rather than
 * inlined so the default is a stated decision, not an accident of a `||`.
 */
export const DEFAULT_CURRICULUM = 'cbc'

/** The curriculum key, defaulting to CBC — the current national curriculum. */
export function normalizeCurriculum(curriculum) {
  const key = String(curriculum == null ? '' : curriculum).toLowerCase().trim()
  return CURRICULUM_ALIASES[key] || DEFAULT_CURRICULUM
}

/**
 * Was this value actually recognised, or did it take the default?
 *
 * The default is deliberate and safe — CBC is the current national curriculum,
 * so an unrecognised value produces a usable paper rather than no paper. But
 * "usable" is not "correct": a paper that silently drifted to CBC wording is
 * wrong for an OBC class, and the drift is invisible from the output. This lets a
 * caller REPORT the fallback (generation-time validation, an admin log) instead
 * of the default being the whole story.
 */
export function isKnownCurriculum(curriculum) {
  const key = String(curriculum == null ? '' : curriculum).toLowerCase().trim()
  return Object.prototype.hasOwnProperty.call(CURRICULUM_ALIASES, key)
}

/**
 * Resolve one term for a curriculum. Returns '' for a term that does not exist,
 * rather than the key — printing `mixedNumber` on a paper would be exactly the
 * developer vocabulary this file exists to keep off it.
 */
export function termFor(topic, key, curriculum = 'cbc') {
  const entry = PAPER_TERMS[topic]?.[key]
  if (!entry) return ''
  if (entry.byCurriculum) return entry.byCurriculum[normalizeCurriculum(curriculum)] || ''
  return entry.term || ''
}

/** Every term for a topic, resolved for one curriculum. */
export function termsForTopic(topic, curriculum = 'cbc') {
  const group = PAPER_TERMS[topic]
  if (!group) return []
  return Object.keys(group).map((key) => termFor(topic, key, curriculum)).filter(Boolean)
}

/** Every term the vocabulary declares, resolved for one curriculum. */
export function allTerms(curriculum = 'cbc') {
  return Object.keys(PAPER_TERMS).flatMap((topic) => termsForTopic(topic, curriculum))
}

/**
 * The terminology directive for a generator prompt: the words to use, and the
 * register to use them in.
 *
 * Rendered from the config at call time — the same contract as
 * `buildBandDirective`. Correcting a term is a config edit, not a prompt-version
 * bump, and nothing downstream carries a second copy of the wording.
 */
export function buildTerminologyDirective({ formality, curriculum = 'cbc', subject = '' } = {}) {
  const register = instructionRegisterFor(formality)
  const curr = normalizeCurriculum(curriculum)
  const lines = [
    `INSTRUCTION REGISTER: ${register.label}. Open instructions with words like `
      + `${register.verbs.slice(0, 5).join(', ')}.`,
    `Instructions may be phrased like: ${register.phrases.map((p) => `"${p}"`).join('; ')}.`,
  ]
  // Only worth spending prompt on where the vocabulary actually applies — by
  // subject, and by level. Offering a term to the generator is how it reaches
  // the page, so a level that should not use a word is not told it.
  const mathsSubject = /math|numeracy/i.test(String(subject || ''))
  const topics = (register.topics || []).filter((t) => t !== 'answering')
  if ((mathsSubject || !subject) && topics.length) {
    const groups = topics
      .map((topic) => termsForTopic(topic, curr).join(', '))
      .filter(Boolean)
    lines.push(
      `MATHEMATICAL VOCABULARY: use the words a Zambian classroom uses — ${groups.join('; ')}.`,
    )
    if (topics.includes('columnArithmetic')) {
      lines.push(
        `When a column subtraction crosses a place value, call it `
        + `"${termFor('columnArithmetic', 'regroup', curr)}" — that is the word this `
        + 'curriculum uses.',
      )
    }
  }
  lines.push(
    'Never write any of our internal terms on the paper: '
    + `${FORBIDDEN_ON_PAPER.join(', ')}.`,
  )
  return lines.join('\n')
}

/**
 * The technical terms a level is NOT allowed to use, resolved for a curriculum.
 *
 * A quoted syllabus outcome may legitimately contain advanced terminology — the
 * outcome is what the curriculum wrote, and the application has no business
 * rewriting an approved statement because its wording is ahead of the level.
 * That outcome travels into the generation prompt as PLANNING CONTEXT.
 *
 * What must not happen is the model copying that wording straight through into a
 * Nursery question. So the same vocabulary grading that decides what a level is
 * TOLD becomes a check on what it PRODUCED: any technical term from a topic this
 * level does not carry is advanced wording that has leaked down.
 */
export function advancedTermsForLevel(formality, curriculum = 'cbc') {
  const register = instructionRegisterFor(formality)
  const permitted = new Set(register.topics || [])
  const curr = normalizeCurriculum(curriculum)
  const out = []
  for (const [topic, group] of Object.entries(PAPER_TERMS)) {
    if (permitted.has(topic)) continue
    for (const [key, entry] of Object.entries(group)) {
      const technical = entry.technical === true || entry.technical === curr
      if (!technical) continue
      const term = termFor(topic, key, curr)
      if (term) out.push(term)
    }
  }
  return out
}

/**
 * Advanced terminology found in text a LEARNER will read, for their level.
 * [] is the pass.
 *
 * Run against generated question and instruction text, not against the prompt —
 * the prompt is allowed to carry a syllabus outcome verbatim. This is the
 * boundary between planning context and learner-facing wording.
 */
export function findAdvancedTerms(text, formality, curriculum = 'cbc') {
  const body = String(text == null ? '' : text)
  if (!body) return []
  return advancedTermsForLevel(formality, curriculum).filter((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`, 'i').test(body)
  })
}

/**
 * Any forbidden internal term found in a rendered paper. [] is the pass.
 *
 * Word-boundary matched so a legitimate word that merely contains one of them
 * is not reported. Case-insensitive, because a leak is a leak in any casing.
 */
export function findForbiddenTerms(rendered) {
  const text = String(rendered == null ? '' : rendered)
  if (!text) return []
  return FORBIDDEN_ON_PAPER.filter((term) => {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`\\b${escaped}\\b`, 'i').test(text)
  })
}
