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
const getChildProgressCallable = httpsCallable(fns, 'getChildProgress')
const confirmGuardianLinkCallable = httpsCallable(fns, 'confirmGuardianLink')
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

/** Parent redeems a learner's family code, creating the link. Returns the child. */
export async function redeemFamilyInviteCode(code) {
  const result = await redeemFamilyInviteCodeCallable({ code })
  capture('family_child_linked', {})
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

/**
 * The child answers "<Name> wants to be your guardian. Is this your
 * grown-up?". `decision` is 'confirm' or 'reject'.
 *
 * Until this resolves, the link grants nothing at all — functions/parentApp's
 * `authorise` refuses every read of a child's data through an unconfirmed
 * link, so this is a real gate rather than a screen.
 */
export async function confirmGuardianLink(parentUid, decision) {
  const result = await confirmGuardianLinkCallable({ parentUid, decision })
  capture('guardian_link_decision', { decision })
  return result.data
}

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
