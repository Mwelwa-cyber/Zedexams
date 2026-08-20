import { SystemBars, SystemBarsStyle, SystemBarType } from '@capacitor/core'
import { isNativePlatform } from './runtime'
import {
  parseCssColor,
  relativeLuminance,
  gradientLuminance,
  decideIconsDark,
} from './statusBarBrightness'

/**
 * Adaptive transparent status bar for the Android Capacitor shell.
 *
 * The system bars stay fully transparent (true edge-to-edge — see
 * capacitor.config.json + android styles.xml), so the page scrolls behind the
 * OS time / signal / Wi-Fi / battery icons. This module keeps those icons
 * legible by sampling the brightness of whatever content is *behind* the bar in
 * real time and flipping the OS icon appearance to dark (over light content) or
 * light (over dark content) — the behaviour you get in Google Photos / Maps /
 * YouTube.
 *
 * Design constraints honoured here:
 *  • Performance — sampling is rAF-throttled, skips no-op scrolls, reads at most
 *    a handful of points/ancestors per frame, and only crosses the native
 *    bridge when the decision actually flips. 60 FPS scrolling is unaffected.
 *  • Flicker-free — hysteresis (statusBarBrightness.decideIconsDark) plus a
 *    short settle delay before a flip is committed means a backdrop hovering
 *    near mid-grey, or scroll wobble, never thrashes the icon colour.
 *  • Smoothness — Android's status-bar icon appearance is a binary OS flag
 *    (light vs dark), so it cannot be cross-faded from JS. The "smooth, never
 *    noticed" feel comes from the hysteresis + ~180 ms settle, which is within
 *    the requested 150–200 ms window and matches how Material apps behave.
 *  • Theme fallback — when nothing usable shows through (everything
 *    transparent), we fall back to the active theme's brightness so the icons
 *    are still right on a plain page.
 *
 * Authoring escape hatch: any element can force the icon colour for content the
 * sampler can't cheaply read (raster banner images, video, canvas) by setting
 * `data-statusbar="light"` (force light icons — element is dark) or
 * `data-statusbar="dark"` (force dark icons — element is light) on the element
 * (or any ancestor) that sits under the bar.
 */

// Themes whose page background is dark → light icons by default. Keep in sync
// with the dark entries in THEMES (src/contexts/ThemeContext.jsx).
const DARK_THEMES = ['midnight']

// How long a *changed* decision must hold before we commit it to the OS. Long
// enough to swallow scroll wobble and momentary banners, short enough to feel
// instant — sits inside the requested 150–200 ms window.
const SETTLE_MS = 180

// X sample columns (fraction of viewport width) and Y sample rows (px from the
// top, inside the typical 24–48 px status-bar band). Sampling a small grid and
// averaging keeps a single dark word/icon under the bar from swinging the whole
// decision. Three columns × two rows = six cheap elementFromPoint hits.
const SAMPLE_COLS = [0.18, 0.5, 0.82]
const SAMPLE_ROWS = [6, 18]

// Cap the ancestor walk when resolving an element's effective background so a
// deep DOM can't make a sample expensive.
const MAX_ANCESTOR_WALK = 12

let initialized = false
let currentIconsDark = null // last decision pushed to the OS (true = dark icons)
let pendingIconsDark = null // decision waiting out the settle window
let settleTimer = null
let rafScheduled = false

function themeIsDark() {
  if (typeof document === 'undefined') return false
  return DARK_THEMES.some((t) => document.body.classList.contains(`theme-${t}`))
}

/**
 * Resolve the effective luminance under one sample point, or null if it can't
 * be read cheaply. Honours an explicit `data-statusbar` override on the element
 * or any ancestor, then a solid background colour, then a parseable gradient,
 * walking up the tree until it finds an opaque backdrop.
 * @returns {{ luminance: number|null, override: boolean|null }}
 */
function sampleAt(x, y) {
  if (typeof document.elementFromPoint !== 'function') {
    return { luminance: null, override: null }
  }
  let el = document.elementFromPoint(x, y)
  let steps = 0
  while (el && el !== document.documentElement && steps < MAX_ANCESTOR_WALK) {
    // 1) Explicit author override wins immediately.
    const flag = el.dataset ? el.dataset.statusbar : null
    if (flag === 'light') return { luminance: null, override: false } // dark content → light icons
    if (flag === 'dark') return { luminance: null, override: true } // light content → dark icons

    const cs = window.getComputedStyle(el)

    // 2) Solid background colour.
    const bg = parseCssColor(cs.backgroundColor)
    if (bg) return { luminance: relativeLuminance(bg), override: null }

    // 3) Gradient background (linear/radial/conic) — average its stops.
    const gl = gradientLuminance(cs.backgroundImage)
    if (gl != null) return { luminance: gl, override: null }

    el = el.parentElement
    steps += 1
  }
  return { luminance: null, override: null }
}

