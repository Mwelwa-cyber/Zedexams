/**
 * generatorRateLimit — per-user burst guard for the AI teacher-tool generators
 * (B3 / OBS-005). One line at the top of each generator's callable handler:
 *
 *   await assertGeneratorRateLimit(request, "homework");
 *
 * Delegates to the shared, Firestore-backed, FAIL-OPEN limiter
 * (functions/rateLimit.js). Policy (the per-minute cap + bucket naming) lives
 * in the pure generatorRateLimitCore.js so it is unit-testable without firebase.
 */

"use strict";

const {assertCallableRateLimit} = require("../rateLimit");
const {resolveGeneratorPerMin, generatorRateLimitBucket} =
  require("./generatorRateLimitCore");

/**
 * Enforce the per-user burst cap for one generator invocation. Throws
 * `resource-exhausted` (surfaced to the client like the daily-limit error)
 * when the caller exceeds the window; fail-open on any limiter fault.
 *
 * @param {object} request the onCall request (uid + rawRequest IP)
 * @param {string} tool short tool slug, e.g. "assessment" / "worksheet"
 * @param {object} [deps] test seam: {assert} overrides assertCallableRateLimit
 */
async function assertGeneratorRateLimit(request, tool, {assert = assertCallableRateLimit, env = process.env} = {}) {
  const perMin = resolveGeneratorPerMin(env);
  return assert(request, generatorRateLimitBucket(tool, perMin));
}

module.exports = {assertGeneratorRateLimit};
