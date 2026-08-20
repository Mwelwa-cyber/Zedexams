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
 * THE RULE, AND THE HALF OF IT THAT IS NOT SYMMETRIC
 *
 * An OS seed is not a choice, and must never outrank one. So an explicitly
 * chosen LIGHT reading palette CLEARS an unchosen 'night' — that is the fix,
 * and it is all of the fix.
 *
 * The mirror move does NOT follow, and shipping it was a regression (#2524 →
 * #2535). Making the seed follow the reading palette in BOTH directions meant
 * a learner or teacher reading in Midnight on a light-OS machine had their
 * whole workspace turned dark, where before it stayed light — and because
 * <ReadingThemeSync> syncs the reading palette to the account, that reached
 * every browser they signed in from, teachers included.
 *
 * So the rule is one-directional:
 *
 *   reading palette is LIGHT  → the workspace seed is light, whatever the OS
 *                               says (nothing may override a choice)
 *   reading palette is DARK   → the OS decides, exactly as it always did
 *                               (a reading choice is not a workspace opinion)
 *
 * A dark reading palette is a statement about the page a learner reads on. It
 * is not a request to repaint the teacher workspace, and treating it as one
 * is the same category of mistake as the OS seed overriding a choice: acting
 * on something the user did not say.
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
 * Should an UNCHOSEN workspace theme be dark? The one-directional rule above,
 * as a pure function of the two inputs.
 *
 * `readingTheme` is the reading palette in force (a raw stored value or a
 * normalised id — both are accepted), or null/undefined when this device has
 * never saved one.
 *
 *   a LIGHT reading palette vetoes the OS      → false
 *   anything else (dark, or nothing saved)     → whatever the OS asks for
 *
 * Note the asymmetry is deliberate and is the whole point: this function can
 * turn an OS-dark seed OFF, and can never turn a seed ON that the OS did not
 * already ask for.
 */
export function seededWorkspaceDarkness({ readingTheme, osDark } = {}) {
  if (readingTheme && !isDarkReadingThemeId(readingTheme)) return false
  return Boolean(osDark)
}

/** The same decision, reading this device's storage and the live OS setting. */
export function seededDarkness() {
  let saved = null
  try {
    saved = localStorage.getItem(READING_THEME_STORAGE_KEY)
  } catch { /* storage unavailable — the OS alone decides */ }
  return seededWorkspaceDarkness({ readingTheme: saved, osDark: prefersDarkColorScheme() })
}
