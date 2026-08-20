/**
 * The fraction question: its types, its marking, and the name of the mistake
 * behind a wrong answer.
 *
 * A fraction quiz that is only ever multiple choice teaches a learner to
 * recognise an answer, and hides the very thing worth knowing — WHICH wrong
 * answer they gave. So there are six ways to respond here, and each one is a
 * different act:
 *
 *   `choice`   name it, or say what the bottom number means
 *   `shade`    tap regions until the shape shows the fraction
 *   `select`   tap a fraction of a GROUP of things
 *   `write`    type it into a stacked pad, form and all
 *   `compare`  bigger, smaller or the same
 *   `order`    put three of them in order
 *
 * Two rules run across all six:
 *
 *   A WRONG ANSWER HAS A NAME, AND THE NAME IS STORED, NOT GUESSED.
 *   `diagnose` looks the learner's actual response up in the question's own
 *   `misconceptions` list. A model asked to explain a mistake at run time will
 *   produce a fluent explanation of a mistake the child did not make; a
 *   reviewed list of the mistakes a Zambian teacher actually sees will not.
 *   A response nobody predicted still gets a human sentence — never "Incorrect".
 *
 *   THE AMOUNT IS THE ANSWER, EXCEPT WHERE THE FORM IS THE QUESTION.
 *   `markWritten` (and `markFractionAnswer`, which it wraps) accepts 2/4 for
 *   1/2 and says how it simplifies; it refuses only where the question asked
 *   for lowest terms, a mixed number, an improper fraction or a decimal.
 *
 * No React, no DOM.
 */
import { markFractionAnswer, trapFor } from './fractionLadderCore.js'
import { fracWords, sameValue, simplify } from '../../../shared/utils/fractionMath.js'
import { shadedCount, validateVisual } from './fractionVisualCore.js'

export const QUESTION_TYPES = ['choice', 'shade', 'select', 'write', 'compare', 'order']

/** The comparison symbols a paper uses. Never `>`/`<` spelled as words. */
export const COMPARE_SYMBOLS = ['>', '<', '=']

/* ── misconceptions ────────────────────────────────────────────────── */

/**
 * The misconceptions a fraction question can carry, as codes. A pack names one
 * per wrong answer, so the same mistake made in level 1 and level 6 is the
 * same code — which is what lets the review queue say "you keep adding the
 * bottoms" rather than listing eight unrelated questions.
 */
export const MISCONCEPTION_CODES = {
  counted_taken_as_bottom: 'Used the number taken as the bottom number',
  counted_remaining: 'Named the part left over instead of the part asked for',
  ignored_equal_parts: 'Treated any two pieces as halves',
  wrong_piece_count: 'Named a fraction with a different number of pieces',
  added_denominators: 'Added the bottom numbers as well as the tops',
  kept_unlike_denominators: 'Added tops without making the bottoms the same',
  compared_by_numerator: 'Judged size by the top number alone',
  compared_by_denominator: 'Judged size by the bottom number alone',
  inverted: 'Wrote the top and bottom the other way round',
  not_simplified: 'Right amount, not yet in lowest terms',
  partial_simplify: 'Simplified, but not all the way',
  divided_by_numerator: 'Divided by the top and multiplied by the bottom',
  found_unit_fraction_only: 'Found one part but not all the parts asked for',
  forgot_to_divide: 'Multiplied by the top without dividing by the bottom',
  multiplied_instead_of_divided: 'Multiplied when the second fraction should be flipped',
  added_instead_of_multiplied: 'Added when "of" means times',
  whole_not_converted: 'Did not write the whole as a fraction first',
  mixed_improper_slip: 'Converted between mixed and improper incorrectly',
  read_percent_as_amount: 'Used the percentage figure as an amount',
  answered_the_wrong_part: 'Answered a different part of the question',
}

/**
 * The misconception behind a response, or null.
 *
 * Two shapes are read. `misconceptions: [{ code, answer, explanation, step }]`
 * is the reviewed form. `traps: { '2/6': '…' }` is the shape the pack already
 * had before this existed and is still honoured — a bare sentence with no code
 * is worth more to a learner than a red cross, and rewriting every pack before
 * shipping the feature would have meant shipping neither.
 */
export function diagnose(question = {}, responseKey) {
  const key = String(responseKey ?? '')
  const list = Array.isArray(question.misconceptions) ? question.misconceptions : []
  const hit = list.find((m) => String(m.answer) === key)
  if (hit) {
    return {
      code: hit.code || null,
      label: hit.code ? MISCONCEPTION_CODES[hit.code] || null : null,
      explanation: hit.explanation || '',
      step: hit.step || null,
    }
  }
  const legacy = question.traps?.[key]
  if (legacy) return { code: null, label: null, explanation: legacy, step: null }
  return null
}

