"use strict";

/**
 * guardianEntitlement — a paid plan on a guardian unlocks every learner
 * linked to them.
 *
 * ── Why this is not just `beneficiaryUid` ───────────────────────────
 *
 * `guardianBillingCore` already lets a guardian name ONE child as the
 * beneficiary of a payment, and the activation credits that child instead
 * of the payer. That is the right mechanism for "pay for Mutinta's
 * unlock", and it is not the product promise: a parent with three
 * children at the same school does not expect to buy three plans, and a
 * parent who bought one and discovered they had bought it for one child
 * would experience that as being overcharged, not as a feature.
 *
 * So activation ALSO cascades: after the beneficiary (or the payer) is
 * credited, every OTHER learner with an approved link to that guardian
 * receives the same plan, to the same expiry.
 *
 * ── Four rules, and why each one is a rule ──────────────────────────
 *
 *  1. **Only on confirmed money.** This runs from
 *     `subscriptionActivation`, which is reached from the Lenco webhook
 *     and the Play verification — never from a client callable, never
 *     from an intent. There is no path from "a parent tapped pay" to a
 *     child being unlocked; a payment that is initiated and abandoned
 *     unlocks nobody.
 *
 *  2. **Only APPROVED links.** A pending link is somebody who typed a
 *     family code and has not been confirmed by the child. Cascading to
 *     them would make an unconfirmed link grant something, which is the
 *     one property the confirmation step exists to deny — and it would
 *     do it in the direction that is hardest to notice, because the
 *     child gains rather than loses.
 *
 *  3. **Never SHORTENS an existing entitlement.** A child who already
 *     holds a longer plan — bought by the other parent, granted by an
 *     admin, or from a school licence — keeps it. The cascade extends to
 *     the later of the two dates and never writes a nearer one, because
 *     the alternative is a parent's purchase silently cancelling three
 *     weeks somebody else paid for.
 *
 *  4. **Unlinking does not revoke.** The grant is written onto the
 *     CHILD's own user document with its own expiry, exactly as a
 *     purchase they made themselves would be. So a guardian who
 *     withdraws consent, or who is removed, leaves the child's plan
 *     running to the end of the period that was paid for. That is not an
 *     accident of the storage model, it is the intended behaviour: a
 *     child should not lose the term they were paid for over an adult's
 *     admin, and there is a test that pins it.
 *
 * ── What it deliberately does NOT do ────────────────────────────────
 *
 * It does not grant `teacherPlan`. A learner has no teacher studio, and
 * copying the field across would hand a child's account the paid teacher
 * quotas — which the usage meter reads by name and would honour.
 */

const admin = require("firebase-admin");

const LINKS = "parentLinks";
const MAX_CASCADE = 20;

let corePromise = null;
function loadCore() {
  if (!corePromise) corePromise = import("./shared/guardian/guardianLinkCore.js");
  return corePromise;
}

/** Millis from a Timestamp, Date, ISO string or number; null if unreadable. */
function toMillis(value) {
  if (value == null) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value.toMillis === "function") {
    const ms = value.toMillis();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d.getTime() : null;
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  const parsed = Date.parse(String(value));
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Decide what one linked learner should receive. PURE — no Firestore, so
 * the rule a family would dispute ("my daughter lost three weeks when I
 * renewed") is testable as arithmetic.
 *
 * @param {object} args
 * @param {object} args.learner       the child's `users` document
 * @param {number} args.expiryMs      the expiry the guardian just bought
 * @param {string} args.planId
 * @returns {{grant: boolean, reason: string, expiryMs?: number}}
 */
function decideCascade({learner, expiryMs, planId} = {}) {
  if (!Number.isFinite(expiryMs)) return {grant: false, reason: "no-expiry"};
  if (!learner || typeof learner !== "object") return {grant: false, reason: "no-learner"};

  // A suspended or deleted account is not unlocked by somebody paying.
  if (learner.status && learner.status !== "active") {
    return {grant: false, reason: "not-active"};
  }
  // A denied guardian consent suspends the account pending deletion. Money
  // does not overturn that; only the guardian who denied it can.
  if (learner.guardian?.consentStatus === "denied") {
    return {grant: false, reason: "guardian-denied"};
  }

  const existing = toMillis(learner.subscriptionExpiry);
  const lifetime = learner.subscriptionLifetime === true;
  if (lifetime) return {grant: false, reason: "already-lifetime"};

  // Rule 3. Never write a nearer date than the child already holds.
  if (existing != null && existing >= expiryMs) {
    return {grant: false, reason: "already-longer"};
  }

  return {grant: true, reason: existing == null ? "new" : "extended", expiryMs, planId};
}

/**
 * Cascade an activation to every approved-linked learner.
 *
 * Best-effort and post-commit: it is called AFTER the payer/beneficiary
 * has been credited, and a failure here must never undo access somebody
 * paid for. Each child is written independently so one bad document
 * cannot strand the rest.
 *
 * @returns {{cascaded: string[], skipped: Array<{uid: string, reason: string}>}}
 */
async function cascadeGuardianEntitlement(db, {
  guardianUid,
  planId,
  expiry,
  paymentId,
  alreadyCredited = [],
} = {}) {
  const out = {cascaded: [], skipped: []};
  if (!guardianUid || !planId) return out;

  const expiryMs = toMillis(expiry);
  if (!Number.isFinite(expiryMs)) return out;

  const core = await loadCore();

  const linkSnap = await db.collection(LINKS).where("parentUid", "==", guardianUid).get();
  const learnerUids = linkSnap.docs
      .map((d) => ({id: d.id, ...(d.data() || {})}))
      // Rule 2. An unconfirmed link grants nothing, entitlement included.
      .filter((l) => core.linkIsApproved(l))
      .map((l) => l.learnerUid)
      .filter((uid) => uid && !alreadyCredited.includes(uid))
      .slice(0, MAX_CASCADE);

  if (learnerUids.length === 0) return out;

  const expiryTs = admin.firestore.Timestamp.fromMillis(expiryMs);

  for (const learnerUid of learnerUids) {
    try {
      const ref = db.collection("users").doc(learnerUid);
      const snap = await ref.get();
      if (!snap.exists) {
        out.skipped.push({uid: learnerUid, reason: "no-learner"});
        continue;
      }
      const verdict = decideCascade({learner: snap.data() || {}, expiryMs, planId});
      if (!verdict.grant) {
        out.skipped.push({uid: learnerUid, reason: verdict.reason});
        continue;
      }

      await ref.set({
        plan: "premium",
        premium: true,
        isPremium: true,
        paymentStatus: "active",
        subscriptionStatus: "active",
        subscriptionPlan: planId,
        subscriptionExpiry: expiryTs,
        subscriptionActivatedAt: admin.firestore.FieldValue.serverTimestamp(),
        subscriptionProvider: "guardian_cascade",
        subscriptionPaymentId: paymentId || null,
        // Who paid, so a learner asking "why am I premium?" — and support
        // answering it — has something to read. A cascaded grant that
        // looked identical to a self-purchase would be indistinguishable
        // from one at exactly the moment a family disputes it.
        subscriptionGrantedByGuardian: guardianUid,
        expiryReminderSentAt: null,
        // Deliberately NOT teacherPlan — see the module docblock.
      }, {merge: true});

      out.cascaded.push(learnerUid);
    } catch (err) {
      console.error("[guardianEntitlement] cascade failed for", learnerUid, err?.message || err);
      out.skipped.push({uid: learnerUid, reason: "error"});
    }
  }

  return out;
}

module.exports = {MAX_CASCADE, cascadeGuardianEntitlement, decideCascade, toMillis};
