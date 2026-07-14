// useTeachingAssignmentChangeNotice — the ONE shared listener that lets an open
// studio notice (but never auto-apply) a teaching-assignment change the teacher
// made on the Dashboard in another tab.
//
// The Dashboard persists the active assignment's seed to
// `zedexams:active-seed:{uid}` (see activeAssignmentSeed.js). A cross-tab
// `storage` event carries that change to any open studio. This hook compares it
// to what the studio is CURRENTLY using and, when they differ, exposes a
// `pending` seed the studio surfaces as a Switch / Keep notice. It mutates
// nothing — applying the change is the studio's explicit choice.
//
// One listener, added once per studio via this hook — no duplicate permanent
// listeners scattered across form components.

import { useState, useEffect, useRef } from 'react'
import { parseStoredSeed, seedsDiffer } from '../components/teacher/generate/teachingAssignmentChangeNoticeCore.js'

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
    const onStorage = (e) => {
      if (e.key !== key) return
      const next = parseStoredSeed(e.newValue)
      if (!next) { setPending(null); return }
      // Same as what we already show, or a change the teacher already actioned.
      if (!seedsDiffer(currentRef.current, next)) { setPending(null); return }
      if (handledRef.current && !seedsDiffer(handledRef.current, next)) return
      setPending(next)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [uid])

  const keep = () => { if (pending) handledRef.current = pending; setPending(null) }
  const clear = () => { if (pending) handledRef.current = pending; setPending(null) }
  return { pending, keep, clear }
}
