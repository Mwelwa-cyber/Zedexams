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
 *                   firing of onNeedRefresh (e.g. on next deploy) will
 *                   re-show.
 *
 * Skipped entirely on native (Capacitor): the wrapper bundles assets at
 * build time and never runs a SW, so there's nothing to update.
 *
 * The dynamic import means the virtual:pwa-register module isn't loaded
 * inside the Capacitor wrapper at all — keeps the bundle a hair smaller
 * and avoids a console warning when the virtual module errors out.
 */
export function usePwaUpdate() {
  const [updateReady, setUpdateReady] = useState(false)
  const [updateFn, setUpdateFn] = useState(() => () => Promise.resolve())
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (isNativePlatform()) return
    let cancelled = false
    // Proactive update plumbing — torn down on unmount. With autoUpdate the
    // plugin activates + reloads on its own once a new SW is found; these only
    // make sure a long-open / idle tab *finds* the new SW promptly instead of
    // waiting for a fresh navigation (browsers otherwise auto-check ~daily).
    let pollId = null
    let onVisible = null
    let onFocus = null
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
            // Re-check on a timer so a tab left open for hours still picks up
            // a deploy without the user touching anything.
            pollId = setInterval(check, 30 * 60 * 1000)
            // And the instant the tab regains focus, so coming back to an
            // already-open app after a deploy lands the new build right away.
            onVisible = () => { if (document.visibilityState === 'visible') check() }
            onFocus = check
            document.addEventListener('visibilitychange', onVisible)
            window.addEventListener('focus', onFocus)
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
      if (onFocus) window.removeEventListener('focus', onFocus)
    }
  }, [])

  return {
    updateReady: updateReady && !dismissed,
    update: updateFn,
    dismiss: () => setDismissed(true),
  }
}
