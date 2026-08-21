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

/* ══════════════════════════════════════════════════════════════════════
 * THE THEME MODE — light / dark / system
 *
 * WHY THIS EXISTS
 * ---------------
 * Until now the reading theme had exactly two storage states: a saved
 * palette, or nothing. "Nothing" meant "follow the OS". That is two states
 * doing the work of three, and the missing one is the one people ask for:
 *
 *   "always light"   — a saved LIGHT palette expressed it, but only on the
 *                      device that saved it. In any context the key was
 *                      absent — a second browser, Incognito, a cleared
 *                      profile, the signed-out marketing site before auth
 *                      resolves — the OS answered instead, and the seed is
 *                      deliberately never written, so it answered again on
 *                      every single cold start. Measured on the built app:
 *                      three consecutive reloads on a dark-OS browser, all
 *                      three midnight, `examprep:theme` still null.
 *   "always dark"    — same, mirrored.
 *   "follow the OS"  — the default, and the only one that was expressible.
 *
 * That is the whole of the "dark mode is back" report. Nothing re-imposed
 * it; it was never recorded that it should be off, so every fresh context
 * re-derived it from the operating system.
 *
 * It also cost the one thing "system" is supposed to give you: because the
 * OS was read ONCE at boot, a device that flips to dark at sunset did not
 * follow until the next reload. ThemeContext now subscribes.
 *
 * THE RULE
 * --------
 *   light   → the chosen light palette, whatever the OS says
 *   dark    → Midnight, whatever the OS says
 *   system  → the OS decides, live
 *
 * An explicit mode is an ANSWER and outranks the OS everywhere — which is
 * the same principle seededWorkspaceDarkness already states for the
 * workspace seed, applied to the palette that seed follows.
 * ══════════════════════════════════════════════════════════════════════ */

/** localStorage key holding the learner's chosen mode. */
export const READING_THEME_MODE_STORAGE_KEY = 'examprep:themeMode'

/**
 * localStorage key remembering WHICH light palette. Unifies the two
 * `lhx:last-light-theme` copies that the learner header and the learner
 * settings screen each kept, so leaving dark returns you to the light
 * palette you actually chose rather than to the brand default.
 */
export const READING_LIGHT_THEME_STORAGE_KEY = 'examprep:lightTheme'

/** Legacy per-device memory of the last light palette, read once on migration. */
export const LEGACY_LAST_LIGHT_KEY = 'lhx:last-light-theme'

export const READING_THEME_MODES = Object.freeze(['light', 'dark', 'system'])

/**
 * The mode a visitor who has never chosen is in.
 *
 * 'system' rather than 'light' on purpose: a first-time visitor on a
 * dark-mode device should still be met in dark. What changed is that this
 * is now the state you are in only until you answer — an answer is
 * recorded, and a recorded answer is not re-litigated by the OS on the next
 * cold start.
 */
export const DEFAULT_READING_THEME_MODE = 'system'

/** The one dark reading palette. */
export const DARK_READING_THEME_ID = 'midnight'

export function isReadingThemeMode(mode) {
  return typeof mode === 'string' && READING_THEME_MODES.includes(mode)
}

/**
 * The mode a device is in when it has no stored mode but does have a stored
 * palette — i.e. every device that predates this.
 *
 * This is the migration, and it is what makes the fix reach people who
 * already picked a palette: a saved light palette was ALWAYS an "always
 * light" answer, it just had no way to say so, and reading it as 'system'
 * would throw away the very choice being rescued. A saved Midnight is read
 * as 'dark' for the same reason.
 *
 * Nothing saved is genuinely unanswered, and stays 'system'.
 */
export function inferReadingThemeMode(savedTheme) {
  if (!savedTheme) return DEFAULT_READING_THEME_MODE
  return isDarkReadingThemeId(savedTheme) ? 'dark' : 'light'
}

/**
 * The palette to paint, as a pure function of the three inputs.
 *
 * `light` is the light palette in force; callers pass their resolved
 * choice (see resolveLightReadingTheme) rather than a raw stored value, so
 * this never has to know about storage or defaults.
 */
export function resolveReadingTheme({ mode, light, osDark } = {}) {
  if (mode === 'dark') return DARK_READING_THEME_ID
  if (mode === 'light') return light
  return osDark ? DARK_READING_THEME_ID : light
}

/**
 * Which light palette a device means, given what it has stored.
 *
 * Order: the explicit light-palette memory, then the active palette if it
 * happens to be a light one, then the brand default. The middle rung is
 * what carries an existing device across — someone reading in Sky has
 * `examprep:theme = 'sky'` and no light-palette key, and must not be
 * quietly moved to Oatmeal by this change.
 *
 * `isKnownLight` is injected because the id vocabulary (and its legacy and
 * retired aliases) lives in ThemeContext; this module deliberately knows
 * only which ids are DARK.
 */
export function resolveLightReadingTheme({ storedLight, activeTheme, fallback, isKnownLight } = {}) {
  const ok = (id) => Boolean(id) && !isDarkReadingThemeId(id)
    && (typeof isKnownLight === 'function' ? isKnownLight(id) : true)
  if (ok(storedLight)) return storedLight
  if (ok(activeTheme)) return activeTheme
  return fallback
}
