/**
 * Ranked search over the admin command palette — pure, no imports, so it
 * tests under plain `node` with fixture data and never needs React.
 *
 * The palette it replaces did one thing: `(section + ' ' + label).includes(term)`.
 * Three consequences, all of which an admin hits within a day of using ⌘K:
 *
 *   • Word order mattered. "costs ai" found nothing, because the haystack
 *     reads "reports ai costs" and a single substring must appear contiguously.
 *   • Only the label was searchable. Typing what the page is FOR — "billing",
 *     "refund", "audit" — returned "No matches", because none of those words
 *     are in a label. Aliases now live on each item as `keywords`.
 *   • Nothing was ranked. Results came back in registry order, so typing
 *     "quiz" put "Manage content" above "Create quiz" whenever the former
 *     happened to be declared first.
 *
 * Matching is AND across whitespace-separated tokens: every token must appear
 * somewhere in the item's searchable text. That is what makes "costs ai" and
 * "ai costs" equivalent, and it keeps a second token narrowing rather than
 * widening the list — the behaviour every other palette has trained people to
 * expect.
 */

/** Rank tiers, best first. Exported so the test names them rather than 0/1/2. */
export const RANK = {
  EXACT_LABEL: 0,      // typed the label exactly: "payments"
  LABEL_PREFIX: 1,     // label starts with the query: "pay" → "Payments"
  LABEL_WORD: 2,       // a label word starts with a token: "quiz" → "Create quiz"
  LABEL_SUBSTRING: 3,  // somewhere inside the label
  OTHER: 4,            // matched only via section / keywords / path
}

const normalize = (value) => String(value ?? '').toLowerCase().trim()

/** Split a query into tokens. Empty/whitespace-only yields []. */
export function tokenize(query) {
  const text = normalize(query)
  return text ? text.split(/\s+/).filter(Boolean) : []
}

/**
 * The text a token may match against. The path is included so an admin who
 * knows the URL ("/admin/ai-costs", or just "ai-costs") lands on it, and
 * hyphens are also flattened to spaces so "ai costs" matches the path too.
 */
function haystack(command) {
  const path = normalize(command.to)
  return [
    normalize(command.label),
    normalize(command.section),
    normalize(command.keywords),
    path,
    path.replace(/[-/]/g, ' '),
  ].join(' ')
}

/**
 * Rank one command against a query. Returns null when it does not match at
 * all, so the caller filters and sorts in one pass.
 *
 * Deliberately returns the TIER only, never a fuzzy similarity score: within
 * a tier, results stay in registry order. A palette whose list reshuffles as
 * you type a fourth character is harder to use than one that only narrows,
 * because the item you were reaching for moves out from under the cursor.
 */
export function rankCommand(command, tokens) {
  if (!command) return null
  if (!tokens.length) return RANK.OTHER

  const text = haystack(command)
  for (const token of tokens) {
    if (!text.includes(token)) return null
  }

  const label = normalize(command.label)
  const query = tokens.join(' ')

  if (label === query) return RANK.EXACT_LABEL
  if (label.startsWith(query)) return RANK.LABEL_PREFIX

  // A label word starting with EVERY token — "cr qu" → "Create quiz".
  const words = label.split(/[^a-z0-9]+/).filter(Boolean)
  if (tokens.every((token) => words.some((word) => word.startsWith(token)))) {
    return RANK.LABEL_WORD
  }

  if (tokens.every((token) => label.includes(token))) return RANK.LABEL_SUBSTRING
  return RANK.OTHER
}

/**
 * Search `commands` for `query`.
 *
 * An empty query returns the first `emptyLimit` commands in registry order —
 * the palette's resting state, which doubles as a menu of where to go.
 *
 * @param {Array<object>} commands flattened command records
 * @param {string} query raw user input
 * @param {{limit?:number, emptyLimit?:number}} [options]
 * @returns {Array<object>} matching commands, best first
 */
export function searchAdminCommands(commands, query, options = {}) {
  const { limit = 30, emptyLimit = 12 } = options
  const list = Array.isArray(commands) ? commands : []
  const tokens = tokenize(query)

  if (!tokens.length) return list.slice(0, emptyLimit)

  const scored = []
  for (let index = 0; index < list.length; index += 1) {
    const rank = rankCommand(list[index], tokens)
    if (rank === null) continue
    scored.push({ command: list[index], rank, index })
  }

  // Stable by construction: equal ranks fall back to registry order, so the
  // list only ever narrows as the query grows.
  scored.sort((a, b) => (a.rank - b.rank) || (a.index - b.index))
  return scored.slice(0, limit).map((entry) => entry.command)
}

/**
 * Move the palette's highlight, wrapping at both ends.
 *
 * Wrapping is the point: with 30-odd destinations the useful gesture is
 * "⌘K then ArrowUp" to reach the last group, which a clamped highlight makes
 * impossible. Returns 0 for an empty list so the caller never holds an index
 * pointing past the results.
 */
export function moveHighlight(current, delta, count) {
  if (!count || count < 1) return 0
  const next = (Number(current) || 0) + delta
  return ((next % count) + count) % count
}
