// useRemoteAssignmentAdoption — the Dashboard-side consumer of active-
// assignment changes made ANYWHERE ELSE, from either delivery path:
//
//   source 'remote'    — another DEVICE switched; useActiveAssignmentSync
//                        validated the assignment and dispatched the same-tab
//                        sync event (carries the seed for the notice copy).
//   source 'cross-tab' — another TAB on this device switched; its dashboard
//                        wrote `zedexams:prep-assignment:{uid}` and the
//                        browser delivered a `storage` event (no seed — the
//                        change is the teacher's own pick seconds ago, so the
//                        dashboard updates silently, without an
//                        "another device" notice).
//
// The dashboard is the surface that OWNS the active-assignment selector, and
// (unlike studios) carries no draft form state — so it adopts automatically.
// This hook only delivers the change; what "adopt" means (set selector state,
// validate against the loaded list, refresh the profile) stays in the
// dashboard.
//
// Dedupe: a change whose id matches what the dashboard already shows is
// dropped (previous !== next). That is also what stops the two paths from
// double-processing one change — whichever arrives first updates the
// dashboard, and the other compares equal.

import { useEffect, useRef } from 'react'
import { REMOTE_ACTIVE_ASSIGNMENT_EVENT } from '../utils/activeAssignmentSyncCore.js'

/**
 * @param {string|null} uid       signed-in teacher (null disables the hook)
 * @param {string} currentId      the assignment id the dashboard shows now
 * @param {(change: {id: string, seed: object|null, source: 'remote'|'cross-tab'}) => void} onAdopt
 */
export default function useRemoteAssignmentAdoption(uid, currentId, onAdopt) {
  // Refs so the stable listeners always see the latest values without
  // re-binding (and without re-subscribing on every selector change).
  const currentRef = useRef(currentId)
  currentRef.current = currentId
  const onAdoptRef = useRef(onAdopt)
  onAdoptRef.current = onAdopt

  useEffect(() => {
    if (!uid || typeof window === 'undefined') return undefined
    const deliver = (id, seed, source) => {
      if (!id || id === currentRef.current) return
      if (typeof onAdoptRef.current === 'function') {
        onAdoptRef.current({ id, seed, source })
      }
    }
    const onRemote = (e) => {
      const detail = e && e.detail
      if (!detail || detail.uid !== uid) return
      deliver(typeof detail.id === 'string' ? detail.id : '', detail.seed || null, 'remote')
    }
    const prepKey = `zedexams:prep-assignment:${uid}`
    const onStorage = (e) => {
      if (e.key !== prepKey) return
      // newValue null = key removed (no pick) — never clear the selector.
      deliver(typeof e.newValue === 'string' ? e.newValue.trim() : '', null, 'cross-tab')
    }
    window.addEventListener(REMOTE_ACTIVE_ASSIGNMENT_EVENT, onRemote)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(REMOTE_ACTIVE_ASSIGNMENT_EVENT, onRemote)
      window.removeEventListener('storage', onStorage)
    }
  }, [uid])
}
