import { App as CapacitorApp } from '@capacitor/app'
import { isNativePlatform } from './runtime'
import { initAdaptiveStatusBar } from './statusBarManager'

let initialized = false

/**
 * Initialise the Capacitor wrapper-only behaviours (adaptive system-bar icon
 * colour, hardware back button). Edge-to-edge + inset handling is owned
 * natively by MainActivity + the SafeArea plugin. No-ops on the web. Safe to
 * call multiple times.
 */
export function initNativeShell() {
  if (initialized) return
  if (!isNativePlatform()) return
  initialized = true

  // Transparent status bar with icons that adapt in real time to the brightness
  // of the content scrolling behind them (see statusBarManager.js). This also
  // subsumes the old theme-only icon flip — a theme switch shows up as a body
  // class mutation, which the manager re-samples.
  initAdaptiveStatusBar()

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
