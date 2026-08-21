import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { TEACHER_THEMES, isTeacherThemeId } from './teacherThemeCore'
import {
  applyTeacherThemeAttribute,
  hydrateTeacherTheme as hydrateTeacherThemeValue,
  registerTeacherThemePersister,
  syncSeededTeacherTheme,
  useTeacherThemeValue,
  writeTeacherTheme,
} from './teacherThemeStore'
import {
  DEFAULT_READING_THEME_MODE,
  LEGACY_LAST_LIGHT_KEY,
  READING_LIGHT_THEME_STORAGE_KEY,
  READING_THEME_MODES,
  READING_THEME_MODE_STORAGE_KEY,
  READING_THEME_STORAGE_KEY,
  inferReadingThemeMode,
  isDarkReadingThemeId,
  isReadingThemeMode,
  prefersDarkColorScheme,
  resolveLightReadingTheme,
  resolveReadingTheme,
} from './readingThemeCore'

const LS_KEY = READING_THEME_STORAGE_KEY
const MODE_KEY = READING_THEME_MODE_STORAGE_KEY
const LIGHT_KEY = READING_LIGHT_THEME_STORAGE_KEY

/**
 * The reading themes — the palettes a learner reads ON (note reader, quiz
 * runner, learner dashboard). Default first, so the picker opens on the one
 * most readers are already using.
 */
export const THEMES = [
  { id: 'oatmeal',  label: 'Warm Oatmeal',  swatch: '#B44F2D' },
  { id: 'sky',      label: 'Sky Blue',      swatch: '#0EA5E9' },
  { id: 'solar',    label: 'Solar Yellow',  swatch: '#F59E0B' },
  { id: 'midnight', label: 'Midnight',      swatch: '#38BDF8' },
]

export const DEFAULT_THEME = 'oatmeal'
const LEGACY_THEME_MAP = {
  light: 'sky',
  warm: 'oatmeal',
  dark: 'midnight',
}

/**
 * Themes that were removed (2026-07). A device that last read in one of them
 * still has that id in localStorage, and there is no CSS behind it any more —
 * so an unmapped value renders the learner a page with no palette at all.
 *
 * Each retired theme maps to the surviving palette closest to it rather than
 * to the default, because a learner who deliberately chose the violet one is
 * better served by the blue than by being silently reset to cream. The map is
 * applied on read AND the stored key is rewritten (see resolveInitialTheme),
 * so the fallback fires exactly once per device and then the id is simply a
 * current one. This is a migration, not a choice — it must not emit an
 * analytics event.
 */
const RETIRED_THEME_MAP = {
  lavender: 'sky',
  vivid: 'solar',
}

const THEME_IDS = THEMES.map(t => t.id)
const THEME_CLASS_IDS = [
  ...THEME_IDS,
  ...Object.keys(LEGACY_THEME_MAP),
  ...Object.keys(RETIRED_THEME_MAP),
]

export function normalizeThemeId(id) {
  const next = LEGACY_THEME_MAP[id] || RETIRED_THEME_MAP[id] || id
  return THEME_IDS.includes(next) ? next : DEFAULT_THEME
}

/** A stored id that is a real, current, LIGHT palette. */
function knownLightThemeId(id) {
  const next = knownThemeId(id)
  return next && !isDarkReadingThemeId(next) ? next : null
}

function readKey(key) {
  try { return localStorage.getItem(key) } catch { return null }
}

/** Firestore path on the user profile: users/{uid}.preferences.readingTheme */
export const READING_THEME_PROFILE_FIELD = 'preferences.readingTheme'

/**
 * The id a stored value actually means, or null if it means nothing.
 *
 * The distinction `normalizeThemeId` cannot make is the one that matters
 * here: it answers "which palette do I paint?" and so folds an absent value
 * into the default. This answers "did anyone choose?" — and an absent value
 * is NOT a choice of the default. Collapsing the two is how a profile that
 * has never recorded a theme silently overwrites a deliberate pick made on
 * the device in front of the learner.
 */
