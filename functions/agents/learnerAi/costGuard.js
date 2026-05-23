/**
 * Cost guard for learner-AI tasks.
 *
 * Two layers:
 *   1. Per-task budget: maxSteps / maxTokensTotal / maxCostUsdCents
 *      stored on aiAgentTasks.supervisorPlan. Dispatcher checks these
 *      before each runner call.
 *   2. Per-user daily cap: wraps aiService.assertDailyLimit with a
 *      dedicated kind so learner usage does not pool with teacher caps.
 *
 * `aiService` is lazy-required inside `assertLearnerDailyLimit` so the
 * pure helpers + constants below (`taskExceedsBudget`,
 * `DEFAULT_TASK_BUDGET`, `MAX_REGENERATION_ATTEMPTS`) can be
 * unit-tested without the full functions/ dep chain — CI's root
 * `npm ci` doesn't install `functions/node_modules`, so eagerly
 * requiring aiService at module-top breaks any test that imports
 * costGuard.
 */

const KIND = "learnerAiTask";

const DEFAULT_TASK_BUDGET = Object.freeze({
  // 8 steps covers every current step plan with headroom — the longest
  // (exam_quiz) is 6 steps: supervisor → curriculumReader → standards
  // → examQuiz → standardsCheck → qualityCheck → supervisorReview.
  // The old default (4) actually short-circuited every practice_quiz
  // and exam_quiz chain — but the helper was never wired into the
  // dispatcher so no production task ever hit it.
  maxSteps: 8,
  maxTokensTotal: 8000,
  maxCostUsdCents: 30,
});

// Hard ceiling on per-task regeneration attempts. After this many
// re-queues for the same task doc, the dispatcher refuses to run
// the chain again — protects against tight loops where admin (or
// the supervisor's auto-decision) keeps regenerating the same task
// and burns the daily question quota on a single bad artifact.
const MAX_REGENERATION_ATTEMPTS = 3;

async function assertLearnerDailyLimit(uid) {
  if (!uid || uid === "system") {
    const err = new Error("Cannot meter a learner-AI task without a real uid.");
    err.code = "failed-precondition";
    throw err;
  }
  // Lazy-required so a test that only exercises the pure helpers
  // doesn't have to mock the full aiService → firebase-functions →
  // anthropicFetch require chain.
  const {assertDailyLimit, getUserRole} = require("../../aiService");
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
  MAX_REGENERATION_ATTEMPTS,
  assertLearnerDailyLimit,
  taskExceedsBudget,
};
