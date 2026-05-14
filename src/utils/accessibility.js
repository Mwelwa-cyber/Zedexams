/**
 * Accessibility preferences — reduced motion, font scale, high contrast.
 *
 * Preferences live in localStorage under a single namespaced key. The
 * resulting CSS toggles ride on <body> data-attributes so existing
 * stylesheets can target them with `body[data-a11y-motion="reduced"] *`.
 *
 * Defaults are conservative: nothing is forced on until the learner opts
 * in. `applyAccessibilityPrefs` is also called once at module load so the
 * very first render respects a stored preference (no flash of unstyled
 * content on reload).
 */

const STORAGE_KEY = 'zedexams:a11y:v1'

export const DEFAULT_A11Y_PREFS = Object.freeze({
  reducedMotion: false,
  highContrast: false,
  fontScale: 'medium', // 'small' | 'medium' | 'large'
})

const FONT_SCALE_VALUES = new Set(['small', 'medium', 'large'])

function normalizePrefs(input) {
  const next = { ...DEFAULT_A11Y_PREFS }
  if (!input || typeof input !== 'object') return next
  if (typeof input.reducedMotion === 'boolean') next.reducedMotion = input.reducedMotion
  if (typeof input.highContrast === 'boolean') next.highContrast = input.highContrast
  if (FONT_SCALE_VALUES.has(input.fontScale)) next.fontScale = input.fontScale
  return next
}

export function loadAccessibilityPrefs() {
  if (typeof window === 'undefined') return { ...DEFAULT_A11Y_PREFS }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...DEFAULT_A11Y_PREFS }
    return normalizePrefs(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_A11Y_PREFS }
  }
}

export function saveAccessibilityPrefs(prefs) {
  const normalized = normalizePrefs(prefs)
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
    } catch {
      // localStorage may be disabled (Safari private). Settings still
      // apply for the current session — they just won't persist.
    }
  }
  applyAccessibilityPrefs(normalized)
  return normalized
}

export function applyAccessibilityPrefs(prefs = loadAccessibilityPrefs()) {
  if (typeof document === 'undefined') return
  const body = document.body
  if (!body) return
  const normalized = normalizePrefs(prefs)
  body.dataset.a11yMotion = normalized.reducedMotion ? 'reduced' : 'normal'
  body.dataset.a11yContrast = normalized.highContrast ? 'high' : 'normal'
  body.dataset.a11yFont = normalized.fontScale
}

// Apply on module load so a saved preference takes effect before any
// React tree mounts. This keeps the first paint matching the user's
// stored choice.
applyAccessibilityPrefs()
