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

/**
 * The Firestore writer, registered by <TeacherThemeSync> once a user is
 * signed in. Null when signed out, which is not an error state — the choice
 * still applies and still persists to this device.
 *
 * WHY IT LIVES HERE AND NOT IN ThemeProvider
 * ------------------------------------------
 * It used to live in the provider, so only `setTeacherTheme` from context
 * reached it. But this store has TWO callers, by design (see the note above):
 * the settings picker goes through context, and the dashboard's light/dark
 * toggle (useDashboardTheme) calls writeTeacherTheme directly — it cannot use
 * context, because the dashboard surfaces render standalone in their specs
 * with no ThemeProvider above them.
 *
 * That made the toggle a write path with no persistence, and the failure was
 * not "the choice is forgotten" — it was worse and looked like a different
 * bug entirely. Toggling to light saved locally but left the profile on
 * Night, so the next load applied light pre-paint and TeacherThemeSync then
 * hydrated Night back over it. The teacher sets light mode, reloads, and the
 * app is dark again — with the setting they chose still showing in
 * localStorage.
 *
 * So the persister belongs on the value, not on one of the two routes to it.
 * Hydration is the one path that must NOT write (see hydrateTeacherTheme).
 */
let persister = null

/**
 * Register the Firestore writer. Returns an unregister function; the
 * identity check means a stale cleanup cannot clear a newer registration.
 */
export function registerTeacherThemePersister(fn) {
  persister = fn
  return () => { if (persister === fn) persister = null }
}

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

/** Apply to the DOM + this device. Returns the normalised id applied. */
function applyAndStore(id) {
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

/**
 * A deliberate choice by the user: apply, save to this device, and sync to
 * the signed-in profile. Returns the normalised id actually applied.
 *
 * Every user-facing write goes through here — the settings picker and the
 * dashboard light/dark toggle alike — which is what makes the profile agree
 * with the device instead of overwriting it on the next load.
 *
 * The Firestore call is fire-and-forget by design: the choice is already
 * applied and already saved locally, so a rejected or offline write costs
 * cross-device sync and nothing else. It must never be awaited here, or a
 * slow network would stall the palette change.
 */
export function writeTeacherTheme(id) {
  const next = applyAndStore(id)
  persister?.(next)
  return next
}

/**
 * Apply a value that CAME FROM the profile. Identical to writeTeacherTheme
 * except that it does not persist — echoing a value straight back to the
 * server it was just read from would bill a write on every sign-in.
 */
export function hydrateTeacherTheme(id) {
  return applyAndStore(id)
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
  persister = null
}
