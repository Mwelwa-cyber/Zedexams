/**
 * Pure helpers for the rate-limiter health canary (OBS-005 / OBS-004). No
 * firebase deps so they test under plain `node` (the *Core.js split).
 *
 * The burst limiter (rateLimit.js) is FAIL-OPEN: when its Firestore-backed
 * transaction errors it allows the request and logs a structured
 * `rate_limit_degraded` event. That log is telemetry, not an alert — nobody is
 * paged when burst protection silently degrades. These helpers back a scheduled
 * synthetic canary that probes the limiter and turns a sustained degradation
 * into an actual ops notification.
 */

"use strict";

/**
 * Classify a single probe of the limiter.
 *   - disabled — the master kill-switch (RATE_LIMIT_DISABLED=1) is on. The
 *                limiter is intentionally off; degraded=true here is expected
 *                and must NOT alert.
 *   - degraded — the limiter's Firestore transaction failed open (burst
 *                protection is not working right now).
 *   - healthy  — the probe went through the real transaction path.
 *
 * @param {{degraded?: boolean, disabled?: boolean}} p
 * @returns {'disabled'|'degraded'|'healthy'}
 */
function classifyLimiterHealth({degraded, disabled} = {}) {
  if (disabled) return "disabled";
  return degraded === true ? "degraded" : "healthy";
}

/**
 * Edge-triggered alert decision: alert only when the limiter has JUST become
 * degraded (onset), not on every hourly probe of a still-ongoing outage — so a
 * sustained Firestore problem produces one alert at onset, not one per hour.
 * Recovery (degraded → healthy) is recorded but does not alert.
 *
 * @param {'disabled'|'degraded'|'healthy'} current
 * @param {'disabled'|'degraded'|'healthy'|undefined|null} previous
 * @returns {boolean}
 */
function shouldAlertLimiterHealth(current, previous) {
  return current === "degraded" && previous !== "degraded";
}

module.exports = {
  classifyLimiterHealth,
  shouldAlertLimiterHealth,
};
