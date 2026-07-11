/**
 * functions/adminPayments.js
 *
 * Server-side, audited admin callables for the sensitive money actions
 * on /admin/payments: confirm / reject a pending payment, and grant /
 * revoke premium on a user. These replace the equivalent client-side
 * Firestore writes (confirmPayment / rejectPayment / grantPremium /
 * revokePremium in src/hooks/useFirestore.js) so every one of them lands
 * a tamper-resistant entry in adminAuditLogs (the /admin/activity page).
 *
 * Field parity is deliberate: each callable writes exactly the user /
 * payment doc shape the client used to, so the dashboards (today's
 * revenue, activations, My-payments, premium count) keep working with no
 * migration. The deterministic parts of that shape live in
 * adminPaymentsCore.js and are unit-tested there.
 *
 * The client (src/utils/adminPaymentsService.js) falls back to a direct
 * Firestore write when these callables aren't deployed yet, so shipping
 * the frontend ahead of the functions deploy never breaks the panel —
 * only the server-stamped audit entry is missed in that window.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {assertVerifiedAuth} = require("./authGuard");
const admin = require("firebase-admin");

const {writeAuditLog} = require("./auditLog");
const {getPlan} = require("./plans");
const {
  resolveDurationDays,
  computeExpiry,
  buildActivationFields,
  buildRevokeFields,
} = require("./adminPaymentsCore");

const ADMIN_ROLES = new Set(["admin", "superAdmin"]);

async function assertCallerIsAdmin(request) {
  // Signed-in + email-verified (admin accounts must verify like everyone).
  await assertVerifiedAuth(request);
  const snap = await admin.firestore().doc(`users/${request.auth.uid}`).get();
  if (!snap.exists || !ADMIN_ROLES.has(snap.data() && snap.data().role)) {
    throw new HttpsError("permission-denied", "Admin role required.");
  }
  return {uid: request.auth.uid, email: (snap.data() && snap.data().email) || null};
}

/**
 * Convert the plain field bag from buildActivationFields into the
 * Firestore-typed write: Date expiries → Timestamp, and the
 * "activated now" markers → serverTimestamp. Keeps the Timestamp/
 * FieldValue types out of the pure core so it stays node-testable.
 */
function finalizeActivationFields(fields) {
  const out = {...fields};
  const now = admin.firestore.FieldValue.serverTimestamp();
  out.premiumActivatedAt = now;
  out.subscriptionActivatedAt = now;
  out.subscriptionExpiry = fields.subscriptionExpiry
    ? admin.firestore.Timestamp.fromDate(fields.subscriptionExpiry)
    : null;
  if (fields.teacherPlan) {
    out.teacherPlanExpiresAt = fields.teacherPlanExpiresAt
      ? admin.firestore.Timestamp.fromDate(fields.teacherPlanExpiresAt)
      : null;
    out.teacherPlanActivatedAt = now;
  }
  return out;
}

/**
 * adminConfirmPayment — confirm a pending payment: activate the buyer's
 * subscription and stamp the payment doc as a manual override. Mirrors
 * confirmPayment() in useFirestore.js.
 */
exports.adminConfirmPayment = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      const actor = await assertCallerIsAdmin(request);
      const {paymentId} = request.data || {};
      if (!paymentId || typeof paymentId !== "string") {
        throw new HttpsError("invalid-argument", "paymentId is required.");
      }

      const db = admin.firestore();
      const payRef = db.collection("payments").doc(paymentId);
      const paySnap = await payRef.get();
      if (!paySnap.exists) {
        throw new HttpsError("not-found", "Payment not found.");
      }
      const pay = paySnap.data() || {};
      const userId = pay.userId;
      if (!userId) {
        throw new HttpsError("failed-precondition", "Payment has no userId.");
      }
      const planId = pay.planId || pay.plan;
      const plan = getPlan(planId);
      const durationDays = resolveDurationDays(plan, plan && plan.durationDays);
      const expiry = computeExpiry(new Date(), durationDays);

      const userUpdate = finalizeActivationFields(
          buildActivationFields({
            planId,
            expiry,
            adminId: actor.uid,
            provider: "manual_override",
            paymentId,
          }),
      );

      const batch = db.batch();
      batch.update(db.collection("users").doc(userId), userUpdate);
      batch.update(payRef, {
        status: "confirmed",
        mtnStatus: "MANUAL_OVERRIDE",
        reason: "",
        confirmedBy: actor.uid,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await batch.commit();

      await writeAuditLog({
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: "payment.confirm",
        targetType: "payment",
        targetId: paymentId,
        before: {status: pay.status || "pending"},
        after: {status: "confirmed"},
        metadata: {userId, planId: planId || null, amountZMW: pay.amountZMW || null},
      });

      return {ok: true, status: "confirmed"};
    },
);

