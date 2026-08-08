/**
 * The Notes Studio's option vocabulary — audience, format, detail, length,
 * English level, paper size — declared ONCE for both runtimes.
 *
 * The studio's form, the generation contract, the preview, the exporters and
 * the library card all have to agree about what "Board notes" or "Summarised"
 * means. They used to be able to disagree, because the vocabulary lived in
 * whichever file first needed it. It lives here instead, and both `src/` and
 * the Cloud Functions import this exact file (see functions/shared/README.md).
 *
 * Two rules encoded here rather than at the call sites:
 *
 *   - **Audience has two different defaults, on purpose.** A NEW note is a
 *     learner note (`DEFAULT_AUDIENCE`) — that is the product's identity. A
 *     SAVED note with no `audience` field predates the field entirely and is a
 *     teaching note (`readAudience`), so every document written before this
 *     change reopens as exactly what it was. Collapsing the two into one
 *     constant is how an old teaching note would reopen claiming to be a
 *     learner handout it does not have the sections for.
 *
 *   - **Length constrains GENERATION, not just layout.** `lengthBudget()` is
 *     read by the prompt builder, so "½ page" produces a shorter document
 *     rather than the same document overflowing onto a second sheet. Photocopy
 *     budgets are the reason the control exists.
 */

export const NOTE_AUDIENCES = Object.freeze({
  LEARNER: 'learner',
  TEACHING: 'teaching',
})

/** What the studio opens on. Learner notes are the product. */
export const DEFAULT_AUDIENCE = NOTE_AUDIENCES.LEARNER

/** What a document written before `audience` existed actually is. */
export const LEGACY_AUDIENCE = NOTE_AUDIENCES.TEACHING

export const NOTE_FORMATS = Object.freeze({ HANDOUT: 'handout', BOARD: 'board' })
export const NOTE_DETAIL = Object.freeze({ SUMMARISED: 'summarised', DETAILED: 'detailed' })
export const NOTE_LENGTHS = Object.freeze({ HALF: 'half', ONE: 'one', TWO: 'two' })
export const ENGLISH_LEVELS = Object.freeze({ SIMPLE: 'simple', STANDARD: 'standard', EXAM: 'exam' })
export const PAPER_SIZES = Object.freeze({ A4: 'a4', A5: 'a5' })

const AUDIENCE_VALUES = new Set(Object.values(NOTE_AUDIENCES))
const FORMAT_VALUES = new Set(Object.values(NOTE_FORMATS))
const DETAIL_VALUES = new Set(Object.values(NOTE_DETAIL))
const LENGTH_VALUES = new Set(Object.values(NOTE_LENGTHS))
const ENGLISH_VALUES = new Set(Object.values(ENGLISH_LEVELS))
const PAPER_VALUES = new Set(Object.values(PAPER_SIZES))

const norm = (v) => String(v ?? '').trim().toLowerCase()

const pick = (set, value, fallback) => (set.has(norm(value)) ? norm(value) : fallback)

/** Normalise an audience supplied by a form or a callable payload. */
export function normalizeAudience(value, fallback = DEFAULT_AUDIENCE) {
  return pick(AUDIENCE_VALUES, value, fallback)
}

/**
 * The audience of a SAVED notes document.
 *
 * Absent field → `teaching`, because every document that lacks it was written
 * by the delivery-notes generator. Never `DEFAULT_AUDIENCE`.
 */
export function readAudience(notes) {
  if (!notes || typeof notes !== 'object') return LEGACY_AUDIENCE
  return normalizeAudience(notes.audience, LEGACY_AUDIENCE)
}

export const isLearnerNotes = (notes) => readAudience(notes) === NOTE_AUDIENCES.LEARNER

export function normalizeFormat(value, fallback = NOTE_FORMATS.HANDOUT) {
  return pick(FORMAT_VALUES, value, fallback)
}
export function normalizeDetail(value, fallback = NOTE_DETAIL.DETAILED) {
  return pick(DETAIL_VALUES, value, fallback)
}
export function normalizeLength(value, fallback = NOTE_LENGTHS.ONE) {
  return pick(LENGTH_VALUES, value, fallback)
}
export function normalizeEnglishLevel(value, fallback = ENGLISH_LEVELS.STANDARD) {
  return pick(ENGLISH_VALUES, value, fallback)
}
export function normalizePaperSize(value, fallback = PAPER_SIZES.A4) {
  return pick(PAPER_VALUES, value, fallback)
}

