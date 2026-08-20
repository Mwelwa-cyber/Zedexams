/**
 * Pure logic for the `fraction_ladder` engine — the nine fraction levels, and
 * the one function that marks a written fraction.
 *
 * Ported from three prototypes, each of which exists because of a rule that
 * an ordinary multiple-choice quiz cannot express:
 *
 *   THE LADDER GATES ON PREREQUISITES, NEVER ON STARS
 *   (docs/learner/zedexams-fraction-levels.html). A level opens when the level
 *   BEFORE it is passed AND every level it names in `prereq` is passed. The
 *   sequence is what stops a learner skipping; the declared list is what lets
 *   a lock say WHY — level 7 cites multiplying, level 9 cites all four
 *   operations — instead of showing a padlock and nothing else. A child who
 *   scrapes a pass still moves on: `levelState` never looks at a score.
 *
 *   THE ANSWER IS WRITTEN, AND FORM IS PART OF THE ANSWER
 *   (docs/learner/zedexams-maths-notation.html). `markFractionAnswer` is the
 *   single comparison: 2/4 is CORRECT for 1/2 — with a simplification line —
 *   and wrong only where the question asks for lowest terms; improper and
 *   mixed are interchangeable unless one is asked for; a decimal is refused
 *   unless the question allows it. Marking a fraction by string equality is
 *   how a learner who wrote the right amount gets told they are wrong.
 *
 *   A WRONG ANSWER HAS A NAME
 *   (docs/learner/zedexams-maths-game.html). A question carries a `traps` map
 *   from the wrong answer to the misconception behind it, so "1/2 + 1/4 = 2/6"
 *   is answered with "you added the bottoms too" rather than a red cross.
 *
 * No React, no DOM.
 */

/* ── arithmetic ────────────────────────────────────────────────────── */

export function gcd(a, b) {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) { const t = x % y; x = y; y = t }
  return x || 1
}
export function simplify(n, d) { const g = gcd(n, d); return [n / g, d / g] }
export function improperOf(whole, n, d) { return [whole * d + n, d] }
export function isLowest(n, d) { return gcd(n, d) === 1 }

/* ── the words, which are the accessible name for every fraction ───── */

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']
const UNIT = {
  2: 'half', 3: 'third', 4: 'quarter', 5: 'fifth', 6: 'sixth', 7: 'seventh', 8: 'eighth', 9: 'ninth',
  10: 'tenth', 11: 'eleventh', 12: 'twelfth', 16: 'sixteenth', 20: 'twentieth', 25: 'twenty-fifth',
  50: 'fiftieth', 100: 'hundredth', 1000: 'thousandth',
}

export function numWord(n) {
  const value = Math.abs(Math.trunc(n))
  if (value < 20) return ONES[value]
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)]
    const rest = value % 10
    return rest ? `${tens}-${ONES[rest]}` : tens
  }
  if (value === 100) return 'one hundred'
  return String(value)
}
export function unitWord(d) { return UNIT[d] || `${numWord(d)}th` }
export function pluralUnit(d) { const u = unitWord(d); return u === 'half' ? 'halves' : `${u}s` }

/** "three quarters" — the string a screen reader gets instead of "3 4". */
export function fracWords(n, d) {
  if (d === 1) return numWord(n)
  return n === 1 ? `one ${unitWord(d)}` : `${numWord(n)} ${pluralUnit(d)}`
}
export function mixedWords(whole, n, d) {
  if (!whole) return fracWords(n, d)
  if (!n) return numWord(whole)
  return `${numWord(whole)} and ${fracWords(n, d)}`
}

/* ── marking ───────────────────────────────────────────────────────── */

/**
 * Mark one written answer.
 *
 * `entry` is what the learner typed: `{ mode: 'fraction', whole, num, den }`
 * or `{ mode: 'decimal', decimal }`.
 * `question` is `{ value: {n, d}, form?, allowDecimal?, tolerance?, traps? }`
 * where `form` is 'lowest' | 'mixed' | 'improper' when the question is ABOUT
 * the form, and absent when it is not.
 *
 * Returns `{ correct, reason, headline, why?, note?, spoken? }`. `note` is the
 * teaching line on a CORRECT answer — the place where "and it simplifies to
 * one half" is said, which is the whole reason 2/4 is accepted.
 */
