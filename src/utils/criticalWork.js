/**
 * src/utils/criticalWork.js
 *
 * A tiny ref-counted "critical work in flight" guard. While the count is > 0,
 * the app is doing something the user must NOT lose to a reload — the original
 * case being a teacher lesson-plan generation, which streams for up to ~2
 * minutes and lives only in React state until it finishes.
 *
 * Why this exists: the PWA ships `registerType: 'autoUpdate'` (vite.config.js).
 * When a new build deploys mid-session the service worker activates and posts
 * SW_RELOAD_REQUEST; the app then reloads onto the new build on the next
 * in-app navigation (see pwaAutoReload.js / UpdatePrompt.jsx). That reload
 * assumed "long-running ops don't navigate, so they're safe" — but a teacher
 * mid-generation can navigate, and the reload wiped the in-progress plan
 * ("it refreshed on its own and started over"). This guard lets that work
 * announce itself so the auto-reload defers until it's done.
 *
 * Two consumers:
 *   • The PWA auto-update reload (UpdatePrompt + pwaReloadOnNavigate) holds the
 *     swap back while work is in flight — the update still lands on the next
 *     navigation once work completes, so users still reach the new build.
 *   • A `beforeunload` backstop warns before ANY unload (manual reload, a
 *     service-worker controllerchange reload, closing the tab) while busy, so
 *     no path silently discards an in-progress generation.
 *
 * The ref-count + listener logic is pure and DOM-guarded so it unit-tests under
 * plain node (see scripts/test-critical-work.mjs).
 */

let count = 0
const listeners = new Set()

function notify() {
  const busy = count > 0
  for (const cb of listeners) {
    // A misbehaving listener must never wedge the counter for everyone else.
    try { cb(busy) } catch { /* swallow */ }
  }
}

let beforeUnloadBound = false

function onBeforeUnload(e) {
  if (count <= 0) return undefined
  // Modern browsers ignore any custom string and show their own generic
  // "Leave site? Changes you made may not be saved." dialog — but that prompt
  // is enough to stop a stray reload from silently discarding the generation.
  e.preventDefault()
  e.returnValue = ''
  return ''
}

function bindBeforeUnload() {
  if (beforeUnloadBound) return
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
  // Bound once and left bound — it no-ops whenever the count is 0, so there's
  // nothing to tear down and no risk of a leaked-but-active handler.
  window.addEventListener('beforeunload', onBeforeUnload)
  beforeUnloadBound = true
}

/**
 * Mark the start of a critical operation. Returns a one-shot release function;
 * call it (e.g. in a `finally`) exactly when the work is done. The releaser is
 * idempotent, so calling it twice can't drive the counter negative.
 *
 * @returns {() => void} release
 */
export function beginCriticalWork() {
  count += 1
  if (count === 1) {
    bindBeforeUnload()
    notify()
  }
  let released = false
  return function release() {
    if (released) return
    released = true
    endCriticalWork()
  }
}

/**
 * Decrement the in-flight counter. Prefer the releaser returned by
 * beginCriticalWork(); this is the explicit counterpart for callers that track
 * their own pairing. Never goes below zero.
 */
export function endCriticalWork() {
  if (count <= 0) return
  count -= 1
  if (count === 0) notify()
}

/** True while any critical operation is in flight. */
export function isCriticalWorkInFlight() {
  return count > 0
}

/**
 * Subscribe to busy-state transitions. The callback fires with the current
 * boolean on every 0↔1 edge (not on intermediate ref-count changes). Returns
 * an unsubscribe function.
 *
 * @param {(busy: boolean) => void} cb
 * @returns {() => void} unsubscribe
 */
export function subscribeCriticalWork(cb) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Test-only: reset module state between cases. */
export function __resetCriticalWork() {
  count = 0
  listeners.clear()
}
