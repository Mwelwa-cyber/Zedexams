import { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react'
import { TEACHER_THEMES, isTeacherThemeId } from './teacherThemeCore'
import {
  applyTeacherThemeAttribute,
  useTeacherThemeValue,
  writeTeacherTheme,
} from './teacherThemeStore'

const LS_KEY = 'examprep:theme'

export const THEMES = [
  { id: 'sky',      label: 'Sky Blue',      swatch: '#0EA5E9' },
  { id: 'lavender', label: 'Lavender',      swatch: '#8B5CF6' },
  { id: 'midnight', label: 'Midnight Tech', swatch: '#1E293B' },
  { id: 'oatmeal',  label: 'Warm Oatmeal',  swatch: '#D97757' },
  { id: 'solar',    label: 'Solar Yellow',  swatch: '#F59E0B' },
  { id: 'vivid',    label: 'Vivid (Canva)', swatch: '#EC4899' },
]

export const DEFAULT_THEME = 'oatmeal'
const LEGACY_THEME_MAP = {
  light: 'sky',
  warm: 'oatmeal',
  dark: 'midnight',
}
const THEME_IDS = THEMES.map(t => t.id)
const THEME_CLASS_IDS = [...THEME_IDS, ...Object.keys(LEGACY_THEME_MAP)]

export function normalizeThemeId(id) {
  const next = LEGACY_THEME_MAP[id] || id
  return THEME_IDS.includes(next) ? next : DEFAULT_THEME
}

// Themes whose palette is dark. Tailwind's `dark:` variants (darkMode:
// 'class') only fire when an ancestor carries the `dark` class, so these
// themes must also toggle it — otherwise every dark: style in the tree is
// dead and light panels leak into the dark palette.
const DARK_THEME_IDS = new Set(['midnight'])

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
    if (saved) return normalizeThemeId(saved)
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
   * registers the writer here. Until it does, setTeacherTheme still works
   * fully — it just persists to localStorage only, which is exactly the
   * right behaviour for a signed-out visitor.
   */
  const persistRef = useRef(null)

  const registerTeacherThemePersister = useCallback((fn) => {
    persistRef.current = fn
    return () => { if (persistRef.current === fn) persistRef.current = null }
  }, [])

  /** A deliberate choice by the user — applies everywhere and persists. */
  const setTeacherTheme = useCallback((id) => {
    // Apply first, on its own line. Folding this into the argument of an
    // optional call — `persistRef.current?.(writeTeacherTheme(id))` — means
    // the argument is never evaluated when no persister is registered, so
    // the theme silently fails to apply for every signed-out visitor.
    const next = writeTeacherTheme(id)
    persistRef.current?.(next)
  }, [])

  /**
   * The signed-in profile's saved theme arriving from Firestore. Same local
   * effect as a user choice, but must NOT write back — that would echo the
   * value we just read straight back to the server on every sign-in.
   */
  const hydrateTeacherTheme = useCallback((id) => {
    if (!isTeacherThemeId(id)) return
    writeTeacherTheme(id)
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
