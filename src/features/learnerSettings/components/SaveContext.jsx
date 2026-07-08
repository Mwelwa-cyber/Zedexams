// Learner Settings — autosave engine + status/undo context.
//
// Panels call `commit(patch)` with the exact Firestore fields they changed
// (flat keys like `displayName`, or dot-paths like `learnerSettings.security`
// for a nested merge). The provider:
//   • debounces writes (auto-save in the background) via updateProfileFields
//   • drives the sticky bar's "Saving…" / "Saved" / "Couldn't save" status
//   • captures a one-step undo snapshot of the pre-edit values
//   • warns before the tab unloads while a write is pending
//
// Firestore's offline persistence queues the write when offline and replays it
// on reconnect, so a learner can change settings on the bus and they sync when
// signal returns — no extra code here.

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useAuth } from '../../../contexts/AuthContext'

const SaveContext = createContext(null)

export function useSettingsSave() {
  const ctx = useContext(SaveContext)
  if (!ctx) throw new Error('useSettingsSave must be used within <SettingsSaveProvider>')
  return ctx
}

// Read a possibly dot-pathed key out of an object (for undo snapshots).
function getByPath(obj, path) {
  if (!obj) return undefined
  if (!path.includes('.')) return obj[path]
  return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj)
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

// Merge a new patch into the pending patch. Panels commit whole nested objects
// under a single key (e.g. `learnerSettings.personalisation`); if two such
// commits land in the same debounce window, a plain replace would drop the
// first change, so same-key object values are merged instead.
function mergePatch(base, patch) {
  const out = { ...base }
  for (const [key, val] of Object.entries(patch)) {
    out[key] = isPlainObject(val) && isPlainObject(out[key]) ? { ...out[key], ...val } : val
  }
  return out
}

const DEBOUNCE_MS = 750
const SAVED_LINGER_MS = 1800

export function SettingsSaveProvider({ children }) {
  const { userProfile, updateProfileFields } = useAuth()

  // Keep the freshest profile in a ref so undo snapshots read live values
  // without re-creating `commit` on every profile snapshot.
  const profileRef = useRef(userProfile)
  useEffect(() => { profileRef.current = userProfile }, [userProfile])

  const [status, setStatus] = useState('idle') // idle | dirty | saving | saved | error
  const [canUndo, setCanUndo] = useState(false)

  const pendingRef = useRef({}) // field → new value, accumulated across a burst
  const undoRef = useRef(null) // field → previous value, captured once per burst
  const timerRef = useRef(null)
  const savedTimerRef = useRef(null)

  const flush = useCallback(async () => {
    clearTimeout(timerRef.current)
    const patch = pendingRef.current
    const keys = Object.keys(patch)
    if (keys.length === 0) return
    pendingRef.current = {}
    setStatus('saving')
    try {
      await updateProfileFields(patch)
      setStatus('saved')
      clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => {
        setStatus((s) => (s === 'saved' ? 'idle' : s))
      }, SAVED_LINGER_MS)
    } catch {
      // Re-queue so a retry (Save button) or the next edit re-attempts.
      pendingRef.current = { ...patch, ...pendingRef.current }
      setStatus('error')
    }
  }, [updateProfileFields])

  const commit = useCallback((patch) => {
    if (!patch || typeof patch !== 'object') return
    const profile = profileRef.current || {}
    // Capture the pre-edit value the first time each field is touched in
    // this burst, so a single Undo reverts the whole burst.
    if (!undoRef.current) undoRef.current = {}
    for (const key of Object.keys(patch)) {
      if (!(key in undoRef.current)) {
        undoRef.current[key] = getByPath(profile, key)
      }
    }
    pendingRef.current = mergePatch(pendingRef.current, patch)
    setStatus('dirty')
    setCanUndo(true)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(flush, DEBOUNCE_MS)
  }, [flush])

  const saveNow = useCallback(() => { flush() }, [flush])

  const undo = useCallback(async () => {
    const snapshot = undoRef.current
    if (!snapshot) return
    undoRef.current = null
    setCanUndo(false)
    clearTimeout(timerRef.current)
    pendingRef.current = {}
    // Firestore rejects `undefined`; drop keys that had no prior value.
    const revert = {}
    for (const [k, v] of Object.entries(snapshot)) {
      if (v !== undefined) revert[k] = v
    }
    if (Object.keys(revert).length === 0) { setStatus('idle'); return }
    setStatus('saving')
    try {
      await updateProfileFields(revert)
      setStatus('saved')
      clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => {
        setStatus((s) => (s === 'saved' ? 'idle' : s))
      }, SAVED_LINGER_MS)
    } catch {
      setStatus('error')
    }
  }, [updateProfileFields])

  // The undo burst ends when the bar settles back to idle — NOT the moment the
  // save lands. The "All changes saved" phase still renders the Undo button, so
  // clearing the snapshot on 'saved' left a visible Undo that did nothing.
  useEffect(() => {
    if (status === 'idle') {
      undoRef.current = null
      setCanUndo(false)
    }
  }, [status])

  // Warn before leaving with an unsaved / in-flight change.
  useEffect(() => {
    const pending = status === 'dirty' || status === 'saving' || status === 'error'
    if (!pending) return undefined
    const onBeforeUnload = (e) => {
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [status])

  // Flush any pending write on unmount.
  useEffect(() => () => {
    clearTimeout(timerRef.current)
    clearTimeout(savedTimerRef.current)
    if (Object.keys(pendingRef.current).length > 0) flush()
  }, [flush])

  const value = { status, canUndo, commit, saveNow, undo }
  return <SaveContext.Provider value={value}>{children}</SaveContext.Provider>
}
