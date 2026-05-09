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
