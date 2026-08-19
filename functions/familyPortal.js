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
 *       8-char code in familyInviteCodes/{code} with a 48-HOUR TTL.
 *       Returns { code, expiresAt }.
 *
 *   revokeFamilyInviteCode({ code })         [learner, own code]
 *     - Sets revokedAt so the code can no longer be redeemed. Returns { ok }.
 *
 *   redeemFamilyInviteCode({ code })         [parent account]
 *     - Validates + BURNS the code, blocks self-linking, and creates a
 *       PENDING parentLinks/{parentUid}_{learnerUid}. Returns { status:
 *       'pending' } — the parent is not a guardian yet.
 *
 *   respondToFamilyLink({ linkId, decision }) [the child named on the link]
 *     - accept → the link goes active AND a guardian consent record is
 *       written; decline → it goes declined and stays inert.
 *
 *   getChildProgress({ childUid })           [parent, ACTIVE link only]
 *     - Verifies the parentLink exists and is active, then reuses
 *       aggregateProgress() to return the same rendered shape as the
 *       public getProgressShare.
 *
 * ── A family code is a credential, and is now treated as one ────────
 *
 * It grants an adult full visibility of a child's activity and control of
 * their permissions. Four things changed together, because each on its
 * own leaves the same hole open from a different side:
 *
 *   SINGLE USE   redeeming burns the code. It used to survive redemption
 *                and keep a tally, so a code shared once was a standing
 *                key for as long as it lived.
 *   48 HOURS     it lived 60 DAYS. See FAMILY_CODE_TTL_HOURS.
 *   THE CHILD    redeeming creates a PENDING link. The child is asked
 *   CONFIRMS     "is this your grown-up?" and must say yes. Redeeming used
 *                to BE the check, so the person the data is about was
 *                never consulted.
 *   RATE LIMITED per account and per IP, so the code space cannot be
 *                walked and a stolen parent session cannot try codes in
 *                a loop.
 *
 * Reads (parent's children list, learner's own code + linked parents) go
 * straight through Firestore rules — see firestore.rules parentLinks /
 * familyInviteCodes blocks — so they are NOT re-implemented as callables.
 * The rules cannot express "only active links", so every SERVER path
 * filters with `isLinkActive`; a client reading its own pending row sees a
 * row it cannot act on.
 */

const admin = require("firebase-admin");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const {aggregateProgress} = require("./parentPortalShared");
const {assertCallableRateLimit} = require("./rateLimit");
const {grantedRecord} = require("./guardianConsent/consentRecord");
const {
  FAMILY_CODE_TTL_HOURS,
  LINK_STATUS,
  ONE_HOUR_MS,
  isLinkActive,
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
      Date.now() + FAMILY_CODE_TTL_HOURS * ONE_HOUR_MS,
  );
  await db.collection("familyInviteCodes").doc(code).set({
    code,
    learnerUid: uid,
    createdBy: uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    revokedAt: null,
    // Single use. Set on redemption; `familyCodeStatus` reads it first.
    redeemedAt: null,
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

  // Per account AND per IP, and far below the platform default (20/120):
  // a person typing a code their child read out gets one or two goes, and
  // anything walking the code space hits this in seconds. Both buckets are
  // needed — the per-account cap alone is defeated by a farm of parent
  // accounts, and the per-IP cap alone by one account on many networks.
  // The limiter fails OPEN by design (see rateLimit.js); the code being
  // single-use, short-lived and confirmed by the child is what actually
  // bounds the damage, and this bounds the noise.
  await assertCallableRateLimit(request, {
    action: "redeemFamilyCode",
    userPerMin: 5,
    ipPerMin: 20,
  });

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

  // A link that is ALREADY active stays active and is simply refreshed —
  // a parent re-entering a code must not have to ask their child to
  // confirm again. Anything else (new, pending, previously declined)
  // becomes pending and waits for the child.
  const priorStatus = priorLink ? (priorLink.data() || {}).status : undefined;
  const staysActive = priorLink ? isLinkActive(priorLink.data() || {}) : false;

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
    // The parent's own contact, recorded HERE so the child is asked about
    // a person rather than about a uid, and so the consent record written
    // on acceptance names ONE guardian account rather than a second
    // half-identity beside the emailed-approval route's.
    //
    // It is a verified address by construction: `assertVerifiedAuth` at
    // the top of this handler refuses an unverified caller, and it reads
    // the AUTH token rather than the `users.emailVerified` display mirror
    // (see authGuard.js). Re-testing the mirror here would be a weaker
    // check wearing the look of a stronger one.
    parentEmail: redeemer.email || null,
    ...(role ? {role} : {}),
    createdVia: "code",
    code,
    status: staysActive ? LINK_STATUS.ACTIVE : LINK_STATUS.PENDING,
    ...(staysActive ? {} : {requestedAt: admin.firestore.FieldValue.serverTimestamp()}),
    ...(priorLink ? {} : {createdAt: admin.firestore.FieldValue.serverTimestamp()}),
  }, {merge: true});

  // BURN the code. `redeemedAt` is what makes it single-use — before this
  // the code survived redemption and only kept a tally, so one code shared
  // once was a standing key until it expired sixty days later.
  //
  // Awaited, not best-effort: a redemption that created the link and
  // silently failed to burn the code is exactly the state this change
  // exists to make impossible.
  await db.collection("familyInviteCodes").doc(code).update({
    redeemedAt: admin.firestore.FieldValue.serverTimestamp(),
    revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    redeemedBy: uid,
    redeemedCount: admin.firestore.FieldValue.increment(1),
    lastRedeemedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Tell the child somebody is asking. In-app rather than only in
  // settings: a confirmation nobody is told about is a confirmation
  // nobody gives, and the link stays inert until they do.
  if (!staysActive) {
    try {
      const {createNotification} = require("./notifications/createNotification");
      await createNotification({
        uid: learnerUid,
        category: "account",
        type: "guardian_link_request",
        title: "Is this your grown-up?",
        body: `${redeemer.displayName || "Someone"} wants to be your guardian on ZedExams.`,
        action: {label: "Check", url: "/settings?section=parent"},
        dedupeKey: `guardian-link-${linkId}`,
      });
    } catch (err) {
      // The child can still find the request in their settings, so a
      // failed notification must not fail the redemption.
      console.warn("[familyPortal] link-request notification failed", err);
    }
  }

  return {
    learnerUid,
    learnerDisplayName: learner.displayName || "your child",
    learnerGrade: learner.grade || null,
    status: staysActive ? LINK_STATUS.ACTIVE : LINK_STATUS.PENDING,
    priorStatus: priorStatus || null,
  };
});