/**
 * Read the average brightness behind the status bar and return the icon
 * decision (true = dark icons). Falls back to the theme when nothing legible
 * shows through.
 */
function readIconsDark() {
  if (typeof window === 'undefined') return !themeIsDark()
  const width = window.innerWidth || document.documentElement.clientWidth || 360

  const lums = []
  let overrideVotes = 0
  let overrideSum = 0
  for (const colFrac of SAMPLE_COLS) {
    const x = Math.round(width * colFrac)
    for (const y of SAMPLE_ROWS) {
      const { luminance, override } = sampleAt(x, y)
      if (override != null) {
        overrideVotes += 1
        overrideSum += override ? 1 : 0
      } else if (luminance != null) {
        lums.push(luminance)
      }
    }
  }

  // An explicit override on the majority of samples wins outright — that's the
  // author telling us what's under the bar (banner image, video, …).
  if (overrideVotes > 0 && overrideVotes >= lums.length) {
    return overrideSum * 2 >= overrideVotes
  }

  if (!lums.length) {
    // Nothing readable showed through — use the theme's own brightness.
    return !themeIsDark()
  }

  const avg = lums.reduce((sum, l) => sum + l, 0) / lums.length
  return decideIconsDark(avg, currentIconsDark)
}

/** Push an icon style to the OS, but only when it actually changed. */
function commit(iconsDark) {
  if (iconsDark === currentIconsDark) return
  currentIconsDark = iconsDark
  setIconStyle(iconsDark)
}

// Set ONLY the status-bar icon appearance and never a background. We use
// @capacitor/core's built-in SystemBars plugin (which just flips
// WindowInsetsControllerCompat.setAppearanceLightStatusBars) rather than
// the legacy @capacitor/status-bar plugin: that plugin's Android class calls
// the Window APIs Android 15 deprecated for edge-to-edge
// (setStatusBarColor / getStatusBarColor / setSystemUiVisibility /
// FLAG_TRANSLUCENT_STATUS), and their mere presence in the DEX is what
// trips the Play Console "deprecated APIs for edge-to-edge" warning — so it
// must stay out of the build entirely. Nor do we use
// @capacitor-community/safe-area's setSystemBarsStyle, because that one
// *also* paints the window decor view solid white/black — which shows
// through the transparent (edge-to-edge) status bar and kills the
// transparency. SafeArea stays responsible only for bridging the bar insets
// into env(safe-area-*). Scoped to the top StatusBar so the gesture bar is
// left alone. Light = dark icons (for a light page); Dark = light icons.
function setIconStyle(iconsDark) {
  const style = iconsDark ? SystemBarsStyle.Light : SystemBarsStyle.Dark
  SystemBars.setStyle({ style, bar: SystemBarType.StatusBar }).catch(() => {})
}

/**
 * Evaluate the backdrop and, if the decision changed, hold it for the settle
 * window before committing — so transient backgrounds and scroll wobble don't
 * flip the icons. An evaluation that agrees with the live state cancels any
 * pending flip.
 */
function evaluate() {
  const next = readIconsDark()
  if (next === currentIconsDark) {
    // Backdrop matches what's on screen — drop any in-flight flip.
    if (settleTimer) {
      clearTimeout(settleTimer)
      settleTimer = null
      pendingIconsDark = null
    }
    return
  }
  if (next === pendingIconsDark) return // already waiting on this exact flip
  pendingIconsDark = next
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    pendingIconsDark = null
    commit(next)
  }, SETTLE_MS)
}

/** rAF-throttled scroll/resize entry point — at most one evaluation per frame. */
function scheduleEvaluate() {
  if (rafScheduled) return
  rafScheduled = true
  window.requestAnimationFrame(() => {
    rafScheduled = false
    evaluate()
  })
}

/**
 * Start the adaptive status-bar manager. No-ops on the web and off the native
 * platform, and is safe to call more than once.
 */
export function initAdaptiveStatusBar() {
  if (initialized) return
  if (!isNativePlatform()) return
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  initialized = true

  // First paint: commit immediately (no settle) so the icons are right before
  // the first scroll.
  currentIconsDark = readIconsDark()
  setIconStyle(currentIconsDark)

  // Re-sample as content moves behind the bar.
  window.addEventListener('scroll', scheduleEvaluate, { passive: true })
  window.addEventListener('resize', scheduleEvaluate, { passive: true })
  // Route changes / layout shifts (header reveal-hide, theme switch, modals)
  // change what's under the bar without a scroll — re-evaluate on DOM mutations,
  // coalesced through the same rAF gate.
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(scheduleEvaluate)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ['class', 'data-statusbar', 'style'],
      childList: true,
      subtree: true,
    })
  }
}

// Test seam: lets the unit test reset module state between cases. Not used by
// the app.
export function __resetAdaptiveStatusBarForTest() {
  initialized = false
  currentIconsDark = null
  pendingIconsDark = null
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = null
  rafScheduled = false
}
