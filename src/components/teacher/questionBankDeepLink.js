/**
 * The Question Bank's filters, in the URL.
 *
 * The bank used to be its own page at `/teacher/question-bank`. That route now
 * redirects into the Assessment Paper Studio's bank view, and the redirect
 * carries the query string across untouched — so a link somebody saved, shared
 * or bookmarked has to keep working, and "the filters were preserved" has to be
 * something a test can check rather than something the redirect claims.
 *
 * Both directions live here, together, for the reason two-directional mappings
 * usually go wrong: a key added to the reader and forgotten in the writer
 * produces a filter that can be arrived at but never linked to.
 *
 * `view` is NOT one of these keys. It selects the studio's view and is owned by
 * `changeView`; a filter writer that also wrote `view` would fight it.
 *
 * Pure — no React, no router. Exercised by
 * `npm run test:question-bank-deep-link`.
 */

/** URL key ↔ filter key. The URL keys are the short, linkable spellings. */
const PARAM_TO_FILTER = {
  q: 'term',
  scope: 'scope',
  grade: 'grade',
  subject: 'subject',
  topic: 'topic',
  subtopic: 'subtopic',
  type: 'type',
  difficulty: 'difficulty',
  marks: 'marks',
  source: 'source',
  diagram: 'withDiagram',
  sort: 'sort',
  starred: 'favouritesOnly',
}

const FILTER_TO_PARAM = Object.fromEntries(
  Object.entries(PARAM_TO_FILTER).map(([param, filter]) => [filter, param]),
)

/** Filter keys whose value is a boolean rather than a string. */
const BOOLEAN_FILTERS = new Set(['favouritesOnly'])

/**
 * Read bank filters out of a URLSearchParams (or anything with `.get`).
 * Unknown keys are ignored and absent keys are omitted entirely — the caller
 * merges this over its own defaults, so an omitted key means "leave the default
 * alone" rather than "clear it".
 */
export function bankFiltersFromParams(params) {
  const out = {}
  if (!params || typeof params.get !== 'function') return out
  for (const [param, filter] of Object.entries(PARAM_TO_FILTER)) {
    const raw = params.get(param)
    if (raw == null) continue
    if (BOOLEAN_FILTERS.has(filter)) {
      out[filter] = raw === '1' || raw === 'true'
      continue
    }
    const value = String(raw).trim()
    if (value) out[filter] = value
  }
  return out
}

/**
 * The query-string form of a filter set. Empty/default values are DROPPED
 * rather than written as blanks, so the address bar reads as the filters that
 * are actually on and a shared link does not pin defaults that later change.
 */
export function bankFiltersToParams(filters = {}, base = null) {
  const params = new URLSearchParams(base || '')
  for (const [filter, param] of Object.entries(FILTER_TO_PARAM)) {
    const value = filters[filter]
    if (BOOLEAN_FILTERS.has(filter)) {
      if (value) params.set(param, '1')
      else params.delete(param)
      continue
    }
    const clean = value == null ? '' : String(value).trim()
    // 'all' scope and 'newest' sort are the defaults; writing them adds noise
    // to every link without changing what it opens.
    const isDefault = (filter === 'scope' && clean === 'all') || (filter === 'sort' && clean === 'newest')
    if (clean && !isDefault) params.set(param, clean)
    else params.delete(param)
  }
  return params
}

/**
 * The studio path the retired `/teacher/question-bank` route redirects to,
 * with the incoming query string preserved.
 *
 * The whole query is carried, not just the keys above: a link may legitimately
 * carry params this module knows nothing about (analytics tags, a future
 * filter), and dropping them is a silent loss the teacher cannot see.
 *
 * @param {string} search    `location.search`, e.g. `?grade=4&subject=Maths`
 * @param {string} routeBase the studio's route base
 */
export function questionBankRedirectPath(search = '', routeBase = '/teacher/assessment-papers') {
  const params = new URLSearchParams(search || '')
  params.set('view', 'bank')
  return `${routeBase}/new?${params.toString()}`
}