export function knownThemeId(id) {
  if (typeof id !== 'string') return null
  const next = LEGACY_THEME_MAP[id] || RETIRED_THEME_MAP[id] || id
  return THEME_IDS.includes(next) ? next : null
}

/**
 * Decide which theme wins when the signed-in profile and this device's
 * localStorage disagree. The twin of teacherThemeCore.resolveThemeConflict,
 * and it exists for the same reason: the profile is the account's answer and
 * a device is only ever a cache of one.
 *
 * The profile wins whenever it holds a usable value. A profile with none is
 * "not answered" and must leave the device alone — including when the device
 * value is itself only the prefers-color-scheme seed, because a learner on a
 * dark-OS machine who has never picked anything is exactly who that seed is
 * for.
 */
export function resolveReadingThemeConflict({
  profileTheme, profileMode, profileLight, localTheme,
} = {}) {
  const fromProfile = knownThemeId(profileTheme)
  // The MODE alone is enough to make the profile the answer. A profile that
  // recorded 'system' carries no palette worth echoing, and reading it as
  // "not answered" would leave the account unable to express the one mode
  // whose whole point is that it is a decision rather than a default.
  if (fromProfile || isReadingThemeMode(profileMode)) {
    return {
      theme: fromProfile,
      mode: isReadingThemeMode(profileMode) ? profileMode : inferReadingThemeMode(fromProfile),
      light: knownThemeId(profileLight) || null,
      source: 'profile',
    }
  }
  const fromLocal = knownThemeId(localTheme)
  if (fromLocal) return { theme: fromLocal, mode: inferReadingThemeMode(fromLocal), light: null, source: 'local' }
  return { theme: DEFAULT_THEME, mode: DEFAULT_READING_THEME_MODE, light: null, source: 'default' }
}

/**
 * Whether a profile write is worth making. Skips the no-op that would
 * otherwise fire on every hydration and bill a write per sign-in. Compared
 * against the RAW stored value, not its normalised form, so a profile still
 * holding a legacy alias ('dark') is rewritten to the current id once rather
 * than re-mapped on every read forever.
 */
export function shouldPersistReadingTheme({
  nextTheme, nextMode, nextLight, profileTheme, profileMode, profileLight,
} = {}) {
  const next = knownThemeId(nextTheme)
  if (!next) return false
  // Any of the three drifting is worth one merge write. The mode is the field
  // that actually has to reach the account — it is what stops another browser
  // asking the operating system instead — so a profile holding the right
  // palette and no mode must still be written.
  return next !== profileTheme
    || (isReadingThemeMode(nextMode) && nextMode !== profileMode)
    || (Boolean(knownThemeId(nextLight)) && nextLight !== profileLight)
}

/**
 * The theme this device has ACTUALLY SAVED, or null if it has never saved
 * one. The difference from the live `theme` value is the whole point: that
 * one is never null, because an unanswered device resolves to the
 * prefers-color-scheme seed or the brand default. Only a value that is
 * physically in localStorage is a choice somebody made here — the seed is
 * deliberately never written, precisely so this distinction stays readable.
 *
 * <ReadingThemeSync> uses it to decide whether a signed-in learner's empty
 * profile may be backfilled from this device.
 */
export function readStoredThemeChoice() {
  const palette = knownThemeId(readKey(LS_KEY))
  const mode = readKey(MODE_KEY)
  if (!palette && !isReadingThemeMode(mode)) return null
  return {
    theme: palette,
    mode: isReadingThemeMode(mode) ? mode : inferReadingThemeMode(palette),
    // Resolved rather than read straight out of storage: a device that
    // predates the light-palette key still has an answer — its active palette
    // — and backfilling `null` onto the account would send every other
    // browser back to the brand default.
    light: resolveLightReadingTheme({
      storedLight: knownLightThemeId(readKey(LIGHT_KEY)) || knownLightThemeId(readKey(LEGACY_LAST_LIGHT_KEY)),
      activeTheme: palette,
      fallback: DEFAULT_THEME,
      isKnownLight: (id) => Boolean(knownLightThemeId(id)),
    }),
  }
}

