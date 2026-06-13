/**
 * Bloom's-taxonomy analysis for the Assessment Studio.
 *
 * Pure (no React, no Firebase) so it's unit-testable. Unlike difficulty,
 * Bloom's level is NOT inferred — a question only counts as a cognitive level
 * once the teacher explicitly tags it. Untagged questions are reported
 * separately so the "thinking skills" meter is honest about coverage.
 */

// Revised Bloom's taxonomy, lower-order → higher-order.
export const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create']

export const BLOOM_LABELS = {
  remember: 'Remember',
  understand: 'Understand',
  apply: 'Apply',
  analyze: 'Analyse',
  evaluate: 'Evaluate',
  create: 'Create',
}

// The first three are "lower-order" thinking; the last three "higher-order".
export const BLOOM_HIGHER_ORDER = ['analyze', 'evaluate', 'create']

/** The valid level on a question, or '' when untagged / invalid. */
export function bloomLevel(question) {
  const level = String(question?.bloom || '').toLowerCase()
  return BLOOM_LEVELS.includes(level) ? level : ''
}

/**
 * Summarise the cognitive-level spread of a paper.
 * @returns {{ total, tagged, untagged, buckets, byBucket, lowerOrder,
 *            higherOrder, verdict }}
 */
export function analyzeBloom(questions = []) {
  const total = questions.length
  const buckets = Object.fromEntries(BLOOM_LEVELS.map((l) => [l, 0]))
  const byBucket = Object.fromEntries(BLOOM_LEVELS.map((l) => [l, []]))
  let tagged = 0
  questions.forEach((q, idx) => {
    const level = bloomLevel(q)
    if (!level) return
    tagged += 1
    buckets[level] += 1
    byBucket[level].push({ q, idx })
  })
  const untagged = total - tagged
  const higherOrder = BLOOM_HIGHER_ORDER.reduce((sum, l) => sum + buckets[l], 0)
  const lowerOrder = tagged - higherOrder

  let verdict
  if (total === 0) verdict = 'No questions yet'
  else if (tagged === 0) verdict = 'No cognitive levels tagged'
  else if (untagged > 0) verdict = `${untagged} question${untagged === 1 ? '' : 's'} untagged`
  else if (higherOrder === 0) verdict = 'All lower-order (recall / understand)'
  else if (lowerOrder === 0) verdict = 'All higher-order — add some recall'
  else verdict = 'Good spread of thinking skills'

  return { total, tagged, untagged, buckets, byBucket, lowerOrder, higherOrder, verdict }
}
