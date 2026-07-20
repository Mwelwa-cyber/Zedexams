/**
 * Pure policy for the AI-generator per-user burst rate limit (B3 / OBS-005).
 * No firebase deps so it unit-tests under the repo's root-only install
 * (the *Core.js convention). The thin wrapper that actually enforces it
 * (generatorRateLimit.js) delegates the enforcement to the shared
 * functions/rateLimit.js#assertCallableRateLimit.
 *
 * Why: the monthly AI budget gate (aiCostTracking) + per-user daily quota
 * (usageMeter) bound TOTAL spend, but before this nothing stopped a signed-in
 * teacher (or a leaked ID token) from bursting many expensive generations per
 * minute up to the daily wall — the denial-of-wallet gap in the audit. This
 * adds a short-window per-user cap to every teacher-tool generator.
 */

"use strict";

// Default per-user per-minute cap for a teacher-tool generation. A human
// iterating in a studio never approaches this; a script/loop hits it in
// seconds. Overridable per deploy via RATE_LIMIT_GENERATOR_PER_MIN.
const DEFAULT_GENERATOR_PER_MIN = 10;

/**
 * Resolve the per-minute cap from env, falling back to the default.
 * @param {Record<string,string|undefined>} [env]
 * @returns {number} a positive integer cap
 */
function resolveGeneratorPerMin(env = {}) {
  const raw = parseInt((env || {}).RATE_LIMIT_GENERATOR_PER_MIN, 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GENERATOR_PER_MIN;
}

/**
 * Build the assertCallableRateLimit options for a generator tool. The action
 * is namespaced `gen:<tool>` so each tool gets its own per-user window and a
 * burst on one generator doesn't block a different one.
 * @param {string} tool  short tool slug, e.g. "homework"
 * @param {number} [perMin]
 * @returns {{action: string, userPerMin: number}}
 */
function generatorRateLimitBucket(tool, perMin = DEFAULT_GENERATOR_PER_MIN) {
  const slug = String(tool || "unknown").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "unknown";
  const cap = Number.isFinite(perMin) && perMin > 0 ? perMin : DEFAULT_GENERATOR_PER_MIN;
  return {action: `gen:${slug}`, userPerMin: cap};
}

module.exports = {
  DEFAULT_GENERATOR_PER_MIN,
  resolveGeneratorPerMin,
  generatorRateLimitBucket,
};
