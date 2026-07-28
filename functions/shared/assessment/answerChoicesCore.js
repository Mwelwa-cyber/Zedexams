/**
 * How many answer choices a multiple-choice question offers, and whether the
 * ones it offers are usable.
 *
 * ## Why the count is a resolved decision rather than a field
 *
 * "Four choices" is a decision a paper makes, a section may override, and a
 * single question may override only when the teacher has deliberately allowed
 * it. Before this module the count lived in one paper-level field that the
 * layout used to SLICE the option array at render time, which meant three
 * separate things could disagree about how many choices question 13 had: the
 * editor (all stored options), the preview (the first N), and the AI generator
 * (whatever the model produced). The marking key read a fourth.
 *
 * So the count is resolved once, through a stated precedence, and every surface
 * — editor, preview, PDF, Word, marking key, generator prompt — is handed the
 * same number.
 *
 * ## Slicing is non-destructive, and stays that way
 *
 * Reducing a paper from A–D to A–C must not delete the teacher's fourth option:
 * they may be trying the shorter form and switching back. The stored question
 * keeps every option; the resolved count decides how many are RENDERED. What
 * this module adds is the consequence nobody handled — if the correct answer was
 * the option that just fell off the end, the paper now has no correct answer,
 * and that is a blocking export failure rather than a silent one.
 */