/**
 * The Firestore writer, registered by <ReadingThemeSync> once a learner is
 * signed in. Null when signed out, which is not an error state — the choice
 * still applies and still persists to this device.
 *
 * It lives at module scope rather than in provider state for the reason
 * teacherThemeStore documents at length: a persister held in state is
 * re-created on every render and a registration is easy to lose to a stale
 * cleanup. The identity check on unregister is what makes a late cleanup
 * unable to clear a newer registration.
 */
let readingThemePersister = null

export function registerReadingThemePersister(fn) {
  readingThemePersister = fn
  return () => { if (readingThemePersister === fn) readingThemePersister = null }
}

/** Test seam — clears the registration between cases. */
export function resetReadingThemePersister() {
  readingThemePersister = null
}

// Which palettes are dark lives in readingThemeCore.isDarkReadingThemeId,
// because two things now ask the question and they must not be able to
// disagree: the `dark` class below (Tailwind's `dark:` variants only fire
// when an ancestor carries it, so without it every dark: style in the tree is
// dead and light panels leak into the dark palette) and the WORKSPACE theme's
// seed, which follows the reading palette while nobody has chosen one.

/**
 * The colour the browser paints its own chrome with — the Android address bar
 * and the iOS status-bar backdrop. It is a <meta>, so no palette token can
 * reach it; index.html ships a fixed value and this is what keeps that value
 * honest once a theme is applied.
 *
 * Each entry is the theme's own `--bg`, because that is the strip of page the
 * chrome sits against. A fixed navy was close enough to be missed on Midnight
 * (#0F1B2D against #0F172A reads as a seam, not as a different colour) and
 * plainly wrong on the three light palettes, where a dark bar sat above a
 * cream page.
 *
 * Kept here rather than in boot.js's pre-paint guard on purpose: this is one
 * more table that would have to be mirrored across ThemeContext / index.css /
 * boot.js, and the cost of getting it late is a browser chrome that settles a
 * few hundred milliseconds after the page — not a flash of unstyled content.
 */
const THEME_META_COLORS = {
  oatmeal:  '#FDF6EC',
  sky:      '#F0F9FF',
  solar:    '#FFFBEB',
  midnight: '#0F172A',
}

/**
 * Apply a theme by setting `theme-<id>` on <body>, removing any prior
 * theme class. Exported so the route-aware applicator can override the
 * saved preference (e.g. pin the brand default on auth/legal pages).
 */
export function applyThemeToBody(id) {
  if (typeof document === 'undefined') return
  const body = document.body
  const next = normalizeThemeId(id)
  THEME_CLASS_IDS.forEach(t => body.classList.remove(`theme-${t}`))
  body.classList.add(`theme-${next}`)
  document.documentElement.classList.toggle('dark', isDarkReadingThemeId(next))
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta && THEME_META_COLORS[next]) meta.setAttribute('content', THEME_META_COLORS[next])
}

/**
 * Whether the visitor's OS asks for a dark palette. Defined in
 * readingThemeCore (the workspace theme's seed reads it too) and re-exported
 * here, which is where every existing caller looks for it.
 */
export { prefersDarkColorScheme }

/**
 * Everything this device has stored about the reading theme, normalised.
 *
 * `mode` is the answer; `light` is which light palette that answer means;
 * `theme` is the palette to paint. A device with no mode stored has its mode
 * INFERRED from its saved palette (readingThemeCore.inferReadingThemeMode) —
 * that inference is the migration, and it is what carries an existing choice
 * across rather than resetting everyone to "follow the OS".
 */
