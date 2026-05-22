/**
 * Cost guard for learner-AI tasks.
 *
 * Two layers:
 *   1. Per-task budget: maxSteps / maxTokensTotal / maxCostUsdCents
 *      stored on aiAgentTasks.supervisorPlan. Dispatcher checks these
 *      before each runner call.
 *   2. Per-user daily cap: wraps aiService.assertDailyLimit with a
 *      dedicated kind so learner usage does not pool with teacher caps.
 */

const {assertDailyLimit, getUserRole} = require("../../aiService");

const KIND = "learnerAiTask";

const DEFAULT_TASK_BUDGET = Object.freeze({
  maxSteps: 4,
  maxTokensTotal: 8000,
  maxCostUsdCents: 30,
});

async function assertLearnerDailyLimit(uid) {
  if (!uid || uid === "system") {
    const err = new Error("Cannot meter a learner-AI task without a real uid.");
    err.code = "failed-precondition";
    throw err;
  }
  const role = await getUserRole(uid);
  await assertDailyLimit(uid, role, KIND);
}

function taskExceedsBudget(usage, budget) {
  const b = {...DEFAULT_TASK_BUDGET, ...(budget || {})};
  if (Number.isFinite(usage.steps) && usage.steps >= b.maxSteps) return "max_steps";
  if (Number.isFinite(usage.tokensTotal) && usage.tokensTotal >= b.maxTokensTotal) {
    return "max_tokens_total";
  }
  if (Number.isFinite(usage.costUsdCents) && usage.costUsdCents >= b.maxCostUsdCents) {
    return "max_cost";
  }
  return null;
}

module.exports = {
  KIND,
  DEFAULT_TASK_BUDGET,
  assertLearnerDailyLimit,
  taskExceedsBudget,
};
