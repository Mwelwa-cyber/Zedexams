"use strict";

/**
 * Hourly sweep that reclaims expired AI-budget reservations
 * (aiBudgetBuckets/{month}/reservations — see aiBudgetReservation.js).
 *
 * The reserve path already lazy-reclaims on contention (reserveBudget's
 * second pass), but that only fires when every bucket LOOKS full — in a
 * quiet month a reservation stranded by a crashed function would otherwise
 * hold budget until the next contention event and skew the reserved-total
 * reporting. This cron is the belt to that lazy-reclaim brace.
 *
 * Sweeps the current AND previous month so holds opened just before a UTC
 * month rollover are still freed. No LLM, no email — reclaim failures are
 * already swallowed (never-throws contract) and just retry next hour.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {reclaimExpiredReservations} = require("./aiBudgetReservation");
const {monthKeyUtc} = require("./aiCostTracking");

/** YYYY-MM of the UTC month before the current one. */
function previousMonthKeyUtc(now = new Date()) {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

const reclaimAiBudgetReservations = onSchedule({
  schedule: "every 60 minutes",
  timeZone: "Etc/UTC",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
}, async () => {
  const db = admin.firestore();
  for (const month of [monthKeyUtc(), previousMonthKeyUtc()]) {
    const reclaimed = await reclaimExpiredReservations(db, {month});
    if (reclaimed > 0) {
      console.log(`[aiBudgetReclaim] reclaimed ${reclaimed} expired reservation(s) for ${month}`);
    }
  }
});

module.exports = {reclaimAiBudgetReservations, previousMonthKeyUtc};
