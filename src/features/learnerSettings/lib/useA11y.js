// Tiny shared store for the localStorage-backed accessibility prefs. Both the
// Appearance card and the Accessibility card sit on the overview at once and can
// both touch these prefs (high contrast, text size, dyslexia font, motion), so
// they subscribe to one store to stay in sync — a change in one reflects live in
// the other. saveAccessibilityPrefs applies to <body> + persists; Firestore
// mirroring stays the caller's job (via commit) exactly as the detail panel does.

import { useSyncExternalStore } from 'react'
import { loadAccessibilityPrefs, saveAccessibilityPrefs } from '../../../utils/accessibility'

const listeners = new Set()
let cache = null

function snapshot() {
  if (!cache) cache = loadAccessibilityPrefs()
  return cache
}

export function updateA11y(patch) {
  cache = { ...snapshot(), ...patch }
  saveAccessibilityPrefs(cache) // apply to <body> + persist to localStorage
  for (const l of listeners) l()
  return cache
}

export function useA11y() {
  const subscribe = (cb) => { listeners.add(cb); return () => listeners.delete(cb) }
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
