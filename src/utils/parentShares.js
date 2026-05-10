/**
 * parentShares — client wrappers for the audit A3 parent-portal
 * Cloud Functions.
 *
 * The learner-side write flow goes through callables (createProgress
 * Share / revokeProgressShare) so the share token is server-issued
 * and uniqueness-checked. Reading the existing list of my shares is
 * direct via Firestore rules (the learner can see their own shares
 * via the learnerUid+createdAt index).
 *
 * The parent-facing read flow goes through getProgressShare — that
 * one is PUBLIC (no auth) and returns a fully rendered shape so the
 * /parent/:token route doesn't need to navigate Firestore rules.
 */

import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../firebase/config'
import { capture } from './analytics'

const fns = getFunctions(app, 'us-central1')
const createProgressShareCallable = httpsCallable(fns, 'createProgressShare')
const revokeProgressShareCallable = httpsCallable(fns, 'revokeProgressShare')
const getProgressShareCallable = httpsCallable(fns, 'getProgressShare')
const triggerWeeklyParentDigestCallable = httpsCallable(fns, 'triggerWeeklyParentDigest', {
  // The cron body can run for up to 9 minutes when iterating 200 shares;
  // a one-share manual run finishes in seconds, but pad the timeout so
  // a slow Meta response doesn't abort.
  timeout: 540000,
})

const COLLECTION = 'progressShares'

export async function createProgressShare({ parentEmail, parentPhone, parentDisplayName } = {}) {
  const result = await createProgressShareCallable({
    parentEmail: parentEmail || null,
    parentPhone: parentPhone || null,
    parentDisplayName: parentDisplayName || null,
  })
  // Audit B2 — analytics event. Booleans only; we never send the
  // parent's actual email or phone in the analytics payload.
  capture('parent_link_created', {
    hasEmail: Boolean(parentEmail),
    hasPhone: Boolean(parentPhone),
  })
  return result.data
}

export async function revokeProgressShare(token) {
  const result = await revokeProgressShareCallable({ token })
  return result.data
}

/**
 * Fetch the rendered parent-facing payload by token. PUBLIC — no
 * auth required. Used by /parent/:token.
 */
export async function getProgressShare(token) {
  const result = await getProgressShareCallable({ token })
  return result.data
}

/**
 * Admin-only: run the weekly digest cron body on demand. Used to
 * verify Meta WhatsApp wiring without waiting for Sunday's tick.
 *
 * @param {Object} opts
 * @param {boolean} [opts.force]            Bypass the 5-day idempotency
 *                                          stamp (the stamp itself is
 *                                          NOT bumped on forced runs so
 *                                          Sunday's real cron still fires).
 * @param {string[]} [opts.targetTokens]    Limit to specific share tokens
 *                                          (cap 10). When omitted the run
 *                                          processes the full union of
 *                                          email + phone candidates.
 * @returns {Promise<Object>} The cron's run summary — sharesScanned,
 *                            sent.{email|whatsapp}, skipped.*, failed.*,
 *                            errors[], whatsAppReady, smtpReady.
 */
export async function triggerWeeklyParentDigest({ force = false, targetTokens = null } = {}) {
  const result = await triggerWeeklyParentDigestCallable({
    force: Boolean(force),
    targetTokens: Array.isArray(targetTokens) && targetTokens.length > 0 ? targetTokens : null,
  })
  return result.data
}

/**
 * Learner-side: list my own (active or revoked) shares so they can
 * see what's outstanding and revoke individual links.
 */
export async function listMyProgressShares(learnerUid, { limit = 20 } = {}) {
  const q = query(
    collection(db, COLLECTION),
    where('learnerUid', '==', learnerUid),
    orderBy('createdAt', 'desc'),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}
