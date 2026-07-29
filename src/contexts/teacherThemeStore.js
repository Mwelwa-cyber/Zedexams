import { useSyncExternalStore } from 'react'
import {
  DEFAULT_TEACHER_THEME,
  TEACHER_THEME_STORAGE_KEY,
  THEME_ATTRIBUTE,
  isTeacherThemeId,
  normalizeTeacherThemeId,
} from './teacherThemeCore'

/**
 * The single live value of the teacher workspace theme.
 *
 * WHY A MODULE STORE AND NOT PROVIDER STATE
 * -----------------------------------------
 * Two separate consumers need this value: <ThemeProvider> (for the settings
 * picker and anything reading context) and useDashboardTheme() (which puts
 * the `is-dark` class on the dashboard root). Holding it in the provider
 * would force every surface that renders a dashboard component to be wrapped
 * in ThemeProvider — including eight component specs that legitimately
 * render those surfaces standalone.
 *
 * More importantly it would invite the failure this store exists to prevent:
 * a second copy of "is the workspace dark?" kept in step by hand. The
 * dashboard previously had exactly that — its own `zedexams:tdv2-theme` key
 * and its own light/dark state, independent of the app's theme layer — so a
 * teacher could hold Night in one and Light in the other and get a dark
 * palette under light-mode overrides. There is now one value, here.
 */

const LEGACY_DASHBOARD_KEY = 'zedexams:tdv2-theme'

let current = null
const listeners = new Set()

function readInitial() {
  try {
    const saved = localStorage.getItem(TEACHER_THEME_STORAGE_KEY)
    if (isTeacherThemeId(saved)) return saved
    // Migration: teachers who had the old per-device dashboard dark toggle
    // switched on land on Night rather than being silently reset to light.
    // Only consulted when the new key is unset, so it never overrides a
    // deliberate choice.
    if (localStorage.getItem(LEGACY_DASHBOARD_KEY) === 'dark') return 'night'
  } catch { /* storage unavailable — fall through to the default */ }
  return DEFAULT_TEACHER_THEME
}

export function getTeacherThemeSnapshot() {
  if (current === null) current = readInitial()
  return current
}

/** SSR/prerender has no localStorage and no DOM — always the default. */
export function getTeacherThemeServerSnapshot() {
  return DEFAULT_TEACHER_THEME
}

export function applyTeacherThemeAttribute(id) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute(THEME_ATTRIBUTE, normalizeTeacherThemeId(id))
}

export function subscribeTeacherTheme(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Apply + persist locally. Returns the normalised id actually applied.
 * Does NOT write to Firestore — see TeacherThemeSync for that half, which is
 * registered separately so this module stays free of Firebase.
 */
export function writeTeacherTheme(id) {
  const next = normalizeTeacherThemeId(id)
  const changed = next !== getTeacherThemeSnapshot()
  current = next
  try {
    localStorage.setItem(TEACHER_THEME_STORAGE_KEY, next)
    // Keep the retired dashboard key consistent rather than stale, so a
    // build still running the old code during a rollout doesn't flip the
    // dashboard back underneath the user.
    localStorage.setItem(LEGACY_DASHBOARD_KEY, next === 'night' ? 'dark' : 'light')
  } catch { /* storage unavailable — the choice still applies this session */ }
  applyTeacherThemeAttribute(next)
  if (changed) listeners.forEach((fn) => fn())
  return next
}

/** Subscribe a component to the active teacher theme. */
export function useTeacherThemeValue() {
  return useSyncExternalStore(
    subscribeTeacherTheme,
    getTeacherThemeSnapshot,
    getTeacherThemeServerSnapshot,
  )
}

/** Test seam — resets module state between cases. */
export function resetTeacherThemeStore() {
  current = null
  listeners.clear()
}
