/**
 * parentShareService — client wrappers for the parent-portal Cloud Functions
 * (audit A3).
 *
 * The learner-side write flow goes through callables (`createProgressShare` /
 * `revokeProgressShare`) so the share token is server-issued and
 * uniqueness-checked. Reading the existing list of my shares is direct via
 * Firestore rules (the learner can see their own shares via the
 * learnerUid+createdAt index).
 *
 * The parent-facing read flow goes through `getProgressShare` — that one is
 * PUBLIC (no auth) and returns a fully rendered shape so the `/parent/:token`
 * route doesn't need to navigate Firestore rules.
 *
 * ## Where this came from, and why it is not the whole of the old file
 *
 * This was `src/utils/parentShares.js`. `features/parentPortal`'s index
 * recorded it as pinned in `src/utils/` by `admin/ParentDigestTester.jsx`,
 * clearing "when the dashboard's freeze lifts". It lifted (Wave 4 slice 4).
 *
 * The pin cleared but a straight move would have been wrong: by then the file
 * had readers in TWO features, so moving it here whole would have made
 * `adminHome` import `parentPortal` — a CROSS-FEATURE import, on a list that
 * only shrinks. That is the trap `learnerSearch`'s entry names: converting one
 * debt entry into another.
 *
 * It split instead, because it was doing two jobs and its own docblock said so
 * — `triggerWeeklyParentDigest` was already marked *"Admin-only"*. That half
 * went to `features/adminHome/services/parentDigestService.js`, beside its one
 * consumer. Neither feature reaches across, and both now own what they use.
 */

import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import app, { db } from '../../../firebase/config'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { capture } from '../../../utils/analytics'

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
