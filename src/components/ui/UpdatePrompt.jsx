import { useRegisterSW } from 'virtual:pwa-register/react'
import { isNativePlatform } from '../../utils/runtime'

/**
 * Service-worker update prompt (audit A1.2).
 *
 * Drives two lifecycle events from vite-plugin-pwa's React hook:
 *  1. First-mount registration of the SW (replacing the manual
 *     registerSW() call previously in main.jsx). useRegisterSW dedupes
 *     internally, so it's safe even if React StrictMode mounts twice
 *     in dev.
 *  2. needRefresh — triggered when Workbox detects a newer SW waiting.
 *     A non-blocking toast at the bottom of the viewport asks the user
 *     to refresh; clicking calls updateServiceWorker(true) which
 *     reloads the page with the new SW active.
 *
 * vite.config.js sets registerType: 'prompt' so the new SW never
 * silently claims open tabs — the user always controls when to switch.
 *
 * Capacitor: returns null on native. The wrapper serves bundled
 * assets from a local origin where SWs aren't useful, and useRegisterSW
 * would attempt registration anyway. Skipping the entire component is
 * cleaner than trying to gate the hook itself.
 *
 * Print-hidden via the existing data-print="hide" attribute (per
 * src/index.css print rules).
 */
export default function UpdatePrompt() {
  // Capacitor short-circuit must come BEFORE the hook call so the SW
  // never tries to register inside the WebView. This is safe because
  // isNativePlatform() returns a stable value for the lifetime of the
  // app — we won't violate the rules-of-hooks order across renders.
  if (isNativePlatform()) return null

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(err) {
      console.warn('[pwa] SW registration failed:', err)
    },
    onOfflineReady() {
      // First successful install — the existing OfflineBanner already
      // signals offline state, so we don't need a separate toast here.
      console.info('[pwa] app ready to work offline')
    },
  })

  if (!needRefresh) return null

  function applyUpdate() {
    setNeedRefresh(false)
    updateServiceWorker(true)
  }

  function dismiss() {
    setNeedRefresh(false)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      data-print="hide"
      className="fixed inset-x-0 bottom-4 z-[100] mx-auto max-w-md px-4"
    >
      <div className="theme-accent-fill theme-on-accent shadow-elev-lg flex items-center justify-between gap-3 rounded-2xl px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-bold leading-tight">New version ready</p>
          <p className="text-xs leading-snug opacity-80">Refresh to get the latest changes.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={dismiss}
            className="rounded-full border border-white/40 bg-transparent px-3 py-1.5 text-xs font-bold shadow-none hover:bg-white/10"
          >
            Later
          </button>
          <button
            type="button"
            onClick={applyUpdate}
            className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-black shadow-none hover:opacity-90"
          >
            Refresh
          </button>
        </div>
      </div>
    </div>
  )
}
