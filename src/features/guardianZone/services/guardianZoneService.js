/**
 * guardianZoneService — the client half of the Guardian Zone's writes.
 *
 * Every function here is a thin wrapper over a callable in
 * functions/guardianZone. There is deliberately no Firestore write in this
 * file, and no read of `guardianZone/{uid}`: firestore.rules denies that
 * document to every client, including the account owner, because the person
 * the PIN keeps out is the child holding the phone.
 *
 * The DASHBOARD's reads are not here either — they come from
 * useLearnerDashboard, the same hook the child's own home page uses, because
 * the guardian is looking at the child's own data through the child's own
 * session and a privileged read path would only widen the server's surface.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../../firebase/config'

// Resolved on first use, not at module load — same reasoning as
// ageGateService: a module-level getFunctions() runs before a spec can install
// a mocked Firebase app, turning an unrelated component test into an import
// crash. Region pinned to where these callables deploy.
let functionsRef = null
function fns() {
  if (!functionsRef) functionsRef = getFunctions(app, 'us-central1')
  return functionsRef
}

/**
 * Does this account have a Guardian PIN, and can we email a setup code?
 *
 * Asked before any PIN is typed. The zone must not learn this by probing
 * verifyGuardianPin with an empty string — that burns one of five attempts
 * per page load, and five refreshes would lock a parent out of their own
 * controls with nobody having typed a wrong digit.
 */
export async function fetchGuardianZoneStatus() {
  const call = httpsCallable(fns(), 'guardianZoneStatus')
  const res = await call({})
  return res?.data || null
}

/** Email the verified guardian a one-time code for setting the PIN. */
export async function requestGuardianPinSetup() {
  const call = httpsCallable(fns(), 'requestGuardianPinSetup')
  const res = await call({})
  return res?.data || null
}

/**
 * Set the PIN.
 *
 * Exactly one of `code` (the emailed one-time code) or `currentPin` must be
 * supplied — the server refuses a first PIN set without a code, which is what
 * stops the child choosing the PIN that is meant to keep them out.
 */
export async function setGuardianPin({ pin, code, currentPin }) {
  const call = httpsCallable(fns(), 'setGuardianPin')
  const res = await call({ pin, code, currentPin })
  return res?.data || null
}

/** Unlock the controls without changing anything. */
export async function verifyGuardianPin(pin) {
  const call = httpsCallable(fns(), 'verifyGuardianPin')
  const res = await call({ pin })
  return res?.data || null
}

/**
 * Change what the child may do.
 *
 * The controls are re-normalised SERVER-side from the same shared module this
 * file's caller reads, so whatever shape is posted, what lands on the user
 * document is the exact three-field object resolveLearnerAccess narrows
 * against.
 */
export async function saveGuardianControls({ pin, controls }) {
  const call = httpsCallable(fns(), 'setGuardianControls')
  const res = await call({ pin, controls })
  return res?.data || null
}

/**
 * Turn a callable rejection into something a parent can act on.
 *
 * The raw messages are already written for a person (the callables throw
 * sentences, not codes), so this mostly passes them through — its job is to
 * make sure a transport failure does not surface as "internal" or as an empty
 * string, which reads as the app having nothing to say.
 */
export function guardianZoneErrorMessage(err) {
  const message = String(err?.message || '').trim()
  if (err?.code === 'functions/unavailable' || /network/i.test(message)) {
    return 'We could not reach ZedExams. Check the connection and try again.'
  }
  if (!message || /^internal$/i.test(message)) {
    return 'Something went wrong. Please try again in a moment.'
  }
  return message
}
