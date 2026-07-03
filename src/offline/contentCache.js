/**
 * contentCache — the high-level, cache-first content API the app calls. Sits on
 * top of offlineStore (persistence) + contentCacheCore (policy) and implements
 * the "load instantly from local, refresh in the background" behaviour
 * (Objectives 1, 2, 10).
 *
 *   const quiz = await getOrFetch({
 *     type: 'quiz', id: quizId,
 *     version: serverUpdatedAt,          // change-detection marker (optional)
 *     fetcher: () => fetchQuizFromFirestore(quizId),
 *     onFresh: (data) => setQuiz(data),  // called when a bg refresh lands
 *   })
 *
 * First call: fetch, cache, return. Next call: return the cached copy instantly,
 * and — only if the version marker says the server copy changed — fetch the
 * delta in the background and invoke onFresh. Nothing is re-downloaded when the
 * version is unchanged, which is the whole point.
 */

import { newEntry, touchEntry, needsRefresh, planCleanup } from './contentCacheCore.js'
import { getContent, putContent, listEntries, deleteEntries } from './offlineStore.js'

/** Rough byte size of a JSON-serialisable value (good enough for the budget maths). */
export function approxSize(value) {
  try {
    return JSON.stringify(value)?.length || 0
  } catch {
    return 0
  }
}

/**
 * Cache-first read with optional background refresh.
 * @param {object} opts
 * @param {string} opts.type
 * @param {string} opts.id
 * @param {string|number|null} [opts.version] server change marker
 * @param {() => Promise<*>} opts.fetcher network fetch, only called on miss/staleness
 * @param {(data:*) => void} [opts.onFresh] callback when a bg refresh replaces the copy
 * @param {boolean} [opts.pin] mark as a user download (never auto-evicted)
 * @returns {Promise<*>} the content (cached copy returned immediately when present)
 */
export async function getOrFetch({ type, id, version = null, fetcher, onFresh, pin = false }) {
  const cached = await getContent(type, id)

  if (cached && cached.payload != null) {
    // Update LRU standing without blocking the caller.
    putContent(touchEntry(cached.entry), cached.payload).catch(() => {})

    if (needsRefresh(cached.entry, version) && typeof fetcher === 'function') {
      // Background refresh: fetch the changed copy, cache it, notify the UI.
      refreshInBackground({ type, id, version, fetcher, onFresh, pinned: cached.entry.pinned || pin })
    }
    return cached.payload
  }

  // Miss — must fetch (throws propagate so the caller can show its own error).
  const data = await fetcher()
  await write({ type, id, version, data, pin })
  return data
}

async function refreshInBackground({ type, id, version, fetcher, onFresh, pinned }) {
  try {
    const data = await fetcher()
    await write({ type, id, version, data, pin: pinned })
    if (typeof onFresh === 'function') onFresh(data)
  } catch {
    // A failed background refresh is non-fatal — the cached copy still serves.
  }
}

async function write({ type, id, version, data, pin }) {
  const entry = newEntry({ type, id, version, size: approxSize(data), pinned: pin })
  await putContent(entry, data)
  // Opportunistic maintenance so the cache can't grow unbounded (Objective 5).
  scheduleMaintenance()
}

/**
 * Explicitly pin content for offline use (the "Download for Offline Use" path,
 * Objective 6). Fetches if not present, then marks the entry pinned so cleanup
 * never touches it.
 * @param {object} opts same as getOrFetch minus onFresh
 * @returns {Promise<*>}
 */
export async function downloadForOffline({ type, id, version = null, fetcher }) {
  const cached = await getContent(type, id)
  const data = cached?.payload != null ? cached.payload : await fetcher()
  const base = cached?.entry || newEntry({ type, id, version, size: approxSize(data) })
  await putContent({ ...base, pinned: true, version: version == null ? base.version : String(version) }, data)
  return data
}

/** Un-pin an entry (it becomes an ordinary auto-managed cache item again). */
export async function unpin(type, id) {
  const cached = await getContent(type, id)
  if (cached?.entry) await putContent({ ...cached.entry, pinned: false }, cached.payload)
}

/* ─────────────────────────── background maintenance ──────────────────────── */

let maintenanceScheduled = false

/**
 * Debounced, idle-scheduled cache cleanup. Runs the pure planCleanup over the
 * live entry list and deletes what it selects. Idle scheduling keeps it off the
 * interaction path (Objective 10: minimal background processing).
 */
export function scheduleMaintenance() {
  if (maintenanceScheduled) return
  maintenanceScheduled = true
  const run = () => { maintenanceScheduled = false; runMaintenance() }
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(run, { timeout: 10_000 })
  } else if (typeof setTimeout !== 'undefined') {
    setTimeout(run, 3000)
  } else {
    run()
  }
}

export async function runMaintenance(opts = {}) {
  try {
    const entries = await listEntries()
    const { remove } = planCleanup(entries, opts)
    if (remove.length) await deleteEntries(remove.map((e) => e.key))
    return remove.length
  } catch {
    return 0
  }
}
