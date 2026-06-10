/**
 * Per-tool, per-month usage metering for the teacher tools.
 *
 * Separate from aiService.assertDailyLimit (which is a daily cap on total AI
 * calls). This one enforces monthly per-tool quotas tied to the teacher's
 * plan.
 */

const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
// Plan ids, per-tool monthly limits and legacy-id normalisation live in the
// dependency-free catalogue so the repo-root test suite can cover them.
const {PLAN_LIMITS, PLAN_LABELS, normalizeTeacherPlan} = require("./teacherPlans");

function yyyymm(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

function periodBounds(period) {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(4, 6));
  return {
    start: new Date(Date.UTC(y, m - 1, 1)),
    end: new Date(Date.UTC(y, m, 1)),
  };
}

// Mirrors src/utils/permissions.js isSuperAdmin(). Kept inline so this
// module stays dependency-free for the functions bundle.
function isSuperAdminRole(role) {
  return role === "admin" || role === "superAdmin";
}

async function getUserTeacherPlan(uid) {
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  const data = snap.exists ? (snap.data() || {}) : {};

  // Super admins always get the highest tier so they can exercise every
  // tool without hitting per-month quotas during testing or moderation.
  // No expiry check — the role itself is the entitlement.
  if (isSuperAdminRole(data.role)) {
    return "max";
  }

  // Accepts canonical ids (pro/max) and the pre-2026-06 legacy ids
  // (individual/school) still present on older users docs.
  const plan = normalizeTeacherPlan(data.teacherPlan);
  if (plan === "pro" || plan === "max") {
    // honour expiry if present
    const exp = data.teacherPlanExpiresAt;
    if (exp && typeof exp.toDate === "function" && exp.toDate() < new Date()) {
      return "free";
    }
    return plan;
  }
  return "free";
}

/**
 * Atomically increments the user's counter for `tool` in the current period,
 * but only if the limit has not been reached. Throws HttpsError on quota.
 * Returns `{ plan, used, limit, period }` on success.
 */
async function assertAndIncrement(uid, tool) {
  // Use `in` so that registered tools whose free-plan limit is 0
  // (e.g. scheme_of_work) are still recognised as known tools.
  if (!(tool in PLAN_LIMITS.free)) {
    throw new HttpsError("invalid-argument", `Unknown tool: ${tool}`);
  }
  const period = yyyymm();
  const {start, end} = periodBounds(period);
  const plan = await getUserTeacherPlan(uid);
  const limit = PLAN_LIMITS[plan][tool];

  const meterRef = admin.firestore().doc(`usageMeters/${uid}/periods/${period}`);

  const result = await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(meterRef);
    const existing = snap.exists ? (snap.data() || {}) : {};
    const counters = existing.counters || {};
    const used = Number(counters[tool] || 0);

    if (used >= limit) {
      throw new HttpsError(
        "failed-precondition",
        `You have used ${used}/${limit} ${tool.replace(/_/g, " ")}s on the ` +
        `${PLAN_LABELS[plan] || plan} plan this month. Upgrade to continue.`,
      );
    }

    const next = {
      uid,
      periodStart: admin.firestore.Timestamp.fromDate(start),
      periodEnd: admin.firestore.Timestamp.fromDate(end),
      plan,
      counters: {...counters, [tool]: used + 1},
      limits: PLAN_LIMITS[plan],
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    tx.set(meterRef, next, {merge: true});
    return {used: used + 1, limit, plan, period};
  });

  return result;
}

module.exports = {
  PLAN_LIMITS,
  yyyymm,
  getUserTeacherPlan,
  assertAndIncrement,
};