/**
 * The child answers "is this your grown-up?".
 *
 * This is the step that turns redeeming a code from the whole check into
 * the first half of one. Only the learner named on the link may call it,
 * and only a PENDING link can be answered — an already-active link is not
 * re-confirmable (nothing to gain) and a declined one is not quietly
 * revivable (the point of keeping the row).
 *
 * ── Accepting writes a real consent record ──────────────────────────
 *
 * `/child-safety` says a guardian approves the account, and until now
 * that was only true of the emailed-link route: linking by code produced
 * an authorised guardian with NO consent evidence at all. Accepting now
 * writes the same `users/{uid}.guardian` record the email link writes,
 * through the same shared builder, with `via: 'code'` and the guardian's
 * uid and VERIFIED email — so the two routes resolve to one guardian
 * identity and one audit trail rather than two half-records.
 *
 * The consent write is deliberately NOT conditional on the child's
 * consent state being empty: a child who already had a granted record and
 * accepts a second guardian gets the record restamped with the newer
 * evidence, which is accurate. What it will not do is DOWNGRADE — nothing
 * here writes denied.
 */
const respondToFamilyLink = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  const uid = await assertVerifiedAuth(request, "Sign in required.");
  await assertCallableRateLimit(request, {
    action: "respondFamilyLink",
    userPerMin: 10,
    ipPerMin: 40,
  });

  const linkId = String(request.data?.linkId || "").trim();
  const decision = String(request.data?.decision || "").trim();
  if (!linkId) throw new HttpsError("invalid-argument", "linkId is required.");
  if (decision !== "accept" && decision !== "decline") {
    throw new HttpsError("invalid-argument", "decision must be 'accept' or 'decline'.");
  }

  const db = admin.firestore();
  const ref = db.collection("parentLinks").doc(linkId);

  // The status flip runs in a transaction that re-reads `status`, so two
  // taps (or accept on a phone and decline on a laptop) resolve to one
  // outcome rather than to whichever write landed last.
  const outcome = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError("not-found", "That request no longer exists.");
    const link = snap.data() || {};
    // Not "you are not the learner" — the same error as a missing link, so
    // this cannot be used to test whether a link id exists.
    if (link.learnerUid !== uid) {
      throw new HttpsError("not-found", "That request no longer exists.");
    }
    if (link.status !== LINK_STATUS.PENDING) {
      return {already: true, status: link.status || LINK_STATUS.ACTIVE, link};
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    if (decision === "decline") {
      tx.update(ref, {status: LINK_STATUS.DECLINED, declinedAt: now});
      return {already: false, status: LINK_STATUS.DECLINED, link};
    }
    tx.update(ref, {status: LINK_STATUS.ACTIVE, acceptedAt: now});
    return {already: false, status: LINK_STATUS.ACTIVE, link};
  });

  if (outcome.status === LINK_STATUS.ACTIVE && !outcome.already) {
    // One guardian identity, one audit trail — see the docblock.
    await db.collection("users").doc(uid).set(grantedRecord({
      now: admin.firestore.FieldValue.serverTimestamp(),
      evidence: {
        via: "code",
        guardianUid: outcome.link.parentUid || "",
        guardianEmail: outcome.link.parentEmail || "",
        code: outcome.link.code || "",
      },
    }), {merge: true});
  }

  return {ok: true, status: outcome.status, already: outcome.already};
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
  // Authorise: the parent must have an ACTIVE link to this child. This is
  // the gate — without one the parent can't read the child's profile or
  // results. A PENDING link (the child has not confirmed) authorises
  // nothing, which is the whole point of the confirmation step: if a
  // pending link could read progress, redeeming a code would still be the
  // only check that mattered.
  const linkSnap = await db.collection("parentLinks").doc(parentLinkId(uid, childUid)).get();
  if (!linkSnap.exists || !isLinkActive(linkSnap.data() || {})) {
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
  respondToFamilyLink,
  getChildProgress,
};
