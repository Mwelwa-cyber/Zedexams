import { useCallback, useEffect, useRef, useState } from 'react'
import { useNetworkStatus } from './useNetworkStatus'

/**
 * Shared autosave state machine: schedule a debounced save of the latest
 * draft, show honest status ("Saving…" only appears once a write is truly
 * in flight; "Saved" only after Firestore/the API confirms it), retry
 * transient failures with capped backoff, and never let a stale save from a
 * previous document/context land on the current one.
 *
 * The hook does not read component state on its own — callers push the
 * latest snapshot in via `scheduleSave(draft)` (typically from an onChange
 * handler or a `useEffect` on the field being edited), which keeps this hook
 * unaware of *what* is being saved. `save` is the caller's own persistence
 * function (an `updateDoc`, a callable, …) and should throw a normal Error;
 * throw one with `.code === 'conflict'` to signal "a newer remote revision
 * exists" and have it surface as the `conflict` status instead of `error`.
 *
 * @param {object} opts
 * @param {*} opts.key            identity of the current document/context
 *   (e.g. a draftId or `${classId}:${subject}`). Changing this cancels any
 *   pending timer and in-flight save started under the previous key so it
 *   can never write into the new context.
 * @param {(draft: any, ctx: { signal: AbortSignal }) => Promise<any>} opts.save
 * @param {number} [opts.delay=800]
 * @param {(draft: any) => boolean} [opts.isEmpty]   skip saving empty drafts
 * @param {number} [opts.maxRetries=2]
 * @param {number} [opts.retryBaseDelay=1000]
 * @param {string} [opts.storageKey]  when set, unsaved drafts are mirrored to
 *   localStorage under this key so a failed/offline save survives a reload;
 *   cleared once a save confirms.
 */
export function useAutosave({
  key,
  save,
  delay = 800,
  isEmpty,
  maxRetries = 2,
  retryBaseDelay = 1000,
  storageKey,
} = {}) {
  const [status, setStatus] = useState('idle')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [error, setError] = useState(null)

  const online = useNetworkStatus()
  const onlineRef = useRef(online)
  onlineRef.current = online

  const saveRef = useRef(save)
  saveRef.current = save
  const isEmptyRef = useRef(isEmpty)
  isEmptyRef.current = isEmpty

  const pendingRef = useRef(null)
  const timerRef = useRef(null)
  const tokenRef = useRef(0)
  const keyRef = useRef(key)
  const retryCountRef = useRef(0)
  const abortRef = useRef(null)
  const inFlightRef = useRef(null)

  const persistLocal = useCallback((draft) => {
    if (!storageKey) return
    try {
      localStorage.setItem(storageKey, JSON.stringify({ draft, savedAt: null }))
    } catch { /* quota / private-mode — best effort only */ }
  }, [storageKey])

  const clearLocal = useCallback(() => {
    if (!storageKey) return
    try { localStorage.removeItem(storageKey) } catch { /* noop */ }
  }, [storageKey])

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const doSave = useCallback(() => {
    clearTimer()
    const draft = pendingRef.current
    if (draft == null) return Promise.resolve()
    if (isEmptyRef.current?.(draft)) {
      pendingRef.current = null
      setStatus('idle')
      return Promise.resolve()
    }
    if (!onlineRef.current) {
      persistLocal(draft)
      setStatus('offline')
      return Promise.resolve()
    }

    const myToken = ++tokenRef.current
    const myKey = keyRef.current
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('saving')
    setError(null)

    const promise = Promise.resolve()
      .then(() => saveRef.current(draft, { signal: controller.signal }))
      .then(() => {
        if (tokenRef.current !== myToken || keyRef.current !== myKey) return
        pendingRef.current = null
        retryCountRef.current = 0
        clearLocal()
        setStatus('saved')
        setLastSavedAt(Date.now())
      })
      .catch((err) => {
        if (controller.signal.aborted) return
        if (tokenRef.current !== myToken || keyRef.current !== myKey) return
        persistLocal(draft) // never silently discard a failed save
        if (err?.code === 'conflict') {
          setStatus('conflict')
          setError(err)
          return
        }
        setError(err)
        if (retryCountRef.current < maxRetries && onlineRef.current) {
          retryCountRef.current += 1
          const backoff = retryBaseDelay * 2 ** (retryCountRef.current - 1)
          setStatus('waiting')
          timerRef.current = setTimeout(doSave, backoff)
        } else {
          setStatus('error')
        }
      })
      .finally(() => {
        if (inFlightRef.current === promise) inFlightRef.current = null
      })

    inFlightRef.current = promise
    return promise
  }, [clearLocal, clearTimer, maxRetries, persistLocal, retryBaseDelay])

  const scheduleSave = useCallback((draft) => {
    pendingRef.current = draft
    if (isEmptyRef.current?.(draft)) {
      clearTimer()
      setStatus('idle')
      return
    }
    if (!onlineRef.current) {
      persistLocal(draft)
      setStatus('offline')
      return
    }
    retryCountRef.current = 0
    setStatus('waiting')
    clearTimer()
    timerRef.current = setTimeout(doSave, delay)
  }, [clearTimer, delay, doSave, persistLocal])

  const saveNow = useCallback(() => {
    if (pendingRef.current == null) return inFlightRef.current || Promise.resolve()
    return doSave()
  }, [doSave])

  const cancelSave = useCallback(() => {
    clearTimer()
    abortRef.current?.abort()
    pendingRef.current = null
    tokenRef.current += 1 // invalidate any save already in flight
    retryCountRef.current = 0
    setStatus('idle')
    setError(null)
  }, [clearTimer])

  // Switching document/context: never let a stale timer or in-flight save
  // from the previous key land on the new one.
  useEffect(() => {
    const changed = keyRef.current !== key
    keyRef.current = key
    if (changed) {
      clearTimer()
      abortRef.current?.abort()
      pendingRef.current = null
      tokenRef.current += 1
      retryCountRef.current = 0
      setStatus('idle')
      setError(null)
    }
  }, [key, clearTimer])

  useEffect(() => () => {
    clearTimer()
    abortRef.current?.abort()
    tokenRef.current += 1
  }, [clearTimer])

  return { status, error, lastSavedAt, scheduleSave, saveNow, cancelSave }
}
