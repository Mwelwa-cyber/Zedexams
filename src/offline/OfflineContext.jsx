/**
 * OfflineContext — the single React surface for offline state. Wires the
 * framework-agnostic syncEngine into component-friendly state and exposes the
 * derived connectivity status (connectivityCore) plus the actions the UI needs.
 *
 * Mounted once near the app root (src/main.jsx). Everything degrades gracefully
 * when IndexedDB / navigator are unavailable, so consumers never have to guard.
 *
 *   const { status, online, pending, enqueue, refresh } = useOffline()
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { deriveStatus, statusLabel, statusTone, shouldShowIndicator, STATUS } from './connectivityCore.js'
import { start as startEngine, subscribe as subscribeEngine, enqueueAction, flush } from './syncEngine.js'

const OfflineContext = createContext(null)

function readOnline() {
  try {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false
  } catch {
    return true
  }
}

export function OfflineProvider({ children }) {
  const [online, setOnline] = useState(readOnline)
  const [pending, setPending] = useState(0)
  const [syncing, setSyncing] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [savedRecently, setSavedRecently] = useState(false)
  const savedTimer = useRef(null)

  // Connectivity listeners (kept alongside the engine's own so React state
  // tracks the transition even if the engine's flush is a no-op).
  useEffect(() => {
    const onUp = () => setOnline(true)
    const onDown = () => setOnline(false)
    if (typeof window !== 'undefined') {
      window.addEventListener('online', onUp)
      window.addEventListener('offline', onDown)
    }
    const stop = startEngine()
    const unsub = subscribeEngine((snap) => {
      setPending(snap.pending)
      setSyncing(snap.syncing)
    })
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('online', onUp)
        window.removeEventListener('offline', onDown)
      }
      unsub()
      stop()
    }
  }, [])

  // Flash a transient "Saved offline" confirmation for ~2.5s.
  const flashSavedOffline = useCallback(() => {
    setSavedRecently(true)
    if (savedTimer.current) clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSavedRecently(false), 2500)
  }, [])

  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current) }, [])

  const enqueue = useCallback(async (spec) => {
    const id = await enqueueAction(spec)
    if (!readOnline()) flashSavedOffline()
    return id
  }, [flashSavedOffline])

  const refresh = useCallback(() => flush(), [])

  const status = useMemo(
    () => deriveStatus({ online, syncing, updating, pending, savedOfflineRecently: savedRecently }),
    [online, syncing, updating, pending, savedRecently],
  )

  const value = useMemo(() => ({
    online,
    pending,
    syncing,
    updating,
    status,
    label: statusLabel(status, pending),
    tone: statusTone(status),
    showIndicator: shouldShowIndicator(status),
    STATUS,
    enqueue,
    refresh,
    setUpdating,
    flashSavedOffline,
  }), [online, pending, syncing, updating, status, enqueue, refresh, flashSavedOffline])

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}

export function useOffline() {
  const ctx = useContext(OfflineContext)
  // Defensive default so a component rendered outside the provider (tests,
  // storybook) still works instead of throwing.
  if (!ctx) {
    return {
      online: true, pending: 0, syncing: false, updating: false,
      status: STATUS.ONLINE, label: 'Online', tone: 'neutral', showIndicator: false,
      STATUS, enqueue: async () => null, refresh: () => {}, setUpdating: () => {}, flashSavedOffline: () => {},
    }
  }
  return ctx
}