/** Every misconception code a question can produce — for the review queue. */
export function codesFor(question = {}) {
  return (Array.isArray(question.misconceptions) ? question.misconceptions : [])
    .map((m) => m.code)
    .filter(Boolean)
}

/* ── the response key ──────────────────────────────────────────────── */

/**
 * The single string a response is looked up by, so one `misconceptions` list
 * serves every question type. A choice is its option id; a shade or a group
 * selection is the COUNT the learner ended on ("3"), because "you shaded three
 * of the four" is the mistake; a written fraction is "3/4" or "2 3/4".
 */
export function responseKey(type, response) {
  if (response === null || response === undefined) return ''
  switch (type) {
    case 'choice':
    case 'compare':
      return String(response)
    case 'shade':
    case 'select':
      return String(Array.isArray(response) ? response.length : response)
    case 'order':
      return (Array.isArray(response) ? response : []).join('>')
    case 'write': {
      if (response.mode === 'decimal') return String(response.decimal ?? '')
      if (response.mode === 'whole') return String(response.whole ?? '')
      const whole = Number.parseInt(response.whole || '0', 10) || 0
      return `${whole ? `${whole} ` : ''}${response.num ?? ''}/${response.den ?? ''}`
    }
    default:
      return String(response)
  }
}

/* ── marking, one type at a time ───────────────────────────────────── */

function verdict(correct, headline, body, extra = {}) {
  return { correct, headline, body, ...extra }
}

/** The sentence a wrong answer gets when the pack predicted this exact one. */
function taughtWrong(question, key, fallback) {
  const found = diagnose(question, key)
  if (found?.explanation) {
    return verdict(false, question.wrongHeadline || 'Have another look', found.explanation, {
      misconception: found.code || null,
      correctiveStep: found.step || null,
    })
  }
  return verdict(false, question.wrongHeadline || 'Have another look', fallback, { misconception: null })
}

function markChoice(question, response) {
  const key = String(response ?? '')
  if (!key) return verdict(false, 'Nothing chosen', '', { blank: true })
  if (key === String(question.answer)) {
    return verdict(true, question.rightHeadline || "That's right", question.explanation || '')
  }
  return taughtWrong(question, key, question.fallbackWrong
    || 'Not this one. Look at the picture again and count the pieces.')
}

function markCompare(question, response) {
  const key = String(response ?? '')
  if (!key) return verdict(false, 'Nothing chosen', '', { blank: true })
  if (!COMPARE_SYMBOLS.includes(key)) return verdict(false, 'Nothing chosen', '', { blank: true })
  if (key === String(question.answer)) {
    return verdict(true, question.rightHeadline || "That's right", question.explanation || '')
  }
  return taughtWrong(question, key, question.fallbackWrong
    || 'Give them the same bottom number first, then the tops can be compared.')
}

/**
 * Shading. Marked on HOW MANY regions are shaded, not which — for an equal
 * partition every region is the same piece, so insisting on the leftmost three
 * would fail a learner who shaded the right amount from the other end.
 */
function markShade(question, response) {
  const parts = Number(question.visual?.parts) || 0
  const want = Number(question.want ?? question.visual?.numerator ?? 0)
  const count = shadedCount(response, parts)
  if (!count) return verdict(false, 'Nothing shaded', '', { blank: true })
  if (count === want) {
    return verdict(true, question.rightHeadline || "That's right", question.explanation || '')
  }
  return taughtWrong(question, String(count), question.fallbackWrong
    || `You shaded ${count} of the ${parts}. Count the pieces the fraction asks for.`)
}

/** A fraction of a GROUP — six oranges, tap half of them. */
function markSelect(question, response) {
  const total = Number(question.visual?.parts) || 0
  const want = Number(question.want ?? question.visual?.numerator ?? 0)
  const count = shadedCount(response, total)
  if (!count) return verdict(false, 'Nothing chosen', '', { blank: true })
  if (count === want) {
    return verdict(true, question.rightHeadline || "That's right", question.explanation || '')
  }
  return taughtWrong(question, String(count), question.fallbackWrong
    || `You picked ${count} of the ${total}. Work out how many go in each equal share first.`)
}

