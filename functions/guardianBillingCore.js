"use strict";

/**
 * guardianBillingCore — the pure decisions behind "a guardian pays for a
 * child".
 *
 * Before this, every payment in ZedExams credited the person who paid:
 * `subscriptionActivation` grants against `pay.userId` and nothing named
 * anyone else. That is correct for a learner or a teacher buying their
 * own plan, and it is the whole problem for the under-18 paywall, whose
 * entire design is that the CHILD never sees a price and the GUARDIAN
 * pays (see src/services/entitlements and functions/guardianUnlock).
 *
 * A payment may now name a `beneficiaryUid`. The rules for when that is
 * allowed, and what it changes, live here — pure, so they test under
 * plain `node` rather than as a sequence of emulator writes with real
 * money-shaped side effects.
 *
 * ── Three rules, and why each one is a rule ─────────────────────────
 *
 *  1. **The beneficiary is authorised at INITIATION, from the server's
 *     own read of `parentLinks`.** Never from anything the client sends
 *     beyond the uid itself. A client that could name any beneficiary
 *     could credit a stranger's account — harmless-looking, since they
 *     are paying for it, until you notice it is also how you'd move a
 *     subscription off an account that is about to be audited.
 *
 *  2. **A guardian payment is never an UPGRADE.** The prorated
 *     Pro→Max quote is computed from the PAYER's subscription
 *     (`quoteUpgradeForUser(user, planId)`), so a parent holding an
 *     active plan would otherwise be quoted a few kwacha of tier
 *     difference and their child would receive a full fresh period for
 *     it. Guardian purchases are charged at full plan price, always.
 *
 *  3. **The request a payment settles must be verified against the
 *     beneficiary.** `guardianRequestId` reaches the server from the
 *     client (it comes out of a URL in an email), and settling it flips
 *     a record and notifies a child. It is honoured only when the stored
 *     request actually belongs to the beneficiary being paid for and is
 *     still outstanding.
 */

/** Statuses a guardian request may still be settled from. */
const SETTLEABLE_REQUEST_STATUSES = Object.freeze(["sent"]);

/**
 * Canonicalise the beneficiary a client asked to pay for.
 *
 * Returns `null` — meaning "an ordinary payment, credit the payer" — for
 * an absent value, a non-string, or the payer's own uid. Paying for
 * yourself is not a beneficiary payment, and treating it as one would
 * put a redundant field on the majority of payments and make the
 * activation branch below load-bearing where it is not.
 */
function normalizeBeneficiary(raw, payerUid) {
  if (typeof raw !== "string") return null;
  const uid = raw.trim();
  if (!uid) return null;
  if (uid === payerUid) return null;
  return uid;
}

/**
 * May `payerUid` buy for `beneficiaryUid`?
 *
 * @param {object} args
 * @param {string|null} args.beneficiaryUid  already normalised
 * @param {string|null} args.role   the payer's guardian role over that child
 * @param {(role: string, capability: string) => boolean} args.can
 * @returns {{allowed: boolean, reason?: string, message?: string}}
 *
 * FAILS CLOSED on every unknown: no link is `not-linked`, and a role this
 * build does not recognise buys nothing (that is `can`'s own contract).
 * `manageBilling` is the capability, which means a CO-GUARDIAN may not
 * pay — deliberately. Co-guardians can approve a request and change what
 * a child may use; moving money is the owner's, because it is one of the
 * two things a co-guardian cannot undo for the person who invited them.
 */
function decideGuardianPayment({beneficiaryUid, role, can} = {}) {
  if (!beneficiaryUid) return {allowed: true};
  if (typeof can !== "function") {
    return {allowed: false, reason: "no-capability-check", message: "Could not check who you are."};
  }
  if (!role) {
    return {
      allowed: false,
      reason: "not-linked",
      message: "You are not linked to this child.",
    };
  }
  if (!can(role, "manageBilling")) {
    return {
      allowed: false,
      reason: "not-owner",
      message: "Only the account owner can pay for this child.",
    };
  }
  return {allowed: true};
}

/**
 * The account a settled payment CREDITS.
 *
 * One line, in one place, so no caller has to remember the precedence —
 * and so the property "an ordinary payment still credits its payer" is
 * something a test can state directly rather than infer from the absence
 * of a branch.
 */
function creditedUid(pay) {
  const beneficiary = pay && typeof pay.beneficiaryUid === "string" ? pay.beneficiaryUid.trim() : "";
  return beneficiary || (pay && pay.userId) || null;
}

/** True when this payment credits somebody other than the person paying. */
function isGuardianPayment(pay) {
  const credited = creditedUid(pay);
  return !!credited && !!pay?.userId && credited !== pay.userId;
}

/**
 * Should a guardian request be settled by this payment?
 *
 * @param {object} args
 * @param {object|null} args.request  the stored guardianRequests doc
 * @param {string|null} args.beneficiaryUid  who the payment credits
 * @returns {{settle: boolean, reason?: string}}
 *
 * The check that matters is `request.uid === beneficiaryUid`. The id
 * arrives from a URL in an email, and settling flips a record and sends a
 * child a message saying their guardian unlocked it — so a request that
 * names a different child must not be settled by this payment, however
 * genuine both halves are separately.
 */
function decideRequestSettlement({request, beneficiaryUid} = {}) {
  if (!request) return {settle: false, reason: "not-found"};
  if (!beneficiaryUid) return {settle: false, reason: "no-beneficiary"};
  if (request.uid !== beneficiaryUid) return {settle: false, reason: "different-child"};
  if (request.status === "paid") return {settle: false, reason: "already-paid"};
  if (!SETTLEABLE_REQUEST_STATUSES.includes(request.status)) {
    return {settle: false, reason: "not-outstanding"};
  }
  return {settle: true};
}

/**
 * The extra fields a guardian payment carries.
 *
 * `isUpgrade: false` is stated rather than omitted — rule 2 above. The
 * activation path branches on `pay.isUpgrade === true`, so writing it
 * explicitly means a guardian payment can never inherit an upgrade
 * quote, whatever the payer's own subscription looks like.
 */
function guardianPaymentFields({beneficiaryUid, beneficiaryName, guardianRequestId} = {}) {
  if (!beneficiaryUid) return {};
  return {
    beneficiaryUid,
    beneficiaryName: typeof beneficiaryName === "string" && beneficiaryName.trim() ?
      beneficiaryName.trim().slice(0, 120) : null,
    isUpgrade: false,
    ...(guardianRequestId ? {guardianRequestId} : {}),
  };
}

module.exports = {
  SETTLEABLE_REQUEST_STATUSES,
  creditedUid,
  decideGuardianPayment,
  decideRequestSettlement,
  guardianPaymentFields,
  isGuardianPayment,
  normalizeBeneficiary,
};