/**
 * adminRejectPayment — reject a pending payment. Mirrors rejectPayment()
 * in useFirestore.js.
 */
exports.adminRejectPayment = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      const actor = await assertCallerIsAdmin(request);
      const {paymentId, reason = ""} = request.data || {};
      if (!paymentId || typeof paymentId !== "string") {
        throw new HttpsError("invalid-argument", "paymentId is required.");
      }

      const db = admin.firestore();
      const payRef = db.collection("payments").doc(paymentId);
      const paySnap = await payRef.get();
      if (!paySnap.exists) {
        throw new HttpsError("not-found", "Payment not found.");
      }
      const pay = paySnap.data() || {};

      await payRef.update({
        status: "rejected",
        mtnStatus: "MANUAL_REJECTED",
        reason: String(reason || "Rejected by admin.").slice(0, 500),
        confirmedBy: actor.uid,
        confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      await writeAuditLog({
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: "payment.reject",
        targetType: "payment",
        targetId: paymentId,
        before: {status: pay.status || "pending"},
        after: {status: "rejected"},
        metadata: {userId: pay.userId || null, reason: String(reason || "").slice(0, 200) || null},
      });

      return {ok: true, status: "rejected"};
    },
);

/**
 * adminGrantPremium — manually grant premium to a user by uid. Mirrors
 * grantPremium() in useFirestore.js, including the durationDays === 0
 * lifetime/comp path.
 */
exports.adminGrantPremium = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      const actor = await assertCallerIsAdmin(request);
      const {uid, planId, durationDays} = request.data || {};
      if (!uid || typeof uid !== "string") {
        throw new HttpsError("invalid-argument", "uid is required.");
      }
      const plan = getPlan(planId);
      if (!plan) {
        throw new HttpsError("invalid-argument", `Unknown plan: ${planId}`);
      }

      const db = admin.firestore();
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        throw new HttpsError("not-found", "User not found.");
      }

      const days = resolveDurationDays(plan, durationDays, {allowLifetime: true});
      const expiry = computeExpiry(new Date(), days);
      const userUpdate = finalizeActivationFields(
          buildActivationFields({
            planId,
            expiry,
            adminId: actor.uid,
            provider: "manual_grant",
            lifetime: days === 0,
          }),
      );
      await userRef.update(userUpdate);

      await writeAuditLog({
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: "payment.grant",
        targetType: "user",
        targetId: uid,
        after: {subscriptionPlan: planId, lifetime: days === 0},
        metadata: {planId, durationDays: days},
      });

      return {ok: true, planId, durationDays: days};
    },
);

/**
 * adminRevokePremium — drop a user back to the free tier. Mirrors
 * revokePremium() in useFirestore.js.
 */
exports.adminRevokePremium = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      const actor = await assertCallerIsAdmin(request);
      const {uid} = request.data || {};
      if (!uid || typeof uid !== "string") {
        throw new HttpsError("invalid-argument", "uid is required.");
      }

      const db = admin.firestore();
      const userRef = db.collection("users").doc(uid);
      const userSnap = await userRef.get();
      if (!userSnap.exists) {
        throw new HttpsError("not-found", "User not found.");
      }
      const before = userSnap.data() || {};

      await userRef.update(buildRevokeFields());

      await writeAuditLog({
        actorUid: actor.uid,
        actorEmail: actor.email,
        action: "payment.revoke",
        targetType: "user",
        targetId: uid,
        before: {subscriptionPlan: before.subscriptionPlan || null, premium: before.premium || false},
        after: {subscriptionPlan: "free", premium: false},
      });

      return {ok: true};
    },
);
