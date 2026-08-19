"use strict";

/**
 * Convergence — the rule that makes the two doors one room.
 *
 * A child can be linked to a guardian two ways:
 *
 *   Door A (child-first)  the child names a guardian's email, the guardian
 *                         clicks an approval link in their inbox.
 *   Door B (parent-first) the parent signs up, then types the child's
 *                         family code.
 *
 * These are two ways into ONE relationship, and the failure mode if they
 * are not joined is quiet and permanent: a mother approves by email in
 * March, signs up for the parent app in June, and finds an empty
 * dashboard — because Door A recorded her decision against an address and
 * Door B is looking for an account. She has two guardian identities, one
 * of which can never log in, and no screen anywhere will ever say so.
 *
 * ── The join key is the verified email address ─────────────────────
 *
 * `guardianEmailKey` (guardianLinkCore) canonicalises it. Matching on
 * anything else was considered and rejected: a phone number is not
 * collected on both paths, and a name is not an identifier — two
 * "Mrs Banda"s in one school is not a corner case, it is a Tuesday.
 *
 * ── Two directions, because either can happen first ────────────────
 *
 *   attachOnApproval  the guardian approved by email. If an account
 *                     already exists for that address, link it NOW.
 *                     Otherwise leave a CLAIM.
 *   claimForGuardian  a parent account appears. Pick up every claim
 *                     addressed to their verified email.
 *
 * ── Why a claim is not a link ──────────────────────────────────────
 *
 * A claim names an ADDRESS; a link names an ACCOUNT. Writing a link for
 * an account that does not exist would mean minting a uid nobody
 * controls, and whoever eventually registered that address would inherit
 * whatever had accumulated against it. The claim is redeemed only by an
 * account that has PROVED it holds the address — `emailVerified`, from
 * the Auth record, not from a profile field the account itself can
 * write.
 */

const admin = require("firebase-admin");

const LINKS = "parentLinks";
const CLAIMS = "guardianLinkClaims";
const AUDIT = "guardianLinkAudit";

let corePromise = null;
function loadCore() {
  if (!corePromise) corePromise = import("../shared/guardian/guardianLinkCore.js");
  return corePromise;
}
let rolesPromise = null;
function loadRoles() {
  if (!rolesPromise) rolesPromise = import("../shared/guardian/guardianRolesCore.js");
  return rolesPromise;
}

/** Deterministic claim id: one address, one child, one claim. */
function claimId(emailKey, learnerUid) {
  return `${Buffer.from(emailKey).toString("hex")}_${learnerUid}`;
}

async function audit(db, entry) {
  try {
    await db.collection(AUDIT).add({...entry, at: admin.firestore.FieldValue.serverTimestamp()});
  } catch (err) {
    console.error("[convergence] AUDIT WRITE FAILED", entry?.event, err?.message || err);
  }
}

/**
 * Find the ONE guardian account holding a verified email address.
 *
 * Auth is the authority, not `users/{uid}.email`: a profile field is
 * written by the account itself, so trusting it would let anyone claim
 * a child by typing their guardian's address into their own profile.
 * `getUserByEmail` answers from the Auth record, and `emailVerified` is
 * checked explicitly — an unverified address is a claim to an address,
 * not possession of one.
 *
 * Returns null for "no such account", "not verified", and "not a parent
 * account", all of which mean the same thing here: leave a claim.
 */
async function findGuardianAccount(db, emailKey) {
  if (!emailKey) return null;
  let authUser = null;
  try {
    authUser = await admin.auth().getUserByEmail(emailKey);
  } catch (err) {
    if (err?.code !== "auth/user-not-found") {
      // A lookup that FAILED is not a lookup that found nothing. Leaving
      // a claim is the safe outcome either way — it will be picked up
      // the next time that account opens the portal — but the difference
      // must be visible in the logs, or an Auth outage looks exactly
      // like a product with no parents in it.
      console.warn("[convergence] guardian lookup failed", err?.message || err);
    }
    return null;
  }
  if (!authUser?.uid || !authUser.emailVerified) return null;

  const snap = await db.collection("users").doc(authUser.uid).get();
  const profile = snap.exists ? (snap.data() || {}) : {};
  if (profile.role !== "parent") return null;

  return {uid: authUser.uid, displayName: profile.displayName || null, email: authUser.email || emailKey};
}

