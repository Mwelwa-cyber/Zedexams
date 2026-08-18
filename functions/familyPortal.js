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
const {assertCallableRateLimit} = require("./rateLimit");
const {aggregateProgress} = require("./parentPortalShared");
const {
  FAMILY_CODE_TTL_HOURS,
  ONE_HOUR_MS,
  normalizeFamilyCode,
  isValidFamilyCode,
  randomFamilyCode,
  familyCodeStatus,
  familyCodeStatusMessage,
  parentLinkId,
} = require("./familyPortalCore");

// The shared ESM link vocabulary, reached the way functions/shared/ is
// always reached from CommonJS: `await import(...)` inside the handler,
// cached per instance.
let linkCorePromise = null;
function loadLinkCore() {
  if (!linkCorePromise) linkCorePromise = import("./shared/guardian/guardianLinkCore.js");
  return linkCorePromise;
}

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
      Date.now() + FAMILY_CODE_TTL_HOURS * ONE_HOUR_MS,
  );
  await db.collection("familyInviteCodes").doc(code).set({
    code,
    learnerUid: uid,
    createdBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    revokedAt: null,
    // Single-use. `null` rather than absent so the burn is a transition
    // a transaction can test for, and so a code minted before this field
    // existed is not indistinguishable from one that has been spent.
    usedAt: null,
    redeemedCount: 0,
  });

  return {code, expiresAt: expiresAt.toMillis(), ttlHours: FAMILY_CODE_TTL_HOURS};
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

  // Per account AND per IP. A family code is a credential, and the one
  // attack it is actually exposed to is grinding — so the limit is on
  // the REDEEM, which is where a guess is tested, rather than on the
  // mint, which is where a child is trying to get on with their evening.
  // Fail-open (see rateLimit.js): a Firestore blip must not stop a
  // parent linking, because the code is single-use, 48-hour and
  // confirmed by the child regardless.
  await assertCallableRateLimit(request, {
    action: "familyCodeRedeem",
    userPerMin: 5,
    ipPerMin: 15,
  });

  const code = normalizeFamilyCode(request.data?.code);
  if (!isValidFamilyCode(code)) {
    throw new HttpsError("invalid-argument", familyCodeStatusMessage("invalid"));
  }

  const db = admin.firestore();
  const core = await loadLinkCore();

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

  const codeRef = db.collection("familyInviteCodes").doc(code);
  const codeSnap = await codeRef.get();
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
  const priorData = priorLink ? (priorLink.data() || {}) : null;
  const role = priorData ?
    (priorData.role || null) :
    roleForNewLink(siblings.docs.map((d) => d.data() || {}));

  // ── Burn the code and create the link in ONE transaction ──────────
  //
  // Two things have to be true together or the hardening is theatre. If
  // the code burned but the link write failed, the child's code is spent
  // and nobody is linked; if the link were written first and the burn
  // failed, a screenshotted code stays live. The transaction re-reads
  // `usedAt` inside itself so two parents racing on the same code
  // resolve to one winner rather than two links.
  //
  // A link that already exists is NOT re-burned: re-entering a code you
  // already used is a no-op, not a way to consume a fresh one.
  const consentState = priorData && core.normalizeLink(priorData).state === core.LINK_CONSENT.APPROVED ?
    core.LINK_CONSENT.APPROVED :
    core.LINK_CONSENT.PENDING;

  await db.runTransaction(async (tx) => {
    const fresh = await tx.get(codeRef);
    const freshDoc = fresh.exists ? (fresh.data() || {}) : null;
    const freshStatus = familyCodeStatus(freshDoc, Date.now());
    if (freshStatus !== "ok") {
      throw new HttpsError("failed-precondition", familyCodeStatusMessage(freshStatus));
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    tx.set(db.collection("parentLinks").doc(linkId), {
      parentUid: uid,
      learnerUid,
      learnerDisplayName: learner.displayName || null,
      learnerGrade: learner.grade || null,
      parentDisplayName: redeemer.displayName || null,
      // The guardian's own address, so a link decision can be mailed to
      // them without a second read of their user document — and so the
      // convergence key (guardianLinkCore.guardianEmailKey) is on the
      // link itself rather than reconstructed from an account that may
      // later change address.
      parentEmail: redeemer.email || null,
      parentEmailKey: core.guardianEmailKey(redeemer.email) || null,
      ...(role ? {role} : {}),
      createdVia: "code",
      code,
      // THE CHANGE THIS WHOLE FLOW EXISTS FOR. Redeeming a code no
      // longer grants anything: it creates a PENDING link and asks the
      // child. Everything that reads a link — the parent dashboard, the
      // approval feed, the consent gate — treats pending as no access.
      consent: {
        state: consentState,
        method: core.LINK_METHOD.FAMILY_CODE,
        requestedAt: now,
        ...(consentState === core.LINK_CONSENT.PENDING ? {grantedAt: null, withdrawnAt: null} : {}),
      },
      ...(priorData ? {} : {createdAt: now}),
    }, {merge: true});

    // Burn. Only on a redeem that actually created a new link.
    if (!priorData) {
      tx.update(codeRef, {
        usedAt: now,
        usedBy: uid,
        redeemedCount: admin.firestore.FieldValue.increment(1),
        lastRedeemedAt: now,
      });
    }
  });

  return {
    learnerUid,
    learnerDisplayName: learner.displayName || "your child",
    learnerGrade: learner.grade || null,
    consentState,
    // Said in the response rather than left for the UI to guess, because
    // a parent who thinks they are linked and sees nothing will conclude
    // the app is broken instead of asking their child to tap yes.
    awaitingChildConfirmation: consentState === core.LINK_CONSENT.PENDING,
    message: consentState === core.LINK_CONSENT.PENDING ?
      `Almost there. We have asked ${learner.displayName || "your child"} to confirm you on their own device.` :
      "Linked.",
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