function readStoredThemeState() {
  const savedRaw = readKey(LS_KEY)
  const saved = savedRaw ? normalizeThemeId(savedRaw) : null
  // Rewrite a stale id (a retired theme, or a legacy alias) so the fallback
  // never has to fire again on this device. Without this the mapping is
  // re-derived on every load, and any code reading the key directly —
  // boot.js's pre-paint guard included — keeps seeing an id that no longer
  // has a palette behind it.
  if (savedRaw && saved !== savedRaw) {
    try { localStorage.setItem(LS_KEY, saved) } catch { /* read-only storage */ }
  }

  const storedMode = readKey(MODE_KEY)
  const mode = isReadingThemeMode(storedMode) ? storedMode : inferReadingThemeMode(saved)

  const light = resolveLightReadingTheme({
    // The two `lhx:last-light-theme` copies the learner header and the
    // learner settings screen each kept are read once, here, so a device
    // that already remembers Sky keeps Sky.
    storedLight: knownLightThemeId(readKey(LIGHT_KEY)) || knownLightThemeId(readKey(LEGACY_LAST_LIGHT_KEY)),
    activeTheme: saved,
    fallback: DEFAULT_THEME,
    isKnownLight: (id) => Boolean(knownLightThemeId(id)),
  })

  return {
    mode,
    light,
    theme: resolveReadingTheme({ mode, light, osDark: prefersDarkColorScheme() }),
  }
}

/* ── Teacher workspace theme ───────────────────────────────────────────
 * A SECOND palette set, applied as `data-theme` on <html>, covering the
 * teacher dashboard + studios. It is deliberately independent of the six
 * learner themes above: learners keep every palette they can pick today,
 * and teachers get the four workspace themes on top.
 *
 * Both live in this one provider on purpose — one place owns theme state,
 * one place writes localStorage, one place applies the DOM change. What is
 * separate is only the token namespace (see teacherThemeCore.js).
 */

/**
 * Apply a teacher theme by setting `data-theme` on <html>. Exported so
 * boot-time and test code can drive it without mounting the provider.
 */
export const applyTeacherTheme = applyTeacherThemeAttribute

const ThemeContext = createContext(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}

