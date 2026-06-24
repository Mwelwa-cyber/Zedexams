import { App as CapacitorApp } from '@capacitor/app'
import { StatusBar, Style } from '@capacitor/status-bar'
import { EdgeToEdge } from '@capawesome/capacitor-android-edge-to-edge-support'
import { isNativePlatform } from './runtime'

let initialized = false

// Per-theme page background. The system status/navigation bars are painted to
// match the page behind them so the chrome reads as one seamless surface
// (the glass header/bottom-nav are translucent over this same colour). Keep in
// sync with the --bg values in src/index.css.
const THEME_BG = {
  sky: '#F0F9FF',
  lavender: '#F5F3FF',
  midnight: '#0F172A',
  oatmeal: '#FDF6EC',
  vivid: '#1A0B3D',
  solar: '#FFFBEB',
}
const DEFAULT_BG = THEME_BG.oatmeal

// Themes whose page background is dark — over those the status-bar icons must
// be light. Everything else is a light palette → dark icons.
const DARK_THEMES = ['midnight', 'vivid']

function activeThemeId() {
  if (typeof document === 'undefined') return null
  for (const id of Object.keys(THEME_BG)) {
    if (document.body.classList.contains(`theme-${id}`)) return id
  }
  return null
}

// Paint the system bars to match the current theme and flip the status-bar
// icon colour so the OS network/time/battery + back/home icons stay legible.
// Style.Dark = light icons (for a dark bar); Style.Light = dark icons.
function syncSystemBars() {
  const id = activeThemeId()
  const color = (id && THEME_BG[id]) || DEFAULT_BG
  EdgeToEdge.setBackgroundColor({ color }).catch(() => {})
  const style = DARK_THEMES.includes(id) ? Style.Dark : Style.Light
  StatusBar.setStyle({ style }).catch(() => {})
}

/**
 * Initialise the Capacitor wrapper-only behaviours (system-bar colour + insets,
 * status-bar icon colour, hardware back button). No-ops on the web. Safe to
 * call multiple times.
 */
export function initNativeShell() {
  if (initialized) return
  if (!isNativePlatform()) return
  initialized = true

  // NOTE: we deliberately keep the @capawesome edge-to-edge plugin ENABLED.
  // It reads the real system-bar insets natively and keeps the WebView clear of
  // them — Android WebView does NOT surface the navigation/status-bar height to
  // CSS env(safe-area-inset-*) (only display cutouts), so a "draw under fully
  // transparent bars" approach leaves the bottom nav and page content hidden
  // behind the on-screen back/home buttons. Letting the plugin inset the WebView
  // and painting the bars to match the page background gives a clean, seamless
  // look with no overlap.
  syncSystemBars()

  // Repaint the bars whenever the theme (body class) changes — covers the theme
  // switcher and the public-route brand-default pin.
  if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
    const observer = new MutationObserver(syncSystemBars)
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
