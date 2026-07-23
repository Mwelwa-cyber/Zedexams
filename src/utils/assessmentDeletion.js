/**
 * assessmentDeletion — the session-scoped tombstone registry that makes an
 * assessment deletion authoritative across the whole app, so a deleted paper
 * can never resurface (in the list, in the editor's autosave, or after a
 * refresh from a stale offline cache).
 *
 * Responsibilities:
 *   • hold the set of assessment ids deleted this tab session, hydrated from
 *     and persisted to sessionStorage so it survives a page refresh;
 *   • broadcast a deletion to other open tabs (BroadcastChannel) and absorb
 *     theirs, so deleting in one tab removes it from every tab;
 *   • notify local subscribers (the list removes the row; the open editor stops
 *     autosaving and warns the teacher);
 *   • filter read results and gate writes against the set.
 *
 * The pure decisions (parse/serialize/add/remove/filter/log-shape) live in
 * assessmentDeletionCore.js so they unit-test without a DOM. Everything here is
 * a thin, fail-open side-effect layer: any storage/channel error degrades to an
 * in-memory-only registry rather than throwing.
 */

import {
  TOMBSTONE_STORAGE_KEY,
  DELETION_CHANNEL,
  parseTombstones,
  serializeTombstones,
  addTombstone,
  removeTombstone,
  filterDeleted as filterDeletedPure,
  buildDeletionLogEntry,
} from './assessmentDeletionCore.js'

const IS_DEV = typeof import.meta !== 'undefined' && Boolean(import.meta.env?.DEV)

// In-memory ordered id list — the fast path every read/write consults.
let ids = null
// Local subscribers: (id, deleted) => void.
const listeners = new Set()
let channel = null

function readStorage() {
  try {
    if (typeof sessionStorage === 'undefined') return []
    return parseTombstones(sessionStorage.getItem(TOMBSTONE_STORAGE_KEY))
  } catch {
    return []
  }
}

function writeStorage() {
  try {
    if (typeof sessionStorage === 'undefined') return
    sessionStorage.setItem(TOMBSTONE_STORAGE_KEY, serializeTombstones(ids))
  } catch {
    // Private mode / quota — the in-memory set still holds this session.
  }
}

function ensureInit() {
  if (ids !== null) return
  ids = readStorage()
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(DELETION_CHANNEL)
      channel.onmessage = (event) => {
        const msg = event?.data
        if (!msg || typeof msg.id !== 'string') return
        // Absorb another tab's decision WITHOUT re-broadcasting (avoids a loop).
        if (msg.type === 'deleted') applyLocal(msg.id, true, false)
        else if (msg.type === 'undeleted') applyLocal(msg.id, false, false)
      }
    }
  } catch {
    channel = null
  }
}

function broadcast(type, id) {
  try {
    channel?.postMessage({ type, id })
  } catch {
    // Channel closed mid-teardown — ignore.
  }
}

function notify(id, deleted) {
  for (const cb of listeners) {
    try { cb(id, deleted) } catch { /* one bad listener must not break the rest */ }
  }
}

/**
 * Apply a mark/unmark locally. `propagate` controls whether we also persist +
 * broadcast (true for a local action, false when we're absorbing a broadcast
 * from another tab, which is already persisted on its side and must not echo).
 */
function applyLocal(id, deleted, propagate) {
  ensureInit()
  const result = deleted ? addTombstone(ids, id) : removeTombstone(ids, id)
  if (!result.changed) return
  ids = result.ids
  writeStorage()
  if (propagate) broadcast(deleted ? 'deleted' : 'undeleted', id)
  notify(id, deleted)
}

/**
 * Record an assessment as deleted. Call this the instant a delete BEGINS (before
 * the network round-trip) so a concurrent autosave — in this tab or another —
 * can't re-persist the paper during the delete, and so a later stale-cache read
 * is filtered out.
 */
export function markAssessmentDeleted(id) {
  applyLocal(id, true, true)
}

/**
 * Lift a tombstone. Call this if the delete FAILED — the paper still exists, so
 * it must become visible/editable again.
 */
export function unmarkAssessmentDeleted(id) {
  applyLocal(id, false, true)
}

/** Is this assessment id tombstoned in this session (or a peer tab)? */
export function isAssessmentDeleted(id) {
  ensureInit()
  if (typeof id !== 'string') return false
  const trimmed = id.trim()
  return trimmed ? ids.includes(trimmed) : false
}

/** Drop every tombstoned item from a list (defensive read-path filter). */
export function filterDeleted(items, getId) {
  ensureInit()
  return filterDeletedPure(items, ids, getId)
}

/**
 * Subscribe to deletion changes (local action, or a peer tab's broadcast). The
 * callback receives (id, deleted). Returns an unsubscribe function.
 */
export function subscribeAssessmentDeletion(cb) {
  ensureInit()
  if (typeof cb !== 'function') return () => {}
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/**
 * Emit a structured, PII-free deletion log line (dev console only). Never logs
 * question content, learner answers, tokens, or document bytes — the core
 * builder whitelists the allowed fields.
 */
export function logAssessmentDeletion(input) {
  const entry = buildDeletionLogEntry(input)
  if (IS_DEV && typeof console !== 'undefined') {
    console.info('[assessment_delete]', entry)
  }
  return entry
}

/** Test-only: reset the module registry so specs don't leak state. */
export function _resetForTests() {
  ids = null
  listeners.clear()
  try { channel?.close() } catch { /* already closed */ }
  channel = null
  try { if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(TOMBSTONE_STORAGE_KEY) } catch { /* ignore */ }
}
