// useQuizDisplayPrefs — reads & persists the learner's quiz reading preferences.
//
// Storage model (matches the learnerSettings convention):
//   • Firestore: users/{uid}.quizDisplayPrefs   (cross-device, offline-replayed)
//   • localStorage: examprep:quizDisplay          (synchronous seed → no theme flash)
//
// The localStorage cache is read synchronously in the useState initializer (the
// same flash-avoidance trick as ThemeContext.resolveInitialTheme) so the quiz
// paints with the right theme/size immediately, then reconciles with the
// Firestore value once the user profile loads. Signed-out learners get
// localStorage-only persistence with safe defaults.

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useDebouncedCallback } from './useDebouncedCallback'
import {
  DEFAULT_QUIZ_DISPLAY,
  QUIZ_DISPLAY_STORAGE_KEY,
  normalizeQuizDisplayPrefs,
  resolveQuizDisplayVars,
} from '../utils/quizDisplayPrefs'

function readCachedPrefs() {
  if (typeof window === 'undefined') return DEFAULT_QUIZ_DISPLAY
  try {
    const raw = window.localStorage.getItem(QUIZ_DISPLAY_STORAGE_KEY)
    if (!raw) return DEFAULT_QUIZ_DISPLAY
    return normalizeQuizDisplayPrefs(JSON.parse(raw))
  } catch {
    return DEFAULT_QUIZ_DISPLAY
  }
}

function writeCachedPrefs(prefs) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(QUIZ_DISPLAY_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Private mode / quota — non-fatal; Firestore + in-memory state still work.
  }
}

const WRITE_DEBOUNCE_MS = 600

/**
 * @returns {{
 *   prefs: object,
 *   setPref: (key: string, value: unknown) => void,
 *   setPrefs: (patch: object) => void,
 *   resetPrefs: () => void,
 *   displayVars: object,   // spread onto the .quiz-shell container
 *   saving: boolean,
 * }}
 */
export function useQuizDisplayPrefs() {
  const { currentUser, userProfile, updateProfileFields } = useAuth()
  // Seed synchronously from cache so the first paint is already themed.
  const [prefs, setLocalPrefs] = useState(readCachedPrefs)
  const [saving, setSaving] = useState(false)
  // Once the learner has touched a setting this session, stop letting a late
  // profile snapshot clobber their in-flight choice.
  const dirtyRef = useRef(false)

  // Reconcile with the Firestore profile when it arrives (unless the learner
  // has already changed something locally this session).
  useEffect(() => {
    if (dirtyRef.current) return
    if (userProfile && userProfile.quizDisplayPrefs) {
      const merged = normalizeQuizDisplayPrefs(userProfile.quizDisplayPrefs)
      setLocalPrefs(merged)
      writeCachedPrefs(merged)
    }
  }, [userProfile])

  const { run: scheduleWrite } = useDebouncedCallback((patch) => {
    Promise.resolve(updateProfileFields(patch))
      .catch(() => {
        // Offline writes queue and replay via Firestore persistence; a hard
        // failure is non-fatal — the cache keeps the learner's choice.
      })
      .finally(() => setSaving(false))
  }, WRITE_DEBOUNCE_MS)

  const persist = useCallback(
    (next) => {
      writeCachedPrefs(next)
      if (!currentUser || typeof updateProfileFields !== 'function') return
      setSaving(true)
      scheduleWrite({ quizDisplayPrefs: next })
    },
    [currentUser, updateProfileFields, scheduleWrite]
  )

  const setPrefs = useCallback(
    (patch) => {
      dirtyRef.current = true
      setLocalPrefs((prev) => {
        const next = normalizeQuizDisplayPrefs({ ...prev, ...patch })
        persist(next)
        return next
      })
    },
    [persist]
  )

  const setPref = useCallback((key, value) => setPrefs({ [key]: value }), [setPrefs])

  const resetPrefs = useCallback(() => {
    dirtyRef.current = true
    setLocalPrefs(DEFAULT_QUIZ_DISPLAY)
    persist(DEFAULT_QUIZ_DISPLAY)
  }, [persist])

  return {
    prefs,
    setPref,
    setPrefs,
    resetPrefs,
    displayVars: resolveQuizDisplayVars(prefs),
    saving,
  }
}

export default useQuizDisplayPrefs
