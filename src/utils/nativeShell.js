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

  // Android hardware back button: walk the SPA history first, only exit when
  // we're already at the root entry. Without this the OS back button kills
  // the app, which is what users were hitting on the first beta.
  CapacitorApp.addListener('backButton', () => {
    if (window.history.length > 1) {
      window.history.back()
    } else {
      CapacitorApp.exitApp()
    }
  }).catch(() => {})
}
