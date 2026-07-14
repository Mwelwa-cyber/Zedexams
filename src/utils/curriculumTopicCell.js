/**
 * Canonical repair for CONCATENATED curriculum TOPIC cells.
 * =========================================================
 *
 * The Zambian syllabi were digitised from PDF tables. At some page breaks the
 * extractor glued a topic heading and the FIRST sub-topic beneath it into ONE
 * `TOPIC` cell and left the `SUB-TOPIC` cell empty, e.g.
 *
 *   TOPIC     = "1.2.1 COMPREHENSION 1.2.1.1. Listening Comprehension"
 *   SUB-TOPIC = ""            (missing)
 *
 * Read verbatim this surfaces one bogus topic option
 * ("1.2.1 COMPREHENSION 1.2.1.1 Listening Comprehension") in every studio
 * picker and hides the real sub-topic. The correct hierarchy is
 *
 *   Topic     1.2.1 Comprehension
 *     Subtopic 1.2.1.1 Listening Comprehension
 *     Subtopic 1.2.1.2 Reading Comprehension
 *
 * This module is the ONE place that splits such a cell. It is pure (no Firebase,
 * no DOM) so the source-repair migration, the shared `rowsWithPropagatedTopic`
 * normaliser (which feeds EVERY studio picker + the coverage counter), the
 * Syllabi Studio table and the unit tests all share exactly one classifier.
 *
 * It NEVER guesses: a cell is split only when it holds exactly two curriculum
 * codes AND the second is a genuine child of the first (parent-code prefix
 * match). Anything else — a single code, three+ codes, or two SIBLING codes
 * (e.g. "1.1 Geography 1.2 The Solar System") — is left untouched and flagged
 * `ambiguous` for the manual-review report, per the "don't guess" rule.
 *
 * The server keeps a lock-step copy in
 * functions/teacherTools/syllabiCurriculumData.js — keep the two in sync.
 */

import { cleanStatement, repairCodePunctuation } from './curriculum2013Parser.js'

// A dotted curriculum code: two or more numeric segments, optional trailing dot.
const CODE_TOKEN = /\d+(?:\.\d+)+\.?/g

/**
 * Repair OCR letter-for-digit slips INSIDE a dotted code only — a single `I`/`l`
 * → `1` or `O` → `0` that sits between a digit-dot and a dot/space/end (e.g.
 * "2.3.I" → "2.3.1"). The digit-dot prefix guarantees we never touch prose.
 */
export function repairOcrCodeDigits(text) {
  return String(text == null ? '' : text)
    .replace(/(\d\.)[Il](?=[.\s]|$)/g, '$11')
    .replace(/(\d\.)O(?=[.\s]|$)/g, '$10')
}

/**
 * Title-case a title that is FULLY uppercase (a caps-lock extraction artefact:
 * "COMPREHENSION" / "LETTER WRITING"). A title with any lowercase is left
 * exactly as digitised — we never restyle real mixed-case wording.
 */
