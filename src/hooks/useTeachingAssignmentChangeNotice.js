// useTeachingAssignmentChangeNotice — the ONE shared listener that lets an open
// studio notice (but never auto-apply) a teaching-assignment change the teacher
// made on the Dashboard in another tab OR on another device.
//
// Two delivery paths, one notice:
//   • cross-tab — the Dashboard persists the active assignment's seed to
//     `zedexams:active-seed:{uid}` (see activeAssignmentSeed.js); a `storage`
//     event carries the change to studios open in OTHER tabs.
//   • cross-device — useActiveAssignmentSync adopts a remote profile change
//     and dispatches REMOTE_ACTIVE_ASSIGNMENT_EVENT in THIS tab (storage
//     events never fire in the tab that wrote the value).
//
// Either way the hook compares the incoming seed to what the studio is
// CURRENTLY using and, when they differ, exposes a `pending` seed the studio
// surfaces as a Switch / Keep notice. It mutates nothing — applying the change
// is the studio's explicit choice.
//
// One listener pair, added once per studio via this hook — no duplicate
// permanent listeners scattered across form components.

import { useState, useEffect, useRef } from 'react'
import { parseStoredSeed, seedsDiffer } from '../shared/utils/teachingAssignmentChangeNoticeCore.js'
import { REMOTE_ACTIVE_ASSIGNMENT_EVENT } from '../utils/activeAssignmentSyncCore.js'

const seedKey = (uid) => `zedexams:active-seed:${uid}`

/**
 * @param {string} uid
 * @param {{grade,subject,curriculum}} currentSeed  what the studio uses now
 * @returns {{ pending: object|null, keep: () => void, clear: () => void }}
 *   pending — the changed seed to offer, or null
 *   keep    — dismiss the notice, remember the choice (won't re-nag for it)
 *   clear   — dismiss after the studio applied the change
 */
export default function useTeachingAssignmentChangeNotice(uid, currentSeed) {
  const [pending, setPending] = useState(null)
  // Refs so the stable listener always sees the latest values without re-binding.
  const currentRef = useRef(currentSeed)
  currentRef.current = currentSeed
  const handledRef = useRef(null)

  useEffect(() => {
    if (!uid || typeof window === 'undefined') return undefined
    const key = seedKey(uid)
    const offer = (next) => {
      if (!next) { setPending(null); return }
      // Same as what we already show, or a change the teacher already actioned.
      if (!seedsDiffer(currentRef.current, next)) { setPending(null); return }
      if (handledRef.current && !seedsDiffer(handledRef.current, next)) return
      setPending(next)
    }
    const onStorage = (e) => {
      if (e.key !== key) return
      offer(parseStoredSeed(e.newValue))
    }
    // Same-tab cross-device path: the sync listener validated the assignment
    // before dispatching, so the detail seed is already normalized — reparse
    // through the same guard anyway so a malformed event can't set junk.
    const onRemote = (e) => {
      const detail = e && e.detail
      if (!detail || detail.uid !== uid) return
      offer(parseStoredSeed(JSON.stringify(detail.seed || null)))
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(REMOTE_ACTIVE_ASSIGNMENT_EVENT, onRemote)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(REMOTE_ACTIVE_ASSIGNMENT_EVENT, onRemote)
    }
  }, [uid])

  const keep = () => { if (pending) handledRef.current = pending; setPending(null) }
  const clear = () => { if (pending) handledRef.current = pending; setPending(null) }
  return { pending, keep, clear }
}
