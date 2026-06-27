/**
 * Splits a SPECIFIC OUTCOMES string from the 2013 curriculum into individual
 * outcome strings, one per numbered outcome code.
 *
 * The 2013 syllabus stores all outcomes for a subtopic in a single cell, with
 * each outcome prefixed by a dot-separated code like "10.1.3.1", e.g.:
 *
 *   "10.1.3.1 Explain the zones. 10.1.3.2 State the duration."
 *   → ["10.1.3.1 Explain the zones.", "10.1.3.2 State the duration."]
 *
 * Strategy: match each outcome as a segment that starts with a 4-part dotted
 * code (\d+\.\d+\.\d+\.\d+) and continues until the next such code or the
 * end of string. This avoids lookahead-split ambiguity where a split on
 * /(?=\d+\.\d+\.\d+\.\d+)/ would fire at every digit inside a code.
 *
 * @param {string} raw - The raw SPECIFIC OUTCOMES cell value.
 * @returns {string[]} Array of individual outcome strings.
 */
export function splitSpecificOutcomes(raw) {
  if (!raw || typeof raw !== 'string') return []
  const trimmed = raw.trim()
  if (!trimmed) return []

  // Match each outcome: starts with a 4-part dotted code, captures everything
  // up to (but not including) the next code boundary or end of string.
  // [\s\S]*? is a non-greedy match so it stops as soon as the lookahead fires.
  const pattern = /\d+\.\d+\.\d+\.\d+[\s\S]*?(?=\s+\d+\.\d+\.\d+\.\d+|$)/g
  const matches = trimmed.match(pattern)
  // If no 4-part codes are found, treat the whole string as a single outcome.
  if (!matches || matches.length === 0) return [trimmed]
  return matches.map((s) => s.trim()).filter(Boolean)
}
