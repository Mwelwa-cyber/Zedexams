/**
 * syncEngine — the runtime that drives the offline outbox. Framework-agnostic
 * singleton (no React) so a Cloud-of-listeners can subscribe: the OfflineContext
 * wires it into UI state, but a plain call site can enqueue too.
 *
 * Responsibilities (Objective 11):
 *   • Detect connectivity changes (online/offline events + a periodic ping-free
 *     check on navigator.onLine) and flush when we come back.
 *   • Queue offline actions durably (offlineStore.outbox).
 *   • Retry failed uploads with exponential backoff (syncQueueCore).
 *   • Prevent duplicate submissions (idempotency ids + in-flight guard).
 *   • Resolve conflicts via the LWW helper (handlers may consult it).
 *
 * A "handler" is registered per action kind: `registerHandler('quiz-result', fn)`
 * where fn(payload, action) → Promise. Throwing (or rejecting) schedules a
 * backoff retry; resolving marks the action done. Handlers do the actual
 * Firestore writes, so this module stays dependency-light and testable-ish.
 */

import {
  newAction,
  actionId,
  enqueue,
  dueActions,
  markAttempt,
  pendingCount,
  pruneDone,
} from './syncQueueCore.js'
import { listActions, replaceOutbox, setMeta } from './offlineStore.js'

const handlers = new Map()
const listeners = new Set()

let queue = []
let flushing = false
let started = false
let hydrated = false

/** Register the executor for a given action kind. Returns an unregister fn. */
export function registerHandler(kind, fn) {
  handlers.set(kind, fn)
  return () => { if (handlers.get(kind) === fn) handlers.delete(kind) }
}

/** Subscribe to engine state changes. Returns an unsubscribe fn. */
export function subscribe(listener) {
  listeners.add(listener)
  listener(snapshot())
  return () => listeners.delete(listener)
}

function snapshot() {
  return {
    pending: pendingCount(queue),
    syncing: flushing,
    actions: queue,
  }
}

function emit() {
  const snap = snapshot()
  listeners.forEach((l) => { try { l(snap) } catch { /* listener errors are their own problem */ } })
}

function isOnline() {
  try {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false
  } catch {
    return true
  }
}

async function hydrate() {
  if (hydrated) return
  hydrated = true
  queue = await listActions()
  emit()
}

/**
 * Enqueue (or coalesce) an action, persist it, and kick a flush. Callers pass a
 * natural key so re-enqueues of the same logical action dedupe.
 * @param {{ kind: string, naturalKey: string, payload: *, version?: number }} spec
 * @returns {Promise<string>} the action id
 */
export async function enqueueAction({ kind, naturalKey, payload, version = 0 }) {
  await hydrate()
  const id = actionId(kind, naturalKey)
  const action = newAction({ id, kind, payload, version })
  queue = enqueue(queue, action)
  await replaceOutbox(queue)
  emit()
  flush()
  return id
}

/**
 * Attempt to run every due action once. Serialised (no overlapping flushes),
 * so an action can never be submitted twice concurrently — the double-submit
 * guard on top of the idempotency id.
 */
export async function flush() {
  // Claim the mutex synchronously (before any await) so two concurrent flush()
  // calls can never both proceed — the hard double-submit guard.
  if (flushing) return
  flushing = true
  try {
    await hydrate()
    if (!isOnline()) return
    const due = dueActions(queue, true)
    if (!due.length) return
    emit()
    for (const action of due) {
      const handler = handlers.get(action.kind)
      if (!handler) continue // no handler registered yet — try again next flush
      // Mark in-flight so a concurrent enqueue of the same id doesn't race it.
      queue = queue.map((a) => (a.id === action.id ? { ...a, status: 'inflight' } : a))
      let result
      try {
        await handler(action.payload, action)
        result = markAttempt(action, { ok: true })
      } catch (err) {
        result = markAttempt(action, { ok: false, error: err?.message || String(err) })
      }
      queue = queue.map((a) => (a.id === action.id ? result : a))
      await replaceOutbox(queue)
      emit()
    }
    // Housekeeping: drop completed actions and stamp the sync time.
    queue = pruneDone(queue)
    await replaceOutbox(queue)
    await setMeta('lastSyncAt', Date.now())
  } finally {
    // Releasing the mutex — this is the single owner (set synchronously above),
    // so the race warning doesn't apply.
    // eslint-disable-next-line require-atomic-updates
    flushing = false
    emit()
  }
}

/**
 * Start the connectivity listeners. Idempotent. On regaining connectivity we
 * flush; a low-frequency interval is a backstop for platforms where the online
 * event is unreliable (some Android WebViews). Returns a stop fn.
 */
export function start() {
  if (started) return () => {}
  started = true
  hydrate()

  const onOnline = () => { emit(); flush() }
  const onOffline = () => { emit() }
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
  }
  // Backstop poll — cheap, no network call, just re-checks navigator.onLine and
  // retries anything now due. 30s keeps battery cost negligible (Objective 10).
  const interval = typeof setInterval !== 'undefined'
    ? setInterval(() => { if (isOnline()) flush() }, 30_000)
    : null

  return () => {
    started = false
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
    if (interval) clearInterval(interval)
  }
}

/** Test/diagnostic reset. */
export function _reset() {
  queue = []
  flushing = false
  started = false
  hydrated = false
  handlers.clear()
  listeners.clear()
}
