const assert = require("node:assert");
const admin = require("firebase-admin");
const reservation = require("./aiBudgetReservation");
const tracking = require("./aiCostTracking");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}

function stubFirestore({monthCostUsd = 0, reservationDocs = []} = {}) {
  const makeReservations = () => ({
    get: async () => ({forEach: (cb) => reservationDocs.forEach((d, i) => cb({id: String(i), data: () => d}))}),
  });
  const fs = () => ({
    collection: (name) => {
      if (name === tracking.MONTHLY_COLLECTION) {
        return {
          doc: () => ({
            get: async () => ({exists: true, data: () => ({totalCostUsd: monthCostUsd})}),
            collection: () => ({get: async () => ({forEach: () => {}, docs: []})}),
          }),
        };
      }
      if (name === reservation.COLLECTION) {
        return {
          doc: () => ({collection: () => makeReservations()}),
        };
      }
      return {doc: () => ({get: async () => ({exists: false}), collection: () => ({get: async () => ({forEach: () => {}, docs: []})})})};
    },
  });
  fs.FieldValue = {
    increment: (n) => ({__inc: n}),
    serverTimestamp: () => ({__ts: true}),
  };
  Object.defineProperty(admin, "firestore", {configurable: true, value: fs});
}

(async () => {
  console.log("aiBudgetEnforcementSummary");

  const origGetReserved = reservation.getReservedTotalUsd;
  const origReclaim = reservation.reclaimExpiredReservations;
  try {
    reservation.getReservedTotalUsd = async () => 1.2;
    reservation.reclaimExpiredReservations = async () => 3;
    stubFirestore({
      monthCostUsd: 2.0,
      reservationDocs: [
        {provider: "openai", status: "settled", actualUsd: 0.5, reservedUsd: 0.7},
        {provider: "gemini", status: "open", reservedUsd: 0.2},
      ],
    });

    tracking._resetBudgetCache();
    const summary = await tracking.getAiBudgetEnforcementSummary();
    ok("summary carries reserved total", Math.abs(summary.reservedTotalUsd - 1.2) < 1e-9);
    ok("summary sums settled enforced spend", Math.abs(summary.enforcedSettledUsd - 0.5) < 1e-9);
    ok("summary computes advisory remainder", Math.abs(summary.advisoryOnlyUsd - 1.5) < 1e-9);
    ok("summary exposes provider rows", summary.providers.some((p) => p.provider === "openai"));

    const reclaimed = await tracking.reclaimExpiredAiReservations({month: "2026-07"});
    ok("reclaim wrapper delegates to reservation layer", reclaimed === 3);
  } finally {
    reservation.getReservedTotalUsd = origGetReserved;
    reservation.reclaimExpiredReservations = origReclaim;
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
