/**
 * Splits a SPECIFIC OUTCOMES string from the 2013 curriculum into individual
 * outcome strings, one per numbered outcome code.
 *
 * The 2013 syllabus stores all outcomes for a subtopic in a single cell, with
 * each outcome prefixed by a dot-separated code, e.g.:
 *
 *   "10.1.3.1 Explain the zones. 10.1.3.2 State the duration."
 *   → ["10.1.3.1 Explain the zones.", "10.1.3.2 State the duration."]
 *
 * This now delegates to the canonical parser (src/utils/curriculum2013Parser.js)
 * so every studio picker shares ONE outcome-splitting implementation — the one
 * that also handles primary-Maths 3-segment codes, OCR double-dots and codes
 * glued to their statement. It re-flattens the parser's { code, statement }
 * records back to plain strings to keep this helper's existing string[]
 * contract for its callers.
 *
 * @param {string} raw - The raw SPECIFIC OUTCOMES cell value.
 * @returns {string[]} Array of individual outcome strings.
 */
import { splitSpecificOutcomes as splitCoded } from '../../utils/curriculum2013Parser.js'

export function splitSpecificOutcomes(raw) {
  if (!raw || typeof raw !== 'string') return []
  return splitCoded(raw)
    .map((o) => (o.code ? `${o.code} ${o.statement}`.trim() : o.statement))
    .filter(Boolean)
}