export function markFractionAnswer(entry = {}, question = {}) {
  const want = question.value || { n: 0, d: 1 }
  const wantValue = want.n / want.d

  if (entry.mode !== 'decimal' && question.form === 'decimal') {
    // The mirror of the rule below. A question about the three forms has to be
    // able to ask for the decimal one, and "3/8" is the right amount written
    // as the thing the question asked you to convert away from.
    return {
      correct: false,
      reason: 'form-fraction',
      headline: 'This one wants a decimal',
      why: `That is the right amount, but written as a fraction. Divide the top by the bottom — ${fracWords(want.n, want.d)} as a decimal.`,
    }
  }

  if (entry.mode === 'decimal') {
    if (!question.allowDecimal && question.form !== 'decimal') {
      return {
        correct: false,
        reason: 'form-decimal',
        headline: 'This one wants a fraction',
        why: `A decimal is not accepted here. Write it as a fraction — ${fracWords(want.n, want.d)}.`,
      }
    }
    const value = Number.parseFloat(entry.decimal)
    if (!Number.isFinite(value)) return { correct: false, reason: 'blank', headline: 'Nothing entered', why: '' }
    if (Math.abs(value - wantValue) <= (question.tolerance || 0.005)) {
      return {
        correct: true,
        reason: 'ok-decimal',
        headline: 'Correct',
        note: `As a fraction that is ${fracWords(want.n, want.d)}.`,
        spoken: fracWords(want.n, want.d),
      }
    }
    return { correct: false, reason: 'value', headline: 'Not quite', why: trapFor(question, entry) }
  }

  const whole = Number.parseInt(entry.whole || '0', 10) || 0
  const n = Number.parseInt(entry.num, 10)
  const d = Number.parseInt(entry.den, 10)
  if (!Number.isFinite(n) || !Number.isFinite(d)) {
    return { correct: false, reason: 'blank', headline: 'Nothing entered', why: '' }
  }
  if (d === 0) {
    return {
      correct: false,
      reason: 'zero-denominator',
      headline: 'The bottom cannot be nothing',
      why: 'The bottom number says how many pieces the whole was cut into, so it is never 0.',
    }
  }

  const [gotN, gotD] = improperOf(whole, n, d)
  const equal = gotN * want.d === want.n * gotD

  if (!equal) {
    return {
      correct: false,
      reason: 'value',
      headline: 'Not quite',
      why: trapFor(question, entry) || 'Let us walk through it.',
    }
  }

  // The value is right. Now the FORM rules — and only where the question is
  // about form, because otherwise every equivalent way of writing it is right.
  const gaveMixed = whole > 0
  const simplest = isLowest(n, d)

  if (question.form === 'lowest' && !simplest) {
    const [lowN, lowD] = simplify(n, d)
    return {
      correct: false,
      reason: 'form-lowest',
      headline: 'Right amount, wrong form',
      why: `This question asks for lowest terms. That is the right amount, but it can still be made simpler — ${fracWords(lowN, lowD)}.`,
    }
  }
  if (question.form === 'mixed' && !gaveMixed && gotN > gotD) {
    return {
      correct: false,
      reason: 'form-mixed',
      headline: 'Right amount, wrong form',
      why: 'This question asks for a mixed number — a whole number with a fraction beside it.',
    }
  }
  if (question.form === 'improper' && gaveMixed) {
    return {
      correct: false,
      reason: 'form-improper',
      headline: 'Right amount, wrong form',
      why: 'This question asks for an improper fraction — everything over the bottom, no whole number in front.',
    }
  }

  let note = null
  if (!simplest) {
    const [lowN, lowD] = simplify(n, d)
    note = `Correct — and it simplifies to ${fracWords(lowN, lowD)}.`
  } else if (!gaveMixed && gotN > gotD && question.form !== 'improper') {
    note = `Correct — and as a mixed number that is ${mixedWords(Math.floor(gotN / gotD), gotN % gotD, gotD)}.`
  } else if (gaveMixed && question.form !== 'mixed') {
    note = `Correct — and as an improper fraction that is ${fracWords(gotN, gotD)}.`
  }
  return { correct: true, reason: 'ok', headline: "That's right", note, spoken: mixedWords(whole, n, d) }
}

/** The named misconception for what the learner actually wrote, if we know it. */
export function trapFor(question, entry = {}) {
  const traps = question?.traps
  if (!traps) return ''
  if (entry.mode === 'decimal') return traps[String(entry.decimal)] || ''
  const whole = Number.parseInt(entry.whole || '0', 10) || 0
  const key = `${whole ? `${whole} ` : ''}${entry.num}/${entry.den}`
  return traps[key] || ''
}

