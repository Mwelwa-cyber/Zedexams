import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'

// Resolved on first use, not at module load — see ageGateService.js for why
// (a module-level getFunctions() runs ahead of a test's mocked Firebase app
// and turns an unrelated component spec into a crash on import).
let functionsRef = null
function fns() {
  if (!functionsRef) functionsRef = getFunctions(app, 'us-central1')
  return functionsRef
}

/**
 * Claim the existing-teacher trial offer — the client half of
 * functions/teacherTrial/existingTeacherOffer.js.
 *
 * Sends no eligibility claim, no dates, nothing from `userProfile` at all:
 * the server re-derives eligibility and the 7-day expiry itself, from the
 * caller's uid and its own clock. This call is atomic and idempotent on the
 * server — repeating it (a double-tap, a retried request) returns the same
 * grant rather than creating or extending anything.
 *
 * The teacher's own profile updates through the existing AuthContext
 * onSnapshot listener once the write lands — this function does not (and
 * should not) mutate any local state itself.
 *
 * @return {Promise<{ok: true, alreadyActive: boolean, teacherPlan: 'trial',
 *   teacherTrialEndsAtMs: number}>}
 * @throws on refusal — the caller reads `err.code` ('failed-precondition' for
 *   an ineligible account, 'unauthenticated' for a signed-out caller) and
 *   `err.message` for display copy.
 */
export async function activateExistingTeacherTrialOffer() {
  const call = httpsCallable(fns(), 'activateExistingTeacherTrialOffer')
  const res = await call({})
  return res?.data
}