export function ThemeProvider({ children }) {
  // One object rather than three states: the palette is DERIVED from the mode
  // and the light choice, so holding them apart is how they drift.
  const [state, setState] = useState(readStoredThemeState)
  const { theme, mode: themeMode, light: lightTheme } = state
  // Lives in a module store, not in this provider — see teacherThemeStore.js
  // for why (the dashboard's own dark toggle reads the same value).
  const teacherTheme = useTeacherThemeValue()

  /*
   * In 'system' mode, FOLLOW the OS — do not merely sample it once at boot.
   *
   * The old resolver read prefers-color-scheme during module init and never
   * again, so a laptop that switches to dark at sunset stayed light until the
   * next reload. That is the one thing "system" is for. The listener is only
   * attached in system mode, so an explicit light/dark answer costs nothing
   * and can never be moved by the OS.
   */
  useEffect(() => {
    if (themeMode !== 'system') return undefined
    let mq
    try { mq = window.matchMedia?.('(prefers-color-scheme: dark)') } catch { return undefined }
    if (!mq) return undefined
    const onChange = () => setState((prev) => (
      prev.mode !== 'system' ? prev : { ...prev, theme: resolveReadingTheme({
        mode: 'system', light: prev.light, osDark: prefersDarkColorScheme(),
      }) }
    ))
    // Safari < 14 has no addEventListener on MediaQueryList.
    if (mq.addEventListener) mq.addEventListener('change', onChange)
    else if (mq.addListener) mq.addListener(onChange)
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange)
      else if (mq.removeListener) mq.removeListener(onChange)
    }
  }, [themeMode])

  /**
   * A deliberate choice by the learner: apply, save to this device, and sync
   * to the signed-in profile. Every user-facing write goes through here — the
   * reading-theme picker, the learner header's Night toggle, the settings
   * panels and the theme selector alike — which is what makes the account
   * agree with the device rather than the device being the only record.
   *
   * The Firestore call is fire-and-forget by design: the choice is already
   * applied and already saved locally, so a rejected or offline write costs
   * cross-browser sync and nothing else. It must never be awaited here, or a
   * slow network would stall the palette change.
   */
  /*
   * Write the answer to this device. The palette key keeps its meaning (the
   * ACTIVE palette — boot.js and every other reader still key off it); the
   * mode and light keys are what make the answer survive a context where the
   * palette key is absent.
   */
  const commit = useCallback((mode, light) => {
    const next = resolveReadingTheme({ mode, light, osDark: prefersDarkColorScheme() })
    setState({ mode, light, theme: next })
    try {
      localStorage.setItem(LS_KEY, next)
      localStorage.setItem(MODE_KEY, mode)
      localStorage.setItem(LIGHT_KEY, light)
    } catch { /* private mode — the choice still applies this session */ }
    return next
  }, [])

  /**
   * Picking a PALETTE. Choosing Midnight is choosing dark; choosing any other
   * palette is choosing light AND choosing which light.
   *
   * Every existing caller — the reading-theme picker, the learner header's
   * Night toggle, the settings panels, the theme selector — keeps working
   * unchanged and now records a durable answer rather than a value that the
   * OS could out-vote in the next fresh context.
   *
   * The Firestore call is fire-and-forget by design: the choice is already
   * applied and already saved locally, so a rejected or offline write costs
   * cross-browser sync and nothing else. It must never be awaited here, or a
   * slow network would stall the palette change.
   */
  function setTheme(id) {
    const next = normalizeThemeId(id)
    const dark = isDarkReadingThemeId(next)
    const mode = dark ? 'dark' : 'light'
    const light = dark ? lightTheme : next
    commit(mode, light)
    readingThemePersister?.({ theme: next, mode, light })
  }

  /**
   * Picking a MODE directly — Light / Dark / System.
   *
   * 'system' is a real, stored answer too: it is the difference between "I
   * have not chosen" and "I have chosen to follow my device", and only the
   * second one survives being carried to another browser through the account.
   */
  const setThemeMode = useCallback((next) => {
    if (!READING_THEME_MODES.includes(next)) return
    const applied = commit(next, lightTheme)
    readingThemePersister?.({ theme: applied, mode: next, light: lightTheme })
  }, [commit, lightTheme])

  /**
   * Apply a value that CAME FROM the profile. Identical to setTheme except
   * that it does not persist upward — echoing a value straight back to the
   * server it was just read from would bill a write on every sign-in.
   *
   * It DOES write localStorage, and that is the half that fixes the flash:
   * boot.js paints pre-paint from that key alone, so without this the account
   * theme would be re-applied a frame late on every single load of this
   * browser instead of once.
   */
  const hydrateTheme = useCallback((incoming) => {
    // Accepts a bare palette id as well as the full answer. A profile that
    // predates the mode carries only a palette, and so do the callers that
    // drive this directly; both must keep working, and a bare palette is a
    // complete answer once its mode is inferred (inferReadingThemeMode).
    const { theme: id, mode, light } = typeof incoming === 'string'
      ? { theme: incoming }
      : (incoming || {})
    const palette = knownThemeId(id)
    const nextMode = isReadingThemeMode(mode) ? mode : inferReadingThemeMode(palette)
    // A profile that carries neither is "not answered" and must leave this
    // device alone — see resolveReadingThemeConflict.
    if (!palette && !isReadingThemeMode(mode)) return
    const nextLight = resolveLightReadingTheme({
      storedLight: knownLightThemeId(light),
      activeTheme: palette,
      fallback: lightTheme,
      isKnownLight: (v) => Boolean(knownLightThemeId(v)),
    })
    const applied = resolveReadingTheme({
      mode: nextMode, light: nextLight, osDark: prefersDarkColorScheme(),
    })
    setState({ mode: nextMode, light: nextLight, theme: applied })
    // Writing the device keys is the half that fixes the flash: boot.js paints
    // pre-paint from them, so without this the account answer is re-applied a
    // frame late on every single load of this browser instead of once.
    try {
      localStorage.setItem(LS_KEY, applied)
      localStorage.setItem(MODE_KEY, nextMode)
      localStorage.setItem(LIGHT_KEY, nextLight)
    } catch { /* read-only storage */ }
  }, [lightTheme])

  /*
   * Persisting the teacher theme to Firestore has to happen OUTSIDE this
   * provider: main.jsx mounts <ThemeProvider> above <AuthProvider>, so
   * calling useAuth() here would be a hook-order violation and would also
   * make the theme layer untestable without Firebase.
   *
   * So <TeacherThemeSync> (rendered inside AuthProvider, in App.jsx)
   * registers the writer, and does so ON THE STORE rather than here. This
   * provider is only one of the two routes to a theme write — the dashboard's
   * light/dark toggle is the other, and it cannot use context because those
   * surfaces render standalone in their specs. A persister held here was
   * therefore reachable from the settings picker and invisible to the toggle,
   * which is what left the profile holding Night while the device held light
   * and made every reload flip back to dark. See teacherThemeStore.js.
   *
   * Until a writer is registered, setTeacherTheme still works fully — it just
   * persists to localStorage only, which is exactly the right behaviour for a
   * signed-out visitor.
   */

  /** A deliberate choice by the user — applies everywhere and persists. */
  const setTeacherTheme = useCallback((id) => {
    writeTeacherTheme(id)
  }, [])

  /**
   * The signed-in profile's saved theme arriving from Firestore. Same local
   * effect as a user choice, but must NOT write back — that would echo the
   * value we just read straight back to the server on every sign-in.
   */
  const hydrateTeacherTheme = useCallback((id) => {
    if (!isTeacherThemeId(id)) return
    hydrateTeacherThemeValue(id)
  }, [])

  // boot.js already set the attribute pre-paint from the same localStorage
  // key, so on a normal load this is a no-op and there is no flash. It
  // matters after a hydration or a programmatic change.
  useEffect(() => {
    applyTeacherThemeAttribute(teacherTheme)
  }, [teacherTheme])

  /*
   * Keep an UNCHOSEN workspace theme following the reading palette.
   *
   * `html[data-theme='night'] body` in index.css restates every reading token
   * in dark (themeBridge.test.js pins it) and outranks `body.theme-<id>`, so
   * whatever this attribute says wins. That is right for a teacher who chose
   * Night and was wrong for everyone who chose nothing: both theme systems
   * seeded themselves from prefers-color-scheme independently, so on a browser
   * with neither key written and a dark OS — a second browser, Incognito, a
   * fresh profile — the attribute came up 'night' for learners too, and the
   * only theme control a learner has writes the READING theme. Toggling to day
   * changed the body class, the bridge kept overriding it, and the page stayed
   * dark with the toggle reading "day".
   *
   * syncSeededTeacherTheme no-ops the moment a workspace theme is actually
   * chosen, and never writes storage — the seed stays unanswered so it keeps
   * following rather than freezing on the first value it saw.
   */
  useEffect(() => {
    syncSeededTeacherTheme(theme)
  }, [theme])

  // The body class is applied by <ThemeApplicator /> inside the Router.
  // Persistence happens ONLY in setTheme (device + profile) and hydrateTheme
  // (device only): an initial value seeded from prefers-color-scheme must
  // stay unwritten on both, or the seed would turn into a saved "choice" on
  // first load — locally it would stop following the OS setting, and on the
  // profile it would masquerade as an answer the learner never gave and then
  // be pushed onto every other browser they sign in from.

  return (
    <ThemeContext.Provider value={{
      theme, setTheme, themes: THEMES,
      themeMode, setThemeMode, lightTheme, themeModes: READING_THEME_MODES,
      hydrateTheme, registerReadingThemePersister,
      teacherTheme, setTeacherTheme, teacherThemes: TEACHER_THEMES,
      hydrateTeacherTheme, registerTeacherThemePersister,
    }}>
      {children}
    </ThemeContext.Provider>
  )
}
