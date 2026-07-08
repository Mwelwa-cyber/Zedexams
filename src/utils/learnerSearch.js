// src/utils/learnerSearch.js
//
// Pure ranking/grouping for global learner search. The app has no server-side
// full-text index, so search is client-side substring matching over the
// bounded per-source fetches the hub pages already use (quizzes, notes, past
// papers, games). These helpers are the deterministic, unit-tested heart of
// that: they take already-normalised result items and a raw query and return a
// ranked, grouped result set. Fetching + normalising lives in
// hooks/useLearnerSearch.js.
//
// A normalised result item is:
//   { id, type: 'quiz'|'note'|'paper'|'game', title, subtitle?, subject?,
//     topic?, route }

export const RESULT_TYPES = ['quiz', 'note', 'paper', 'game']

export const RESULT_TYPE_META = {
  quiz:  { label: 'Quizzes', icon: '📝' },
  note:  { label: 'Notes',   icon: '📓' },
  paper: { label: 'Past papers', icon: '📄' },
  game:  { label: 'Games',   icon: '🎮' },
}

/** Lower-case, collapse internal whitespace, trim. '' means "no query". */
export function normalizeQuery(q) {
  return String(q == null ? '' : q).toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Relevance score for one item against a normalised needle. Higher is better;
 * 0 means "no match" (filtered out). Title matches beat metadata matches, and
 * an earlier match in the title beats a later one.
 */
export function scoreItem(item, needle) {
  if (!item || !needle) return 0
  const title = String(item.title || '').toLowerCase()
  if (title === needle) return 100
  if (title.startsWith(needle)) return 80
  const titleAt = title.indexOf(needle)
  if (titleAt > 0) return 60 - Math.min(titleAt, 20) // earlier = higher
  // Metadata fields — a hit here is weaker than any title hit.
  const meta = [item.topic, item.subject, item.subtitle]
    .map((x) => String(x || '').toLowerCase())
  if (meta.some((f) => f.includes(needle))) return 20
  return 0
}

/**
 * Filter `items` to those matching `query` and sort by descending relevance,
 * tie-broken alphabetically by title. Returns [] for an empty query.
 */
export function rankResults(query, items) {
  const needle = normalizeQuery(query)
  if (!needle || !Array.isArray(items)) return []
  return items
    .map((it) => ({ it, score: scoreItem(it, needle) }))
    .filter((x) => x.score > 0)
    .sort((a, b) =>
      b.score - a.score ||
      String(a.it.title || '').localeCompare(String(b.it.title || '')))
    .map((x) => x.it)
}

const joinMeta = (...parts) => parts.filter(Boolean).join(' · ')

/**
 * Normalise the four raw source lists into a single flat array of search-result
 * items (id, type, title, subtitle, subject, topic, route). Each source keeps
 * its own opening route so a result links straight to the content.
 */
export function buildResultItems({ quizzes = [], notes = [], papers = [], games = [] } = {}) {
  return [
    ...quizzes.map((q) => ({
      id: q.id, type: 'quiz', title: q.title || q.topic || 'Quiz',
      subtitle: joinMeta(q.subject, q.topic), subject: q.subject, topic: q.topic,
      route: `/quiz/${q.id}`,
    })),
    ...notes.map((n) => ({
      id: n.id, type: 'note', title: n.title || 'Note',
      subtitle: joinMeta(n.subject, n.topic), subject: n.subject, topic: n.topic,
      route: `/notes/${n.id}`,
    })),
    ...papers.map((p) => ({
      id: p.id, type: 'paper', title: p.title || 'Past paper',
      subtitle: joinMeta(p.subject, p.year), subject: p.subject,
      route: `/papers/${p.id}`,
    })),
    ...games.map((g) => ({
      id: g.id, type: 'game', title: g.title || 'Game',
      subtitle: joinMeta(g.subject, g.description).slice(0, 90), subject: g.subject,
      route: `/games/play/${g.id}`,
    })),
  ].filter((it) => it.id)
}

/** Group a flat ranked list into { quiz, note, paper, game } arrays (order kept). */
export function groupByType(results) {
  const groups = { quiz: [], note: [], paper: [], game: [] }
  for (const r of results || []) {
    if (groups[r.type]) groups[r.type].push(r)
  }
  return groups
}