/**
 * Write the link for a guardian who has just approved by email.
 *
 * The link is created APPROVED, not pending, and that is the one place
 * the two doors differ. Door B needs the child's confirmation because
 * the adult arrived holding a code that may have reached them by
 * accident. Door A has both halves already: the CHILD named this
 * address, and the ADULT proved they read that inbox. Asking the child
 * to confirm a guardian they themselves nominated would be a
 * confirmation dialog for an action they already took.
 */
async function writeApprovedLink(db, {guardian, learnerUid, learner, emailKey, evidence}) {
  const core = await loadCore();
  const {roleForNewLink} = await loadRoles();

  const id = core.linkId(guardian.uid, learnerUid);
  const siblingsSnap = await db.collection(LINKS).where("learnerUid", "==", learnerUid).get();
  const siblings = siblingsSnap.docs.map((d) => ({id: d.id, ...(d.data() || {})}));
  const prior = siblings.find((l) => l.id === id);
  const role = prior ? (prior.role || null) : roleForNewLink(siblings);

  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.collection(LINKS).doc(id).set({
    parentUid: guardian.uid,
    learnerUid,
    learnerDisplayName: learner?.displayName || null,
    learnerGrade: learner?.grade || null,
    parentDisplayName: guardian.displayName || null,
    parentEmail: guardian.email || null,
    parentEmailKey: emailKey,
    ...(role ? {role} : {}),
    createdVia: "email_consent",
    // Active on creation, in BOTH fields. Door A needs no child
    // confirmation — the child NAMED this address and the adult proved
    // they read that inbox — so the link is born confirmed, and says so
    // in the field the family-code flow reads.
    status: "active",
    consent: {
      state: core.LINK_CONSENT.APPROVED,
      method: core.LINK_METHOD.EMAIL_LINK,
      grantedAt: now,
      withdrawnAt: null,
      // The same evidence the account-level record carries, kept on the
      // link too: the link is what a withdrawal or a dispute is argued
      // about, and evidence stored only on a field that a later
      // withdrawal overwrites is evidence that disappears exactly when
      // it is needed.
      ...(evidence ? {evidence} : {}),
    },
    ...(prior ? {} : {createdAt: now}),
  }, {merge: true});

  return {linkId: id, role, existed: Boolean(prior)};
}

/**
 * Door A has been approved. Attach it to a guardian account if one
 * exists for that address; otherwise leave a claim for one that turns up
 * later.
 *
 * Never throws. Consent has ALREADY been recorded by the caller's
 * transaction at this point — the guardian has clicked approve and been
 * shown a success page — so a failure here must not surface as a broken
 * approval. It degrades to "no link yet", which the claim sweep fixes on
 * the parent's first visit.
 */
