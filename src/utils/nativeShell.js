import { App as CapacitorApp } from '@capacitor/app'
import { SafeArea, SystemBarsStyle } from '@capacitor-community/safe-area'
import { isNativePlatform } from './runtime'

let initialized = false

// Themes whose page background is dark — over those the system-bar icons must
// be light. Everything else is a light palette → dark icons. Keep in sync with
// the dark entries in THEMES (src/contexts/ThemeContext.jsx).
const DARK_THEMES = ['midnight', 'vivid']

function themeIsDark() {
  if (typeof document === 'undefined') return false
  return DARK_THEMES.some((t) => document.body.classList.contains(`theme-${t}`))
}

// The system bars are fully transparent (true edge-to-edge) — the page draws
// underneath them and @capacitor-community/safe-area feeds the real bar insets
// into CSS env(safe-area-inset-*) so content stays clear of the icons. All we
// own here is the *content* (icon) style so the OS network/time/battery +
// back/home icons stay legible over whatever shows through.
// SystemBarsStyle.Light = dark icons (for a light page); .Dark = light icons.
function syncSystemBarIcons() {
  const style = themeIsDark() ? SystemBarsStyle.Dark : SystemBarsStyle.Light
  SafeArea.setSystemBarsStyle({ style }).catch(() => {})
}

/**
 * Initialise the Capacitor wrapper-only behaviours (system-bar icon colour,
 * hardware back button). Edge-to-edge + inset handling is owned natively by
 * MainActivity + the SafeArea plugin. No-ops on the web. Safe to call multiple
 * times.
 */
export function initNativeShell() {
  if (initialized) return
  if (!isNativePlatform()) return
  initialized = true

  // Flip the bar icon colour to match the active theme, and re-run whenever the
  // theme (body class) changes — covers the theme switcher and the public-route
  // brand-default pin.
  syncSystemBarIcons()
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const observer = new MutationObserver(syncSystemBarIcons)
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