/** Everything the learner path needs, normalised in one call. */
export function normalizeNotesOptions(raw = {}, { audienceFallback = DEFAULT_AUDIENCE } = {}) {
  return {
    audience: normalizeAudience(raw.audience, audienceFallback),
    format: normalizeFormat(raw.format),
    detail: normalizeDetail(raw.detail),
    length: normalizeLength(raw.length),
    englishLevel: normalizeEnglishLevel(raw.englishLevel),
    paperSize: normalizePaperSize(raw.paperSize),
  }
}

/**
 * How much document each Length asks for, before Detail and Format adjust it.
 *
 * Word counts are what a Zambian primary handout actually holds at 11pt on A4
 * with a diagram — measured from the printed fixtures, not guessed from a
 * character count.
 */
const LENGTH_BASE = Object.freeze({
  [NOTE_LENGTHS.HALF]: { words: 260, sections: 2, examples: 1, faqs: 2, remember: 5, exercise: 4 },
  [NOTE_LENGTHS.ONE]: { words: 600, sections: 3, examples: 2, faqs: 3, remember: 6, exercise: 5 },
  [NOTE_LENGTHS.TWO]: { words: 1150, sections: 5, examples: 3, faqs: 4, remember: 8, exercise: 6 },
})

/**
 * The generation budget for a set of options.
 *
 * `faqs: 0` is how Board notes drop the FAQ section — the prompt asks for none
 * and the validator drops any that arrive anyway, so "no FAQ in board notes" is
 * enforced twice rather than requested once.
 */
export function lengthBudget({ length, detail, format } = {}) {
  const len = normalizeLength(length)
  const det = normalizeDetail(detail)
  const fmt = normalizeFormat(format)
  const base = LENGTH_BASE[len]

  const summarised = det === NOTE_DETAIL.SUMMARISED
  const board = fmt === NOTE_FORMATS.BOARD

  // Summarised compresses the explanation, not the skeleton: the boxed
  // definitions, the Remember! box and the exercise all survive, because those
  // are what a revision sheet IS.
  let words = summarised ? Math.round(base.words * 0.55) : base.words
  if (board) words = Math.round(words * 0.65) // a chalkboard holds less than a sheet

  return Object.freeze({
    words,
    sections: base.sections,
    workedExamples: summarised ? Math.min(1, base.examples) : base.examples,
    // No FAQ on a board (§4) and none on a revision sheet (§5).
    faqs: board || summarised ? 0 : base.faqs,
    rememberPoints: base.remember,
    exerciseQuestions: base.exercise,
    dontMixBoxes: summarised ? 1 : 2,
    includeFaq: !board && !summarised,
    includeWorkedExamples: !board || !summarised,
  })
}

/** Human labels — one spelling for the form, the library card and the exports. */
export const AUDIENCE_LABELS = Object.freeze({
  [NOTE_AUDIENCES.LEARNER]: 'Learner notes',
  [NOTE_AUDIENCES.TEACHING]: 'Teaching notes',
})
export const FORMAT_LABELS = Object.freeze({
  [NOTE_FORMATS.HANDOUT]: 'Handout',
  [NOTE_FORMATS.BOARD]: 'Board notes',
})
export const DETAIL_LABELS = Object.freeze({
  [NOTE_DETAIL.SUMMARISED]: 'Summarised',
  [NOTE_DETAIL.DETAILED]: 'Detailed',
})
export const LENGTH_LABELS = Object.freeze({
  [NOTE_LENGTHS.HALF]: 'Half page',
  [NOTE_LENGTHS.ONE]: '1 page',
  [NOTE_LENGTHS.TWO]: '2 pages',
})
export const ENGLISH_LEVEL_LABELS = Object.freeze({
  [ENGLISH_LEVELS.SIMPLE]: 'Simple',
  [ENGLISH_LEVELS.STANDARD]: 'Standard',
  [ENGLISH_LEVELS.EXAM]: 'Exam English',
})
export const PAPER_SIZE_LABELS = Object.freeze({
  [PAPER_SIZES.A4]: 'A4',
  [PAPER_SIZES.A5]: 'A5 booklet',
})

/**
 * The library card's one-line description of what a saved note is.
 * "Learner notes — handout" vs "Teaching notes" (§6).
 */
export function notesLibraryLabel(notes) {
  const audience = readAudience(notes)
  if (audience !== NOTE_AUDIENCES.LEARNER) return AUDIENCE_LABELS[NOTE_AUDIENCES.TEACHING]
  const format = normalizeFormat(notes && notes.format)
  return `${AUDIENCE_LABELS[NOTE_AUDIENCES.LEARNER]} — ${FORMAT_LABELS[format].toLowerCase()}`
}
