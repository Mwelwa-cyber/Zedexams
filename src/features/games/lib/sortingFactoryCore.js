/**
 * Pure logic for the `sorting_factory` game engine.
 *
 * Plain .js module (no React) so it can be unit-tested from plain Node
 * scripts — same pattern as numberTargetCore.js.
 *
 * Content shape: `game.questions` is an array of { question, answer } where
 *   question = the item to sort (e.g. "🐐 Goat")
 *   answer   = the bin it belongs to (e.g. "Living")
 * The bins are derived from the unique answers, in first-appearance order,
 * so authoring a sorting game is exactly like authoring any other game doc.
 */

/** Trim items and drop any without both an item label and a bin. */
export function normalizeItems(questions) {
  return (questions || [])
    .map((q) => ({
      question: String(q?.question || '').trim(),
      answer: String(q?.answer || '').trim(),
    }))
    .filter((q) => q.question && q.answer)
}

/**
 * Unique bin labels in first-appearance order. Dedupes case-insensitively
 * but keeps the first-seen casing for display.
 */
export function extractBins(items) {
  const seen = new Set()
  const bins = []
  for (const item of items) {
    const key = item.answer.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    bins.push(item.answer)
  }
  return bins
}

/** Case-insensitive bin match, so "living" and "Living" sort together. */
export function matchesBin(item, bin) {
  return String(item?.answer || '').trim().toLowerCase() === String(bin || '').trim().toLowerCase()
}

/**
 * Combo multiplier from the current streak (including this answer):
 * 4+ in a row doubles points, 8+ triples them. This is what makes the
 * round feel like an arcade run instead of a quiz.
 */
export function multiplierFor(streak) {
  if (streak >= 8) return 3
  if (streak >= 4) return 2
  return 1
}

/**
 * Sanity-check a sorting game's content. The UI fits 2–4 bins comfortably
 * on a phone; fewer than 2 means there is nothing to sort.
 */
export function validateSortingContent(questions) {
  const items = normalizeItems(questions)
  const bins = extractBins(items)
  if (items.length < 4) return { ok: false, reason: 'Needs at least 4 items to sort.' }
  if (bins.length < 2) return { ok: false, reason: 'Needs at least 2 different bins (answers).' }
  if (bins.length > 4) return { ok: false, reason: 'Too many bins — keep it to 4 or fewer.' }
  return { ok: true, items, bins }
}
