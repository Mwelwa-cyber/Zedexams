import { createContext, useContext, useCallback, useEffect, useState } from 'react'
import { TEACHER_THEMES, isTeacherThemeId } from './teacherThemeCore'
import {
  applyTeacherThemeAttribute,
  hydrateTeacherTheme as hydrateTeacherThemeValue,
  registerTeacherThemePersister,
  useTeacherThemeValue,
  writeTeacherTheme,
} from './teacherThemeStore'

const LS_KEY = 'examprep:theme'

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

// Themes whose palette is dark. Tailwind's `dark:` variants (darkMode:
// 'class') only fire when an ancestor carries the `dark` class, so these
// themes must also toggle it — otherwise every dark: style in the tree is
// dead and light panels leak into the dark palette.
const DARK_THEME_IDS = new Set(['midnight'])

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
  document.documentElement.classList.toggle('dark', DARK_THEME_IDS.has(next))
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta && THEME_META_COLORS[next]) meta.setAttribute('content', THEME_META_COLORS[next])
}

/**
 * Resolve the initial theme for a brand-new visitor.
 * - If they've saved a choice → use that.
 * - Otherwise → Warm Oatmeal (the brand default — a light, warm palette).
 *
 * We intentionally do NOT read `prefers-color-scheme` here. The site's
 * content (including the quiz editor, rich-text areas, tables, and native
 * form controls) is designed for a light palette, and honouring the OS
 * dark preference would auto-flip visitors into Midnight — which many
 * users flagged as "a bit too dark" because not every surface is fully
 * dark-theme-ready yet. Users who want Midnight can still pick it from
 * the theme switcher and the choice persists via localStorage.
 */
function resolveInitialTheme() {
  try {
    const saved = localStorage.getItem(LS_KEY)
    if (saved) {
      const next = normalizeThemeId(saved)
      // Rewrite a stale id (a retired theme, or a legacy alias) so the
      // fallback never has to fire again on this device. Without this the
      // mapping is re-derived on every load, and any code reading the key
      // directly — boot.js's pre-paint guard included — keeps seeing an id
      // that no longer has a palette behind it.
      if (next !== saved) {
        try { localStorage.setItem(LS_KEY, next) } catch { /* read-only storage */ }
      }
      return next
    }
  } catch { /* localStorage unavailable — fall through */ }
  return DEFAULT_THEME
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
  const [theme, setThemeState] = useState(resolveInitialTheme)
  // Lives in a module store, not in this provider — see teacherThemeStore.js
  // for why (the dashboard's own dark toggle reads the same value).
  const teacherTheme = useTeacherThemeValue()

  function setTheme(id) {
    const next = normalizeThemeId(id)
    setThemeState(next)
    try { localStorage.setItem(LS_KEY, next) } catch { }
  }

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

  // The body class is applied by <ThemeApplicator /> inside the Router so it
  // can pin the brand default on auth/legal routes regardless of the saved
  // preference. Persist the saved theme here so localStorage stays the source
  // of truth across reloads.
  useEffect(() => {
    try { localStorage.setItem(LS_KEY, theme) } catch { }
  }, [theme])

  return (
    <ThemeContext.Provider value={{
      theme, setTheme, themes: THEMES,
      teacherTheme, setTeacherTheme, teacherThemes: TEACHER_THEMES,
      hydrateTeacherTheme, registerTeacherThemePersister,
    }}>
      {children}
    </ThemeContext.Provider>
  )
}
