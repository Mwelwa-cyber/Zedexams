// useAiOperationLock — shared request lock + idempotency-key manager for one
// AI-generation button.
//
// Why this exists: every studio's "Generate" button today only disables on
// `status === 'generating'` React state, which updates asynchronously — a
// double-click, a rapid tap on a slow device, or two mounted instances of the
// same button (a rerender, a route remount) can still both slip past the
// disabled check and fire two full-price generations before React catches
// up. This hook adds a synchronous ref-based lock (checked and set BEFORE any
// await, in the same tick as the click) plus a client-generated idempotency
// key that a Cloud Function reservation service can use to guarantee one
// logical request produces exactly one result and one usage charge — see
// functions/aiOperations.js.
//
// Pure decision logic (fingerprint comparison, key reuse-vs-mint) lives in
// aiOperationLockCore.js so it's unit-testable without React or storage.
//
// Lock scope: `lockKey` is operation-specific, e.g.
// `assessment:${assessmentId}:generate-full` or `regenerate-section:${id}`.
// Two DIFFERENT lock keys run independently; the SAME lock key across
// double-clicks / rerenders / remounts (and, best-effort, other tabs) is
// coordinated to run at most once at a time. Cross-tab awareness is
// advisory only (BroadcastChannel, degrades silently where unavailable) —
// the server-side aiOperations record is what actually prevents two tabs
// both calling the provider; see reserveAiOperation's tx.create() race.

import {useCallback, useEffect, useRef, useState} from 'react'
import {resolveIdempotencyKey, buildPendingRecord, storageKeyFor} from './aiOperationLockCore.js'

// Module-level (not per-hook-instance) so the SAME lockKey is coordinated
// across every mounted component in this tab — not just repeated clicks on
// one button instance. Covers the "two mounted instances" and "route
// remount while a request is still in flight" cases the per-instance ref
// alone can't.
const activeLocks = new Set()

const CHANNEL_NAME = 'zedexams-ai-operation-lock'
let sharedChannel
let channelInitAttempted = false
function getChannel() {
  if (!channelInitAttempted) {
    channelInitAttempted = true
    try {
      if (typeof BroadcastChannel !== 'undefined') sharedChannel = new BroadcastChannel(CHANNEL_NAME)
    } catch {
      sharedChannel = undefined
    }
  }
  return sharedChannel
}

function readPersisted(lockKey) {
  try {
    const raw = sessionStorage.getItem(storageKeyFor(lockKey))
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writePersisted(lockKey, record) {
  try {
    if (record) sessionStorage.setItem(storageKeyFor(lockKey), JSON.stringify(record))
    else sessionStorage.removeItem(storageKeyFor(lockKey))
  } catch {
    // Storage unavailable (private mode / quota) — the in-memory lock still
    // protects this tab; only cross-refresh resume is lost.
  }
}

function randomUuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // Defensive fallback for a hostile/ancient WebView — every supported
  // browser/Capacitor target has crypto.randomUUID().
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

/**
 * @param {string} lockKey  Operation-specific lock scope (see file header).
 * @returns {{
 *   run: (opts: {fingerprint: string, action: (idempotencyKey: string) => Promise<any>}) => Promise<{ok:true,data:any,idempotencyKey:string}|{ok:false,reason:'locked'|'error',error?:any,idempotencyKey?:string}>,
 *   isRunning: boolean,
 *   otherTabRunning: boolean,
 *   clear: () => void,
 * }}
 */
export function useAiOperationLock(lockKey) {
  const lockRef = useRef(false) // synchronous — set before any await, unlike React state
  const [isRunning, setIsRunning] = useState(() => activeLocks.has(lockKey))
  const [otherTabRunning, setOtherTabRunning] = useState(false)

  // A lockKey change (e.g. switching which section is being regenerated)
  // must re-sync isRunning to the NEW key's actual lock state, not carry
  // over the previous key's.
  useEffect(() => {
    setIsRunning(activeLocks.has(lockKey))
  }, [lockKey])

  useEffect(() => {
    const channel = getChannel()
    if (!channel) return undefined
    const onMessage = (event) => {
      const msg = event?.data
      if (!msg || msg.lockKey !== lockKey) return
      if (msg.type === 'started') setOtherTabRunning(true)
      else if (msg.type === 'finished') setOtherTabRunning(false)
    }
    channel.addEventListener('message', onMessage)
    return () => channel.removeEventListener('message', onMessage)
  }, [lockKey])

  const run = useCallback(async ({fingerprint, action}) => {
    // Synchronous check-and-set — both the ref (this component instance,
    // survives rerenders) and the module Set (every instance sharing this
    // lockKey) are consulted and claimed in the same tick as the call, with
    // no `await` between the check and the claim.
    if (lockRef.current || activeLocks.has(lockKey)) {
      return {ok: false, reason: 'locked'}
    }
    lockRef.current = true
    activeLocks.add(lockKey)
    setIsRunning(true)
    getChannel()?.postMessage({type: 'started', lockKey, ts: Date.now()})

    let idempotencyKey
    try {
      const persisted = readPersisted(lockKey)
      const {key: resumedKey} = resolveIdempotencyKey({persisted, fingerprint, now: Date.now()})
      idempotencyKey = resumedKey || randomUuid()
      writePersisted(lockKey, buildPendingRecord({key: idempotencyKey, fingerprint, now: Date.now()}))

      const data = await action(idempotencyKey)
      // Done — a future click under this lockKey is a new logical request,
      // so it must mint a fresh key rather than resume this one.
      writePersisted(lockKey, null)
      return {ok: true, data, idempotencyKey}
    } catch (error) {
      // Deliberately DO NOT clear the persisted pending record here: the
      // client cannot tell a lost-response timeout (server may still be
      // running, or may have completed) from a definitive server rejection.
      // Leaving it in place means the next attempt with the SAME inputs
      // reuses the same idempotencyKey and lets the server resume/no-op
      // instead of billing twice (§14). A caller that receives a definitive
      // terminal failure (e.g. a non-retryable AiOperationError) and wants
      // the next click to start a genuinely new request should call
      // `clear()` explicitly.
      return {ok: false, reason: 'error', error, idempotencyKey}
    } finally {
      // eslint-disable-next-line require-atomic-updates -- plain assignment after the preceding await, not a read-modify-write; nothing else can flip this ref between the check and this line.
      lockRef.current = false
      activeLocks.delete(lockKey)
      setIsRunning(false)
      getChannel()?.postMessage({type: 'finished', lockKey, ts: Date.now()})
    }
  }, [lockKey])

  const clear = useCallback(() => writePersisted(lockKey, null), [lockKey])

  return {run, isRunning, otherTabRunning, clear}
}
