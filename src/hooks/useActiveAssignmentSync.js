// useActiveAssignmentSync — the ONE live cross-device listener for the
// teacher's active teaching assignment.
//
// Mounted once (headless <ActiveAssignmentSync /> in App.jsx) and active only
// while a teacher is signed in. It subscribes to teacherProfiles/{uid} and,
// when activeAssignmentId changes on ANOTHER device, validates the id against
// the real assignment doc and — only if it's a live, usable assignment —
// mirrors it into this device's local caches (`zedexams:prep-assignment:{uid}`
// + the active-seed) and dispatches REMOTE_ACTIVE_ASSIGNMENT_EVENT.
//
// What it deliberately does NOT do:
//   • never writes to Firestore (repairing a dangling id stays on the
//     dashboard, which has the full assignment list to resolve against)
//   • never mutates open form state — open studios get the same non-blocking
//     Switch / Keep notice as cross-tab changes (useTeachingAssignmentChangeNotice)
//   • never clears a local pick because the profile has none yet
//
// Offline reconcile is the listener itself: Firestore re-delivers the latest
// snapshot on reconnect, and the local echo of this device's own write compares
// equal to localStorage, so nothing loops. Sign-out flips uid to null, which
// tears the subscription down (cleanup below).

import { useEffect } from 'react'
import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/config'
import { useAuth } from '../contexts/AuthContext'
import { normalizeAssignment } from '../utils/teachingProfileCore'
import { writeActiveAssignmentSeed } from '../utils/activeAssignmentSeed'
import {
  planRemoteAdoption,
  REMOTE_ACTIVE_ASSIGNMENT_EVENT,
} from '../utils/activeAssignmentSyncCore'

const prepKey = (uid) => `zedexams:prep-assignment:${uid}`

function readLocalId(uid) {
  try {
    return window.localStorage.getItem(prepKey(uid)) || ''
  } catch {
    return '' // private mode / storage unavailable
  }
}

export default function useActiveAssignmentSync() {
  const { currentUser, isTeacher } = useAuth()
  const uid = isTeacher && currentUser?.uid ? currentUser.uid : null

  useEffect(() => {
    if (!uid || typeof window === 'undefined') return undefined
    // One mutable record instead of loose lets: the drain loop reads/writes it
    // across awaits, and it is only ever entered once at a time (`draining`).
    const state = {
      disposed: false,
      draining: false,
      queuedId: null, // latest remote id awaiting validation (bursts collapse)
      lastHandledId: '', // don't re-fetch an id already validated this session
    }

    async function drain() {
      if (state.draining) return
      state.draining = true
      try {
        while (state.queuedId !== null && !state.disposed) {
          const remoteId = state.queuedId
          state.queuedId = null
          if (remoteId === state.lastHandledId) continue
          const first = planRemoteAdoption({ remoteId, localId: readLocalId(uid) })
          if (first.action !== 'fetch') continue
          let assignment = null
          try {
            const snap = await getDoc(doc(db, 'teacherProfiles', uid, 'teachingAssignments', remoteId))
            assignment = snap.exists() ? { id: snap.id, ...normalizeAssignment(snap.data()) } : null
          } catch {
            // Transient read failure — leave local state untouched and DON'T
            // mark the id handled; the next snapshot / reconnect retries.
            continue
          }
          if (state.disposed) return
          state.lastHandledId = remoteId
          const plan = planRemoteAdoption({ remoteId, localId: readLocalId(uid), assignment })
          if (plan.action !== 'adopt') continue
          try { window.localStorage.setItem(prepKey(uid), remoteId) } catch { /* quota / private mode */ }
          writeActiveAssignmentSeed(uid, assignment)
          window.dispatchEvent(
            new CustomEvent(REMOTE_ACTIVE_ASSIGNMENT_EVENT, { detail: { uid, seed: plan.seed } }),
          )
        }
      } finally {
        state.draining = false
      }
    }

    const unsubscribe = onSnapshot(
      doc(db, 'teacherProfiles', uid),
      (snap) => {
        if (state.disposed || !snap.exists()) return
        const data = snap.data() || {}
        state.queuedId = typeof data.activeAssignmentId === 'string' ? data.activeAssignmentId : ''
        void drain()
      },
      (err) => {
        // Non-fatal: the app works exactly as before this listener existed.
        console.warn('active-assignment sync listener failed:', err?.code || err)
      },
    )

    return () => {
      state.disposed = true
      unsubscribe()
    }
  }, [uid])
}

/** Headless mount point — renders nothing, syncs while a teacher is signed in. */
export function ActiveAssignmentSync() {
  useActiveAssignmentSync()
  return null
}
