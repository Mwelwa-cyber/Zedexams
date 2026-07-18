/**
 * cacheKeys — tenant-safe cache key builders for the app-level caching layer
 * (src/utils/cache/memoryCache.js, searchCache.js, src/hooks/useCachedQuery.js).
 *
 * The one rule that matters: every field that affects the result set must be
 * part of the key. A key built from `query` alone (or any subset that drops
 * userId/schoolId/curriculumId/gradeId/...) can leak or mix results between
 * curricula, grades, schools, or users — see CLAUDE.md #13.2/#13.8.
 *
 * `undefined`/`null` segments are encoded with a NUL sentinel distinct from
 * the empty string, so `{gradeId: undefined}` and `{gradeId: ''}` never
 * collide, and so a fixed-order key never ambiguously shifts when an inner
 * field is omitted.
 */

const NONE = '\u0000' // NUL sentinel; kept as a literal source escape, never a raw byte on disk

function seg(value) {
  if (value === undefined || value === null) return NONE
  if (typeof value === 'boolean') return value ? '1' : '0'
  return String(value)
}

/** Normalise free-text search input: trim, collapse internal whitespace, lowercase. */
export function normalizeSearchText(text) {
  return String(text ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

/**
 * Stable, sorted-key stringification of a filters object. Undefined/null/''
 * values are dropped so `{type: 'mcq', difficulty: undefined}` and
 * `{type: 'mcq'}` produce the same segment (an unset filter shouldn't create
 * a distinct cache entry from an explicitly-empty one).
 */
export function normalizeFilters(filters) {
  if (!filters || typeof filters !== 'object') return ''
  const keys = Object.keys(filters)
    .filter((k) => filters[k] !== undefined && filters[k] !== null && filters[k] !== '')
    .sort()
  return keys.map((k) => `${k}=${seg(filters[k])}`).join('&')
}

/**
 * Build a cache key from an ordered list of parts. Every part is encoded
 * (including absent ones, via the NONE sentinel) so keys stay positionally
 * stable — `createCacheKey(['a', undefined, 'c'])` never collides with
 * `createCacheKey(['a', 'c'])`.
 * @param {Array<string|number|boolean|null|undefined>} parts
 * @returns {string}
 */
export function createCacheKey(parts) {
  if (!Array.isArray(parts)) throw new TypeError('createCacheKey expects an array of parts')
  return parts.map(seg).join(':')
}

/**
 * Build a `startsWith`-safe prefix from a leading run of parts (for
 * `cache.invalidatePrefix(...)`). Always ends in the `:` separator so
 * `createCacheKeyPrefix(['a', 'u1'])` matches `a:u1:...` but never the
 * unrelated key `a:u12:...`.
 * @param {Array<string|number|boolean|null|undefined>} parts
 * @returns {string}
 */
export function createCacheKeyPrefix(parts) {
  if (!Array.isArray(parts)) throw new TypeError('createCacheKeyPrefix expects an array of parts')
  return `${parts.map(seg).join(':')}:`
}

// Field order matters: it's what makes prefix-based invalidation useful.
// Tenant/context fields come first (so "invalidate everything for this
// user+school" is a clean prefix cut) and the most granular, most-frequently
// -changing fields (sort/page/filters/query) come last.
const SEARCH_KEY_FIELDS = [
  'scope', 'userId', 'schoolId',
  'curriculumId', 'curriculumVersion', 'gradeId', 'subjectId', 'topicId', 'subtopicId',
  'language', 'sort', 'filters', 'page', 'query',
]

function encodeSearchField(name, fields) {
  if (name === 'filters') return normalizeFilters(fields.filters)
  if (name === 'query') return normalizeSearchText(fields.query)
  return fields[name]
}

/**
 * Build a cache key for a scoped search/read request. `scope` (e.g.
 * `"question-bank"`, `"syllabus-search"`) is required; every other field is
 * optional but, when it affects the result, MUST be passed — see the module
 * doc comment.
 *
 * @example
 *   createSearchCacheKey({
 *     scope: 'question-bank', userId, schoolId, curriculumId, gradeId,
 *     subjectId, topicId, filters: { type, difficulty }, query: term,
 *   })
 */
export function createSearchCacheKey(fields = {}) {
  if (!fields.scope) throw new Error('createSearchCacheKey requires a scope')
  const parts = ['search', ...SEARCH_KEY_FIELDS.map((name) => encodeSearchField(name, fields))]
  return createCacheKey(parts)
}

/**
 * Build an invalidation prefix over a *leading* run of the same field order
 * `createSearchCacheKey` uses. Only fields explicitly present in `fields`
 * (checked in field order, stopping at the first omission) are included —
 * `createSearchCacheKeyPrefix({ scope: 'assessment-list', userId, schoolId })`
 * invalidates every cached search for that user+school regardless of
 * curriculum/grade/subject/filters/query.
 * @param {object} fields
 * @returns {string}
 */
export function createSearchCacheKeyPrefix(fields = {}) {
  if (!fields.scope) throw new Error('createSearchCacheKeyPrefix requires a scope')
  const parts = ['search', fields.scope]
  for (const name of SEARCH_KEY_FIELDS.slice(1)) {
    if (fields[name] === undefined) break
    parts.push(encodeSearchField(name, fields))
  }
  return createCacheKeyPrefix(parts)
}
