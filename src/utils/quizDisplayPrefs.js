// Quiz reading/display preferences — pure helpers (no Firebase, no React).
//
// Single source of truth for the shape of a learner's quiz-display preferences
// and the mapping from those prefs to the CSS custom properties / data-*
// attributes that the reading layer in index.css consumes. Keeping it pure
// makes the whole contract unit-testable under plain `node`
// (quizDisplayPrefs.test.js) and lets the hook, the settings sheet, and the
// live preview all read the same normalizer — so what the sheet writes, the
// runner reads back unchanged.
//
// Persistence: a nested `quizDisplayPrefs` map on the user's Firestore doc
// (users/{uid}), mirroring the learnerSettings convention, plus a localStorage
// cache (examprep:quizDisplay) so the quiz never flashes between themes on load.

const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback)
const oneOf = (v, allowed, fallback) =>
  typeof v === 'string' && allowed.includes(v) ? v : fallback

export const QUIZ_DISPLAY_STORAGE_KEY = 'examprep:quizDisplay'

/* ── Option catalogues (drive the settings sheet UI) ─────────────────────── */

export const TEXT_SIZES = Object.freeze([
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'xlarge', label: 'Extra Large' },
])

export const LINE_SPACING = Object.freeze([
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'wide', label: 'Wide' },
])

export const QUIZ_THEMES = Object.freeze([
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'high-contrast', label: 'High Contrast' },
])

// Learner-selectable highlight swatches. All are pale/warm enough to keep dark
// text readable on top (WCAG AA for body text), so a learner can never pick a
// highlight that hides the highlighted word. 'none' does NOT remove intentional
// <mark>s — it falls back to the system default (see resolveQuizDisplayVars).
export const HIGHLIGHT_COLOURS = Object.freeze([
  { value: 'yellow', label: 'Yellow', swatch: '#ffe58a' },
  { value: 'green', label: 'Green', swatch: '#bff0c6' },
  { value: 'blue', label: 'Blue', swatch: '#bfe0ff' },
  { value: 'pink', label: 'Pink', swatch: '#ffd0e0' },
  { value: 'none', label: 'None', swatch: null },
])

export const UNDERLINE_STYLES = Object.freeze([
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'double', label: 'Double' },
  { value: 'none', label: 'None' },
])

const HIGHLIGHT_HEX = Object.freeze(
  HIGHLIGHT_COLOURS.reduce((acc, c) => {
    if (c.swatch) acc[c.value] = c.swatch
    return acc
  }, {})
)

const SYSTEM_HIGHLIGHT = '#ffe58a'

const TEXT_SIZE_VALUES = TEXT_SIZES.map((o) => o.value)
const LINE_SPACING_VALUES = LINE_SPACING.map((o) => o.value)
const THEME_VALUES = QUIZ_THEMES.map((o) => o.value)
const HIGHLIGHT_VALUES = HIGHLIGHT_COLOURS.map((o) => o.value)
const UNDERLINE_VALUES = UNDERLINE_STYLES.map((o) => o.value)

/* ── Defaults + normaliser ───────────────────────────────────────────────── */

export const DEFAULT_QUIZ_DISPLAY = Object.freeze({
  textSize: 'medium',
  lineSpacing: 'comfortable',
  theme: 'light',
  highlightColour: 'yellow',
  underlineStyle: 'solid',
  dyslexiaFont: false,
  widerAnswerSpacing: false,
  largerAnswerLetters: false,
  reduceAnimations: false,
  readAloud: false,
  keepPassageOpen: false,
  showPassageLineNumbers: false,
})

/**
 * Normalise a stored (possibly partial / garbage) prefs object into a clean,
 * fully-populated object with safe defaults. Never throws.
 */
export function normalizeQuizDisplayPrefs(input) {
  const p = input && typeof input === 'object' ? input : {}
  return {
    textSize: oneOf(p.textSize, TEXT_SIZE_VALUES, DEFAULT_QUIZ_DISPLAY.textSize),
    lineSpacing: oneOf(p.lineSpacing, LINE_SPACING_VALUES, DEFAULT_QUIZ_DISPLAY.lineSpacing),
    theme: oneOf(p.theme, THEME_VALUES, DEFAULT_QUIZ_DISPLAY.theme),
    highlightColour: oneOf(p.highlightColour, HIGHLIGHT_VALUES, DEFAULT_QUIZ_DISPLAY.highlightColour),
    underlineStyle: oneOf(p.underlineStyle, UNDERLINE_VALUES, DEFAULT_QUIZ_DISPLAY.underlineStyle),
    dyslexiaFont: bool(p.dyslexiaFont, DEFAULT_QUIZ_DISPLAY.dyslexiaFont),
    widerAnswerSpacing: bool(p.widerAnswerSpacing, DEFAULT_QUIZ_DISPLAY.widerAnswerSpacing),
    largerAnswerLetters: bool(p.largerAnswerLetters, DEFAULT_QUIZ_DISPLAY.largerAnswerLetters),
    reduceAnimations: bool(p.reduceAnimations, DEFAULT_QUIZ_DISPLAY.reduceAnimations),
    readAloud: bool(p.readAloud, DEFAULT_QUIZ_DISPLAY.readAloud),
    keepPassageOpen: bool(p.keepPassageOpen, DEFAULT_QUIZ_DISPLAY.keepPassageOpen),
    showPassageLineNumbers: bool(p.showPassageLineNumbers, DEFAULT_QUIZ_DISPLAY.showPassageLineNumbers),
  }
}

/**
 * Map a (normalised or raw) prefs object to the props to spread on the
 * .quiz-shell container: data-* attributes for CSS selectors + a `style`
 * object of CSS custom properties. Pure and deterministic.
 *
 * Accessibility guarantee: a 'none' underline maps to `solid` (default
 * thickness), and a 'none' highlight falls back to the system highlight — an
 * intentionally underlined/highlighted exam word can never be hidden by a
 * learner preference. "None" only drops the learner's extra customisation.
 */
export function resolveQuizDisplayVars(input) {
  const p = normalizeQuizDisplayPrefs(input)

  const underline = p.underlineStyle === 'none' ? 'solid' : p.underlineStyle
  const highlight =
    p.highlightColour === 'none'
      ? SYSTEM_HIGHLIGHT
      : HIGHLIGHT_HEX[p.highlightColour] || SYSTEM_HIGHLIGHT

  return {
    className: 'quiz-shell',
    'data-quiz-theme': p.theme,
    'data-quiz-size': p.textSize,
    'data-quiz-spacing': p.lineSpacing,
    'data-quiz-underline': underline,
    'data-quiz-dyslexia': p.dyslexiaFont ? 'true' : 'false',
    'data-quiz-answer-space': p.widerAnswerSpacing ? 'wide' : 'normal',
    'data-quiz-letters': p.largerAnswerLetters ? 'large' : 'normal',
    'data-quiz-reduce-motion': p.reduceAnimations ? 'true' : 'false',
    style: {
      '--quiz-highlight': highlight,
    },
  }
}
