/**
 * courseMapMatch — fuzzy matching of author-entered quiz topics/titles to
 * canonical CBC topic / subtopic names for the practice Course Map
 * (src/components/dashboard/SubjectDrillDown.jsx).
 *
 * Why this exists
 * ---------------
 * The Course Map groups published practice quizzes under the curriculum's
 * topic → subtopic tree. The original logic required `quiz.topic` to be an
 * EXACT string match against a subtopic name. In practice authors save the
 * topic/title with section numbers, articles and a suffix, e.g.
 *
 *   subtopic name : "Digestive System"
 *   quiz.title    : "1.1 The Digestive System — Practice Quiz"
 *
 * which never `=== "Digestive System"`, so every quiz fell through to the
 * catch-all "Other quizzes" bucket while the real subtopic rendered
 * "No quizzes yet — coming soon".
 *
 * `normalizeForMatch` canonicalises both sides (lowercase, drop a leading
 * section number like "5.6", drop the "Practice Quiz" suffix, drop a leading
 * "The", strip punctuation, collapse whitespace) and `matchName` scores each
 * candidate so a quiz lands under the most specific matching name:
 *   - exact match            (score 4)
 *   - quiz begins with name   (score 3) — title carries extra trailing words
 *   - name begins with quiz   (score 2) — title is a truncation of the name
 * Ties break toward the closest-length name so "Fruits" wins over
 * "Fruits and Seeds" for a quiz simply titled "Fruits".
 *
 * Pure functions only — no React, no Firestore — so they are unit-testable
 * with plain `node` (see scripts/test-course-map-match.mjs).
 */

/**
 * Canonicalise a topic/subtopic/title string for fuzzy comparison.
 * @param {unknown} value
 * @returns {string}
 */
export function normalizeForMatch(value) {
  return String(value ?? '')
    .toLowerCase()
    // dashes (hyphen, en/em dash) act as separators
    .replace(/[‒-―-]/g, ' ')
    // strip the "Practice Quiz" / "Quiz" suffix authors append to titles
    .replace(/\bpractice\s+quiz\b/g, ' ')
    .replace(/\bquiz\b/g, ' ')
    // drop a leading section number: "5.6 ", "1.1)", "3 - ", "12. "
    .replace(/^\s*\d+(?:\.\d+)*[\s.)-]*/, ' ')
    // keep only word characters and spaces
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    // drop a single leading article once the rest is clean
    .replace(/^the\s+/, '')
    .trim()
}

/** True when `a` equals `b` or begins with `b` followed by a word boundary. */
function startsWithWord(a, b) {
  return a === b || (b.length > 0 && a.startsWith(`${b} `))
}

/**
 * Pick the best matching name for a quiz from a list of canonical names.
 *
 * Tries `quiz.topic` first, then falls back to `quiz.title` (some quizzes
 * leave the topic blank and only carry the subtopic in the title).
 *
 * @param {{ topic?: string, title?: string }} quiz
 * @param {string[]} names canonical topic or subtopic names to match against
 * @returns {string|null} the matched name, or null if nothing matches
 */
export function matchName(quiz, names) {
  if (!Array.isArray(names) || names.length === 0) return null
  const candidates = [quiz?.topic, quiz?.title]
  for (const raw of candidates) {
    const q = normalizeForMatch(raw)
    if (!q) continue
    let best = null
    let bestScore = 0
    let bestDelta = Infinity
    for (const name of names) {
      const s = normalizeForMatch(name)
      if (!s) continue
      let score = 0
      if (q === s) score = 4
      else if (startsWithWord(q, s)) score = 3
      else if (startsWithWord(s, q)) score = 2
      if (score === 0) continue
      const delta = Math.abs(s.length - q.length)
      if (score > bestScore || (score === bestScore && delta < bestDelta)) {
        best = name
        bestScore = score
        bestDelta = delta
      }
    }
    if (best) return best
  }
  return null
}
