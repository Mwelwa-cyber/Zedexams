/**
 * cursors.js — pure, framework- and Firestore-agnostic pagination primitives.
 *
 * This module holds the *decision logic* for cursor-based pagination that the
 * `usePaginatedQuery` / `useInfiniteFirestoreQuery` hooks and the Firestore
 * page fetcher (`firestorePage.js`) build on. Nothing here imports React or
 * `firebase/firestore`, so it runs under plain `node` in tests and can be
 * reused from Cloud Functions.
 *
 * The model this enforces (see Prompt 16 §2/§7/§12):
 *   - bounded page sizes, clamped so a client can never request an unbounded read
 *   - a deterministic secondary sort (document id) so equal primary-sort values
 *     don't drop or duplicate rows across page boundaries
 *   - end-of-results detection by over-fetching one extra row (pageSize + 1),
 *     which is exact rather than the ambiguous "returned fewer than pageSize"
 *   - de-duplication by canonical document id when merging pages, because a doc
 *     whose ordering field changed mid-session, a retried request, or React
 *     Strict Mode's double-invoke can otherwise surface the same row twice.
 */

// ── Page-size standards (Prompt 16 §4) ───────────────────────────────────

export const DEFAULT_PAGE_SIZE = 25

// Hard client-side ceiling. The server enforces its own max independently
// (functions/pagination/paginationCore.js) — this is the belt to that
// braces, so a mistaken `pageSize: 5000` never even leaves the browser.
export const MAX_PAGE_SIZE = 50
export const MIN_PAGE_SIZE = 1

// Feature-appropriate starting sizes. Callers pass one of these (or their own
// value) to `usePaginatedQuery({ pageSize })`; they're collected here so the
// standards live in one place rather than scattered as magic numbers.
export const PAGE_SIZES = Object.freeze({
  MOBILE_LIST: 15,
  TABLET_LIST: 25,
  DESKTOP_LIST: 30,
  LEARNER_LIST: 30,
  QUESTION_BANK: 25,
  PAST_PAPERS: 24,
  NOTIFICATIONS: 25,
  AI_OPERATIONS: 20,
  PAYMENTS: 25,
  AUDIT_LOGS: 50,
})

/**
 * Clamp a requested page size into the safe [min, max] band, defaulting a
 * missing/invalid request to `fallback`. Non-integers are floored; NaN /
 * non-numbers fall back. This is the single choke-point that makes
 * "give me the whole collection in one page" impossible.
 *
 * @param {unknown} requested
 * @param {{ min?: number, max?: number, fallback?: number }} [opts]
 * @returns {number}
 */
export function clampPageSize(requested, { min = MIN_PAGE_SIZE, max = MAX_PAGE_SIZE, fallback = DEFAULT_PAGE_SIZE } = {}) {
  const n = Number(requested)
  if (!Number.isFinite(n) || n <= 0) return Math.min(Math.max(fallback, min), max)
  return Math.min(Math.max(Math.floor(n), min), max)
}

/**
 * The Firestore `limit()` to request for a page of `pageSize` items: one extra
 * so a full return unambiguously signals "there is at least one more row"
 * (Prompt 16 §7). Use `splitOverfetch` on the result to peel the sentinel off.
 */
export function overfetchLimit(pageSize) {
  return clampPageSize(pageSize) + 1
}

/**
 * Split an over-fetched result (fetched with `overfetchLimit`) into the page
 * the caller should show plus an exact `hasNextPage`. If the query returned
 * more than `pageSize` rows, the extra sentinel row is dropped and there is a
 * next page; otherwise this is the last page.
 *
 * @template T
 * @param {T[]} rows rows returned from a query limited to overfetchLimit(pageSize)
 * @param {number} pageSize the logical page size (not the over-fetch limit)
 * @returns {{ items: T[], hasNextPage: boolean }}
 */
export function splitOverfetch(rows, pageSize) {
  const size = clampPageSize(pageSize)
  const list = Array.isArray(rows) ? rows : []
  if (list.length > size) {
    return { items: list.slice(0, size), hasNextPage: true }
  }
  return { items: list, hasNextPage: false }
}

// ── De-duplication (Prompt 16 §12) ───────────────────────────────────────

const defaultGetId = (item) => (item == null ? undefined : item.id)

/**
 * De-duplicate a list by canonical id, keeping the LAST occurrence of each id
 * (so a fresher copy of a record — e.g. a refreshed first page — wins over the
 * stale copy already in the list) while preserving the overall order the
 * winning occurrences appear in. Items with a null/undefined id are kept as-is
 * (never merged together — an id-less row is not "the same" as another).
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => (string|number|undefined)} [getId]
 * @returns {T[]}
 */
export function dedupeById(items, getId = defaultGetId) {
  const list = Array.isArray(items) ? items : []
  const seen = new Map()
  const passthrough = []
  for (const item of list) {
    const id = getId(item)
    if (id === undefined || id === null) {
      passthrough.push(item)
    } else {
      seen.set(id, item) // last write wins
    }
  }
  // Preserve first-seen positional order but with last-seen values.
  const orderedIds = []
  const positioned = new Set()
  for (const item of list) {
    const id = getId(item)
    if (id === undefined || id === null) continue
    if (!positioned.has(id)) { positioned.add(id); orderedIds.push(id) }
  }
  const deduped = orderedIds.map((id) => seen.get(id))
  return [...deduped, ...passthrough]
}

/**
 * Merge already-loaded items with a freshly-loaded page, de-duplicating by id.
 * `incoming` values win on collision (a re-fetched row replaces its stale
 * copy). Existing order is preserved, new ids append in arrival order.
 *
 * @template T
 * @param {T[]} existing
 * @param {T[]} incoming
 * @param {(item: T) => (string|number|undefined)} [getId]
 * @returns {T[]}
 */
export function mergeUniqueItems(existing, incoming, getId = defaultGetId) {
  return dedupeById([...(existing || []), ...(incoming || [])], getId)
}

/**
 * Remove a single record (by id) from a loaded list — used when a document is
 * deleted while the user is viewing paginated results (Prompt 16 §19).
 *
 * @template T
 * @param {T[]} items
 * @param {string|number} id
 * @param {(item: T) => (string|number|undefined)} [getId]
 * @returns {T[]}
 */
export function removeById(items, id, getId = defaultGetId) {
  return (items || []).filter((item) => getId(item) !== id)
}

// ── Cursor fingerprints (Prompt 16 §13) ──────────────────────────────────

/**
 * A stable string identifying the cursor a next-page request will start after,
 * so two concurrent triggers reading from the same position can be detected
 * and de-duped (`queryKey:lastCursorId`). `null` for the very first page.
 *
 * @param {{ id?: string|number }|null|undefined} cursor a doc snapshot-like value with an `id`
 * @returns {string}
 */
export function cursorFingerprint(cursor) {
  if (cursor == null) return 'start'
  const id = typeof cursor === 'object' ? cursor.id : cursor
  return id == null ? 'start' : String(id)
}

/**
 * Build the in-flight lock key for a specific page request: the query key plus
 * the cursor it reads from. Two triggers with the same key must not both fire
 * a Firestore read (Prompt 16 §13).
 */
export function pageRequestKey(queryKey, cursor) {
  return `${queryKey}::${cursorFingerprint(cursor)}`
}