/** The letters a choice can be labelled with, in order. */
export const OPTION_LETTERS = Object.freeze('ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''))

/** The label printed beside choice `index`. */
export function optionLabel(index) {
  return OPTION_LETTERS[index] ?? ''
}

/**
 * The counts a teacher may choose.
 *
 * Two is absent on purpose: a two-choice "multiple choice" question is a
 * true/false question, which the studio has as its own type with its own
 * marking. Two remains ACCEPTED on read (`normalizeChoiceCount`) because papers
 * saved before this module carry it, and a saved paper must keep rendering.
 */
export const CHOICE_COUNT_OPTIONS = Object.freeze([
  Object.freeze({ value: 3, label: 'A–C', description: 'Three choices' }),
  Object.freeze({ value: 4, label: 'A–D', description: 'Four choices' }),
  Object.freeze({ value: 5, label: 'A–E', description: 'Five choices' }),
])

export const MIN_CHOICE_COUNT = 2
export const MAX_CHOICE_COUNT = 5
export const DEFAULT_CHOICE_COUNT = 4

/**
 * The count recommended for a grade — never imposed.
 *
 * Four choices from Grade 4, three below it: a Grade-2 learner reading five
 * options is being tested on reading stamina rather than the outcome. This is a
 * RECOMMENDATION and the resolver never consults it when the teacher has chosen,
 * because a default that overrides a choice is not a default.
 */
export function recommendedChoiceCount(grade) {
  const n = Number(String(grade ?? '').replace(/[^\d]/g, ''))
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_CHOICE_COUNT
  return n >= 4 ? 4 : 3
}

/** Coerce a stored value onto a usable count, or null when nothing was set. */
export function normalizeChoiceCount(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  const rounded = Math.round(n)
  if (rounded < MIN_CHOICE_COUNT || rounded > MAX_CHOICE_COUNT) return null
  return rounded
}

/**
 * The count that applies to one question.
 *
 * Precedence, most specific first:
 *   1. the question's own override — but ONLY when the paper enabled per-question
 *      overrides. A stray field on an imported question must not quietly give one
 *      question a different shape from the rest of its section.
 *   2. the section's override
 *   3. the paper's default
 *   4. the grade recommendation
 *
 * True/False is always exactly two, whatever the paper says.
 */
export function resolveChoiceCount({
  paper = null,
  section = null,
  question = null,
  grade = null,
  allowPerQuestion = false,
  type = 'mcq',
} = {}) {
  if (type === 'tf') return 2
  if (allowPerQuestion) {
    const own = normalizeChoiceCount(question?.answerChoiceCount ?? question?.mcqAnswerChoiceCount)
    if (own != null) return own
  }
  const sectionCount = normalizeChoiceCount(section?.answerChoiceCount ?? section?.mcqAnswerChoiceCount)
  if (sectionCount != null) return sectionCount
  const paperCount = normalizeChoiceCount(paper?.answerChoiceCount ?? paper?.mcqAnswerChoiceCount)
  if (paperCount != null) return paperCount
  return recommendedChoiceCount(grade ?? paper?.grade)
}

/**
 * The count that was CONFIGURED for a question, or null when nothing was.
 *
 * The difference from `resolveChoiceCount` is the grade recommendation, and it
 * decides whether a paper's stored options may be trimmed. A paper saved before
 * this setting existed has five options on a question because the teacher wrote
 * five; applying the recommendation to it would silently stop printing the
 * fifth, and the correct answer might BE the fifth. So rendering caps only
 * against an explicit setting, and papers with no setting print what they hold.
 *
 * New papers get the recommendation as their stored default at creation, which
 * is where a default belongs — in the document, visible and editable — rather
 * than in a renderer that quietly reinterprets old work.
 */
export function resolveConfiguredChoiceCount({
  paper = null, section = null, question = null, allowPerQuestion = false, type = 'mcq',
} = {}) {
  if (type === 'tf') return 2
  if (allowPerQuestion) {
    const own = normalizeChoiceCount(question?.answerChoiceCount ?? question?.mcqAnswerChoiceCount)
    if (own != null) return own
  }
  const sectionCount = normalizeChoiceCount(section?.answerChoiceCount ?? section?.mcqAnswerChoiceCount)
  if (sectionCount != null) return sectionCount
  return normalizeChoiceCount(paper?.answerChoiceCount ?? paper?.mcqAnswerChoiceCount)
}

/** The choice-count settings a paper carries, read off a saved or draft doc. */
export function paperChoiceSettings(assessment = {}) {
  return {
    count: normalizeChoiceCount(assessment.answerChoiceCount ?? assessment.mcqAnswerChoiceCount)
      ?? recommendedChoiceCount(assessment.grade),
    /** Per-question overrides are OFF unless the paper turned them on. */
    allowPerQuestion: Boolean(assessment.allowPerQuestionChoiceCount),
  }
}

/* ── Equivalence ─────────────────────────────────────────────────────────── */

/**
 * The numeric value an option denotes, or null when it does not denote one.
 *
 * Two distractors that are the same number written differently — `1/2`, `0.5`,
 * `50%`, `2/4` — are one choice printed twice, and a learner who spots it has
 * been handed the answer. Detecting that needs the VALUE, not the text, so this
 * parses the handful of numeric forms a Zambian primary/secondary paper actually
 * uses and returns null for everything else.
 *
 * Deliberately conservative. `null` means "not comparable as a number", which is
 * how prose, algebra and units all exit — reporting two sentences as
 * mathematically equivalent because both contain a 3 would be worse than missing
 * a genuine duplicate.
 */
export function numericValueOf(text) {
  const raw = String(text ?? '')
    .replace(/[−–—]/g, '-')
    // Thousands separators first, and only between digits — "1,000" is one
    // number, while collapsing every comma to a space turns it into the mixed
    // number "1 000" and reads it as 1.
    .replace(/(\d),(?=\d{3}(\D|$))/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  if (!raw) return null

  // Unicode vulgar fractions, so "½" and "1/2" compare equal.
  const vulgar = { '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75, '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8, '⅙': 1 / 6, '⅚': 5 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 }
  const normalized = raw.replace(/[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g, (ch) => ` ${vulgar[ch]} `).replace(/\s+/g, ' ').trim()

  // A percentage is a number in hundredths — "50%" and "0.5" are one choice.
  const pct = normalized.match(/^(-?\d+(?:\.\d+)?)\s*%$/)
  if (pct) return Number(pct[1]) / 100

  // Mixed number: "2 1/2" or "2½" (the vulgar pass above leaves "2 0.5").
  const mixed = normalized.match(/^(-?\d+)\s+(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/)
  if (mixed) {
    const den = Number(mixed[3])
    if (den === 0) return null
    const whole = Number(mixed[1])
    const frac = Number(mixed[2]) / den
    return whole < 0 ? whole - frac : whole + frac
  }
  // "2 0.5" — what the vulgar-fraction pass above leaves behind for "2½". The
  // fractional part must be WRITTEN as a decimal: without that, "1 000" (a
  // thousands separator that got away) reads as the mixed number 1.
  const mixedDecimal = normalized.match(/^(-?\d+)\s+(0?\.\d+)$/)
  if (mixedDecimal) {
    const whole = Number(mixedDecimal[1])
    const frac = Number(mixedDecimal[2])
    return whole < 0 ? whole - frac : whole + frac
  }

  const fraction = normalized.match(/^(-?\d+(?:\.\d+)?)\s*\/\s*(-?\d+(?:\.\d+)?)$/)
  if (fraction) {
    const den = Number(fraction[2])
    if (den === 0) return null
    return Number(fraction[1]) / den
  }

  const plain = normalized.match(/^-?\d+(?:\.\d+)?$/)
  if (plain) return Number(normalized)

  return null
}

/** Are two option texts the same number written two ways? */
export function areNumericallyEquivalent(a, b) {
  const va = numericValueOf(a)
  const vb = numericValueOf(b)
  if (va == null || vb == null) return false
  // A tolerance, because 1/3 and 0.333 are the same choice on a paper even
  // though they are different doubles. Relative, so it holds at every scale.
  const scale = Math.max(1, Math.abs(va), Math.abs(vb))
  return Math.abs(va - vb) <= 1e-6 * scale
}

/** Text reduced to what a learner would read as "the same option". */
export function normalizeOptionText(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/[.．。]+$/, '')
}

/* ── Validation ──────────────────────────────────────────────────────────── */

export const CHOICE_ISSUES = Object.freeze({
  WRONG_COUNT: 'choice-count',
  EMPTY_CHOICE: 'choice-empty',
  DUPLICATE_CHOICE: 'choice-duplicate',
  EQUIVALENT_CHOICE: 'choice-equivalent',
  NO_CORRECT_ANSWER: 'choice-no-correct',
  CORRECT_OUT_OF_RANGE: 'choice-correct-missing',
  MULTIPLE_CORRECT: 'choice-multiple-correct',
})

/**
 * Check one question's choices against the count that applies to it.
 *
 * Returns issues, most severe first is NOT imposed here — the caller ranks. Each
 * issue names the question and the letters involved, because "question 13 has a
 * problem" sends a teacher hunting and "question 13: C and D are both 0.5" does
 * not.
 *
 * @param {object} question the RENDERED question (options already sliced)
 * @param {number} expected the resolved choice count
 * @param {object} meta     {number, type} for the message
 */
export function validateChoices(question = {}, expected = DEFAULT_CHOICE_COUNT, meta = {}) {
  const type = meta.type ?? question.type ?? 'mcq'
  if (type !== 'mcq' && type !== 'tf') return []
  const label = meta.number != null ? `Question ${meta.number}` : 'A question'
  const issues = []
  const options = Array.isArray(question.options) ? question.options : []
  const media = Array.isArray(question.optionMedia) ? question.optionMedia : []
  const has = (i) => Boolean(String(options[i] ?? '').trim())
    || Boolean(media[i]?.imageUrl) || Boolean(media[i]?.diagram)

  const target = type === 'tf' ? 2 : expected
  const present = options.length

  if (present !== target) {
    issues.push({
      code: CHOICE_ISSUES.WRONG_COUNT,
      severity: 'error',
      questionNumber: meta.number ?? null,
      message: `${label} has ${present} answer choice${present === 1 ? '' : 's'} but this paper is set to ${target} (A–${optionLabel(target - 1)}).`,
    })
  }

  for (let i = 0; i < Math.max(present, target); i += 1) {
    if (i < present && !has(i)) {
      issues.push({
        code: CHOICE_ISSUES.EMPTY_CHOICE,
        severity: 'error',
        questionNumber: meta.number ?? null,
        message: `${label} choice ${optionLabel(i)} is empty.`,
      })
    }
  }

  // Duplicates, then equivalence. Reported separately because they are different
  // authoring mistakes: a duplicate is a copy-paste, an equivalence is a
  // distractor the author did not realise was the answer again.
  const seen = new Map()
  for (let i = 0; i < present; i += 1) {
    const key = normalizeOptionText(options[i])
    if (!key) continue
    if (seen.has(key)) {
      issues.push({
        code: CHOICE_ISSUES.DUPLICATE_CHOICE,
        severity: 'error',
        questionNumber: meta.number ?? null,
        message: `${label} choices ${optionLabel(seen.get(key))} and ${optionLabel(i)} are identical.`,
      })
    } else {
      seen.set(key, i)
    }
  }
  for (let i = 0; i < present; i += 1) {
    for (let j = i + 1; j < present; j += 1) {
      if (normalizeOptionText(options[i]) === normalizeOptionText(options[j])) continue
      if (!areNumericallyEquivalent(options[i], options[j])) continue
      issues.push({
        code: CHOICE_ISSUES.EQUIVALENT_CHOICE,
        severity: 'error',
        questionNumber: meta.number ?? null,
        message: `${label} choices ${optionLabel(i)} and ${optionLabel(j)} are the same value written two ways `
          + `(“${String(options[i]).trim()}” and “${String(options[j]).trim()}”).`,
      })
    }
  }

  // The correct answer. Stored as an index; an array would mean several.
  const correct = question.correctAnswer
  if (Array.isArray(correct)) {
    if (correct.length === 0) {
      issues.push(noCorrect(label, meta))
    } else if (correct.length > 1) {
      issues.push({
        code: CHOICE_ISSUES.MULTIPLE_CORRECT,
        severity: 'error',
        questionNumber: meta.number ?? null,
        message: `${label} has ${correct.length} correct answers marked — a multiple-choice question must have exactly one.`,
      })
    }
  } else if (correct == null || correct === '') {
    issues.push(noCorrect(label, meta))
  } else {
    const index = Number(correct)
    if (!Number.isInteger(index) || index < 0 || index >= present) {
      issues.push({
        code: CHOICE_ISSUES.CORRECT_OUT_OF_RANGE,
        severity: 'error',
        questionNumber: meta.number ?? null,
        message: present > 0 && Number.isInteger(index)
          ? `${label} is marked correct at choice ${optionLabel(index) || index + 1}, which this paper no longer prints `
            + `(it shows A–${optionLabel(present - 1)}).`
          : `${label} has no valid correct answer selected.`,
      })
    }
  }

  return issues
}

function noCorrect(label, meta) {
  return {
    code: CHOICE_ISSUES.NO_CORRECT_ANSWER,
    severity: 'error',
    questionNumber: meta.number ?? null,
    message: `${label} has no correct answer selected.`,
  }
}
