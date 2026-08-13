/**
 * Password-reset rate-limit keys — the pure half.
 *
 * The endpoint charges two daily buckets before it tries to send (per email,
 * so one victim's inbox can't be bombed; per IP, so one source can't spray).
 * A failed send has to give those charges back, and "give back what you
 * charged" is only checkable if BOTH sides derive their keys from one
 * function — the format used to be built inline at the charge site, so a
 * refund could only ever re-type it and hope.
 *
 * Plain CommonJS with no firebase-functions / firebase-admin import, so it
 * tests under bare `node` (the *Core.js split used across functions/).
 *
 * The key STRINGS are load-bearing: live counter documents are already keyed
 * this way, so changing the format silently resets everybody's allowance
 * rather than reading it.
 */

/**
 * The rate-limit document ids a single reset attempt charges.
 *
 * `unknown` is the sentinel the handler uses when the request carries no
 * usable client IP; it is dropped rather than bucketed, because bucketing it
 * would put every such caller in one shared counter and let a handful of
 * them lock out the rest.
 *
 * @param {{email: string, ip?: string, day: string}} args
 * @returns {string[]} zero to two document ids, email bucket first
 */
function passwordResetRateLimitKeys({email, ip, day}) {
  const keys = [];
  if (email) keys.push(`email_${email}_${day}`);
  if (ip && ip !== "unknown") keys.push(`ip_${ip}_${day}`);
  return keys;
}

module.exports = {passwordResetRateLimitKeys};
