/**
 * familyPortal — client wrappers for the authenticated parent↔child linking
 * Cloud Functions (functions/familyPortal.js).
 *
 * Mint / revoke / redeem go through callables (server issues + rotates codes,
 * validates the redeemer is a parent, and owns the parentLinks shape). The two
 * list reads — a parent's linked children, and a learner's linked parents —
 * go straight through Firestore rules (parentLinks is readable by either side
 * of the link; familyInviteCodes by the owning learner).
 */

import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../../../firebase/config'
import { capture } from '../../../utils/analytics'

const fns = getFunctions(app, 'us-central1')
const createFamilyInviteCodeCallable = httpsCallable(fns, 'createFamilyInviteCode')
const revokeFamilyInviteCodeCallable = httpsCallable(fns, 'revokeFamilyInviteCode')
const redeemFamilyInviteCodeCallable = httpsCallable(fns, 'redeemFamilyInviteCode')
const respondToFamilyLinkCallable = httpsCallable(fns, 'respondToFamilyLink')
const getChildProgressCallable = httpsCallable(fns, 'getChildProgress')

const LINKS = 'parentLinks'
const CODES = 'familyInviteCodes'

// ── Learner side ────────────────────────────────────────────────────────────

/** Learner mints (and rotates) a family invite code. Returns { code, expiresAt }. */
export async function createFamilyInviteCode() {
  const result = await createFamilyInviteCodeCallable({})
  capture('family_code_created', {})
  return result.data
}

/** Learner turns off a family code so it can no longer be redeemed. */
export async function revokeFamilyInviteCode(code) {
  const result = await revokeFamilyInviteCodeCallable({ code })
  return result.data
}

/**
 * Learner-side: the parents currently linked to me (so a learner can see —
 * and, via a delete, cut off — who has access). Reads parentLinks directly.
 */
export async function listMyLinkedParents(learnerUid, { limit = 20 } = {}) {
  const q = query(
    collection(db, LINKS),
    where('learnerUid', '==', learnerUid),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * Learner-side: my active family codes, newest first, so the panel can show
 * the current code + let the learner rotate/revoke it.
 */
export async function listMyFamilyCodes(learnerUid, { limit = 5 } = {}) {
  const q = query(
    collection(db, CODES),
    where('learnerUid', '==', learnerUid),
    orderBy('createdAt', 'desc'),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

// ── Parent side ─────────────────────────────────────────────────────────────

/**
 * Parent redeems a learner's family code.
 *
 * This no longer creates a working link. It burns the code and creates a
 * PENDING one; the child is asked "is this your grown-up?" and has to say
 * yes before the parent can see anything. The returned `status` says
 * which happened — `'pending'` for a new link, `'active'` only when the
 * parent was already a confirmed guardian and simply re-entered a code.
 * Callers must not report success as "linked".
 */
export async function redeemFamilyInviteCode(code) {
  const result = await redeemFamilyInviteCodeCallable({ code })
  capture('family_child_link_requested', { status: result.data?.status || 'pending' })
  return result.data
}

/**
 * The child answers a pending guardian request: 'accept' | 'decline'.
 *
 * Accepting also writes the guardian consent record, so this is not only a
 * status flip — see functions/familyPortal.js respondToFamilyLink.
 */
export async function respondToFamilyLink(linkId, decision) {
  const result = await respondToFamilyLinkCallable({ linkId, decision })
  capture('family_link_response', { decision })
  return result.data
}

/**
 * Parent-side: my linked children. Reads parentLinks directly (rules scope it
 * to parentUid == me). Each row carries the snapshotted learnerDisplayName /
 * learnerGrade so the list renders without an extra profile read.
 */
export async function listMyChildren(parentUid, { limit = 20 } = {}) {
  const q = query(
    collection(db, LINKS),
    where('parentUid', '==', parentUid),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/** Parent fetches a linked child's rendered progress (KPIs, subjects, recent). */
export async function getChildProgress(childUid) {
  const result = await getChildProgressCallable({ childUid })
  return result.data
}

/**
 * Remove a parent↔child link by its doc id. Firestore rules allow either side
 * (parent or learner) to delete, so this serves both "parent removes a child"
 * and "learner cuts off a parent".
 */
export async function unlinkParentLink(linkId) {
  await deleteDoc(doc(db, LINKS, linkId))
}
