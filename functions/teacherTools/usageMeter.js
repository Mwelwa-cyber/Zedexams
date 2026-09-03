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
  isMaxOnlyTool,
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

  // The free teacher trial (functions/teacherTrial/) — its own branch, own
  // expiry field, deliberately not folded into the pro/max check below: a
  // trial's teacherTrialEndsAt must never be confused with a
  // teacherPlanExpiresAt a real payment set (see teacherPlans.js comment on
  // PLAN_LIMITS.trial for why the tier itself is a plain alias of pro).
  if (plan === "trial") {
    const exp = data.teacherTrialEndsAt;
    if (exp && typeof exp.toDate === "function" && exp.toDate() > new Date()) {
      return {plan: "trial", isSuperAdmin: false};
    }
    return {plan: "free", isSuperAdmin: false};
  }

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
  const userRef = admin.firestore().doc(`users/${uid}`);

  const result = await admin.firestore().runTransaction(async (tx) => {
    // Both reads must happen before any write (Firestore tx rule). The user
    // doc is read transactionally so a top-up credit is consumed atomically —
    // two racing generations can't spend the same credit twice.
    const [snap, userSnap] = await Promise.all([tx.get(meterRef), tx.get(userRef)]);
    const existing = snap.exists ? (snap.data() || {}) : {};
    const counters = existing.counters || {};
    const used = Number(counters[tool] || 0);
    const credits = Math.max(0, Number((userSnap.exists ? userSnap.data() : null)?.generationCredits || 0));

    // Rolling daily counter ({date, count}) — backs the "Daily cap of
    // 2/10/30 generations" sold on /pricing and the dashboard widget's
    // "Today: N of M". Resets implicitly when the stored date no longer
    // matches today. Super admins skip the gate, but their daily-counted
    // generations still increment so the widget stays truthful.
    const dayKey = yyyymmdd();
    const prevDaily = existing.daily || {};
    const todayUsed = prevDaily.date === dayKey ? Number(prevDaily.count || 0) : 0;

    const monthlyBlocked = used >= limit;
    const dailyBlocked = countsDaily && !isSuperAdmin && todayUsed >= dailyLimit;

    // A purchased top-up credit (K25, one extra generation, any tool) covers
    // EITHER cap. Spend it only when the teacher would otherwise be blocked,
    // so a credit is never wasted on a within-quota generation. It buys one
    // bonus run without touching the plan counters (the plan meter stays at
    // its cap; the bonus lives only as the spent credit).
    if ((monthlyBlocked || dailyBlocked) && credits > 0 && !isSuperAdmin) {
      tx.update(userRef, {
        generationCredits: admin.firestore.FieldValue.increment(-1),
        generationCreditsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {used, limit, plan, period, usedCredit: true, creditsRemaining: credits - 1};
    }

    if (monthlyBlocked) {
      // Assessment + Exam Paper are Max-only studios: Free/Pro get a single
      // monthly taster, then must upgrade to Max (not Pro). Surface a
      // Max-specific message + a structured `details.reason` so the client
      // can open the "Upgrade to Max" paywall rather than the generic one.
      const maxOnly = isMaxOnlyTool(tool) && plan !== "max";
      const toolLabel = tool.replace(/_/g, " ");
      const message = maxOnly ?
        `${toolLabel.charAt(0).toUpperCase() + toolLabel.slice(1)}s are a ` +
          `Max studio. You've used your ${limit} free ${toolLabel} this ` +
          `month on the ${PLAN_LABELS[plan] || plan} plan — upgrade to Max ` +
          `for unlimited.` :
        `You have used ${used}/${limit} ${toolLabel}s on the ` +
          `${PLAN_LABELS[plan] || plan} plan this month. Upgrade to continue.`;
      throw new HttpsError("failed-precondition", message, {
        reason: maxOnly ? "max-only" : "monthly-limit",
        tool,
        plan,
        used,
        limit,
      });
    }

    if (dailyBlocked) {
      throw new HttpsError(
        "failed-precondition",
        `You have used ${todayUsed}/${dailyLimit} generations today on the ` +
        `${PLAN_LABELS[plan] || plan} plan. Your daily allowance resets ` +
        `tomorrow${plan === "max" ? "" : " — or upgrade for a higher cap"}.`,
        {reason: "daily-cap", tool, plan, used: todayUsed, limit: dailyLimit},
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

  // Nudge the teacher once when they cross 80% of a tool's monthly quota
  // (finite limits only; super admins are uncapped). Best-effort — never let a
  // notification failure affect the metered generation.
  try {
    if (!isSuperAdmin && Number.isFinite(limit) && limit > 0 && result.usedCredit !== true) {
      const threshold = Math.ceil(limit * 0.8);
      if (result.used >= threshold && result.used - 1 < threshold && result.used < limit) {
        const {createNotification} = require("../notifications/createNotification");
        const toolLabel = tool.replace(/_/g, " ");
        await createNotification({
          uid,
          category: "account",
          type: "ai_limit_warning",
          title: "You're close to your monthly limit",
          body: `You've used ${result.used} of ${limit} ${toolLabel} generations this month on the ${PLAN_LABELS[plan] || plan} plan.`,
          priority: "medium",
          icon: "user-circle",
          action: {label: "Upgrade plan", url: "/pricing"},
          dedupeKey: `ai-limit-${tool}-${period}`,
          source: "usage-meter",
        });
      }
    }
  } catch (err) {
    console.warn("[usageMeter] AI-limit notification failed", (err && err.message) || err);
  }

  return result;
}

/**
 * Refund a generation credit or roll back a monthly-counter increment that
 * was consumed by assertAndIncrement when the generation subsequently failed
 * with a hard throw (no usable output returned to the user).
 *
 * Must ONLY be called when a usageResult was returned by assertAndIncrement
 * (i.e. the gate was passed). The `flagged` path in the runners (validation
 * failed but an exam paper / assessment was still returned) must NOT call this —
 * only a true throw from the AI call qualifies.
 *
 * Safety contract:
 *  - Best-effort: never throws over the original error (callers must
 *    wrap in their own try/catch and rethrow the original).
 *  - Idempotent enough: re-crediting an already-correct balance is
 *    harmless (the original error is still surfaced to the user).
 *  - Super admins skip both the gate and the refund (their daily-counted
 *    generations do still increment the display counter, but there's no
 *    limit to enforce so no rollback makes sense).
 *
 * @param {string} uid
 * @param {{ usedCredit?: boolean, period?: string, plan?: string }} usageResult
 *   The object returned by assertAndIncrement.
 * @param {string} tool  The tool key passed to assertAndIncrement.
 */
async function refundGeneration(uid, usageResult, tool) {
  if (!usageResult || !uid || !tool) return;
  // Super-admin path: assertAndIncrement increments the display counter for
  // them but they have no hard cap and no purchased credits — nothing to refund.
  if (usageResult.plan === "max" && usageResult.used !== undefined) {
    // Detect super-admin by checking the user doc directly (same as meter does).
    try {
      const snap = await admin.firestore().doc(`users/${uid}`).get();
      if (snap.exists && isSuperAdminRole(snap.data()?.role)) return;
    } catch (_) {
      // If we can't read the doc, proceed with normal refund logic.
    }
  }

  if (usageResult.usedCredit) {
    // A purchased K25 credit was spent. Return it atomically.
    try {
      await admin.firestore().doc(`users/${uid}`).update({
        generationCredits: admin.firestore.FieldValue.increment(1),
        generationCreditsUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (err) {
      console.error("[usageMeter] refundGeneration: credit refund failed", {uid, tool, err});
    }
  } else if (usageResult.period && usageResult.plan) {
    // A free/pro/max plan counter was incremented. Roll it back.
    const period = usageResult.period;
    const meterRef = admin.firestore().doc(`usageMeters/${uid}/periods/${period}`);
    try {
      await admin.firestore().runTransaction(async (tx) => {
        const snap = await tx.get(meterRef);
        if (!snap.exists) return; // meter doc gone — nothing to roll back
        const counters = (snap.data() || {}).counters || {};
        const current = Number(counters[tool] || 0);
        if (current <= 0) return; // already at 0, don't go negative
        tx.update(meterRef, {
          [`counters.${tool}`]: admin.firestore.FieldValue.increment(-1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        // Also roll back the daily counter if this tool counts daily and
        // the stored date still matches today (don't touch a different day).
        if (isDailyCountedTool(tool)) {
          const daily = (snap.data() || {}).daily || {};
          if (daily.date === yyyymmdd() && Number(daily.count || 0) > 0) {
            tx.update(meterRef, {
              "daily.count": admin.firestore.FieldValue.increment(-1),
            });
          }
        }
      });
    } catch (err) {
      console.error("[usageMeter] refundGeneration: counter rollback failed", {uid, tool, period, err});
    }
  }
}

module.exports = {
  PLAN_LIMITS,
  yyyymm,
  getUserTeacherPlan,
  assertAndIncrement,
  refundGeneration,
};
