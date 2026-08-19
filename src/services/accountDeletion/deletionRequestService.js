/**
 * deletionRequestService — client wrappers for the deletion state machine
 * (functions/deletionFlow/).
 *
 * Every one is a callable rather than a Firestore read, and that is the design
 * rather than a convenience: `accountDeletionRequests` is server-only in
 * `firestore.rules`, in both directions. A client that could read it would see
 * a document describing a family; a client that could write it could schedule
 * any account it can name, or move its own request to `completed` and out of
 * every sweep.
 *
 * The two people the request is about get two different projections of it —
 * the guardian's view needs the child's name and their progress, the child's
 * needs to know only that somebody was asked — which is a thing a callable can
 * express and a security rule cannot.
 *
 * ── Nothing here decides anything ──────────────────────────────────────
 *
 * No state transitions, no clock arithmetic, no "is it due yet". The server
 * owns all of it (`deletionRequestCore.js`, node-tested), and a second copy
 * running on a child's phone would be the fork that eventually disagrees with
 * it on the day that matters. These functions send and receive.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../../firebase/config'

/**
 * Callables are resolved at CALL time, not at module load.
 *
 * `getFunctions(app)` throws on an app that is not a real Firebase instance,
 * and this module is reached from a LAZY import inside `LearnerShell` — so an
 * import-time call runs during a chunk load, off the render path, where the
 * throw surfaces as an unhandled rejection with no component to attribute it
 * to. It cost one spec a false green before it was caught.
 *
 * Resolving on first use also means a learner with no deletion request pays
 * nothing: the banner gates on a profile field and never calls in, so the
 * Functions client is never constructed for the overwhelming majority of
 * sessions.
 */
let cachedFns = null
function call(name) {
  if (!cachedFns) cachedFns = getFunctions(app, 'us-central1')
  return httpsCallable(cachedFns, name)
}

/**
 * The states, mirrored for the UI to switch on. Kept in step with
 * `functions/deletionFlow/deletionRequestCore.js` by `test:deletion-state-mirror`
 * — a client that renders a state the server never sends, or fails to render
 * one it does, shows a child a blank screen at the worst possible moment.
 */
export const DELETION_STATE = Object.freeze({
  PENDING_GUARDIAN: 'pending_guardian',
  SCHEDULED: 'scheduled',
  DECLINED: 'declined',
  ESCALATED_SUPPORT: 'escalated_support',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
})

/** States in which the request is still live and the account still exists. */
export const OPEN_STATES = Object.freeze([
  DELETION_STATE.PENDING_GUARDIAN,
  DELETION_STATE.SCHEDULED,
  DELETION_STATE.ESCALATED_SUPPORT,
])

/**
 * Ask to delete this account.
 *
 * Returns the request the server opened — which may be one that already
 * existed, because asking twice is what an anxious person does and the server
 * hands back the first rather than opening a second clock.
 */
export async function requestAccountDeletion() {
  const res = await call('requestAccountDeletion')({})
  return res?.data || null
}

/**
 * The guardian's answer. `park` is a real outcome, not a way of doing nothing:
 * it tells the child their grown-up wants to talk first, and it deliberately
 * does NOT stop the seven-day clock.
 *
 * @param {string} requestId
 * @param {'approve'|'decline'|'park'} decision
 */
export async function respondToDeletionRequest(requestId, decision) {
  const res = await call('respondToDeletionRequest')({ requestId, decision })
  return res?.data || null
}

/** The child withdraws, or the guardian restores. Same transition. */
export async function cancelDeletionRequest(requestId) {
  const res = await call('cancelDeletionRequest')({ requestId })
  return res?.data || null
}

/**
 * What this viewer is shown. With no `requestId` it returns the caller's own
 * open request, which is how the banner and `/settings/delete` find it.
 */
export async function getDeletionRequest(requestId) {
  const res = await call('getDeletionRequest')(requestId ? { requestId } : {})
  return res?.data || { request: null }
}

/**
 * "Not your grown-up? Tell us instead."
 *
 * Reaches SUPPORT and never the linked guardian — a child who needs out of a
 * link with the wrong adult must not be made to ask that adult, and must not
 * have that adult told they asked. The server flags the link for a human
 * rather than severing it, because an automatic unlink on an unverified report
 * is its own abuse vector.
 */
export async function reportWrongGuardian(note) {
  const res = await call('reportWrongGuardian')({ note: note || '' })
  return res?.data || null
}
