// Active-assignment cross-device sync — pure decision logic (no Firebase/DOM).
//
// The dashboard persists the teacher's active assignment to BOTH this device
// (localStorage `zedexams:prep-assignment:{uid}`) and the profile doc
// (`teacherProfiles/{uid}.activeAssignmentId`, via setActiveAssignmentId).
// useActiveAssignmentSync listens to the profile doc so a switch made on
// ANOTHER device reaches this one live. This module decides — from plain
// values — whether a remote id is worth acting on, so the policy is
// node-testable without a Firestore emulator:
//
//   plan({ remoteId, localId })              → 'none' | 'fetch'
//   plan({ remoteId, localId, assignment })  → 'none' | 'ignore' | 'adopt'
//
// Adoption NEVER mutates open form state — the hook updates the local caches
// and dispatches REMOTE_ACTIVE_ASSIGNMENT_EVENT; open studios surface it as
// the same Switch / Keep notice used for cross-tab changes.
//
// Run tests: npm run test:active-assignment-sync

import { normalizeAssignment } from './teachingProfileCore.js'
import { assignmentSelectorSeed } from './activeAssignmentSeed.js'

/** Same-tab event carrying an adopted remote change: detail = { uid, seed }. */
export const REMOTE_ACTIVE_ASSIGNMENT_EVENT = 'zedexams:active-assignment-remote-change'

function id(v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * Decide what to do about the profile's activeAssignmentId.
 *
 * Two-step by design: call without `assignment` first (no read needed to
 * discover the ids already agree), then again with the fetched assignment
 * (undefined = not fetched yet; null = fetched, doesn't exist).
 *
 * @returns {{ action: 'none'|'fetch'|'ignore'|'adopt', id?: string, seed?: object }}
 */
export function planRemoteAdoption({ remoteId, localId, assignment } = {}) {
  const remote = id(remoteId)
  const local = id(localId)
  if (!remote) return { action: 'none' } // nothing synced yet — never clear a local pick
  if (remote === local) return { action: 'none' } // already in sync
  if (assignment === undefined) return { action: 'fetch', id: remote }

  // Validate before adopting: the id must point at a real, ACTIVE assignment
  // that carries a usable seed. A dangling/deactivated reference is ignored —
  // the dashboard's repair path (not this listener) writes corrections back.
  if (!assignment || typeof assignment !== 'object') return { action: 'ignore' }
  const normalized = normalizeAssignment(assignment)
  if (!normalized.isActive) return { action: 'ignore' }
  const seed = assignmentSelectorSeed(normalized)
  if (!seed) return { action: 'ignore' }
  return { action: 'adopt', id: remote, seed }
}
