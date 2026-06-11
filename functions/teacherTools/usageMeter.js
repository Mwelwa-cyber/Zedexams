/**
 * Per-tool, per-month usage metering for the teacher tools.
 *
 * Separate from aiService.assertDailyLimit (which gates the chat / explain /
 * import surfaces). This module gates the teacher studio tools: monthly
 * per-tool quotas plus the plan's total daily generation cap, both tied to
 * the teacher's plan.
 *
 * Plan and limits are read once before the transaction; only the counters
 * are read transactionally. A plan change racing a generation call can
 * apply the old limits to that one call — accepted, same exposure as the
 * pre-existing monthly check.
 */

const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");
// Plan ids, per-tool monthly limits, daily caps and legacy-id normalisation
// live in the dependency-free catalogue so the repo-root test suite covers them.
const {
  PLAN_LIMITS,
  PLAN_LABELS,
  DAILY_LIMITS,
  normalizeTeacherPlan,
  isDailyCountedTool,
} = require("./teacherPlans");

function yyyymm(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

// UTC day key for the rolling daily counter — same convention as the
// month key above (Zambia is UTC+2, so the "day" rolls at 02:00 local;
// acceptable for a soft display meter, same property as the month edge).
function yyyymmdd(d = new Date()) {
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyymm(d)}${day}`;
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

async function getUserPlanContext(uid) {
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  const data = snap.exists ? (snap.data() || {}) : {};

  // Super admins always get the highest tier so they can exercise every
  // tool without hitting per-month quotas during testing or moderation.
  // No expiry check — the role itself is the entitlement. They also skip
  // the daily cap (bulk content sessions would hit 30/day immediately).
  if (isSuperAdminRole(data.role)) {
    return {plan: "max", isSuperAdmin: true};
  }

  // Accepts canonical ids (pro/max) and the pre-2026-06 legacy ids
  // (individual/school) still present on older users docs.
  const plan = normalizeTeacherPlan(data.teacherPlan);
  if (plan === "pro" || plan === "max") {
    // honour expiry if present
    const exp = data.teacherPlanExpiresAt;
    if (exp && typeof exp.toDate === "function" && exp.toDate() < new Date()) {
      return {plan: "free", isSuperAdmin: false};
    }
    return {plan, isSuperAdmin: false};
  }
  return {plan: "free", isSuperAdmin: false};
}

async function getUserTeacherPlan(uid) {
  return (await getUserPlanContext(uid)).plan;
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
  const {plan, isSuperAdmin} = await getUserPlanContext(uid);
  const limit = PLAN_LIMITS[plan][tool];
  const dailyLimit = DAILY_LIMITS[plan];
  // Micro tools (suggest_answer, revise_question, slide_notes_images) have
  // monthly allowances far above the daily cap and don't count against it.
  const countsDaily = isDailyCountedTool(tool);

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

    // Rolling daily counter ({date, count}) — backs the "Daily cap of
    // 2/10/30 generations" sold on /pricing and the dashboard widget's
    // "Today: N of M". Resets implicitly when the stored date no longer
    // matches today. Super admins skip the gate, but their daily-counted
    // generations still increment so the widget stays truthful.
    const dayKey = yyyymmdd();
    const prevDaily = existing.daily || {};
    const todayUsed = prevDaily.date === dayKey ? Number(prevDaily.count || 0) : 0;

    if (countsDaily && !isSuperAdmin && todayUsed >= dailyLimit) {
      throw new HttpsError(
        "failed-precondition",
        `You have used ${todayUsed}/${dailyLimit} generations today on the ` +
        `${PLAN_LABELS[plan] || plan} plan. Your daily allowance resets ` +
        `tomorrow${plan === "max" ? "" : " — or upgrade for a higher cap"}.`,
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
    if (countsDaily) {
      // Omitted for micro tools — {merge:true} preserves the existing value.
      next.daily = {date: dayKey, count: todayUsed + 1};
    }
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
