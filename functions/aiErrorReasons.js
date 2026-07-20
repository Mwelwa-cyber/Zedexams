/**
 * Canonical reason codes attached to HttpsError("resource-exhausted", …,
 * details) so the CLIENT can distinguish a short-term burst throttle (retry in
 * N seconds) from a daily-quota / monthly-budget exhaustion (terminal for the
 * period) — the B3/OBS-005 correctness gap where all three shared a bare
 * "resource-exhausted" and clients showed the wrong message (and, worse, a
 * throttle could be mistaken for a real evaluation failure).
 *
 * Pure + dependency-free (no firebase) so it unit-tests under the root-only
 * install. The FRONTEND mirrors these exact strings in
 * src/utils/aiErrorReasons.js — a drift guard test pins the two together.
 */

"use strict";

const AI_ERROR_REASON = Object.freeze({
  // Per-user per-minute burst limiter tripped. RETRYABLE after retryAfterSec.
  BURST_RATE_LIMIT: "burst_rate_limit",
  // Per-user daily AI-action allowance used up. Terminal until tomorrow.
  DAILY_QUOTA_EXHAUSTED: "daily_quota_exhausted",
  // Revenue-linked monthly AI budget reached. Terminal until next month/admin.
  MONTHLY_BUDGET_EXHAUSTED: "monthly_budget_exhausted",
  // Reserved for a future per-user concurrent-job cap.
  CONCURRENCY_LIMIT: "concurrency_limit",
  // Provider (Anthropic/OpenAI/Gemini) unavailable / timed out.
  PROVIDER_UNAVAILABLE: "provider_unavailable",
});

module.exports = {AI_ERROR_REASON};
