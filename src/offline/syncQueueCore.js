/**
 * syncQueueCore — the pure brain of the offline synchronisation engine.
 *
 * No browser APIs, no Firestore, no timers — just the queue model and the
 * retry / dedup / conflict maths, unit-tested under plain `node` (see
 * syncQueueCore.test.js). syncEngine.js owns the connectivity listeners,
 * Firestore writes, and the actual `setTimeout` retry loop; it calls these
 * helpers to decide *when* and *whether* to act.
 *
 * A queued action (an "outbox" entry):
 *   {
 *     id,             // stable idempotency key — dedup + prevent double-submit
 *     kind,           // 'quiz-result' | 'draft' | 'progress' | …
 *     payload,        // JSON-safe body to write to Firestore
 *     createdAt,      // enqueued (ms)
 *     updatedAt,      // last attempt (ms)
 *     version,        // client version for conflict resolution (LWW)
 *     attempts,       // retry counter
 *     status,         // 'pending' | 'inflight' | 'done' | 'failed'
 *     nextAttemptAt,  // earliest ms to retry (backoff)
 *     lastError,      // diagnostic string
 *   }
 */

export const MAX_ATTEMPTS = 8
const BASE_DELAY = 2000 // 2s, matches the repo's push-retry backoff convention
const MAX_DELAY = 5 * 60 * 1000 // cap backoff at 5 minutes

/**
 * Deterministic idempotency key so the SAME logical action never enqueues (or
 * submits) twice — the core defence against duplicate submissions (Objective
 * 11). Callers pass a natural key: e.g. `quiz-result:${quizId}:${uid}:${attempt}`.
 * @param {string} kind
 * @param {string} naturalKey
 * @returns {string}
 */
export function actionId(kind, naturalKey) {
  return `${kind}:${naturalKey}`
}

/**
 * Build a new queued action in the 'pending' state.
 * @param {object} spec
 * @returns {object}
 */
export function newAction({ id, kind, payload, version = 0, now = Date.now() }) {
  return {
    id: id || actionId(kind, String(now)),
    kind,
    payload,
    version: Number(version) || 0,
    createdAt: now,
    updatedAt: now,
    attempts: 0,
    status: 'pending',
    nextAttemptAt: now,
    lastError: null,
  }
}

/**
 * Insert `action` into the queue, deduping by id. An existing PENDING/FAILED
 * entry with the same id is REPLACED (the newer payload wins — e.g. a fresher
 * quiz snapshot), preserving the original createdAt + attempt count so backoff
 * isn't reset by a save-on-every-answer loop. An already-DONE entry is left
 * alone so a replayed action can't resurrect. Returns a new array.
 * @param {object[]} queue
 * @param {object} action
 * @returns {object[]}
 */
export function enqueue(queue = [], action) {
  const idx = queue.findIndex((a) => a.id === action.id)
  if (idx === -1) return [...queue, action]
  const existing = queue[idx]
  if (existing.status === 'done') return queue // never re-queue a completed action
  const merged = {
    ...existing,
    payload: action.payload,
    version: Math.max(existing.version || 0, action.version || 0),
    updatedAt: action.updatedAt || action.createdAt,
    status: 'pending',
  }
  const next = queue.slice()
  next[idx] = merged
  return next
}

/**
 * Exponential backoff with a hard ceiling, mirroring the git-push retry policy
 * documented for this repo (2s, 4s, 8s, 16s, …). Deterministic (no jitter) so
 * it's testable; syncEngine may add jitter at the timer if a thundering-herd
 * ever matters.
 * @param {number} attempts number of failed attempts so far (0-based)
 * @returns {number} delay in ms
 */
export function backoffDelay(attempts) {
  const n = Math.max(0, Number(attempts) || 0)
  return Math.min(BASE_DELAY * 2 ** n, MAX_DELAY)
}

/**
 * Record the outcome of an attempt. Success → 'done'. Failure → either
 * re-scheduled with backoff, or 'failed' once MAX_ATTEMPTS is exhausted (so a
 * poison message can't spin forever and block the queue). Pure; returns a new
 * action.
 * @param {object} action
 * @param {{ ok: boolean, error?: string, now?: number }} result
 * @returns {object}
 */
export function markAttempt(action, { ok, error = null, now = Date.now() } = {}) {
  if (ok) {
    return { ...action, status: 'done', updatedAt: now, lastError: null }
  }
  const attempts = (action.attempts || 0) + 1
  const exhausted = attempts >= MAX_ATTEMPTS
  return {
    ...action,
    attempts,
    updatedAt: now,
    status: exhausted ? 'failed' : 'pending',
    // attempts-1 so the FIRST retry waits backoffDelay(0)=2s, matching the
    // repo's documented 2s/4s/8s/16s push-retry policy.
    nextAttemptAt: exhausted ? action.nextAttemptAt : now + backoffDelay(attempts - 1),
    lastError: error ? String(error) : action.lastError,
  }
}

/**
 * The actions that are eligible to run right now: pending, not in-flight, and
 * past their backoff window. Ordered oldest-first (FIFO) so a learner's earlier
 * results upload before later ones.
 * @param {object[]} queue
 * @param {boolean} online is the device online?
 * @param {number} now
 * @returns {object[]}
 */
export function dueActions(queue = [], online, now = Date.now()) {
  if (!online) return []
  return queue
    .filter((a) => a.status === 'pending' && (a.nextAttemptAt || 0) <= now)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

/** Count of actions still waiting to sync (drives the "Waiting to Sync" badge). */
export function pendingCount(queue = []) {
  return queue.filter((a) => a.status === 'pending' || a.status === 'inflight').length
}

/**
 * Drop completed actions from the queue (housekeeping after a flush). Keeps
 * pending/inflight/failed so nothing in flight or needing attention is lost.
 * @param {object[]} queue
 * @returns {object[]}
 */
export function pruneDone(queue = []) {
  return queue.filter((a) => a.status !== 'done')
}

/**
 * Conflict resolution for a record that changed both locally (queued) and
 * remotely (already in Firestore) while offline. Last-write-wins by version
 * then timestamp — the same LWW rule the Universal Draft Manager uses
 * (pickFreshestDraft), applied to sync actions. Returns which side to keep.
 *
 * A higher `version` always wins. On equal version, the newer `updatedAt`
 * wins. On a dead tie, REMOTE wins — never clobber server state on a
 * coin-flip (safer for shared/graded data).
 * @param {{ version?: number, updatedAt?: number }} local
 * @param {{ version?: number, updatedAt?: number }} remote
 * @returns {'local'|'remote'}
 */
export function resolveConflict(local, remote) {
  if (!remote) return 'local'
  if (!local) return 'remote'
  const lv = Number(local.version) || 0
  const rv = Number(remote.version) || 0
  if (lv !== rv) return lv > rv ? 'local' : 'remote'
  const lt = Number(local.updatedAt) || 0
  const rt = Number(remote.updatedAt) || 0
  if (lt !== rt) return lt > rt ? 'local' : 'remote'
  return 'remote'
}
