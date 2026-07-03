/**
 * useDraftManager — the single front door every ZedExams studio connects to for
 * "never lose work" auto-save, recovery, and session protection.
 *
 * It composes the pure core (draftCore), the on-device store (draftIdbStore),
 * the cloud mirror (draftCloudSync), cross-tab coordination (draftTabLock), the
 * network signal (useNetworkStatus) and the app's critical-work guard
 * (criticalWork — which gives us PWA-update deferral AND a beforeunload warning
 * for free while a draft is unsaved).
 *
 * A studio wires it in with a descriptor + its live state:
 *
 *   const draft = useDraftManager({
 *     studioId: 'worksheet', uid, draftId, descriptor, state,
 *     enabled, cloud: true, onRestore: (payload) => applyToState(payload),
 *   })
 *
 * and renders <DraftRecoveryPrompt {...draft} /> + <DraftStatusIndicator … />.
 * On the studio's real save, it calls draft.clear().
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildDraftPayload,
  isLiveDraft,
  computeDirtyFingerprint,
  pushVersion,
  DRAFT_TTL,
} from './draftCore.js'
import {
  idbGetDraft,
  idbPutDraft,
  idbDeleteDraft,
  idbSweepExpired,
} from './draftIdbStore.js'
import {
  saveDraftRemote,
  deleteDraftRemote,
  loadDraftMerged,
} from './draftCloudSync.js'
import { createTabLock } from './draftTabLock.js'
import { useNetworkStatus } from '../useNetworkStatus.js'
import { beginCriticalWork } from '../../utils/criticalWork.js'

const EMPTY_RECOVERY = { available: false, payload: null, source: null }

export function useDraftManager({
  studioId,
  uid,
  draftId,
  descriptor,
  state,
  enabled = true,
  debounceMs = 2500,
  cloud = true,
  onRestore,
}) {
  const online = useNetworkStatus()

  const [status, setStatus] = useState('idle') // idle | saving | saved | offline | local-only | error
  const [savedAt, setSavedAt] = useState(null)
  const [recovery, setRecovery] = useState(EMPTY_RECOVERY)
  const [versions, setVersions] = useState([])
  const [tabStatus, setTabStatus] = useState('owner')

  const active = Boolean(enabled && uid && draftId && descriptor)

  // Refs so the persist path reads live values without re-subscribing effects.
  const lastFingerprintRef = useRef(null)
  const versionsRef = useRef([])
  const releaseRef = useRef(null) // held critical-work token while dirty
  const tabStatusRef = useRef('owner')
  const onlineRef = useRef(online)
  onlineRef.current = online
  const onRestoreRef = useRef(onRestore)
  onRestoreRef.current = onRestore

  const ident = { studioId, uid, draftId }

  const releaseCritical = useCallback(() => {
    if (releaseRef.current) {
      releaseRef.current()
      releaseRef.current = null
    }
  }, [])

  /* ── mount: sweep, then offer the freshest recoverable draft ── */
  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    ;(async () => {
      await idbSweepExpired(descriptor.ttl ?? DRAFT_TTL)
      const localRecord = await idbGetDraft(ident)
      const localPayload = localRecord?.payload || null
      const localLive = localPayload && isLiveDraft(localPayload, descriptor) ? localPayload : null
      const { draft, source, remoteVersions } = await loadDraftMerged({
        uid, studioId, draftId, descriptor, local: localLive,
      })
      if (cancelled) return
      // Seed the version ring from whichever store had the most history.
      const seed = (localRecord?.versions?.length || 0) >= (remoteVersions?.length || 0)
        ? (localRecord?.versions || [])
        : remoteVersions
      versionsRef.current = seed
      setVersions(seed)
      if (draft && isLiveDraft(draft, descriptor)) {
        setRecovery({ available: true, payload: draft, source })
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, uid, studioId, draftId])

  /* ── cross-tab lock: a shadow tab keeps saving locally but not to cloud ── */
  useEffect(() => {
    if (!active) return undefined
    const lock = createTabLock({
      studioId,
      draftId,
      onChange: (s) => { tabStatusRef.current = s; setTabStatus(s) },
    })
    tabStatusRef.current = lock.getStatus()
    setTabStatus(lock.getStatus())
    return () => lock.stop()
  }, [active, studioId, draftId])

  /* ── the write path ── */
  const persist = useCallback(async (payload, fingerprint) => {
    const nextVersions = pushVersion(versionsRef.current, payload)
    versionsRef.current = nextVersions
    setVersions(nextVersions)

    await idbPutDraft({ ...ident, payload, versions: nextVersions })

    let cloudOutcome = null
    if (cloud && tabStatusRef.current === 'owner') {
      cloudOutcome = await saveDraftRemote({ ...ident, payload, versions: nextVersions })
    }

    lastFingerprintRef.current = fingerprint
    setSavedAt(payload.savedAt)
    if (cloud && cloudOutcome === 'too-large') setStatus('local-only')
    else if (cloud && cloudOutcome === 'error') setStatus(onlineRef.current ? 'error' : 'offline')
    else if (!onlineRef.current) setStatus(cloud ? 'offline' : 'saved')
    else setStatus('saved')

    releaseCritical()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, studioId, uid, draftId, releaseCritical])

  const pendingRef = useRef(null) // { payload, fingerprint } scheduled for save

  /* ── debounced auto-save on state change ── */
  useEffect(() => {
    if (!active) return undefined
    const payload = buildDraftPayload(state, descriptor)
    // Don't create a draft for an untouched / empty form — nothing worth
    // recovering, and it avoids a spurious recovery prompt on the next visit.
    if (descriptor.isNonEmpty && !descriptor.isNonEmpty(payload)) {
      releaseCritical()
      return undefined
    }
    const fingerprint = computeDirtyFingerprint(payload)
    if (fingerprint === lastFingerprintRef.current) return undefined // nothing changed

    // Dirty: announce critical work so a PWA update / unload can't silently
    // discard the pending edits (the token is released once the save lands).
    if (!releaseRef.current) releaseRef.current = beginCriticalWork()
    setStatus('saving')
    pendingRef.current = { payload, fingerprint }

    const timer = setTimeout(() => { persist(payload, fingerprint) }, debounceMs)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, state, debounceMs, persist])

  useEffect(() => () => releaseCritical(), [releaseCritical])

  /* ── public actions ── */
  const flush = useCallback(async () => {
    if (!pendingRef.current) return
    const { payload, fingerprint } = pendingRef.current
    pendingRef.current = null
    await persist(payload, fingerprint)
  }, [persist])

  const acceptRecovery = useCallback(() => {
    const payload = recovery.payload
    if (!payload) return
    // Restoring sets the studio's state = payload, which would otherwise fire a
    // fresh auto-save; pin the fingerprint so the restored content isn't
    // re-persisted as a spurious new version.
    lastFingerprintRef.current = computeDirtyFingerprint(payload)
    onRestoreRef.current?.(descriptor.hydrate ? descriptor.hydrate(payload) : payload)
    setRecovery(EMPTY_RECOVERY)
    setSavedAt(payload.savedAt)
    setStatus('saved')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recovery])

  const discardRecovery = useCallback(async () => {
    setRecovery(EMPTY_RECOVERY)
    await idbDeleteDraft(ident)
    if (cloud) await deleteDraftRemote({ uid, draftId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, uid, draftId])

  const clear = useCallback(async () => {
    releaseCritical()
    pendingRef.current = null
    lastFingerprintRef.current = null
    versionsRef.current = []
    setVersions([])
    setRecovery(EMPTY_RECOVERY)
    setStatus('idle')
    setSavedAt(null)
    await idbDeleteDraft(ident)
    if (cloud) await deleteDraftRemote({ uid, draftId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud, uid, draftId, releaseCritical])

  return {
    status,
    savedAt,
    online,
    source: recovery.source,
    recovery,
    acceptRecovery,
    discardRecovery,
    versions,
    tabStatus,
    clear,
    flush,
  }
}
