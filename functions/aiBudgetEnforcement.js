"use strict";

/**
 * getAiBudgetEnforcement — admin-only read model for the /admin/ai-costs
 * "budget enforcement" panel (issue #1755 follow-up).
 *
 * The reservation buckets (aiBudgetBuckets/{month}, see
 * aiBudgetReservation.js) are server-only — Firestore rules never expose
 * them — so the dashboard reads them through this callable rather than a
 * rules carve-out. It returns, for the current UTC month:
 *   - the live ceiling status (mode, budget, month-to-date, over/warning)
 *   - the total currently held in the budget buckets (open holds + settled
 *     actuals — what the hard gate is actually enforcing against)
 *   - a per-provider breakdown of reservations: enforced settled spend and
 *     in-flight open holds, plus month-wide released/expired counts
 *
 * The per-provider numbers come from Firestore AGGREGATE queries (count +
 * sum), never a full collection read — a busy month holds one reservation
 * doc per AI call, far too many to stream to a dashboard. Each aggregate is
 * equality-filtered on (provider, status); the composite index lives in
 * firestore.indexes.json. Every read fails SOFT (zero rows + partial flag):
 * this is a reporting surface and must never 500 the whole panel because
 * one aggregate hiccuped.
 */

const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {AggregateField} = require("firebase-admin/firestore");
const {assertVerifiedAuth} = require("./authGuard");
const {getBudgetStatus, monthKeyUtc} = require("./aiCostTracking");
const {getReservedTotalUsd} = require("./aiBudgetReservation");

const ADMIN_ROLES = new Set(["admin", "superAdmin"]);

// Every model client is on the reservation-based hard gate as of #1761;
// keep this list in sync when a new provider client is added.
const ENFORCED_PROVIDERS = ["anthropic", "openai", "gemini", "embeddings"];

async function assertCallerIsAdmin(request) {
  await assertVerifiedAuth(request);
  const snap = await admin.firestore().doc(`users/${request.auth.uid}`).get();
  if (!snap.exists || !ADMIN_ROLES.has(snap.data()?.role)) {
    throw new HttpsError("permission-denied", "Admin role required.");
  }
  return request.auth.uid;
}

/**
 * One aggregate over the month's reservations, filtered by status and
 * (optionally) provider. Returns zeros on any error — reporting reads
 * degrade, they don't break the panel.
 */
async function aggregateReservations(reservationsCol, {status, provider}) {
  try {
    let q = reservationsCol.where("status", "==", status);
    if (provider !== undefined) q = q.where("provider", "==", provider);
    const snap = await q.aggregate({
      count: AggregateField.count(),
      reservedUsd: AggregateField.sum("reservedUsd"),
      actualUsd: AggregateField.sum("actualUsd"),
    }).get();
    const d = snap.data() || {};
    return {
      ok: true,
      count: Number(d.count || 0),
      reservedUsd: Number(d.reservedUsd || 0),
      actualUsd: Number(d.actualUsd || 0),
    };
  } catch (err) {
    console.warn("[aiBudgetEnforcement] aggregate failed", status, provider, err?.message || err);
    return {ok: false, count: 0, reservedUsd: 0, actualUsd: 0};
  }
}

/**
 * Per-provider reservation summary for one month. `null` provider rows
 * (a caller that skipped the provider tag) surface as "unattributed" and
 * are only included when non-empty. Never throws; `partial: true` flags
 * that at least one aggregate failed and the numbers understate reality.
 */
async function readEnforcementSummary(db, {month}) {
  const col = db.collection("aiBudgetBuckets").doc(month)
      .collection("reservations");

  const providerKeys = [...ENFORCED_PROVIDERS, null];
  const jobs = [];
  for (const provider of providerKeys) {
    jobs.push(aggregateReservations(col, {status: "settled", provider}));
    jobs.push(aggregateReservations(col, {status: "open", provider}));
  }
  // Month-wide failure/reclaim counts (no provider split — they're rare and
  // the split doubles the query count for little insight).
  jobs.push(aggregateReservations(col, {status: "released"}));
  jobs.push(aggregateReservations(col, {status: "expired"}));

  const results = await Promise.all(jobs);
  const partial = results.some((r) => !r.ok);

  const providers = [];
  providerKeys.forEach((provider, i) => {
    const settled = results[i * 2];
    const open = results[i * 2 + 1];
    const row = {
      provider: provider || "unattributed",
      settledUsd: settled.actualUsd,
      settledCount: settled.count,
      openUsd: open.reservedUsd,
      openCount: open.count,
    };
    // Known providers always render (a zero row is informative); the
    // unattributed bucket only when something actually landed there.
    if (provider !== null || row.settledCount > 0 || row.openCount > 0) {
      providers.push(row);
    }
  });

  const released = results[results.length - 2];
  const expired = results[results.length - 1];
  return {
    providers,
    releasedCount: released.count,
    expiredCount: expired.count,
    partial,
  };
}

const getAiBudgetEnforcement = onCall(
    {region: "us-central1", timeoutSeconds: 30},
    async (request) => {
      await assertCallerIsAdmin(request);
      const db = admin.firestore();
      const month = monthKeyUtc();
      const [budget, summary, reservedNowUsd] = await Promise.all([
        getBudgetStatus(),
        readEnforcementSummary(db, {month}),
        getReservedTotalUsd(db, {month}),
      ]);
      return {
        month,
        budget,
        reservedNowUsd,
        enforcedProviders: ENFORCED_PROVIDERS,
        ...summary,
      };
    },
);

module.exports = {
  getAiBudgetEnforcement,
  readEnforcementSummary,
  ENFORCED_PROVIDERS,
};