/** Ordering. The learner's list must be the pack's list, in that order. */
function markOrder(question, response) {
  const given = Array.isArray(response) ? response.map(String) : []
  const want = (Array.isArray(question.answer) ? question.answer : []).map(String)
  if (given.length < want.length) return verdict(false, 'Not finished yet', '', { blank: true })
  if (given.join('>') === want.join('>')) {
    return verdict(true, question.rightHeadline || "That's right", question.explanation || '')
  }
  return taughtWrong(question, given.join('>'), question.fallbackWrong
    || 'Give them all the same bottom number, then the order is just the tops.')
}

/**
 * A written fraction. `markFractionAnswer` is the marker — it already holds
 * every equivalence and form rule — and this only reshapes its result into the
 * one verdict shape the rest of the engine reads, and reaches the structured
 * misconception list that `markFractionAnswer`'s own `traps` lookup cannot see.
 */
function markWritten(question, response) {
  const marked = markFractionAnswer(response || {}, question)
  if (marked.correct) {
    return verdict(true, marked.headline, marked.note || question.explanation || '', {
      spoken: marked.spoken,
      reason: marked.reason,
    })
  }
  if (marked.reason === 'blank') {
    return verdict(false, marked.headline, marked.why || '', { blank: true, reason: marked.reason })
  }
  // A form failure is already a named, specific sentence — it says which form
  // the question wants and what the learner wrote. A VALUE failure is the one
  // worth diagnosing, so only that reaches the misconception list.
  if (marked.reason !== 'value') {
    return verdict(false, marked.headline, marked.why || '', { reason: marked.reason, misconception: null })
  }
  const key = responseKey('write', response)
  const found = diagnose(question, key)
  return verdict(false, marked.headline, found?.explanation || marked.why || trapFor(question, response) || 'Let us walk through it.', {
    misconception: found?.code || null,
    correctiveStep: found?.step || null,
    reason: marked.reason,
  })
}

/**
 * Mark one response to one question.
 *
 * Returns `{ correct, headline, body, misconception?, correctiveStep?, blank? }`.
 * `blank` means nothing was entered — the caller must NOT count it as a miss,
 * because a learner who tapped Check with an empty pad has not made a mistake.
 */
export function markResponse(question = {}, response) {
  switch (question.type) {
    case 'choice': return markChoice(question, response)
    case 'compare': return markCompare(question, response)
    case 'shade': return markShade(question, response)
    case 'select': return markSelect(question, response)
    case 'order': return markOrder(question, response)
    case 'write':
    default: return markWritten(question, response)
  }
}

/* ── the working ───────────────────────────────────────────────────── */

/**
 * The steps of the worked solution, revealed one at a time.
 *
 * A pack that gives none gets NONE — there is deliberately no generated
 * fallback. A worked solution invented from the answer is a plausible set of
 * steps that may not be the steps this question is teaching, offered to a
 * child who has just been told they were wrong. The offer is simply not made.
 */
export function workingSteps(question = {}) {
  const steps = Array.isArray(question.workingSteps) ? question.workingSteps : []
  return steps
    .filter((s) => s && (s.title || s.math))
    .map((s, index) => ({ index, title: s.title || `Step ${index + 1}`, math: s.math || '', note: s.note || null }))
}

export function hasWorking(question) {
  return workingSteps(question).length > 0
}

/* ── validation ────────────────────────────────────────────────────── */

const LEVEL1_BANNED = /\b(numerator|denominator)\b/i
// A fraction written as a symbol — the stacked component's markup, or slash
// notation between two digits. Level 1 introduces the symbol only in the
// feedback after a correct answer, so a stem carrying one has skipped a step.
const SYMBOL_IN_TEXT = /(\bzx-frac\b)|(\b\d+\s*\/\s*\d+\b)/

/**
 * The `answer` string a pack writes beside `value`, as a fraction — "3/4",
 * "2 3/4", "180". Null when it is not a number at all (a choice question's
 * option id), which is the case the caller skips.
 */
export function parseWrittenAnswer(text) {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  const mixed = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(trimmed)
  if (mixed) {
    const [, whole, n, d] = mixed.map(Number)
    return d ? { n: whole * d + n, d } : null
  }
  const plain = /^(\d+)\s*\/\s*(\d+)$/.exec(trimmed)
  if (plain) {
    const [, n, d] = plain.map(Number)
    return d ? { n, d } : null
  }
  const whole = /^(\d+)$/.exec(trimmed)
  if (whole) return { n: Number(whole[1]), d: 1 }
  return null
}

/** The words a learner reads in a question — stem, caption and every option. */
export function learnerFacingText(question = {}) {
  const out = []
  if (question.prompt) out.push({ what: 'prompt', text: question.prompt })
  if (question.caption) out.push({ what: 'caption', text: question.caption })
  if (question.kicker) out.push({ what: 'kicker', text: question.kicker })
  for (const option of question.options || []) {
    if (option?.label) out.push({ what: 'option', text: option.label })
  }
  return out
}

