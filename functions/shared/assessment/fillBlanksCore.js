/**
 * src/utils/fillBlanks.js
 *
 * Shared helpers for the dedicated "Fill in the Blanks" question type
 * (`type: 'fill_blanks'`). A fill-blanks question is a small set of
 * statements (A, B, C, …), each on its own line, each carrying one or more
 * blanks, plus an optional word bank the learner draws from.
 *
 *   {
 *     type: 'fill_blanks',
 *     text: 'Fill in the blanks using the words provided below.',  // instruction
 *     wordBank: ['soap', 'clean', 'germs', 'water'],               // [] = open mode
 *     wordBankReuse: false,                                        // words reusable?
 *     statements: [
 *       { text: 'We use ____ to wash our hands.', answers: ['soap'] },
 *       { text: 'Plants need ____ and ____ to grow.', answers: ['water', 'sunlight'] },
 *     ],
 *   }
 *
 * Two modes, distinguished purely by whether `wordBank` is non-empty:
 *   - Word Bank mode  — learners pick from the supplied words.
 *   - Open mode       — no word bank; learners supply their own answers.
 *
 * Blanks are authored as runs of underscores inside the statement text. Any
 * run of 2+ underscores counts as exactly one blank, so a teacher can type
 * `____` or `__________` and get the same result. `answers[i]` is the
 * expected answer for the i-th blank in that statement (in reading order).
 * An expected answer may list interchangeable variants separated by `/` or
 * `|` (e.g. `"sunlight/sun"`).
 *
 * Pure + dependency-free so it can be unit-tested with plain `node` and
 * shared across the editors, the printed-paper renderers, the DOCX export
 * and the learner quiz runner without dragging in React or Firebase.
 */

// Canonical blank marker an author inserts; detection is forgiving (see below).
export const BLANK_TOKEN = '____'

// Any run of two or more underscores is one blank.
const BLANK_RE = /_{2,}/g

/** Count the blanks in a statement's text. */
export function countBlanks(text) {
  if (typeof text !== 'string') return 0
  const matches = text.match(BLANK_RE)
  return matches ? matches.length : 0
}

/**
 * Split a statement into the literal text segments around its blanks.
 * `segments.length === countBlanks(text) + 1` — a blank sits between each
 * adjacent pair of segments.
 */
export function splitStatementSegments(text) {
  if (typeof text !== 'string' || text === '') return ['']
  return text.split(BLANK_RE)
}

/**
 * Replace every blank marker with a fixed-width underscore run, for the
 * printed / plain renderings where no interactive input is drawn (PDF, Word,
 * print preview). Default fill matches the long "__________" a Zambian test
 * paper uses.
 */
export function blanksToUnderscores(text, fill = '__________') {
  if (typeof text !== 'string') return ''
  return text.replace(BLANK_RE, fill)
}

/**
 * Statement label: 0 → 'A', 25 → 'Z', 26 → 'AA', … Mirrors a spreadsheet
 * column label so a long fill-blanks block never runs out of letters.
 */
export function statementLabel(index) {
  let i = Number(index)
  if (!Number.isInteger(i) || i < 0) return ''
  let out = ''
  do {
    out = String.fromCharCode(65 + (i % 26)) + out
    i = Math.floor(i / 26) - 1
  } while (i >= 0)
  return out
}

/** Normalise a single statement for storage: clamp text, align answers to blanks. */
export function normalizeFillStatement(raw) {
  const text = String(raw?.text ?? '').slice(0, 2000)
  const blanks = countBlanks(text)
  const rawAnswers = Array.isArray(raw?.answers) ? raw.answers : []
  const answers = []
  // Keep at least one answer slot so a not-yet-blanked draft round-trips
  // without losing what the teacher already typed.
  const slots = Math.max(blanks, 0)
  for (let i = 0; i < slots; i += 1) {
    answers.push(String(rawAnswers[i] ?? '').trim().slice(0, 200))
  }
  return { text, answers }
}

/** Normalise + clamp a statements array for storage. */
export function normalizeFillStatements(list) {
  if (!Array.isArray(list)) return []
  return list.map(normalizeFillStatement).slice(0, 40)
}

/** Normalise a word bank: trim, drop empties, clamp length + count. */
export function normalizeWordBank(list) {
  if (!Array.isArray(list)) return []
  return list.map((w) => String(w ?? '').trim().slice(0, 120)).filter(Boolean).slice(0, 40)
}

/** Total number of blanks across every statement in a fill-blanks question. */
export function totalFillBlanks(question) {
  const statements = Array.isArray(question?.statements) ? question.statements : []
  return statements.reduce((sum, s) => sum + countBlanks(s?.text ?? ''), 0)
}

/**
 * Flatten every expected answer across all statements in reading order. The
 * learner response array is aligned to this same order.
 */
export function fillBlanksAnswerKey(question) {
  const statements = Array.isArray(question?.statements) ? question.statements : []
  const key = []
  for (const s of statements) {
    const blanks = countBlanks(s?.text ?? '')
    const answers = Array.isArray(s?.answers) ? s.answers : []
    for (let i = 0; i < blanks; i += 1) key.push(String(answers[i] ?? ''))
  }
  return key
}

function normalizeForCompare(value) {
  return String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Does the learner's `given` answer satisfy the `expected` key? Comparison is
 * case-insensitive and whitespace-tolerant. The key may list interchangeable
 * variants with `/` or `|` ("sunlight/sun"). An empty key never auto-marks
 * correct (the teacher hasn't supplied an answer yet).
 */
export function fillBlankMatches(expected, given) {
  const variants = String(expected ?? '')
    .split(/\s*[/|]\s*/)
    .map(normalizeForCompare)
    .filter(Boolean)
  if (!variants.length) return false
  return variants.includes(normalizeForCompare(given))
}

/**
 * Per-blank layout for the interactive runner. Returns one entry per
 * statement with its text segments, blank count, label and the flat-index
 * offset its blanks occupy in the learner-response array.
 */
export function fillBlanksLayout(question) {
  const statements = Array.isArray(question?.statements) ? question.statements : []
  let flat = 0
  return statements.map((s, index) => {
    const text = String(s?.text ?? '')
    const segments = splitStatementSegments(text)
    const blanks = Math.max(0, segments.length - 1)
    const startFlatIndex = flat
    flat += blanks
    return {
      index,
      label: statementLabel(index),
      text,
      segments,
      blanks,
      startFlatIndex,
      answers: Array.isArray(s?.answers) ? s.answers : [],
    }
  })
}

/**
 * Grade a fill-blanks response deterministically (no AI needed — the answer
 * key is exact). `response` is a flat array of learner strings aligned to
 * `fillBlanksAnswerKey(question)`.
 *
 * Returns { totalBlanks, correctBlanks, perBlank: boolean[], allCorrect }.
 */
export function gradeFillBlanks(question, response) {
  const key = fillBlanksAnswerKey(question)
  const resp = Array.isArray(response) ? response : []
  const perBlank = key.map((expected, i) => fillBlankMatches(expected, resp[i]))
  const totalBlanks = key.length
  const correctBlanks = perBlank.filter(Boolean).length
  return {
    totalBlanks,
    correctBlanks,
    perBlank,
    allCorrect: totalBlanks > 0 && correctBlanks === totalBlanks,
  }
}

/** True when a fill-blanks question has at least one authored statement. */
export function hasFillBlanksContent(question) {
  const statements = Array.isArray(question?.statements) ? question.statements : []
  return statements.some((s) => String(s?.text ?? '').trim().length > 0)
}
