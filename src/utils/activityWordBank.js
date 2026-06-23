/**
 * Resolve the "word box" (a.k.a. word bank / white box) shown above the
 * questions in a Lesson Plan Studio class exercise or homework.
 *
 * Returns { words, instructions } where:
 *   - `words`        is the list of choices to render inside a bordered box.
 *   - `instructions` is the lead-in line shown ON TOP of that box, with any
 *     echoed word list removed and "…from the word box above" rephrased to
 *     "…below" — the box now sits below the instruction, not above it.
 *
 * New generations carry a structured `activity.wordBank` (see
 * functions/teacherTools/lessonActivitiesSchema.js). Older library items
 * crammed the words into the instruction text ("Word Box: a, b, c  Read each
 * sentence…"); those are parsed out as a best-effort fallback so they render
 * the same way without needing to be regenerated.
 */

const WORD_BOX_RE = /\b(?:word\s*box|word\s*bank|white\s*box)\b\s*[-:]?\s*/i

const DEFAULT_FILL_INSTRUCTION =
  'Read each sentence carefully and fill in the blank with a suitable word from the word box below.'

function cleanWord(w) {
  return String(w || '').trim().replace(/\s+/g, ' ')
}

// The box used to be printed above the instruction; it now sits below it, so
// flip any "word box above" / "box above" wording to "below".
function rephraseBelow(text) {
  return String(text || '').replace(
    /\b(word\s*box|word\s*bank|white\s*box|box)\s+above\b/gi,
    (_, label) => `${label} below`,
  )
}

// Best-effort extraction of an inline "Word Box: a, b, c" run from instruction
// prose. Returns { words, instructions } with the list removed, or null.
function parseInlineWordBox(text) {
  const m = WORD_BOX_RE.exec(text)
  if (!m) return null
  const before = text.slice(0, m.index).trim()
  const after = text.slice(m.index + m[0].length)
  // The list ends where the instruction prose resumes — the generators
  // separate the two with a run of 2+ spaces or a line break.
  const splitAt = after.search(/\s{2,}|\n/)
  const listText = splitAt === -1 ? after : after.slice(0, splitAt)
  const trailing = splitAt === -1 ? '' : after.slice(splitAt).trim()
  const words = listText.split(/[,;•]+/).map(cleanWord).filter(Boolean)
  if (words.length < 2) return null
  return { words, instructions: [before, trailing].filter(Boolean).join(' ').trim() }
}

export function resolveActivityWordBank(activity = {}) {
  const structured = Array.isArray(activity.wordBank)
    ? activity.wordBank.map(cleanWord).filter(Boolean)
    : []
  const rawInstructions = String(activity.instructions || '').trim()

  if (structured.length) {
    // Drop any echoed "Word Box: …" sentence so the words aren't shown twice.
    const parsed = parseInlineWordBox(rawInstructions)
    const instructions = rephraseBelow((parsed ? parsed.instructions : rawInstructions).trim())
    return { words: structured, instructions: instructions || DEFAULT_FILL_INSTRUCTION }
  }

  const parsed = parseInlineWordBox(rawInstructions)
  if (parsed) {
    return {
      words: parsed.words,
      instructions: rephraseBelow(parsed.instructions) || DEFAULT_FILL_INSTRUCTION,
    }
  }
  return { words: [], instructions: rephraseBelow(rawInstructions) }
}
