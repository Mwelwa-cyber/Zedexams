/**
 * Family portal — authenticated parent↔child linking (real parent accounts).
 *
 * Distinct from parentPortal.js (the anonymous, link-only `progressShares`
 * flow, which stays as-is). Here a *learner* mints a family invite code and a
 * signed-in *parent account* redeems it, creating a durable link the parent
 * dashboard reads through.
 *
 * Callables (all region us-central1):
 *
 *   createFamilyInviteCode()                 [learner]
 *     - Rotates: revokes the learner's prior active codes, mints a fresh
 *       8-char code in familyInviteCodes/{code} with a 60-day TTL.
 *       Returns { code, expiresAt }.
 *
 *   revokeFamilyInviteCode({ code })         [learner, own code]
 *     - Sets revokedAt so the code can no longer be redeemed. Returns { ok }.
 *
 *   redeemFamilyInviteCode({ code })         [parent account]
 *     - Validates the code (not revoked/expired), blocks self-linking, and
 *       creates parentLinks/{parentUid}_{learnerUid} (idempotent). Returns the
 *       linked child's summary.
 *
 *   getChildProgress({ childUid })           [parent, linked only]
 *     - Verifies the parentLink exists, then reuses aggregateProgress() to
 *       return the same rendered shape as the public getProgressShare.
 *
 * Reads (parent's children list, learner's own code + linked parents) go
 * straight through Firestore rules — see firestore.rules parentLinks /
 * familyInviteCodes blocks — so they are NOT re-implemented as callables.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const {aggregateProgress, ONE_DAY_MS} = require("./parentPortalShared");
const {
  FAMILY_CODE_TTL_DAYS,
  normalizeFamilyCode,
  isValidFamilyCode,
  randomFamilyCode,
  familyCodeStatus,
  familyCodeStatusMessage,
  parentLinkId,
} = require("./familyPortalCore");

const REGION = "us-central1";
const STATS_WINDOW_DAYS = 30;
const MAX_CHILDREN_PER_PARENT = 20;

function randomBytes(n) {
  return require("node:crypto").randomBytes(n);
}

async function mintUniqueCode(db) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = randomFamilyCode(randomBytes);
    const snap = await db.collection("familyInviteCodes").doc(code).get();
    if (!snap.exists) return code;
  }
  throw new HttpsError("internal", "Could not mint a unique family code. Please try again.");
}

const createFamilyInviteCode = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const db = admin.firestore();

  // Rotate: retire the learner's existing active codes so only the newest
  // one is live (a rotated code can't be redeemed by someone who screenshotted
  // an old one). Best-effort — a failure here doesn't block minting.
  try {
    const prior = await db.collection("familyInviteCodes")
        .where("learnerUid", "==", uid)
        .where("revokedAt", "==", null)
        .get();
    const batch = db.batch();
    prior.docs.forEach((d) => batch.update(d.ref, {
      revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    }));
    if (!prior.empty) await batch.commit();
  } catch (err) {
    console.warn("[familyPortal] code rotation cleanup failed", err);
  }

  const code = await mintUniqueCode(db);
  const expiresAt = admin.firestore.Timestamp.fromMillis(
      Date.now() + FAMILY_CODE_TTL_DAYS * ONE_DAY_MS,
  );
  await db.collection("familyInviteCodes").doc(code).set({
    code,
    learnerUid: uid,
    createdBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    revokedAt: null,
    redeemedCount: 0,
  });

  return {code, expiresAt: expiresAt.toMillis()};
});

const revokeFamilyInviteCode = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const code = normalizeFamilyCode(request.data?.code);
  if (!isValidFamilyCode(code)) {
    throw new HttpsError("invalid-argument", "A valid family code is required.");
  }

  const db = admin.firestore();
  const ref = db.collection("familyInviteCodes").doc(code);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Family code not found.");
  if ((snap.data() || {}).learnerUid !== uid) {
    throw new HttpsError("permission-denied", "You can only turn off your own family code.");
  }
  await ref.update({revokedAt: admin.firestore.FieldValue.serverTimestamp()});
  return {ok: true};
});

const redeemFamilyInviteCode = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const code = normalizeFamilyCode(request.data?.code);
  if (!isValidFamilyCode(code)) {
    throw new HttpsError("invalid-argument", familyCodeStatusMessage("invalid"));
  }

  const db = admin.firestore();

  // Only parent accounts may link a child — otherwise a learner could redeem
  // another learner's code and read their results. Fail closed.
  const redeemerSnap = await db.collection("users").doc(uid).get();
  const redeemer = redeemerSnap.exists ? (redeemerSnap.data() || {}) : {};
  if (redeemer.role !== "parent") {
    throw new HttpsError(
        "failed-precondition",
        "Only a parent account can link a child. Create or switch to a parent account first.",
    );
  }

  const codeSnap = await db.collection("familyInviteCodes").doc(code).get();
  const codeDoc = codeSnap.exists ? (codeSnap.data() || {}) : null;
  const status = familyCodeStatus(codeDoc, Date.now());
  if (status !== "ok") {
    throw new HttpsError("failed-precondition", familyCodeStatusMessage(status));
  }

  const learnerUid = codeDoc.learnerUid;
  if (!learnerUid || learnerUid === uid) {
    throw new HttpsError("failed-precondition", "This family code can't be linked to your own account.");
  }

  // Cap the number of children per parent to bound reads + abuse.
  const existing = await db.collection("parentLinks")
      .where("parentUid", "==", uid)
      .get();
  const linkId = parentLinkId(uid, learnerUid);
  const alreadyLinked = existing.docs.some((d) => d.id === linkId);
  if (!alreadyLinked && existing.size >= MAX_CHILDREN_PER_PARENT) {
    throw new HttpsError("resource-exhausted", "You have reached the maximum number of linked children.");
  }

  const learnerSnap = await db.collection("users").doc(learnerUid).get();
  const learner = learnerSnap.exists ? (learnerSnap.data() || {}) : {};

  // Which role this link gets. The first guardian to link a child owns
  // the account (billing, deletion); everyone after them is a
  // co-guardian. Recording it at creation is what stops the derived
  // answer in guardianRolesCore from depending on timestamps forever —
  // and re-redeeming must NOT rewrite it, or a parent who re-entered
  // their code would demote themselves. Hence the explicit read-back.
  const {roleForNewLink} = await import("./shared/guardian/guardianRolesCore.js");
  const siblings = await db.collection("parentLinks")
      .where("learnerUid", "==", learnerUid)
      .get();
  const priorLink = siblings.docs.find((d) => d.id === linkId);
  const role = priorLink ?
    ((priorLink.data() || {}).role || null) :
    roleForNewLink(siblings.docs.map((d) => d.data() || {}));

  // Idempotent: re-redeeming the same code just refreshes the snapshot.
  // `createdAt` is written only on FIRST creation — it used to be stamped
  // on every redeem, which was harmless when nothing read it and is not
  // now: for a legacy link with no stored role, guardianRolesCore derives
  // ownership from it, so bumping it on a re-redeem could hand the owner
  // role to whichever parent last typed the code.
  await db.collection("parentLinks").doc(linkId).set({
    parentUid: uid,
    learnerUid,
    learnerDisplayName: learner.displayName || null,
    learnerGrade: learner.grade || null,
    parentDisplayName: redeemer.displayName || null,
    ...(role ? {role} : {}),
    createdVia: "code",
    code,
    ...(priorLink ? {} : {createdAt: admin.firestore.FieldValue.serverTimestamp()}),
  }, {merge: true});

  // Best-effort redemption tally for the learner's own visibility.
  db.collection("familyInviteCodes").doc(code).update({
    redeemedCount: admin.firestore.FieldValue.increment(1),
    lastRedeemedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => console.warn("[familyPortal] redeem tally failed", err));

  return {
    learnerUid,
    learnerDisplayName: learner.displayName || "your child",
    learnerGrade: learner.grade || null,
  };
});

const getChildProgress = onCall({
  region: REGION,
  timeoutSeconds: 60,
  memory: "512MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");

  const childUid = String(request.data?.childUid || "").trim();
  if (!childUid) throw new HttpsError("invalid-argument", "childUid is required.");

  const db = admin.firestore();
  // Authorise: the parent must have a link to this child. This is the gate —
  // without a link the parent can't read the child's profile or results.
  const linkSnap = await db.collection("parentLinks").doc(parentLinkId(uid, childUid)).get();
  if (!linkSnap.exists) {
    throw new HttpsError("permission-denied", "You are not linked to this child.");
  }

  const learnerSnap = await db.collection("users").doc(childUid).get();
  const learner = learnerSnap.exists ? (learnerSnap.data() || {}) : {};
  const stats = await aggregateProgress(db, childUid, {windowDays: STATS_WINDOW_DAYS});

  return {
    learnerUid: childUid,
    learnerDisplayName: learner.displayName || "your child",
    learnerGrade: learner.grade || null,
    learnerSchool: learner.school || null,
    summary: stats.summary,
    subjectBreakdown: stats.subjectBreakdown,
    recentResults: stats.recentResults,
  };
});

module.exports = {
  createFamilyInviteCode,
  revokeFamilyInviteCode,
  redeemFamilyInviteCode,
  getChildProgress,
};