/**
 * The stage that INTRODUCES the written fraction, where the picture-first rule
 * binds: level 1, stage 1.
 *
 * The rule from docs/learner/zedexams-fractions-level1.html is that the symbol
 * appears only in the feedback after a correct answer — a child meets the
 * drawing, then the words, then the written form, and meeting the written form
 * first is what leaves them with nothing underneath it. It binds to the
 * introduction and not to all of level 1, because level 1 goes on to teach what
 * the top and the bottom each MEAN (§8), and that question cannot be asked
 * without a fraction on the screen to point at. Two stages later the learner
 * has met the symbol; the ban has done its work.
 */
export function introducesSymbol(question = {}) {
  return question.level === 'basics' && (Number(question.stage) || 1) === 1
}

/**
 * Is this question well formed?
 *
 * `{ ok, errors: [{ code, message }] }`. Everything checked here is something
 * that renders perfectly while teaching the wrong thing — a picture that
 * disagrees with its fraction, an answer that is not among the options, a
 * level-1 stem that shows the symbol before the child has met it.
 */
export function validateQuestion(question = {}) {
  const errors = []
  const add = (code, message) => errors.push({ code, message })

  if (!question.id) add('id', 'Every question needs an id — the review queue and the resume snapshot both key on it.')
  if (!question.type || !QUESTION_TYPES.includes(question.type)) {
    add('type', `Unknown question type "${question.type}". Use one of: ${QUESTION_TYPES.join(', ')}.`)
  }
  if (!question.prompt) add('prompt', 'A question with no prompt asks nothing.')
  if (!question.skill) add('skill', 'Every question names a skill — mastery and the review queue are per skill, not per question.')

  if (question.visual) {
    const check = validateVisual(question.visual)
    for (const error of check.errors) add(`visual:${error.code}`, error.message)
  }

  switch (question.type) {
    case 'choice':
    case 'compare': {
      const options = question.type === 'compare'
        ? COMPARE_SYMBOLS.map((id) => ({ id }))
        : (question.options || [])
      if (options.length < 2) add('options', 'A choice needs at least two options.')
      if (!options.some((o) => String(o.id) === String(question.answer))) {
        add('answer', `The answer "${question.answer}" is not one of the options.`)
      }
      const ids = options.map((o) => String(o.id))
      if (new Set(ids).size !== ids.length) add('option-ids', 'Two options share an id, so one of them can never be chosen.')
      break
    }
    case 'shade':
    case 'select': {
      const parts = Number(question.visual?.parts)
      const want = Number(question.want ?? question.visual?.numerator)
      if (!question.visual) add('visual', 'A shade or group question needs a picture to act on.')
      if (!Number.isInteger(want) || want < 0) add('want', 'A shade or group question must say how many regions are wanted.')
      else if (Number.isInteger(parts) && want > parts) {
        add('want-over', `${want} cannot be shaded out of ${parts}.`)
      }
      break
    }
    case 'order': {
      const ids = (question.options || []).map((o) => String(o.id))
      const answer = (Array.isArray(question.answer) ? question.answer : []).map(String)
      if (ids.length < 2) add('options', 'An ordering question needs at least two fractions.')
      if (answer.length !== ids.length) add('answer', 'The answer must order every option exactly once.')
      else if (answer.some((id) => !ids.includes(id))) add('answer', 'The answer names an option that does not exist.')
      break
    }
    case 'write':
    default: {
      const value = question.value
      if (!value || !Number.isFinite(Number(value.n)) || !Number.isFinite(Number(value.d))) {
        add('value', 'A written question needs a value — the fraction it is marked against.')
      } else if (Number(value.d) === 0) {
        add('value', 'The bottom number of the answer cannot be 0.')
      } else if (question.form === 'lowest') {
        const [n, d] = simplify(Number(value.n), Number(value.d))
        if (n !== Number(value.n) || d !== Number(value.d)) {
          add('value-form', `This question asks for lowest terms, so its own answer must be in lowest terms — ${n}/${d}, not ${value.n}/${value.d}.`)
        }
      } else if (question.form === 'whole') {
        if (Number(value.d) !== 1) {
          add('value-form', `A whole-number question is marked against a whole number, so its value must be over 1 — not ${value.n}/${value.d}.`)
        }
      } else if (question.form === 'denominator') {
        const required = Number(question.requireDenominator)
        if (!Number.isInteger(required) || required < 1) {
          add('require-denominator', 'A "give it in these pieces" question must say which bottom number it wants (requireDenominator).')
        } else if (required !== Number(value.d)) {
          add('value-form', `The question asks for a bottom of ${required}, so its own value must have one — not ${value.n}/${value.d}.`)
        }
      }
      // `answer` is the human-readable twin of `value`, used by the admin list
      // and search. It drifting from `value` is how a reviewer approves one
      // fraction and a learner is marked against another.
      const written = parseWrittenAnswer(question.answer)
      if (written && value && !sameValue(written, { n: Number(value.n), d: Number(value.d) })) {
        add('answer-value', `The written answer "${question.answer}" is not the same amount as value ${value.n}/${value.d}.`)
      }
      break
    }
  }

  // Every misconception must be reachable — an explanation keyed to an answer
  // no learner can give is an explanation nobody will ever read.
  for (const m of question.misconceptions || []) {
    if (!m.explanation) add('misconception', `The misconception for "${m.answer}" has no explanation.`)
    if (m.code && !MISCONCEPTION_CODES[m.code]) add('misconception-code', `Unknown misconception code "${m.code}".`)
    if (String(m.answer) === String(question.answer)) {
      add('misconception-answer', `"${m.answer}" is the right answer, so it cannot also be a misconception.`)
    }
  }

  if (introducesSymbol(question)) {
    if (question.fraction || question.options?.some((o) => o.fraction)) {
      add('level1-symbol', 'The stage that introduces the fraction shows the written form only in the feedback after a correct answer — not on a question or an option.')
    }
    for (const piece of learnerFacingText(question)) {
      if (SYMBOL_IN_TEXT.test(piece.text)) {
        add('level1-symbol', `The stage that introduces the fraction shows the written form only after a correct answer, but the ${piece.what} contains one: "${piece.text}".`)
      }
    }
  }
  if (question.level === 'basics') {
    for (const piece of learnerFacingText(question)) {
      if (LEVEL1_BANNED.test(piece.text)) {
        add('level1-vocabulary', `Level 1 says "the top" and "the bottom"; the formal words arrive in level 2. The ${piece.what} uses one: "${piece.text}".`)
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Validate a whole fraction pack before it is published.
 *
 * The import path calls this, so a malformed pack FAILS with a reason rather
 * than landing in Firestore and reaching learners. The failure modes it is
 * for are the quiet ones: a picture that disagrees with its fraction, a
 * lowest-terms question whose own answer is not in lowest terms, two questions
 * sharing an id so the review queue confuses them, a level id nothing knows.
 *
 * `{ ok, errors: [{ id, code, message }], counts }` — every error, not the
 * first, because a bad pack usually has several and fixing them one import at
 * a time is how a content edit takes five rounds.
 */
export function validateFractionPack(game = {}, { knownLevels = null } = {}) {
  const errors = []
  const questions = Array.isArray(game.questions) ? game.questions : []

  if (!questions.length) {
    errors.push({ id: null, code: 'empty', message: 'A fraction pack with no questions has no levels to play.' })
  }

  const seen = new Set()
  for (const question of questions) {
    const id = question?.id || '(no id)'
    if (question?.id) {
      if (seen.has(question.id)) {
        errors.push({ id, code: 'duplicate-id', message: `Two questions share the id "${question.id}".` })
      }
      seen.add(question.id)
    }
    if (knownLevels && question?.level && !knownLevels.includes(question.level)) {
      errors.push({ id, code: 'level', message: `"${question.level}" is not a level on the ladder.` })
    }
    for (const error of validateQuestion(question || {}).errors) {
      errors.push({ id, code: error.code, message: error.message })
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    counts: { questions: questions.length, errors: errors.length },
  }
}

/** One line an admin can act on, from a failed pack validation. */
export function describePackErrors(result, limit = 3) {
  const errors = result?.errors || []
  if (!errors.length) return ''
  const shown = errors.slice(0, limit).map((e) => `${e.id}: ${e.message}`)
  const rest = errors.length - shown.length
  return `${shown.join(' ')}${rest > 0 ? ` (+${rest} more)` : ''}`
}

/** The fraction a question is about, for a "what you learned" line. */
export function questionFraction(question = {}) {
  if (question.value) return { n: Number(question.value.n), d: Number(question.value.d) }
  if (question.visual?.numerator !== undefined && question.visual?.parts) {
    return { n: Number(question.visual.numerator), d: Number(question.visual.parts) }
  }
  return null
}

/** "three quarters" for a question, or null. Used by the stage summary. */
export function questionWords(question) {
  const value = questionFraction(question)
  return value && value.d ? fracWords(value.n, value.d) : null
}
