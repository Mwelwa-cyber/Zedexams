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

  StatusBar.setStyle({ style: Style.Light }).catch(() => {})
  StatusBar.setBackgroundColor({ color: '#ffffff' }).catch(() => {})
  StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {})

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