async function attachOnApproval(db, {learnerUid, guardianEmail, evidence} = {}) {
  try {
    const core = await loadCore();
    const emailKey = core.guardianEmailKey(guardianEmail);
    if (!emailKey || !learnerUid) return {attached: false, reason: "no-email"};

    const learnerSnap = await db.collection("users").doc(learnerUid).get();
    const learner = learnerSnap.exists ? (learnerSnap.data() || {}) : {};

    const guardian = await findGuardianAccount(db, emailKey);

    if (!guardian) {
      // No account yet. Record the claim so the parent who signs up with
      // this address next month arrives to a dashboard that already has
      // their child in it, rather than to an empty screen and a request
      // for a code the child has long since forgotten about.
      await db.collection(CLAIMS).doc(claimId(emailKey, learnerUid)).set({
        emailKey,
        learnerUid,
        learnerDisplayName: learner.displayName || null,
        method: core.LINK_METHOD.EMAIL_LINK,
        ...(evidence ? {evidence} : {}),
        status: "open",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, {merge: true});
      await audit(db, {
        event: "link_claim_recorded",
        learnerUid,
        emailKey,
        actor: "guardian",
      });
      return {attached: false, claimed: true, reason: "no-account"};
    }

    const {linkId, existed} = await writeApprovedLink(db, {
      guardian, learnerUid, learner, emailKey, evidence,
    });
    await audit(db, {
      event: "link_created_by_email_approval",
      learnerUid,
      parentUid: guardian.uid,
      emailKey,
      toState: core.LINK_CONSENT.APPROVED,
      actor: "guardian",
      existed,
    });
    return {attached: true, parentUid: guardian.uid, linkId};
  } catch (err) {
    console.error("[convergence] attachOnApproval failed", err?.message || err);
    return {attached: false, reason: "error"};
  }
}

/**
 * A parent account exists (or has just verified its address). Pick up
 * every claim addressed to it.
 *
 * Idempotent: a claim is marked redeemed, and a link that already exists
 * is merged rather than duplicated. Safe to call on every visit to the
 * parent portal, which is exactly how it is wired — a sweep that only
 * runs at signup would miss the parent who verified their address later,
 * which is most of them.
 *
 * @returns {{claimed: number, children: string[]}}
 */
async function claimForGuardian(db, guardianUid) {
  const core = await loadCore();
  if (!guardianUid) return {claimed: 0, children: []};

  let authUser = null;
  try {
    authUser = await admin.auth().getUser(guardianUid);
  } catch (err) {
    console.warn("[convergence] claim sweep: auth read failed", err?.message || err);
    return {claimed: 0, children: []};
  }
  // Unverified means the address is asserted, not held. A claim redeemed
  // on an unverified address is a child handed to whoever typed it.
  if (!authUser?.emailVerified) return {claimed: 0, children: []};

  const emailKey = core.guardianEmailKey(authUser.email);
  if (!emailKey) return {claimed: 0, children: []};

  const snap = await db.collection(CLAIMS)
      .where("emailKey", "==", emailKey)
      .where("status", "==", "open")
      .limit(20)
      .get();
  if (snap.empty) return {claimed: 0, children: []};

  const profileSnap = await db.collection("users").doc(guardianUid).get();
  const profile = profileSnap.exists ? (profileSnap.data() || {}) : {};
  const guardian = {
    uid: guardianUid,
    displayName: profile.displayName || null,
    email: authUser.email || emailKey,
  };

  const children = [];
  for (const doc of snap.docs) {
    const claim = doc.data() || {};
    try {
      const learnerSnap = await db.collection("users").doc(claim.learnerUid).get();
      if (!learnerSnap.exists) {
        // The child's account is gone. Close the claim rather than
        // retrying it on every visit forever.
        await doc.ref.update({status: "stale", closedAt: admin.firestore.FieldValue.serverTimestamp()});
        continue;
      }
      await writeApprovedLink(db, {
        guardian,
        learnerUid: claim.learnerUid,
        learner: learnerSnap.data() || {},
        emailKey,
        evidence: claim.evidence || null,
      });
      await doc.ref.update({
        status: "redeemed",
        redeemedBy: guardianUid,
        redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await audit(db, {
        event: "link_claim_redeemed",
        learnerUid: claim.learnerUid,
        parentUid: guardianUid,
        emailKey,
        toState: core.LINK_CONSENT.APPROVED,
        actor: "guardian",
      });
      children.push(claim.learnerUid);
    } catch (err) {
      // One bad claim must not abandon the rest. It stays open and is
      // retried on the next visit.
      console.error("[convergence] claim redemption failed", doc.id, err?.message || err);
    }
  }

  return {claimed: children.length, children};
}

module.exports = {
  CLAIMS,
  attachOnApproval,
  claimForGuardian,
  claimId,
  findGuardianAccount,
  writeApprovedLink,
};
