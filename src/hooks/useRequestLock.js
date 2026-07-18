import { useCallback, useRef, useState } from 'react'
import { createRequestLock } from '../utils/requestControl'

/**
 * Guards an action (typically an AI "Generate…" button) against duplicate
 * concurrent invocations: double-clicks, a re-render re-firing a handler, or
 * the same studio open in two tabs racing the same document. The first call
 * to `run` is accepted immediately and locks; every call while locked is a
 * no-op. Unlike debouncing, nothing here waits — the caller gets synchronous
 * feedback (`isLocked`) to disable the button, and the lock releases the
 * moment the async action settles, success or failure.
 *
 * A fresh `requestId` (crypto.randomUUID, or a fallback) is generated per
 * accepted call and handed to `fn` — pass it to the backend so a retried
 * network call or a duplicate webhook delivery can be deduped server-side
 * instead of creating a second document / charging usage twice.
 *
 *   const { run, isLocked } = useRequestLock()
 *   <button disabled={isLocked} onClick={() => run((requestId) => generateAssessment({ requestId, ... }))} />
 */
export function useRequestLock() {
  const [isLocked, setIsLocked] = useState(false)
  const lockRef = useRef(createRequestLock())

  const run = useCallback(async (fn) => {
    const requestId = lockRef.current.begin()
    if (!requestId) return undefined // already in flight — ignore this call
    setIsLocked(true)
    try {
      return await fn(requestId)
    } finally {
      lockRef.current.release(requestId)
      setIsLocked(false)
    }
  }, [])

  return { run, isLocked }
}
