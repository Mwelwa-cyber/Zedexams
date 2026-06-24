import { App as CapacitorApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { EdgeToEdge } from '@capawesome/capacitor-android-edge-to-edge-support'
import { isNativePlatform } from './runtime'

let initialized = false

// Themes whose page background is dark — over those, the transparent status
// bar's network/time/battery icons must be light to stay legible. Every other
// palette is light → dark icons. Keep this list in sync with the dark entries
// in THEMES (src/contexts/ThemeContext.jsx).
const DARK_THEMES = ['midnight', 'vivid']

function themeIsDark() {
  if (typeof document === 'undefined') return false
  return DARK_THEMES.some((t) => document.body.classList.contains(`theme-${t}`))
}

// Status-bar *icon* appearance. Style.Dark = "dark status bar" → light/white
// icons (for a dark background); Style.Light = dark icons (for a light
// background). We follow the active theme so the icons stay visible over
// whatever content scrolls beneath the now-transparent bar.
function syncStatusBarIcons() {
  const style = themeIsDark() ? Style.Dark : Style.Light
  StatusBar.setStyle({ style }).catch(() => {})
}

/**
 * Initialise the Capacitor wrapper-only behaviours (edge-to-edge system bars,
 * status-bar icon colour, hardware back button). No-ops on the web. Safe to
 * call multiple times.
 */
export function initNativeShell() {
  if (initialized) return
  if (!isNativePlatform()) return
  initialized = true

  // True edge-to-edge (LinkedIn-style). The @capawesome edge-to-edge plugin
  // normally insets the WebView and paints solid colour bars behind the status
  // and navigation bars. disable() drops both: it removes the WebView margins
  // (so the page draws *under* the bars) and the colour overlays (so the bars
  // are fully transparent). The OS network/time/battery + back/home icons stay
  // on top, and the safe-area CSS (env(safe-area-inset-*), viewport-fit=cover)
  // keeps content clear of them.
  EdgeToEdge.disable().catch(() => {})

  // Keep the status-bar icons readable as the theme (and route-based brand pin)
  // changes the page background. The MutationObserver re-runs on every body
  // class change — covers the theme switcher and the public-route theme pin.
  syncStatusBarIcons()
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const observer = new MutationObserver(syncStatusBarIcons)
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  }

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
