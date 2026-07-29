import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

// Resolved on first use rather than at module load. Two reasons: the Functions
// SDK should not be initialised just because something imported this module,
// and a module-level getFunctions() runs before a test can install a mocked
// Firebase app — which turns an unrelated component spec into a crash on
// import. Region pinned to match where these callables deploy.
let functionsRef = null
function fns() {
  if (!functionsRef) functionsRef = getFunctions(app, 'us-central1')
  return functionsRef
}

/**
 * ageGateService — the client half of the neutral age screen's retry cooldown.
 *
 * Play's neutrality requirement includes that a user who has answered the age
 * question cannot immediately answer it again with a different birthday. The
 * cooldown itself is SERVER-side (recordAgeGateAttempt); this module only
 * supplies a stable per-device identifier and reports the attempt.
 *
 * ── About the device id ─────────────────────────────────────────────────
 *
 * It is a random UUID minted on first use and kept in localStorage. It is not
 * a fingerprint, and deliberately so: fingerprinting a device is exactly the
 * "persistent identifier" behaviour Play's Families policy prohibits
 * transmitting from children, so building one to satisfy a different Families
 * requirement would be self-defeating. The server stores only sha256 of it.
 *
 * The consequence is that clearing storage or reinstalling resets the
 * cooldown. That is accepted: this is a good-faith speed bump, which is what
 * the policy asks for and all any age screen has ever been. Trading a child's
 * privacy for a marginally stickier cooldown is the wrong side of that trade.
 */

const DEVICE_KEY = 'zedexams:device-id'

/**
 * A stable-per-device random id. Falls back to a per-call value when storage
 * is unavailable (private mode, disabled cookies) — which effectively skips
 * the cooldown for that user rather than blocking signup, the correct
 * direction for a speed bump.
 */
export function getDeviceId() {
  try {
    const existing = localStorage.getItem(DEVICE_KEY)
    if (existing && existing.length >= 8) return existing
    const minted = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, minted)
    return minted
  } catch {
    return crypto.randomUUID()
  }
}

/**
 * Report an age-screen attempt.
 *
 * @return {Promise<{blocked: boolean, retryAfterMs?: number}>}
 *   Never throws for a transport failure — the caller treats an unreachable
 *   server as "not blocked", because an outage must not stop a real child
 *   from signing up.
 */
export async function recordAgeGateAttempt() {
  try {
    const call = httpsCallable(fns(), 'recordAgeGateAttempt')
    const res = await call({ deviceId: getDeviceId() })
    return { blocked: res?.data?.blocked === true, retryAfterMs: res?.data?.retryAfterMs }
  } catch {
    return { blocked: false }
  }
}

/**
 * Ask the server to message the learner's guardian with an approval link.
 *
 * Called right after a minor's account is created, and again from the Resend
 * control on the limited-mode banner. The server owns the once-a-day cooldown
 * — the recipient did not ask for any of this, and a resend button a child can
 * tap is a way to make a parent's inbox unusable.
 *
 * @return {Promise<{ok: boolean, sent?: string, waLink?: string}>}
 */
export async function sendGuardianConsentRequest() {
  const call = httpsCallable(fns(), 'sendGuardianConsent')
  const res = await call({})
  return res?.data || { ok: false }
}
