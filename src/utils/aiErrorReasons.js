// Mirror of functions/aiErrorReasons.js — the reason codes the backend attaches
// to HttpsError('resource-exhausted', …, { reason }). Kept byte-identical to the
// backend by the drift-guard test in src/utils/aiErrorTaxonomy.test.js.
export const AI_ERROR_REASON = Object.freeze({
  BURST_RATE_LIMIT: 'burst_rate_limit',
  DAILY_QUOTA_EXHAUSTED: 'daily_quota_exhausted',
  MONTHLY_BUDGET_EXHAUSTED: 'monthly_budget_exhausted',
  CONCURRENCY_LIMIT: 'concurrency_limit',
  PROVIDER_UNAVAILABLE: 'provider_unavailable',
})
