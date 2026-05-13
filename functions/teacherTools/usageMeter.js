/**
 * Per-tool, per-month usage metering for the teacher tools.
 *
 * Separate from aiService.assertDailyLimit (which is a daily cap on total AI
 * calls). This one enforces monthly per-tool quotas tied to the teacher's
 * plan.
 */

const admin = require("firebase-admin");
const {HttpsError} = require("firebase-functions/v2/https");

// Plan → tool → monthly limit. Keep in sync with TEACHER_TOOLS_ARCHITECTURE.md §10
// and the marketing copy in src/components/marketing/Plans.jsx.
//
// Plan key mapping (backend → marketing tier):
//   free       → Free
//   individual → Pro       (K79/mo, "for the everyday teacher")
//   school     → Max       (K199/mo, "unlimited" with fair-use ceiling)
const PLAN_LIMITS = {
  free: {
    lesson_plan: 5,
    worksheet: 3,
    flashcards: 20,
    quiz: 0,
    rubric: 0,
    scheme_of_work: 0,
    notes: 3,
    diagram: 3,
    suggest_answer: 30,
  },
  individual: {
    lesson_plan: 40,
    worksheet: 25,
    flashcards: 200,
    quiz: 8,
    rubric: 8,
    scheme_of_work: 2,
    notes: 25,
    diagram: 30,
    suggest_answer: 500,
  },
  school: {
    lesson_plan: 200,
    worksheet: 200,
    flashcards: 200,
    quiz: 200,
    rubric: 200,
    scheme_of_work: 200,
    notes: 200,
    diagram: 200,
    suggest_answer: 2000,
  },
};

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

async function getUserTeacherPlan(uid) {
  const snap = await admin.firestore().doc(`users/${uid}`).get();
  const data = snap.exists ? (snap.data() || {}) : {};
  const plan = data.teacherPlan;
  if (plan === "individual" || plan === "school") {
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
        `${plan} plan this month. Upgrade to continue.`,
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
