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
 *   respondToFamilyLink({ linkId, decision }) [the child named on the link]
 *     - accept → the link goes active AND a guardian consent record is
 *       written; decline → it goes declined and stays inert.
 *
 *   (redeemFamilyInviteCode and getChildProgress were removed 2026-10 with the
 *   parent app: no screen called them and a parent account can no longer be made.)
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

const {FieldValue, getFirestore} = require("firebase-admin/firestore");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const {assertCallableRateLimit} = require("./rateLimit");
const {grantedRecord} = require("./guardianConsent/consentRecord");
const {
  LINK_STATUS,
  normalizeFamilyCode,
  isValidFamilyCode,
  familyCodeStatus,
} = require("./familyPortalCore");

const REGION = "us-central1";

// Retired with the parent app (2026-10): the callable that REDEEMED a code is
// gone, so a code minted here could never be used. It refuses rather than
// vanishing so a stale client gets a clear error instead of "function not
// found"; `revokeFamilyInviteCode` and `respondToFamilyLink` stay, because a
// link or code created before the retirement can still be turned off or
// answered.
const createFamilyInviteCode = onCall({
  region: REGION,
  timeoutSeconds: 30,
  memory: "256MiB",
}, async (request) => {
  await assertVerifiedAuth(request, "Sign in required.");
  throw new HttpsError(
      "failed-precondition",
      "Family codes have been retired. Use the WhatsApp button on your results to tell a parent how you are doing.",
      {reason: "retired"},
  );
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

  const db = getFirestore();
  const ref = db.collection("familyInviteCodes").doc(code);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Family code not found.");
  if ((snap.data() || {}).learnerUid !== uid) {
    throw new HttpsError("permission-denied", "You can only turn off your own family code.");
  }
  await ref.update({revokedAt: FieldValue.serverTimestamp()});
  return {ok: true};
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

  const db = getFirestore();
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

    const now = FieldValue.serverTimestamp();
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
      now: FieldValue.serverTimestamp(),
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

module.exports = {
  createFamilyInviteCode,
  revokeFamilyInviteCode,
  respondToFamilyLink,
};
