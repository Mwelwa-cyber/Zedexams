/**
 * Cross-studio handoff — passes a Visual Studio diagram into another studio
 * (Assessment / Worksheet / Lesson Plan / Notes) without a heavyweight shared
 * draft document.
 *
 * Mechanism: a small sessionStorage payload + a `?from=visual-studio` query
 * flag on the destination route. The destination studio reads the payload
 * ONCE on mount (consume = read-and-clear) so a refresh doesn't re-inject the
 * same image. sessionStorage (not localStorage) keeps it tab-scoped and
 * short-lived, and all access is guarded so private-mode / quota failures are
 * non-fatal (the brief's studios already treat storage as best-effort).
 */

export const HANDOFF_KEY = 'zedexams:visual-handoff'
export const HANDOFF_FLAG = 'visual-studio'

// Payloads older than this are ignored — a stale image from a previous session
// shouldn't pop into a brand-new paper.
const MAX_AGE_MS = 30 * 60 * 1000

function getStore() {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) return window.sessionStorage
  } catch {
    /* access can throw in sandboxed iframes */
  }
  return null
}

/**
 * Stash a visual for another studio to pick up.
 * @param {object} payload — must include at least `imageUrl`.
 * @returns {boolean} whether it was stored.
 */
export function writeVisualHandoff(payload) {
  const store = getStore()
  if (!store) return false
  if (!payload || typeof payload !== 'object' || !payload.imageUrl) return false
  try {
    store.setItem(
      HANDOFF_KEY,
      JSON.stringify({ ...payload, _ts: Date.now() }),
    )
    return true
  } catch {
    return false
  }
}

/**
 * Read AND clear the pending handoff. Returns null when absent, malformed, or
 * stale.
 * @returns {object|null}
 */
export function consumeVisualHandoff() {
  const store = getStore()
  if (!store) return null
  let raw
  try {
    raw = store.getItem(HANDOFF_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  // Always clear, even if parsing fails, so a corrupt entry can't wedge.
  try { store.removeItem(HANDOFF_KEY) } catch { /* ignore */ }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || !parsed.imageUrl) return null
    if (parsed._ts && Date.now() - Number(parsed._ts) > MAX_AGE_MS) return null
    return parsed
  } catch {
    return null
  }
}

/** Whether a destination route was reached via a Visual Studio handoff. */
export function isVisualHandoffRequest(searchParams) {
  try {
    return Boolean(searchParams && searchParams.get && searchParams.get('from') === HANDOFF_FLAG)
  } catch {
    return false
  }
}
