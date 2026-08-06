/**
 * The stable visitor id — one rule, now with two consumers.
 *
 * A signed-in visitor IS their uid, so a count (or a rollout bucket) survives
 * signing out and back in on the same device. An anonymous visitor gets a
 * long-lived browser id minted once and kept in localStorage.
 *
 * This moved out of `pastPaperQuiz.js` when the Assessment Engine's rollout
 * flags needed the same id (docs/phase3-plan.md §4.2 buckets on "the stable
 * visitor id the free-limit counter already mints"). Two modules deriving the
 * id separately would agree right up until one of them changed — and the
 * failure would be silent: a visitor counted as one person by the paywall and
 * a different person by the rollout, which is exactly the incoherence a
 * canary is supposed to rule out. `pastPaperQuiz.js` re-exports both names, so
 * every existing import keeps working.
 *
 * No Firebase import, deliberately: the flag resolution path must not drag the
 * SDK in, and a plain-node test can then exercise the whole thing.
 *
 * Storage is per-device by design. Clearing site data mints a new id, which
 * resets a free-preview count and can move a visitor between rollout buckets.
 * Accepted: the alternative is a server round trip on a public route to answer
 * a question that only has to be *stable*, not *unforgeable*.
 *
 * What is NOT accepted is instability while the page is open. The id has to be
 * the same on every call of one page load whether or not it could be written
 * down, which is what the memo below is for.
 */

const ANON_ID_KEY = 'zedexams:anonId'

/** The value returned when localStorage is unavailable (SSR, private mode,
 *  a browser refusing storage). Constant rather than random, so it cannot
 *  create an unbounded set of one-visit identities. */
export const NO_STORAGE_VISITOR_ID = 'anon-no-storage'

/**
 * The id this page load minted but could not persist.
 *
 * `setItem` throws under quota and in browsers that refuse storage writes while
 * still allowing reads (Safari's private mode did exactly this for years).
 * Without this memo the next call reads nothing back, mints a DIFFERENT id, and
 * an anonymous visitor moves between rollout buckets on every recompute — a
 * settings update is enough. Stability is the entire property both consumers
 * rely on, and it must not depend on the write having succeeded.
 *
 * Module-level rather than per-call, which is the right lifetime: one page load
 * is one visitor. It is never preferred over a value that IS in storage — that
 * one is shared with other tabs and survives reloads, so it wins.
 */
let mintedId = null

function safeStorage() {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage
  } catch {
    return null
  }
}

/** Stable per-browser id for anonymous visitors. Created lazily. */
export function getOrCreateAnonId() {
  const ls = safeStorage()
  if (!ls) return NO_STORAGE_VISITOR_ID
  const stored = ls.getItem(ANON_ID_KEY)
  if (stored) return stored
  if (!mintedId) {
    mintedId = `anon-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`
  }
  // Retried on every call, not only the first: quota is a state a browser can
  // leave, and the moment a write succeeds the id becomes shared with the other
  // tabs and survives the reload.
  try { ls.setItem(ANON_ID_KEY, mintedId) } catch { /* still unwritable — the memo holds */ }
  return mintedId
}

/**
 * The id every per-visitor decision keys on: the uid when there is one, the
 * browser id otherwise.
 */
export function resolveVisitorId(uid) {
  return uid || getOrCreateAnonId()
}
