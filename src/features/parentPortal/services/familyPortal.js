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
const requestGuardianUnlinkCallable = httpsCallable(fns, 'requestGuardianUnlink')
const reportGuardianLinkCallable = httpsCallable(fns, 'reportGuardianLink')
const withdrawGuardianConsentCallable = httpsCallable(fns, 'withdrawGuardianConsent')

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
 *
 * THE ONLY confirm path. The Guardian panel calls this one too; a second
 * callable of our own was removed, because two paths flipping the same
 * link — each writing a different field — is how they come to disagree
 * about whether a child said yes. Note it takes the LINK ID.
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

// ── The link lifecycle ───────────────────────────────────────────────
//
// `unlinkParentLink` USED TO LIVE HERE and deleted the document directly.
// It is gone, and the two sides now have different, deliberately unequal
// routes — because "remove this link" means two different things depending
// on who is asking:
//
//   a guardian leaving   → withdrawGuardianConsent. Marks the link
//                          `withdrawn` and KEEPS the record, because "who
//                          approved this account, and when did that stop"
//                          is what /child-safety promises we can answer.
//   a child asking       → requestGuardianUnlink. Files a request and tells
//                          the guardian and support. Removes nobody. A
//                          child who could quietly drop supervision is a
//                          child who can be talked into dropping it, by
//                          the person the supervision exists to notice.
//
// Firestore rules now deny every client write to `parentLinks`, delete
// included, so there is no third route.



/** The child asks for a guardian to be removed. Files a request; removes nobody. */
export async function requestGuardianUnlink(parentUid, reason = '') {
  const result = await requestGuardianUnlinkCallable({ parentUid, reason })
  capture('guardian_unlink_requested', {})
  return result.data
}

/** "This isn't my grown-up." Removes an unconfirmed link; flags a confirmed one. */
export async function reportGuardianLink(parentUid, reason = '') {
  const result = await reportGuardianLinkCallable({ parentUid, reason })
  capture('guardian_link_reported', {})
  return result.data
}

/** A guardian ends their own link. The child keeps every lesson and past paper. */
export async function withdrawGuardianConsent(childUid) {
  const result = await withdrawGuardianConsentCallable({ childUid })
  capture('guardian_consent_withdrawn', {})
  return result.data
}
