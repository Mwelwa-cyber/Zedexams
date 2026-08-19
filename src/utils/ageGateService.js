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
 * Called from the guardian step during sign-up, and again from the Resend
 * control on the waiting screen and the limited-mode banner. The server owns
 * the pacing — a backoff ladder per learner and a daily cap per destination,
 * both in functions/shared/consent/guardianContactCore.js — because the
 * recipient did not ask for any of this, and a resend button a child can tap
 * is a way to make a parent's inbox unusable.
 *
 * @param {object} payload
 * @param {string} [payload.contact]  Their WhatsApp number or email address.
 * @param {string} [payload.channel]  'whatsapp' | 'email' | 'same_device'.
 * @return {Promise<{ok: boolean, sent?: string, waLink?: string,
 *                   consentUrl?: string, contactDisplay?: string}>}
 */
export async function sendGuardianConsentRequest(payload = {}) {
  const call = httpsCallable(fns(), 'sendGuardianConsent')
  // `method` travels alongside `channel` because it is the name the user
  // document has always stored and what older clients send.
  const res = await call(payload.channel ? { ...payload, method: payload.channel } : payload)
  return res?.data || { ok: false }
}

/**
 * Validate a contact and get back the message the guardian will actually
 * receive — without sending anything, minting a token, or spending a send.
 *
 * This is what the confirm screen renders. It is a server call rather than a
 * local template on purpose: the preview has to be the real message, and a
 * copy of the wording in the browser is a copy that drifts. It is also where
 * the refusals surface (the learner's own contact, a contact that already
 * signs in as a learner, the send ladder), so the child is told before they
 * tap send rather than after.
 *
 * @return {Promise<{ok, dryRun, channel, contactDisplay, preview:
 *   {subject, body}, allowed: boolean, waitMs?: number, refusal?: string}>}
 */
export async function previewGuardianConsentRequest({ contact, channel } = {}) {
  const call = httpsCallable(fns(), 'sendGuardianConsent')
  const res = await call({ contact, channel, method: channel, dryRun: true })
  return res?.data || { ok: false }
}

/**
 * The grown-up is in the room: mint a consent link for THIS device.
 *
 * Nobody is messaged. The URL returned is the same page the emailed link
 * opens, so the adult answers the same question and the record carries the
 * same evidence — see functions/guardianConsent.
 *
 * @return {Promise<{ok: boolean, consentUrl?: string}>}
 */
export async function startSameDeviceConsent() {
  return sendGuardianConsentRequest({ channel: 'same_device' })
}
