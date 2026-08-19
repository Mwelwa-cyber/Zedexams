/**
 * The two things about the learner READING theme that the WORKSPACE theme
 * also has to know — pure, no React and no DOM state.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * There are two palette systems (see teacherThemeCore.js): the reading
 * palettes on <body>, and the teacher workspace palettes as `data-theme` on
 * <html>. They are bridged in one direction — `html[data-theme='night'] body`
 * in index.css restates every reading token in dark, so a teacher on Night
 * gets dark shared components (themeBridge.test.js pins that bridge).
 *
 * That bridge is a higher-specificity selector than `body.theme-<id>`, so
 * whatever `data-theme` says OUTRANKS the reading palette. Which is correct
 * when a teacher CHOSE Night, and was a bug when nothing was chosen at all:
 * both systems seeded themselves independently from `prefers-color-scheme`,
 * so on any browser with no saved keys and a dark OS — a second browser,
 * Incognito, a fresh profile — the workspace attribute came up 'night' for
 * every user including learners, and the learner's Night toggle (which writes
 * the READING theme, the only theme control a learner has) could not undo it.
 * The page stayed dark with the toggle reading "day".
 *
 * The rule that closes it: an OS seed is not a choice, and must never outrank
 * one. So while no workspace theme has been chosen, the workspace theme
 * FOLLOWS the reading palette — which itself falls back to the OS. One
 * decision about darkness, taken once, in `isDarkReadingThemeId`.
 */

/** localStorage key holding the learner's chosen reading palette. */
export const READING_THEME_STORAGE_KEY = 'examprep:theme'

/**
 * The reading palettes that are DARK.
 *
 * 'dark' is the legacy alias for 'midnight' (LEGACY_THEME_MAP in
 * ThemeContext) and is listed because this is read against the RAW stored
 * value as well as against normalised ids — a device that has not been
 * rewritten yet still holds the alias, and reading it as light would flip a
 * returning learner's workspace seed to light under a dark reading palette.
 *
 * Every other stored value — the light palettes, the retired ids, and
 * anything unrecognised — is light: the retirements map onto light palettes
 * and an unrecognised id normalises to the light brand default, so treating
 * "not in this list" as light is the same answer normalizeThemeId gives.
 */
export const DARK_READING_THEME_IDS = Object.freeze(['midnight', 'dark'])

/** Whether a reading-theme id (raw or normalised) paints a dark page. */
export function isDarkReadingThemeId(id) {
  return typeof id === 'string' && DARK_READING_THEME_IDS.includes(id)
}

/**
 * Whether the visitor's OS asks for a dark palette. Read through one helper
 * so every seeding site (ThemeContext, teacherThemeStore, and the pre-paint
 * mirrors in boot.js) agrees on the query.
 */
export function prefersDarkColorScheme() {
  try {
    return typeof window !== 'undefined'
      && Boolean(window.matchMedia?.('(prefers-color-scheme: dark)')?.matches)
  } catch {
    return false
  }
}

/**
 * Is the page dark RIGHT NOW, as far as a seed is concerned — the saved
 * reading choice if this device has one, otherwise the OS.
 *
 * A stored value of any kind answers the question on its own: it is either a
 * dark palette or a light one, and either way the learner has spoken, so the
 * OS is not consulted. Only a device with no stored reading theme at all
 * falls through to `prefers-color-scheme`.
 */
export function seededDarkness() {
  try {
    const saved = localStorage.getItem(READING_THEME_STORAGE_KEY)
    if (saved) return isDarkReadingThemeId(saved)
  } catch { /* storage unavailable — fall through to the OS */ }
  return prefersDarkColorScheme()
}
