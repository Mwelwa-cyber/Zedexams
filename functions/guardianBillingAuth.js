"use strict";

/**
 * guardianBillingAuth — "may this adult buy for this child?", asked once.
 *
 * The rules themselves live in `guardianBillingCore` (pure) and
 * `shared/guardian/guardianRolesCore` (pure). What lives HERE is the one
 * READ that turns them into an answer: the server's own lookup of
 * `parentLinks` and `guardianRequests`, performed before anything is
 * charged or written.
 *
 * ── Why it is its own module ────────────────────────────────────────
 *
 * This block was written inside `initiateLencoPayment`, which was correct
 * while Lenco was the only way a guardian could pay. Google Play Billing
 * is now a second door onto the same decision, and a second door needs
 * either the same lock or a very good reason. Copying twenty lines of
 * `parentLinks` lookup into the Play verifier would have produced two
 * implementations of "who may spend a parent's money" — the exact fork
 * `src/utils/guardianRoles.js` carries a DO-NOT-ADD-A-RULE-HERE warning
 * about, and the one where a divergence is least visible: both halves
 * keep working, on different rules, until a family disputes a charge.
 *
 * So the Play rail and the Lenco rail call this, and a change to who may
 * pay is a change in one place.
 *
 * ── It returns a verdict; it does not throw ─────────────────────────
 *
 * The two callers surface failures differently — the Lenco initiate
 * raises `HttpsError` mid-callable, the Play verifier has to fold a
 * refusal into a per-token result so one bad purchase cannot abort a
 * multi-token restore. A module that threw would force the second caller
 * to catch its own control flow. `code` is a callable error code so the
 * throwing caller can pass it straight through.
 *
 * ── A valid request id is dropped when it fails, never refused ──────
 *
 * `guardianRequestId` reaches the server from a URL in an email or WhatsApp
 * message. A mismatch means the link is stale or names another child; if
 * the PAYER is separately authorised (an owning parentLinks role), that
 * payment is still legitimate and must not be blocked by it. So a rejected
 * request id comes back as `guardianRequestId: null` with a warning logged
 * rather than refusing the purchase — the child simply is not told "your
 * guardian unlocked what you asked for", which is the honest outcome when
 * we cannot prove they asked.
 *
 * ── …but a valid one is ALSO enough, on its own ─────────────────────
 *
 * This is the flip side, and it is what makes the signed pay link
 * (functions/guardianUnlock, GuardianUnlock.jsx) actually deliver on its
 * "does not require the guardian to have an account" promise: before this,
 * that was only true up to the point of PAYING — a guardian still needed a
 * full registration and a confirmed family-code link to get past
 * `decideGuardianPayment`'s `not-linked` refusal, which is exactly the
 * two-account friction the link exists to remove. A `guardianRequests`
 * record that is still `status: "sent"`, unexpired, and names this exact
 * beneficiary is authorisation on its own — no `parentLinks` row needed.
 * The trust model is possession of the 32-byte single-use token (hashed at
 * rest — see guardianUnlockCore.js), the same boundary
 * `startSameDeviceConsent`'s hand-off already relies on, not the payer's
 * identity. So a co-guardian who was handed this exact link can complete
 * this exact payment even though `manageBilling` would refuse them on the
 * ordinary parentLinks path — they have shown the same thing an owner
 * forwarding the link would have.
 */

const {
  decideGuardianPayment,
  decideRequestSettlement,
  normalizeBeneficiary,
} = require("./guardianBillingCore");

const LINKS = "parentLinks";
const REQUESTS = "guardianRequests";
const MAX_REQUEST_ID = 128;

/**
 * Authorise a guardian purchase.
 *
 * @param {object} args
 * @param {FirebaseFirestore.Firestore} args.db
 * @param {string} args.payerUid            the authenticated caller
 * @param {*} args.beneficiaryUid           raw, as the client sent it
 * @param {*} [args.guardianRequestId]      raw, as the client sent it
 * @param {string} [args.logLabel]          prefix for the dropped-request warning
 * @returns {Promise<
 *   {ok: true, beneficiaryUid: string|null, beneficiary: object|null, guardianRequestId: string|null} |
 *   {ok: false, code: string, message: string, reason: string}
 * >}
 *
 * `beneficiaryUid: null` with `ok: true` is the ordinary case — somebody
 * paying for their own account. Every caller must handle it, because it
 * is the majority of payments.
 */
async function authoriseGuardianPurchase({
  db,
  payerUid,
  beneficiaryUid: rawBeneficiary,
  guardianRequestId: rawRequestId,
  logLabel = "guardianBillingAuth",
} = {}) {
  const beneficiaryUid = normalizeBeneficiary(rawBeneficiary, payerUid);
  if (!beneficiaryUid) {
    return {ok: true, beneficiaryUid: null, beneficiary: null, guardianRequestId: null};
  }

  const requestedId = typeof rawRequestId === "string" ?
    rawRequestId.trim().slice(0, MAX_REQUEST_ID) : "";

  const [{roleFor, can}, linkSnap, reqSnap] = await Promise.all([
    import("./shared/guardian/guardianRolesCore.js"),
    db.collection(LINKS).where("learnerUid", "==", beneficiaryUid).get(),
    requestedId ? db.collection(REQUESTS).doc(requestedId).get() : null,
  ]);
  const links = linkSnap.docs.map((d) => d.data() || {});

  const settlement = decideRequestSettlement({
    request: reqSnap && reqSnap.exists ? reqSnap.data() : null,
    beneficiaryUid,
  });

  // A still-open, unexpired request naming THIS beneficiary is
  // authorisation on its own — see rule 4 in the module docblock. It is
  // checked before the parentLinks lookup because it is meant to succeed
  // for a payer who holds none: that is the entire point of the signed pay
  // link.
  if (!settlement.settle) {
    const verdict = decideGuardianPayment({
      beneficiaryUid,
      role: roleFor(links, payerUid),
      can,
    });
    if (!verdict.allowed) {
      return {
        ok: false,
        code: "permission-denied",
        message: verdict.message,
        reason: verdict.reason,
      };
    }
  }

  const beneficiarySnap = await db.collection("users").doc(beneficiaryUid).get();
  if (!beneficiarySnap.exists) {
    return {
      ok: false,
      code: "not-found",
      message: "That child's account could not be found.",
      reason: "no-beneficiary-account",
    };
  }

  if (requestedId && !settlement.settle) {
    // Present but not usable as authorisation — dropped, not refused, per
    // the module docblock. The payer already cleared decideGuardianPayment
    // above (a link that fails to settle can never be the ONLY reason a
    // purchase is allowed), so this is bookkeeping, not a gate.
    console.warn(`[${logLabel}] guardian request not settled`, {
      requestedId, reason: settlement.reason,
    });
  }

  return {
    ok: true,
    beneficiaryUid,
    beneficiary: beneficiarySnap.data() || {},
    guardianRequestId: settlement.settle ? requestedId : null,
  };
}

module.exports = {authoriseGuardianPurchase};
