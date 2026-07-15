// useRemoteAssignmentAdoption — the Dashboard-side consumer of the
// cross-device sync event (see useActiveAssignmentSync).
//
// The dashboard is the surface that OWNS the active-assignment selector, and
// (unlike studios) carries no draft form state — so when another device
// switches the active assignment, an idle dashboard adopts it automatically
// and shows a small informational notice instead of a Switch / Keep prompt.
// This hook only delivers the event; what "adopt" means (set selector state,
// refresh the profile if the assignment is unknown) stays in the dashboard.
//
// Dedupe: an event whose id matches what the dashboard already shows is
// dropped (previous !== next), so the sync listener's own echoes and repeated
// snapshots can't re-fire the notice.

import { useEffect, useRef } from 'react'
import { REMOTE_ACTIVE_ASSIGNMENT_EVENT } from '../utils/activeAssignmentSyncCore.js'

/**
 * @param {string|null} uid       signed-in teacher (null disables the hook)
 * @param {string} currentId      the assignment id the dashboard shows now
 * @param {(change: {id: string, seed: object|null}) => void} onAdopt
 */
export default function useRemoteAssignmentAdoption(uid, currentId, onAdopt) {
  // Refs so the stable listener always sees the latest values without
  // re-binding (and without re-subscribing on every selector change).
  const currentRef = useRef(currentId)
  currentRef.current = currentId
  const onAdoptRef = useRef(onAdopt)
  onAdoptRef.current = onAdopt

  useEffect(() => {
    if (!uid || typeof window === 'undefined') return undefined
    const onRemote = (e) => {
      const detail = e && e.detail
      if (!detail || detail.uid !== uid) return
      const id = typeof detail.id === 'string' ? detail.id : ''
      if (!id || id === currentRef.current) return
      if (typeof onAdoptRef.current === 'function') {
        onAdoptRef.current({ id, seed: detail.seed || null })
      }
    }
    window.addEventListener(REMOTE_ACTIVE_ASSIGNMENT_EVENT, onRemote)
    return () => window.removeEventListener(REMOTE_ACTIVE_ASSIGNMENT_EVENT, onRemote)
  }, [uid])
}
