/**
 * assessmentDeletionCore — pure, dependency-free logic for the assessment
 * deletion registry (see assessmentDeletion.js for the stateful wrapper that
 * adds sessionStorage + BroadcastChannel).
 *
 * Why a registry at all? The Assessment Studio library list (AssessmentList)
 * and the paper editor (AssessmentStudio) are separate component trees — and,
 * across two tabs, separate JS contexts. When a teacher deletes a paper from
 * the list, nothing told the editor's continuous library autosave to stop, and
 * nothing survived a page refresh to mask a stale offline-cache read. Both are
 * resurrection vectors: an in-flight/queued autosave (or another tab's editor)
 * could re-persist the paper, or a stale Firestore IndexedDB cache read could
 * resurface it after refresh.
 *
 * A session-scoped tombstone set — recorded the instant a delete starts,
 * persisted to sessionStorage so it survives a refresh, and broadcast to other
 * tabs — closes all of those windows: every read path filters tombstoned ids,
 * and every write path (autosave) aborts on a tombstoned id.
 *
 * Firestore document ids are unique random strings, so a tombstoned id can
 * never legitimately belong to a different, still-live paper — hiding it is
 * always safe.
 *
 * These helpers are pure so they can be unit-tested under plain `node`; the
 * side effects (storage, channel, timers) live in assessmentDeletion.js.
 */

// sessionStorage key holding the JSON array of tombstoned assessment ids for
// this browser tab session. sessionStorage (not localStorage) so the tombstone
// clears when the tab closes — long enough to outlast a refresh and any
// cache-lag window, short enough never to accumulate forever.
export const TOMBSTONE_STORAGE_KEY = 'zedexams:assessment:deleted'

// Cross-tab channel name. A delete in one tab must remove the paper from every
// other open tab (and stop their editors re-persisting it).
export const DELETION_CHANNEL = 'zedexams-assessment-deletion'

// Hard cap so a marathon session that deletes hundreds of papers can't grow the
// stored set without bound. Oldest ids fall off first (FIFO) — a very old
// tombstone is harmless to drop because its server delete is long since durable.
export const MAX_TOMBSTONES = 500

/** Coerce a value to a non-empty trimmed id string, or null. */
export function normalizeId(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/**
 * Parse the sessionStorage payload into an ordered array of ids. Tolerant of
 * corruption / legacy shapes — anything unparseable yields an empty list rather
 * than throwing (a broken tombstone store must never break the studio).
 */
export function parseTombstones(raw) {
  if (typeof raw !== 'string' || !raw) return []
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(data)) return []
  const out = []
  const seen = new Set()
  for (const entry of data) {
    const id = normalizeId(entry)
    if (id && !seen.has(id)) {
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/** Serialize an ordered id list back to the sessionStorage payload, capped. */
export function serializeTombstones(ids) {
  const list = Array.isArray(ids) ? ids : []
  const capped = list.length > MAX_TOMBSTONES ? list.slice(list.length - MAX_TOMBSTONES) : list
  return JSON.stringify(capped)
}

/**
 * Add an id to an ordered list (append, newest last), de-duplicated and capped.
 * Returns a NEW array (never mutates the input) plus whether it changed.
 */
export function addTombstone(ids, id) {
  const clean = normalizeId(id)
  const list = Array.isArray(ids) ? ids : []
  if (!clean || list.includes(clean)) return { ids: list, changed: false }
  const next = [...list, clean]
  const capped = next.length > MAX_TOMBSTONES ? next.slice(next.length - MAX_TOMBSTONES) : next
  return { ids: capped, changed: true }
}

/** Remove an id from the list. Returns a new array plus whether it changed. */
export function removeTombstone(ids, id) {
  const clean = normalizeId(id)
  const list = Array.isArray(ids) ? ids : []
  if (!clean || !list.includes(clean)) return { ids: list, changed: false }
  return { ids: list.filter((x) => x !== clean), changed: true }
}

/**
 * Drop every item whose id is tombstoned. Used by the read paths so a
 * just-deleted paper never renders, even if an offline-cache read returned it.
 * @param {Array<any>} items
 * @param {Set<string>|Array<string>} tombstoned
 * @param {(item:any)=>(string|undefined)} [getId]
 */
export function filterDeleted(items, tombstoned, getId = (item) => item?.id) {
  if (!Array.isArray(items) || !items.length) return Array.isArray(items) ? items : []
  const has = tombstoned instanceof Set
    ? (id) => tombstoned.has(id)
    : (id) => Array.isArray(tombstoned) && tombstoned.includes(id)
  return items.filter((item) => {
    const id = normalizeId(getId(item))
    return !(id && has(id))
  })
}

/**
 * Should a persist (library autosave / explicit save) be skipped because the
 * target document was deleted? A write against a tombstoned id would either
 * fail (update on a missing doc) or, in a race, re-create orphaned data — so we
 * refuse it outright. A create with no target id (targetId falsy) is a genuinely
 * new paper and is never skipped.
 */
export function shouldSkipPersist(targetId, isDeleted) {
  const clean = normalizeId(targetId)
  if (!clean) return false
  return typeof isDeleted === 'function' ? Boolean(isDeleted(clean)) : Boolean(isDeleted)
}

// The exact, whitelisted shape of a deletion log line. Only operational
// metadata — never question text, learner answers, tokens, or document
// contents. Any field not listed here is dropped, so a caller can't
// accidentally log PII by passing extra keys.
const LOG_FIELDS = [
  'event',
  'assessmentId',
  'userId',
  'deletionMode',
  'source',
  'startedAt',
  'completedAt',
  'success',
  'errorCode',
]

/**
 * Build a structured, PII-free deletion log entry. Unknown keys are dropped and
 * `durationMs` is derived when both timestamps are present.
 */
export function buildDeletionLogEntry(input = {}) {
  const entry = {}
  for (const key of LOG_FIELDS) {
    if (input[key] !== undefined) entry[key] = input[key]
  }
  if (!entry.event) entry.event = 'assessment_delete'
  if (typeof entry.startedAt === 'number' && typeof entry.completedAt === 'number') {
    entry.durationMs = Math.max(0, entry.completedAt - entry.startedAt)
  }
  return entry
}
