/**
 * src/utils/questionParts.js
 *
 * Shared helpers for SHORT-ANSWER SUB-PARTS — the "(a) … (b) … (c) …" structure
 * a Zambian test paper uses when one numbered question carries an instruction
 * stem and several lettered follow-ups:
 *
 *   17. Fill in the blanks to complete the sentences below.            (3 marks)
 *       (a) Foods such as meat, eggs and fish belong to the group called …… [1]
 *       (b) Fats and oils give our bodies …… [1]
 *       (c) Eating too little food leads to a condition called …… [1]
 *
 * Stored on the question as `subParts` (NOT `parts` — that word is already taken
 * by the paper-level Part groupings in quizSections.js):
 *
 *   question.subParts = [
 *     { text, answer, marks, answerFormat, answerLines },
 *     …
 *   ]
 *
 *   - text          the sub-question / sentence. A blank may be authored inline
 *                   as a run of underscores ("____"), dots ("....") or an
 *                   ellipsis ("…"); the renderers turn it into a ruled gap.
 *   - answer        the expected answer for the marking key.
 *   - marks         per-sub-part marks. The question's total auto-sums these.
 *   - answerFormat  'inline' (default — a dotted blank inside the sentence,
 *                   Q17 style), 'lines' (N ruled lines under the part) or
 *                   'none' (no space — e.g. the part is answered on a diagram).
 *   - answerLines   ruled-line count for the 'lines' format (default 2).
 *
 * The (a)(b)(c) LABEL is always derived from the part's position via
 * subPartLabel(), so adding / removing / reordering parts re-letters them
 * automatically — the teacher never types a label.
 *
 * Pure + dependency-free so it can be unit-tested with plain `node` and shared
 * across the editor, the printed-paper renderers and the DOCX export without
 * dragging in React or Firebase.
 */

// Allowed per-sub-part answer-space formats.
export const SUBPART_FORMATS = new Set(['inline', 'lines', 'none'])

// A blank inside a sub-part's text: a run of 2+ underscores, 2+ dots, or one or
// more ellipsis characters. Forgiving so a teacher can type "__", "...." or "…"
// and get the same single ruled gap.
const PART_BLANK_RE = /_{2,}|\.{2,}|…+/g

/**
 * Sub-part label by position: 0 → 'a', 1 → 'b', … 25 → 'z', 26 → 'aa'. Mirrors a
 * spreadsheet column label (lower-case) so a long question never runs out of
 * letters. Returns '' for a non-integer / negative index.
 */
export function subPartLabel(index) {
  let i = Number(index)
  if (!Number.isInteger(i) || i < 0) return ''
  let out = ''
  do {
    out = String.fromCharCode(97 + (i % 26)) + out
    i = Math.floor(i / 26) - 1
  } while (i >= 0)
  return out
}

/** Count the inline blanks authored in a sub-part's text. */
export function countPartBlanks(text) {
  if (typeof text !== 'string') return 0
  const matches = text.match(PART_BLANK_RE)
  return matches ? matches.length : 0
}

/**
 * Split a sub-part's text into the literal segments around its blanks.
 * `segments.length === countPartBlanks(text) + 1`. A blank sits between each
 * adjacent pair of segments. Always returns at least `['']`.
 */
export function splitPartBlanks(text) {
  if (typeof text !== 'string' || text === '') return ['']
  return text.split(PART_BLANK_RE)
}

/** Normalise + clamp a single sub-part for storage / rendering. */
export function normalizeSubPart(raw = {}) {
  const r = raw && typeof raw === 'object' ? raw : {}
  const answerFormat = SUBPART_FORMATS.has(r.answerFormat) ? r.answerFormat : 'inline'
  const rawLines = Number(r.answerLines)
  const answerLines = Number.isFinite(rawLines) && rawLines >= 0
    ? Math.min(20, Math.round(rawLines))
    : null
  const rawMarks = Number(r.marks)
  const marks = Number.isFinite(rawMarks) && rawMarks >= 0
    ? Math.min(99, Math.round(rawMarks))
    : 1
  return {
    // `prompt` is accepted as an alias for `text` because the AI generator and
    // the lesson-activity convention both emit { label, prompt, marks, answer }.
    text: String(r.text ?? r.prompt ?? '').slice(0, 2000),
    answer: String(r.answer ?? r.correctAnswer ?? '').slice(0, 1000),
    marks,
    answerFormat,
    answerLines,
  }
}

/** Normalise + clamp a whole subParts array for storage / rendering. */
export function normalizeSubParts(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter(p => p && typeof p === 'object')
    .map(normalizeSubPart)
    .slice(0, 12)
}

/** Sum the marks across a question's sub-parts (the auto question total). */
export function sumSubPartMarks(list) {
  return normalizeSubParts(list).reduce((sum, p) => sum + (Number(p.marks) || 0), 0)
}

/** True when a question carries at least one usable sub-part. */
export function hasSubParts(question) {
  const list = question?.subParts
  return Array.isArray(list) && list.some(p => p && typeof p === 'object')
}

/** A blank sub-part for the editor's "+ Add part" action. */
export function emptySubPart(overrides = {}) {
  return normalizeSubPart({ text: '', answer: '', marks: 1, answerFormat: 'inline', ...overrides })
}
