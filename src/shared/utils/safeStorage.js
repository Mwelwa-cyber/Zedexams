/**
 * The one localStorage adapter.
 *
 * ## What it consolidates
 *
 * Nine learner surfaces each kept a private read/write pair — GradeHub's seen
 * notifications, the papers hub's bookmarks and recents, the paper viewer's
 * bookmarks, two games' level progress, the settings section memory, and
 * `paperResumeStorage`'s reading position. Every one of them was correct: all
 * nine wrapped access in try/catch, because Safari private mode throws on
 * `setItem` and a storage failure must never take a screen down.
 *
 * That is exactly why they were worth consolidating. Nine correct copies of a
 * rule mean the tenth author has nine examples to copy and no single place
 * that says what the rule IS — and the copies had already drifted in what they
 * return when the stored value is present but the wrong shape (some checked
 * `Array.isArray`, some handed the caller whatever `JSON.parse` produced).
 *
 * ## The contract
 *
 * Reads never throw and never return a broken shape: a missing key, an
 * unavailable store, malformed JSON and a value of the wrong type all yield
 * the caller's fallback. Writes never throw and are best-effort — losing a
 * bookmark is always preferable to losing the screen.
 *
 * Storage keys are NOT owned here. They stay with the feature that writes
 * them, because a key is a data contract with the learner's existing device
 * and moving one silently forgets what they had.
 */

/** True when a real Storage is reachable. Server render and locked-down browsers both land here. */
function store() {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage ?? null
  } catch {
    // Some embedded webviews throw on the property access itself.
    return null
  }
}

/**
 * Raw string at `key`, or `fallback`.
 * @param {string} key
 * @param {string|null} [fallback]
 * @returns {string|null}
 */
export function readString(key, fallback = null) {
  try {
    return store()?.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

/**
 * Write a raw string. Silently does nothing when storage is unavailable or full.
 * @param {string} key
 * @param {string} value
 */
export function writeString(key, value) {
  try {
    store()?.setItem(key, String(value))
  } catch { /* quota / private mode — best-effort by contract */ }
}

/**
 * Parsed JSON at `key`, or `fallback` if absent, unreadable or malformed.
 * @template T
 * @param {string} key
 * @param {T} [fallback]
 * @returns {T}
 */
export function readJson(key, fallback = null) {
  try {
    const raw = store()?.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

/**
 * Write a JSON-serialisable value. Silently does nothing when storage is
 * unavailable, full, or the value cannot be serialised.
 * @param {string} key
 * @param {unknown} value
 */
export function writeJson(key, value) {
  try {
    store()?.setItem(key, JSON.stringify(value))
  } catch { /* quota / private mode / circular value — best-effort by contract */ }
}

/**
 * Parsed JSON at `key`, guaranteed to be an array.
 *
 * The type check is the point: three call sites stored id lists and each had
 * to remember that a stored `null`, `{}` or `"corrupted"` would otherwise flow
 * into `.includes()` or `new Set()` as-is. A wrong-shaped value reads as empty.
 *
 * @param {string} key
 * @returns {Array}
 */
export function readArray(key) {
  const parsed = readJson(key, null)
  return Array.isArray(parsed) ? parsed : []
}

/**
 * Positive integer at `key`, or null.
 * Anything non-finite, zero or negative reads as "not recorded".
 * @param {string} key
 * @returns {number|null}
 */
export function readPositiveInt(key) {
  const n = Number(readString(key))
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Remove a key. Never throws. */
export function removeKey(key) {
  try {
    store()?.removeItem(key)
  } catch { /* best-effort by contract */ }
}
