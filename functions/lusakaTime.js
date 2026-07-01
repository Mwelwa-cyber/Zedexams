/**
 * functions/lusakaTime.js
 *
 * Zambia wall-clock helpers. Dependency-free on purpose so plain-node test
 * scripts can load them without functions/ deps installed.
 *
 * Why this exists: Cloud Functions containers run in UTC. Any code that
 * derives "today" from `new Date()` local getters silently produces the UTC
 * calendar date — which is still YESTERDAY between 00:00 and 01:59 Lusaka
 * time. The daily-exam pipeline keys everything on the learner-visible
 * (Lusaka) calendar day, so every server-side "today" must come from here.
 *
 * Lusaka is UTC+02:00 year-round with no DST, so a fixed offset is exact.
 */

const LUSAKA_UTC_OFFSET_MS = 2 * 60 * 60 * 1000;

/** Lusaka wall-clock parts for an instant (defaults to now). */
function lusakaNowParts(date = new Date()) {
  const shifted = new Date(date.getTime() + LUSAKA_UTC_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

/** The Lusaka calendar date as "YYYY-MM-DD" — the daily-exam day key. */
function lusakaDayString(date = new Date()) {
  const p = lusakaNowParts(date);
  return [
    p.year,
    String(p.month).padStart(2, "0"),
    String(p.day).padStart(2, "0"),
  ].join("-");
}

module.exports = {lusakaDayString, lusakaNowParts, LUSAKA_UTC_OFFSET_MS};
