/**
 * Accessibility preferences — reduced motion, font scale, high contrast,
 * dyslexia-friendly font, and colour-blind-friendly mode.
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
  dyslexiaFont: false,
  colorBlind: 'none', // 'none' | 'protanopia' | 'deuteranopia' | 'tritanopia'
})

const FONT_SCALE_VALUES = new Set(['small', 'medium', 'large'])
const COLOR_BLIND_VALUES = new Set(['none', 'protanopia', 'deuteranopia', 'tritanopia'])

function normalizePrefs(input) {
  const next = { ...DEFAULT_A11Y_PREFS }
  if (!input || typeof input !== 'object') return next
  if (typeof input.reducedMotion === 'boolean') next.reducedMotion = input.reducedMotion
  if (typeof input.highContrast === 'boolean') next.highContrast = input.highContrast
  if (FONT_SCALE_VALUES.has(input.fontScale)) next.fontScale = input.fontScale
  if (typeof input.dyslexiaFont === 'boolean') next.dyslexiaFont = input.dyslexiaFont
  if (COLOR_BLIND_VALUES.has(input.colorBlind)) next.colorBlind = input.colorBlind
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

// Colour-blind daltonisation filters (feColorMatrix). Injected once and
// referenced from CSS via `filter: url(#cb-*)`. Standard correction matrices.
const CB_FILTER_TAG_ID = 'zx-a11y-colorblind-filters'
const CB_MATRICES = {
  protanopia: '0.567 0.433 0 0 0  0.558 0.442 0 0 0  0 0.242 0.758 0 0  0 0 0 1 0',
  deuteranopia: '0.625 0.375 0 0 0  0.7 0.3 0 0 0  0 0.3 0.7 0 0  0 0 0 1 0',
  tritanopia: '0.95 0.05 0 0 0  0 0.433 0.567 0 0  0 0.475 0.525 0 0  0 0 0 1 0',
}

function ensureColorBlindFilters() {
  if (typeof document === 'undefined') return
  if (document.getElementById(CB_FILTER_TAG_ID)) return
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  svg.id = CB_FILTER_TAG_ID
  svg.setAttribute('aria-hidden', 'true')
  svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden'
  for (const [name, values] of Object.entries(CB_MATRICES)) {
    const filter = document.createElementNS(ns, 'filter')
    filter.id = `cb-${name}`
    const matrix = document.createElementNS(ns, 'feColorMatrix')
    matrix.setAttribute('type', 'matrix')
    matrix.setAttribute('values', values)
    filter.appendChild(matrix)
    svg.appendChild(filter)
  }
  document.body.appendChild(svg)
}

export function applyAccessibilityPrefs(prefs = loadAccessibilityPrefs()) {
  if (typeof document === 'undefined') return
  const body = document.body
  if (!body) return
  const normalized = normalizePrefs(prefs)
  body.dataset.a11yMotion = normalized.reducedMotion ? 'reduced' : 'normal'
  body.dataset.a11yContrast = normalized.highContrast ? 'high' : 'normal'
  body.dataset.a11yFont = normalized.fontScale
  body.dataset.a11yDyslexia = normalized.dyslexiaFont ? 'on' : 'off'
  body.dataset.a11yColorblind = normalized.colorBlind
  if (normalized.colorBlind !== 'none') ensureColorBlindFilters()
}

// Apply on module load so a saved preference takes effect before any
// React tree mounts. This keeps the first paint matching the user's
// stored choice.
applyAccessibilityPrefs()
