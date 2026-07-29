// Which papers get the mathematics authoring tools, and in what order.
//
// Pure helpers only — no React, no Firebase — so the plain-node suite can
// import this directly (scripts/test-maths-subjects.mjs) and so the studio
// card, the MCQ option rows and the slide-over editors all decide
// "is this a maths paper" from ONE place rather than each growing its own
// string comparison.
//
// Detection is keyed on the CANONICAL subject key that paperTaxonomy already
// resolves, not on the label a picker happened to show. That matters most for
// the lower grades: the CBC "Mathematics and Science" subject (Grades 1-3) and
// "Pre-Mathematics and Science" (Nursery/Reception) do NOT store `mathematics`
// — both fold onto the legacy internal key `numeracy` through SUBJECT_FIXES.
// Matching on the word "mathematics" would therefore have silently made this a
// Grade-4-and-up feature while appearing to cover everything.

import { toKbSubjectKey, paperLevel } from './paperTaxonomy.js'

/**
 * The canonical subject keys that turn mathematics-aware editing on.
 *
 *   mathematics     — Grade 4 upward (CBC) and the previous 2013 syllabus
 *   mathematics_ii  — the second Forms 1-4 mathematics syllabus
 *   numeracy        — what "Mathematics and Science" (Grades 1-3) and
 *                     "Pre-Mathematics and Science" (Nursery/Reception)
 *                     resolve to; see SUBJECT_FIXES in paperTaxonomy.js
 *
 * A Mathematics-and-Science paper bundles science strands with the maths
 * ones. Offering the maths toolbar there is correct — a teacher writing the
 * science half simply doesn't use it, and nothing about the science strands
 * is changed by its presence.
 */
export const MATHS_SUBJECT_KEYS = Object.freeze([
  'mathematics',
  'mathematics_ii',
  'numeracy',
])

const MATHS_KEY_SET = new Set(MATHS_SUBJECT_KEYS)

/**
 * Loose display-label spellings that `toKbSubjectKey` does not fold, kept
 * here rather than added to SUBJECT_FIXES on purpose: SUBJECT_FIXES decides
 * which SYLLABUS ROWS a subject resolves to, and widening it to catch "Maths"
 * would silently repoint topic lookups and generator allowlists. This list
 * only ever answers "should the maths toolbar appear", so being generous
 * costs a toolbar and never a curriculum mismatch.
 *
 * Values are the key `toKbSubjectKey` derives from each label — verified in
 * scripts/test-maths-subjects.mjs, so a change to the slugging rules fails a
 * test instead of quietly turning the feature off.
 */
const MATHS_LABEL_ALIASES = new Set([
  'maths',
  'math',
  'maths_and_science',
  'math_and_science',
  'mathematics_and_science',
  'pre_maths_and_science',
  'pre_math_and_science',
  'pre_mathematics_and_science',
  'pre_maths_science',
  'pre_mathematics_science',
  'maths_science',
  'mathematics_science',
])

/**
 * True when a paper's subject should get mathematics-aware editing.
 *
 * Accepts anything a caller might actually hold: a canonical key
 * ('mathematics', 'numeracy'), a stored slug ('maths_science'), or a display
 * label ('Mathematics and Science', 'Maths & Science'). Never throws — an
 * unknown or empty subject is simply not maths.
 */
export function isMathsSubject(subject) {
  const raw = String(subject ?? '').trim()
  if (!raw) return false
  const key = toKbSubjectKey(raw)
  if (MATHS_KEY_SET.has(key)) return true
  return MATHS_LABEL_ALIASES.has(key)
}

/**
 * Grade bands, used ONLY to order the toolbar. Every tool stays reachable at
 * every grade — a Nursery teacher who wants a number base can still insert
 * one. Ordering puts the tools a band actually uses within first reach so a
 * lower-primary teacher is not scanning past algebra to find vertical
 * addition.
 *
 * The ladder's `order` is the split point rather than a parsed grade number,
 * because grade VALUES are not comparable as numbers: 'ECE_N', '4' and 'G8'
 * all coexist, and a legacy secondary paper stores a bare '8'.
 */
export const MATHS_GRADE_BANDS = Object.freeze({
  EARLY: 'early',
  UPPER_PRIMARY: 'upper_primary',
  SECONDARY: 'secondary',
})

/**
 * 'early' (Nursery-Grade 4) | 'upper_primary' (Grades 5-7) | 'secondary'.
 *
 * An unknown or missing grade resolves to 'secondary', which is the FULL
 * ordering — the band that hides nothing and assumes least. Guessing 'early'
 * for an unrecognised grade would bury the algebraic tools for a paper we
 * simply failed to identify.
 */
export function mathsGradeBand(grade) {
  const level = paperLevel(grade)
  const order = level?.order
  if (!Number.isFinite(order) || order >= 999) return MATHS_GRADE_BANDS.SECONDARY
  if (order <= 70) return MATHS_GRADE_BANDS.EARLY          // ECE … Grade 4
  if (order <= 100) return MATHS_GRADE_BANDS.UPPER_PRIMARY // Grades 5-7
  return MATHS_GRADE_BANDS.SECONDARY
}

/**
 * Every mathematics tool the toolbar can offer, in the canonical vocabulary
 * the UI labels them with (§6 — accessible names an ordinary teacher reads,
 * not unexplained glyphs).
 */
export const MATHS_TOOLS = Object.freeze([
  'fraction',
  'mixedNumber',
  'verticalArithmetic',
  'power',
  'subscript',
  'root',
  'formula',
  'numberBase',
  'symbols',
])

const TOOL_SET = new Set(MATHS_TOOLS)

// One ordering per band. Each is a permutation of MATHS_TOOLS — asserted by
// the test, so a tool added above and forgotten here fails rather than
// disappearing from a band's toolbar.
const BAND_ORDER = Object.freeze({
  [MATHS_GRADE_BANDS.EARLY]: Object.freeze([
    'verticalArithmetic', 'fraction', 'mixedNumber',
    'power', 'root', 'subscript', 'symbols', 'formula', 'numberBase',
  ]),
  [MATHS_GRADE_BANDS.UPPER_PRIMARY]: Object.freeze([
    'fraction', 'mixedNumber', 'verticalArithmetic', 'power', 'root',
    'numberBase', 'symbols', 'subscript', 'formula',
  ]),
  [MATHS_GRADE_BANDS.SECONDARY]: Object.freeze([
    'formula', 'fraction', 'mixedNumber', 'power', 'root', 'subscript',
    'numberBase', 'verticalArithmetic', 'symbols',
  ]),
})

/**
 * The mathematics tools for a grade, most-used-first. Always returns every
 * tool: ordering is a convenience, never a restriction (§6).
 */
export function mathsToolOrder(grade) {
  return BAND_ORDER[mathsGradeBand(grade)] || BAND_ORDER[MATHS_GRADE_BANDS.SECONDARY]
}

/** Teacher-facing name for a tool — the words §6 requires on screen. */
export const MATHS_TOOL_LABELS = Object.freeze({
  fraction: 'Fraction',
  mixedNumber: 'Mixed number',
  verticalArithmetic: 'Vertical calculation',
  power: 'Power',
  subscript: 'Subscript',
  root: 'Square root',
  formula: 'Formula',
  numberBase: 'Number base',
  symbols: 'More maths',
})

export function mathsToolLabel(tool) {
  return TOOL_SET.has(tool) ? MATHS_TOOL_LABELS[tool] : ''
}