export function titleCaseIfAllCaps(title) {
  const s = String(title == null ? '' : title)
  const letters = s.replace(/[^A-Za-z]/g, '')
  if (!letters || letters !== letters.toUpperCase()) return s
  return s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

/** Split a "<code> <title>" fragment into `{ code, title }` (code may be null). */
function parseCodedFragment(fragment) {
  const cleaned = cleanStatement(fragment)
  const m = cleaned.match(/^(\d+(?:\.\d+)+)\.?\s*(.*)$/)
  if (!m) return { code: null, title: cleaned }
  return { code: m[1], title: cleanStatement(m[2]) }
}

/**
 * Find the dotted codes that start at a word boundary inside a topic cell.
 * @returns {Array<{ idx: number, code: string }>}
 */
function findCodes(text) {
  const codes = []
  CODE_TOKEN.lastIndex = 0
  let m
  while ((m = CODE_TOKEN.exec(text)) !== null) {
    const idx = m.index
    const prev = idx > 0 ? text[idx - 1] : ''
    // Skip a match that starts mid-number (defensive; the regex anchors on \d
    // so this only trips on pathological input).
    if (prev && /[\d.]/.test(prev)) continue
    codes.push({ idx, code: m[0].replace(/\.$/, '') })
  }
  return codes
}

/**
 * @typedef {Object} TopicCellSplit
 * @property {string}  topic     the (repaired) topic value
 * @property {string}  subtopic  the sub-topic value — filled from the topic cell
 *                               ONLY when the passed sub-topic cell was empty
 * @property {boolean} split     true when a concatenation was separated
 * @property {boolean} ambiguous true when concatenation is suspected but could
 *                               not be split safely (→ manual review)
 */

/**
 * Separate a concatenated TOPIC cell.
 *
 * @param {string} topicCell     raw TOPIC cell value
 * @param {string} [subtopicCell] raw SUB-TOPIC cell value (kept if non-empty)
 * @returns {TopicCellSplit}
 */
export function splitConcatenatedTopicCell(topicCell, subtopicCell = '') {
  const rawTopic = String(topicCell == null ? '' : topicCell).trim()
  const rawSub = String(subtopicCell == null ? '' : subtopicCell).trim()
  const result = { topic: rawTopic, subtopic: rawSub, split: false, ambiguous: false }
  if (!rawTopic) return result

  const norm = repairOcrCodeDigits(repairCodePunctuation(rawTopic))
  const codes = findCodes(norm)

  if (codes.length < 2) return result // a normal single-code (or code-less) topic
  if (codes.length > 2) {
    // Three or more codes glued together (e.g. two topics AND two sub-topics in
    // one cell) — too tangled to separate without guessing.
    result.ambiguous = true
    return result
  }

  const [c1, c2] = codes
  // Parent-child validation: the second code must be a descendant of the first.
  // Sibling codes ("1.1" + "1.2") are a different malformation — never split.
  if (!c2.code.startsWith(c1.code + '.')) {
    result.ambiguous = true
    return result
  }

  const topicPart = parseCodedFragment(norm.slice(c1.idx, c2.idx))
  const subPart = parseCodedFragment(norm.slice(c2.idx))
  if (!topicPart.code || !topicPart.title || !subPart.code || !subPart.title) {
    result.ambiguous = true
    return result
  }

  // Data-loss guard: we may only truncate the embedded child off the parent
  // cell when it won't be lost — i.e. the child cell is empty (we move it
  // there) OR already carries the SAME code (the embedded copy is redundant).
  // A child cell holding a DIFFERENT code means truncating would silently drop
  // a distinct record — that's a guess we refuse to make.
  const childCode = leadingCode(rawSub)
  if (rawSub && childCode !== subPart.code) {
    result.ambiguous = true
    return result
  }

  result.topic = `${topicPart.code} ${titleCaseIfAllCaps(topicPart.title)}`.trim()
  result.split = true
  // Adopt the recovered child only when the child cell was empty — never
  // overwrite content the source already has.
  if (!rawSub) result.subtopic = `${subPart.code} ${subPart.title}`.trim()
  return result
}

/**
 * Compatibility mapping for a legacy stored value (e.g. a saved lesson plan's
 * `topic`) that captured the malformed combined label. Returns the corrected
 * `{ topic, subtopic }` when it can be split, else `{ topic: original }`.
 *
 * @param {string} storedTopic
 * @param {string} [storedSubtopic]
 * @returns {{ topic: string, subtopic: string, remapped: boolean }}
 */
export function mapLegacyTopicValue(storedTopic, storedSubtopic = '') {
  const { topic, subtopic, split } = splitConcatenatedTopicCell(storedTopic, storedSubtopic)
  return { topic, subtopic, remapped: split }
}

// ── Numeric code-segment ordering ────────────────────────────────────────────

/** Leading dotted code of a label ("1.2.10 Foo" → "1.2.10"), or null. */
export function leadingCode(label) {
  const m = String(label == null ? '' : label).trim().match(/^(\d+(?:\.\d+)*)/)
  return m ? m[1] : null
}

/**
 * Compare two curriculum labels by their leading code, segment-by-segment and
 * NUMERICALLY, so "1.2.2" < "1.2.9" < "1.2.10" (ordinary string/alpha sorting
 * would wrongly put "1.2.10" before "1.2.2"). Labels without a code sort after
 * coded ones; two code-less labels compare equal (stable order preserved).
 */
export function compareCurriculumCodes(a, b) {
  const ca = leadingCode(a)
  const cb = leadingCode(b)
  if (!ca && !cb) return 0
  if (!ca) return 1
  if (!cb) return -1
  const sa = ca.split('.').map(Number)
  const sb = cb.split('.').map(Number)
  const n = Math.max(sa.length, sb.length)
  for (let i = 0; i < n; i++) {
    const x = sa[i] ?? 0
    const y = sb[i] ?? 0
    if (x !== y) return x - y
  }
  return 0
}

/** Stable numeric-by-code sort of an array of labels (or objects via `keyOf`). */
export function sortByCurriculumCode(items, keyOf = (x) => x) {
  return items
    .map((item, i) => ({ item, i }))
    .sort((p, q) => {
      const c = compareCurriculumCodes(keyOf(p.item), keyOf(q.item))
      return c !== 0 ? c : p.i - q.i
    })
    .map(({ item }) => item)
}
