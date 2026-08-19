/**
 * Stop Firebase Auth's IndexedDB persistence tearing itself down on
 * `visibilitychange`.
 *
 * ## The failure
 *
 * `@firebase/auth`'s `IndexedDBLocalPersistence` registers three lifecycle
 * listeners the first time anything subscribes to it:
 *
 *   window.addEventListener('pagehide',       onPageHide)
 *   window.addEventListener('pageshow',       onPageShow)
 *   document.addEventListener('visibilitychange', onVisibilityChange)
 *
 * and `onVisibilityChange` calls `onPageHide()` on every `hidden` transition.
 * `onPageHide` sets `isHiding = true` and closes the database, after which
 * `_openDb()` throws `Database is closing/hidden` and `_withRetries()`
 * deliberately does NOT retry while `isHiding` is set.
 *
 * Auth initialisation writes to that database — `initializeCurrentUser()`
 * reloads the persisted user and, on a non-network error, clears it through
 * `removeCurrentUser()` → `_openDb()`. If the tab hides while that write is in
 * flight the write throws, `_initializationPromise` rejects, `_isInitialized`
 * is never set, and `notifyAuthListeners()` becomes a permanent no-op: from
 * there `onAuthStateChanged` never fires again for the life of the page. That
 * is Sentry PYTHON-K (`Database is closing/hidden`, thrown from `_openDb`
 * inside `removeCurrentUser` during `reloadAndSetCurrentUserOrClear`) and
 * PYTHON-N ("Auth initialisation never completed") — one incident, two issues.
 *
 * The trigger is the part that makes it common rather than exotic: switching
 * tabs, minimising the window, an incoming call, or the screen simply locking
 * is enough. None of those end the page, and all of them are ordinary on the
 * mobile links most ZedExams learners are on.
 *
 * ## The fix
 *
 * A hidden page is not a closing page. Persistence is torn down only when the
 * page is genuinely going away and is NOT eligible to come back — `pagehide`
 * with `event.persisted === false`. A bfcache-eligible `pagehide`
 * (`persisted === true`) is left alone too: that page can be restored intact,
 * and closing the database under it reproduces the same wedge one `pageshow`
 * later.
 *
 * This patches the persistence class's own listener registration rather than
 * wrapping `document.addEventListener` globally, so nothing else on the page
 * changes behaviour. It is applied in `firebase/config.js` at module load —
 * BEFORE `setPersistence`, and therefore before the SDK can register the
 * listeners it replaces (they are registered lazily, on the first
 * `_addListener`).
 *
 * The patch is deliberately additive-free: it re-uses the instance's own
 * `onPageHide` / `onPageShow` handlers, so whatever those do stays exactly the
 * same. The only thing that changes is WHEN they are called.
 */

/**
 * Should a lifecycle event tear persistence down?
 *
 * Pure so the policy is testable without a DOM or a Firebase instance — the
 * whole bug is a wrong answer to this one question.
 *
 * @param {string} type            DOM event type ('pagehide' | 'visibilitychange' | …)
 * @param {{persisted?: boolean}} [event]
 * @returns {boolean}
 */
export function shouldTearDownPersistence(type, event) {
  // The page is going away for good. Closing the database is free — nothing
  // will read it again, and a restored page gets a fresh one.
  if (type === 'pagehide') return event?.persisted === false
  // Everything else — visibilitychange above all — leaves a live page behind
  // that still needs its database.
  return false
}

/** Marker so a double-invocation (HMR, a re-imported module) is a no-op. */
export const HARDENED_FLAG = '__zedexamsLifecycleHardened'

/**
 * Replace `registerLifecycleListeners` / `unregisterLifecycleListeners` on a
 * persistence class so teardown follows `shouldTearDownPersistence`.
 *
 * @param {Function} persistenceClass  The exported `indexedDBLocalPersistence`
 *   (which is the CLASS, not an instance — the SDK instantiates it lazily).
 * @returns {boolean} whether the patch was applied now (false = already applied
 *   or the class does not have the shape this patch understands).
 */
export function hardenAuthPersistenceLifecycle(persistenceClass) {
  const proto = persistenceClass?.prototype
  // Fail SAFE, not closed: if a future SDK drops or renames these methods we
  // leave the SDK exactly as it is rather than half-patching it. The watchdog
  // + retry ladder in AuthContext still cover the wedge; a broken patch would
  // not.
  if (!proto) return false
  if (proto[HARDENED_FLAG]) return false
  if (typeof proto.registerLifecycleListeners !== 'function') return false
  if (typeof proto.unregisterLifecycleListeners !== 'function') return false

  // Per-instance handler pair, so unregister removes the exact functions
  // register added. A WeakMap rather than an instance property because the
  // instance is the SDK's, not ours.
  const handlers = new WeakMap()

  proto.registerLifecycleListeners = function registerLifecycleListeners() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return
    if (handlers.has(this)) return
    const onPageHide = (event) => {
      if (!shouldTearDownPersistence('pagehide', event)) return
      this.onPageHide?.()
    }
    // `pageshow` is kept as-is. It only ever CLEARS `isHiding`, so leaving it
    // bound is the recovering direction: a page restored from bfcache after
    // some other code set the flag still comes back usable.
    const onPageShow = () => { this.onPageShow?.() }
    handlers.set(this, { onPageHide, onPageShow })
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('pageshow', onPageShow)
    // NOTE the omission: no `visibilitychange` listener. That is the fix.
  }

  proto.unregisterLifecycleListeners = function unregisterLifecycleListeners() {
    const bound = handlers.get(this)
    if (!bound) return
    handlers.delete(this)
    if (typeof window === 'undefined' || typeof window.removeEventListener !== 'function') return
    window.removeEventListener('pagehide', bound.onPageHide)
    window.removeEventListener('pageshow', bound.onPageShow)
  }

  Object.defineProperty(proto, HARDENED_FLAG, { value: true, enumerable: false })
  return true
}
