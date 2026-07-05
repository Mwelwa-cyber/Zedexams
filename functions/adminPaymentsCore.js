/**
 * functions/adminPaymentsCore.js
 *
 * Pure, Firebase-free helpers for the admin payment/subscription
 * callables (functions/adminPayments.js). Splitting the deterministic
 * math out here — the *Core.js convention used across this codebase —
 * lets the field-shape rules that revenue depends on be unit-tested
 * under plain `node`, with no firebase-admin dependency.
 *
 * These builders mirror, field for field, the client-side writes they
 * replace (confirmPayment / grantPremium / revokePremium in
 * src/hooks/useFirestore.js) so every existing dashboard query keeps
 * working unchanged. The callable layer adds the Firestore-typed fields
 * (serverTimestamp / Timestamp) around these plain values.
 */

/**
 * Map a plan id onto the teacher studio tier the usage meter reads
 * (users.teacherPlan — a SEPARATE axis from subscriptionPlan/premium).
 * Mirrors functions/subscriptionActivation.js so an admin-granted
 * Pro/Max teacher gets studio quotas, not just premium content access.
 * Returns null for learner plans.
 */
function teacherTierForPlan(planId) {
  if (planId === "pro_monthly" || planId === "pro_yearly") return "pro";
  if (planId === "max_monthly" || planId === "max_yearly") return "max";
  return null;
}

/**
 * Resolve the grant length in days. A 0/NaN/negative request falls back
 * to the plan's own duration, then to 30 — the same guard the admin UI
 * applies so an emptied "days" field can't mint a subscription that
 * expires the same instant.
 *
 * `durationDays === 0` is meaningful ONLY for a lifetime/comp grant and
 * must be requested explicitly via `allowLifetime`; otherwise it is
 * treated as "unset" and coerced to the fallback.
 */
function resolveDurationDays(plan, requested, {allowLifetime = false} = {}) {
  const n = Number(requested);
  if (allowLifetime && n === 0) return 0;
  if (Number.isFinite(n) && n > 0) return n;
  return Number(plan && plan.durationDays) || 30;
}

/**
 * expiry = now + durationDays. Returns a fresh Date; never mutates the
 * input. A lifetime grant (durationDays === 0) has no expiry → null.
 */
function computeExpiry(now, durationDays) {
  if (!durationDays) return null;
  const d = new Date(now);
  d.setDate(d.getDate() + durationDays);
  return d;
}

/**
 * Deterministic user-doc fields for a manual grant / confirm. The
 * callable spreads this, then overlays the Firestore-typed timestamps
 * (premiumActivatedAt, subscriptionActivatedAt) and converts
 * `subscriptionExpiry` (a Date|null here) to a Timestamp.
 *
 * @param {object} args
 * @param {string} args.planId
 * @param {Date|null} args.expiry           computed expiry (null = lifetime)
 * @param {string} args.adminId            actor uid, stored as subscriptionActivatedBy
 * @param {string} args.provider           'manual_override' (confirm) | 'manual_grant' (grant)
 * @param {string|null} [args.paymentId]   payments/{id} this grant is tied to
 * @param {boolean} [args.lifetime]        true when durationDays was 0
 */
function buildActivationFields({planId, expiry, adminId, provider, paymentId = null, lifetime = false}) {
  const fields = {
    plan: "premium",
    premium: true,
    isPremium: true,
    paymentStatus: "active",
    subscriptionStatus: "active",
    subscriptionPlan: planId,
    subscriptionExpiry: expiry, // Date|null — callable converts to Timestamp
    subscriptionActivatedBy: adminId,
    subscriptionProvider: provider,
  };
  if (paymentId) fields.subscriptionPaymentId = paymentId;
  if (lifetime) fields.subscriptionLifetime = true;
  const tier = teacherTierForPlan(planId);
  if (tier) {
    fields.teacherPlan = tier;
    fields.teacherPlanExpiresAt = expiry; // Date|null — callable converts
  }
  return fields;
}

/**
 * Deterministic user-doc fields for a revoke — drops the account back to
 * the free tier. Mirrors revokePremium in useFirestore.js exactly.
 */
function buildRevokeFields() {
  return {
    plan: "free",
    premium: false,
    isPremium: false,
    paymentStatus: "inactive",
    subscriptionStatus: "inactive",
    premiumActivatedAt: null,
    subscriptionPlan: "free",
    subscriptionExpiry: null,
    subscriptionActivatedBy: null,
    subscriptionActivatedAt: null,
    subscriptionProvider: null,
    subscriptionPaymentId: null,
  };
}

module.exports = {
  teacherTierForPlan,
  resolveDurationDays,
  computeExpiry,
  buildActivationFields,
  buildRevokeFields,
};