/* ── the ladder ────────────────────────────────────────────────────── */

/**
 * The nine levels. Data, not code: nothing in the engine is fraction-specific,
 * so decimals or ratio would be another list of the same shape.
 */
export const FRACTION_LEVELS = [
  { id: 'basics', order: 1, group: 'Understanding them', name: 'What a fraction is', blurb: 'Parts of a whole. What the top and bottom each mean.', prereq: [] },
  { id: 'equal', order: 2, group: 'Understanding them', name: 'Equal fractions & simplifying', blurb: 'The same amount written different ways.', prereq: ['basics'] },
  { id: 'compare', order: 3, group: 'Understanding them', name: 'Which one is bigger?', blurb: 'Comparing and putting them in order.', prereq: ['equal'] },
  { id: 'add', order: 4, group: 'Working with them', name: 'Adding fractions', blurb: 'Same bottoms first, then different bottoms.', prereq: ['equal'] },
  { id: 'sub', order: 5, group: 'Working with them', name: 'Taking fractions away', blurb: 'Including taking one from a whole.', prereq: ['add'] },
  { id: 'mult', order: 6, group: 'Working with them', name: 'Multiplying fractions', blurb: '“Of” means times. Needed before you can divide.', prereq: ['equal'] },
  { id: 'div', order: 7, group: 'Working with them', name: 'Dividing fractions', blurb: 'Turn the second one upside down and multiply.', prereq: ['mult'] },
  { id: 'fdp', order: 8, group: 'Using them', name: 'Fractions, decimals & percentages', blurb: 'The same amount, three ways. Heavy in exam papers.', prereq: ['equal'] },
  { id: 'real', order: 9, group: 'Using them', name: 'Fractions in real life', blurb: 'Kwacha, mealie meal, chitenge and time.', prereq: ['add', 'sub', 'mult', 'div', 'fdp'] },
]

const BY_ID = Object.fromEntries(FRACTION_LEVELS.map((level) => [level.id, level]))

export function levelById(id) { return BY_ID[id] || null }

/**
 * `{ state: 'done' | 'open' | 'locked', blockers: [id] }`.
 *
 * Blockers are earliest-first, so a lock names the NEXT thing to do rather
 * than the furthest. Stars are never consulted by either half of the rule.
 */
export function levelState(id, passed = []) {
  if (passed.includes(id)) return { state: 'done', blockers: [] }
  const level = BY_ID[id]
  if (!level) return { state: 'locked', blockers: [] }
  const previous = FRACTION_LEVELS.find((l) => l.order === level.order - 1)
  const blockers = []
  if (previous && !passed.includes(previous.id)) blockers.push(previous.id)
  for (const id_ of level.prereq) {
    if (!passed.includes(id_) && !blockers.includes(id_)) blockers.push(id_)
  }
  blockers.sort((a, b) => BY_ID[a].order - BY_ID[b].order)
  return { state: blockers.length ? 'locked' : 'open', blockers }
}

export function isOpen(id, passed = []) { return levelState(id, passed).state !== 'locked' }

/** "Level 2 — Equal fractions & simplifying", or a list of them. */
export function blockerText(ids = []) {
  const names = ids.map((id) => `Level ${BY_ID[id].order} — ${BY_ID[id].name}`)
  if (!names.length) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** A pack's questions for one level, in order. */
export function questionsForLevel(game, levelId) {
  const all = Array.isArray(game?.questions) ? game.questions : []
  return all.filter((q) => q.level === levelId)
}

/** Every level a pack actually has questions for. */
export function playableLevels(game) {
  return FRACTION_LEVELS.filter((level) => questionsForLevel(game, level.id).length > 0)
}

/* ── scoring, the same shape every other mechanic pays ──────────────── */

export const ANSWER_POINTS = 20

export function answerGain(combo = 1) {
  return ANSWER_POINTS * Math.max(1, Math.floor(Number(combo) || 1))
}

export function starsForScore(score) {
  const value = Number(score) || 0
  if (value >= 140) return 3
  if (value >= 60) return 2
  return 1
}

export function roundResult({ game, score, solved, misses, peakCombo, timeSpent }) {
  return {
    game,
    score: Number(score) || 0,
    correct: Number(solved) || 0,
    total: Number(solved || 0) + Number(misses || 0),
    peakCombo: Number(peakCombo) || 1,
    timeSpent: Number(timeSpent) || 0,
  }
}
