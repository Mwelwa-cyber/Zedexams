import { App as CapacitorApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { isNativePlatform } from './runtime'

let initialized = false

/**
 * Initialise the Capacitor wrapper-only behaviours (status bar, hardware
 * back button). No-ops on the web. Safe to call multiple times.
 */
export function initNativeShell() {
  if (initialized) return
  if (!isNativePlatform()) return
  initialized = true

  // Status-bar *icon* appearance only. Style.Dark means "dark status bar" —
  // i.e. light/white icons — which reads correctly over the brand violet bar.
  // This routes through WindowInsetsControllerCompat (not deprecated).
  //
  // The bar *background* colour is owned by the edge-to-edge plugin
  // (capacitor.config.json → plugins.EdgeToEdge.backgroundColor), which paints
  // overlay views behind the WebView. We deliberately no longer call
  // StatusBar.setBackgroundColor / setOverlaysWebView here: on Android 15/16
  // edge-to-edge is enforced and those go through the deprecated
  // Window.setStatusBarColor path (a no-op on-device, and it left two edge-to-
  // edge systems fighting over the bars — the violet never actually rendered).
  StatusBar.setStyle({ style: Style.Dark }).catch(() => {})

  // Android hardware back button: rely on Capacitor's own canGoBack
  // signal (it tracks the WebView's history) — window.history.length is
  // unreliable because the SPA's initial entry can read as length 1 even
  // after several pushState calls. Without this, every back press
  // hit the "no history → exit" branch.
  CapacitorApp.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back()
    } else {
      CapacitorApp.exitApp()
    }
  }).catch(() => {})
}
