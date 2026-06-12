import { useEffect, useState } from 'react'
import { isNativePlatform } from '../utils/runtime'

/**
 * usePwaUpdate — bridges vite-plugin-pwa's registerSW into React state
 * (audit A1.2).
 *
 * Returns:
 *   - updateReady: true when a new SW is waiting and the user can update.
 *   - update():     trigger the swap (skipWaiting + reload).
 *   - dismiss():    hide the prompt for this session — useful if the user
 *                   is mid-task and doesn't want to lose state. The next
 *                   SW_RELOAD_REQUEST message (e.g. on next deploy) will
 *                   re-show.
 *
 * Skipped entirely on native (Capacitor): the wrapper bundles assets at
 * build time and never runs a SW, so there's nothing to update.
 *
 * The dynamic import means the virtual:pwa-register module isn't loaded
 * inside the Capacitor wrapper at all — keeps the bundle a hair smaller
 * and avoids a console warning when the virtual module errors out.
 *
 * Update detection strategy:
 *   1. A 30-minute poll via setInterval ensures a long-open tab finds a
 *      new build without the user touching anything.
 *   2. A visibilitychange listener re-checks when the user switches away
 *      from the tab and back (covers the "reopened PWA" case).
 *   3. sw-reload-clients.js posts SW_RELOAD_REQUEST when a new SW
 *      activates; we surface the "New version available" prompt so the
 *      user can reload at a safe moment.
 *
 * The focus event is intentionally NOT used as an update trigger. Opening
 * an OS file picker (e.g. during document import) fires focus/blur on the
 * browser window; if the update check found a waiting SW at that moment it
 * would activate + reload the page mid-import, destroying the operation.
 * The visibilitychange + 30-min timer are sufficient for freshness without
 * that risk.
 */
export function usePwaUpdate() {
  const [updateReady, setUpdateReady] = useState(false)
  const [updateFn, setUpdateFn] = useState(() => () => Promise.resolve())
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    // TEMPORARY: Disable SW registration to force fresh content loading
    // Remove this block once caching issues are resolved
    if (isNativePlatform()) return
    return  // <- Force early exit; disables SW for web too during debug
    let cancelled = false
    // Proactive update plumbing — torn down on unmount. With autoUpdate the
    // plugin activates on its own once a new SW is found; these only make
    // sure a long-open / idle tab *finds* the new SW promptly instead of
    // waiting for a fresh navigation (browsers otherwise auto-check ~daily).
    let pollId = null
    let onVisible = null
    // Handle SW_RELOAD_REQUEST from sw-reload-clients.js. The SW posts this
    // when a new build activates so the page can reload at a safe moment
    // rather than being hard-navigated mid-operation.
    let onSwMessage = null
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (cancelled) return
        const update = registerSW({
          onNeedRefresh() {
            if (cancelled) return
            console.info('[pwa] new version available — prompt user')
            setUpdateReady(true)
          },
          onOfflineReady() {
            console.info('[pwa] app ready to work offline')
          },
          onRegisteredSW(swScriptUrl, registration) {
            // registration is undefined if the browser refused to register.
            if (cancelled || !registration) return
            const check = () => { registration.update().catch(() => {}) }
            // Re-check on a 30-minute timer so a tab left open for hours
            // still picks up a deploy without the user touching anything.
            pollId = setInterval(check, 30 * 60 * 1000)
            // And when the tab becomes visible again after being hidden
            // (user switched away and came back). This covers the main
            // "reopened PWA / returned to idle tab" case without the risk
            // of firing during file-picker open/close cycles.
            // NOTE: the focus event is deliberately NOT used — it fires
            // when an OS file picker closes and returns control to the
            // browser window. Triggering a SW update check at that moment
            // can cause an in-progress document import to be interrupted
            // by a page reload if a new SW was found and activated.
            onVisible = () => { if (document.visibilityState === 'visible') check() }
            document.addEventListener('visibilitychange', onVisible)

            // Listen for SW_RELOAD_REQUEST from sw-reload-clients.js so
            // the page can show "New version available" and reload when
            // no long-running operation is in flight.
            if (navigator.serviceWorker) {
              onSwMessage = (event) => {
                if (cancelled) return
                if (event.data?.type === 'SW_RELOAD_REQUEST') {
                  console.info('[pwa] SW requested reload — surfacing update prompt')
                  setUpdateReady(true)
                  setDismissed(false)
                }
              }
              navigator.serviceWorker.addEventListener('message', onSwMessage)
            }
          },
          onRegisterError(err) {
            console.warn('[pwa] SW registration failed:', err)
          },
        })
        if (!cancelled) {
          // registerSW returns the swap function. Wrap it so a click on
          // "Update" also reloads — virtual:pwa-register can be configured
          // to reload, but doing it explicitly here keeps the contract
          // obvious to anyone reading this hook.
          setUpdateFn(() => async () => {
            try { await update(true) } catch (e) { console.warn('[pwa] update failed:', e) }
            // Belt-and-braces: vite-plugin-pwa already triggers
            // window.location.reload() when skipWaiting completes, but
            // explicit reload covers edge cases (e.g. failed claim).
            window.location.reload()
          })
        }
      })
      .catch((err) => {
        console.warn('[pwa] failed to load registerSW:', err)
      })
    return () => {
      cancelled = true
      if (pollId) clearInterval(pollId)
      if (onVisible) document.removeEventListener('visibilitychange', onVisible)
      if (onSwMessage && navigator.serviceWorker) {
        navigator.serviceWorker.removeEventListener('message', onSwMessage)
      }
    }
  }, [])

  return {
    updateReady: updateReady && !dismissed,
    update: updateFn,
    dismiss: () => setDismissed(true),
  }
}
