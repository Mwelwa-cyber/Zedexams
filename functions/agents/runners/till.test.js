/**
 * Unit tests for Till's payment reconciliation logic.
 *
 * Plain Node assertions, no test runner (repo convention). Every effectful
 * dependency (Firestore query, Lenco lookup, activate, markFailed) is
 * injected with a fake, so this never touches Firebase or the network.
 *
 *   node functions/agents/runners/till.test.js
 */

const assert = require("node:assert");
const {reconcilePendingPayments, toMillis} = require("./till");

let passed = 0;
function test(name, fn) {
  return fn().then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

const NOW = 1_700_000_000_000;
const ts = (ms) => ({toMillis: () => ms});

// A Firestore-ish query stub: chainable where/orderBy/limit, returns the
// docs it was seeded with (the real query filters server-side; the runner's
// own filtering/dispatch is what we exercise here).
function fakeDb(docs) {
  const q = {
    where() {
      return q;
    },
    orderBy() {
      return q;
    },
    limit() {
      return q;
    },
    async get() {
      return {
        forEach(cb) {
          docs.forEach((d) => cb({id: d.id, data: () => d.data}));
        },
      };
    },
  };
  return {collection() {
    return q;
  }};
}

function makeFakes({statusMap = {}, activateMap = {}} = {}) {
  const lookedUp = [];
  const activateCalls = [];
  const markFailedCalls = [];
  return {
    lookedUp,
    activateCalls,
    markFailedCalls,
    async getCollectionStatus({reference}) {
      lookedUp.push(reference);
      const entry = statusMap[reference];
      if (entry instanceof Error) throw entry;
      return {data: entry || {}};
    },
    async activate({paymentId}) {
      activateCalls.push(paymentId);
      return activateMap[paymentId] || {ok: true, activated: true};
    },
    async markFailed({paymentId}) {
      markFailedCalls.push(paymentId);
      return {ok: true};
    },
  };
}

async function run() {
  // ── the core reconciliation matrix ─────────────────────────────────
  await test("reconciles each Lenco status correctly and skips the rest", async () => {
    const docs = [
      {id: "p_success", data: {provider: "lenco", amountZMW: 50, userId: "u1", planId: "grade7_monthly", createdAt: ts(NOW - 3_600_000)}},
      {id: "p_already", data: {provider: "lenco", amountZMW: 50, userId: "u2", planId: "grade7_monthly", createdAt: ts(NOW - 3_600_000)}},
      {id: "p_failed", data: {provider: "lenco", amountZMW: 50, userId: "u3", createdAt: ts(NOW - 7_200_000)}},
      {id: "p_otp", data: {provider: "lenco", createdAt: ts(NOW - 1_800_000)}},
      {id: "p_toonew", data: {provider: "lenco", createdAt: ts(NOW - 60_000)}}, // 1 min old
      {id: "p_manual", data: {provider: "manual_grant", createdAt: ts(NOW - 3_600_000)}},
    ];
    const fakes = makeFakes({
      statusMap: {
        p_success: {status: "successful"},
        p_already: {status: "successful"},
        p_failed: {status: "failed", reasonForFailure: "insufficient funds"},
        p_otp: {status: "otp-required"},
      },
      activateMap: {
        p_success: {ok: true, activated: true},
        p_already: {ok: true, alreadyActive: true},
      },
    });

    const s = await reconcilePendingPayments({
      db: fakeDb(docs), apiKey: "test-key", now: NOW,
      getCollectionStatus: fakes.getCollectionStatus,
      activate: fakes.activate, markFailed: fakes.markFailed,
    });

    assert.strictEqual(s.skipped, null);
    assert.strictEqual(s.checked, 4, "only the 4 in-window lenco docs are queried");
    assert.strictEqual(s.recovered.length, 1, "only the genuine flip counts as recovered");
    assert.strictEqual(s.recovered[0].paymentId, "p_success");
    assert.strictEqual(s.recovered[0].amountZMW, 50);
    assert.strictEqual(s.recovered[0].userId, "u1");
    assert.strictEqual(s.failedClosed.length, 1);
    assert.strictEqual(s.failedClosed[0].paymentId, "p_failed");
    assert.strictEqual(s.stillPending, 1, "otp-required is left alone");
    assert.strictEqual(s.skippedTooNew, 1, "the 1-min-old payment is left to the live poll");
    assert.strictEqual(s.errors.length, 0);

    // The too-new and non-lenco payments must never be queried against Lenco.
    assert.deepStrictEqual(fakes.lookedUp, ["p_success", "p_already", "p_failed", "p_otp"]);
    assert.deepStrictEqual(fakes.activateCalls, ["p_success", "p_already"]);
    assert.deepStrictEqual(fakes.markFailedCalls, ["p_failed"]);
  });

  // ── never act without a key (fail-closed) ──────────────────────────
  await test("does nothing when the Lenco key is absent", async () => {
    const fakes = makeFakes();
    const s = await reconcilePendingPayments({
      db: fakeDb([{id: "p1", data: {provider: "lenco", createdAt: ts(NOW - 3_600_000)}}]),
      apiKey: "", now: NOW,
      getCollectionStatus: fakes.getCollectionStatus,
      activate: fakes.activate, markFailed: fakes.markFailed,
    });
    assert.strictEqual(s.skipped, "no-lenco-api-key");
    assert.strictEqual(s.checked, 0);
    assert.strictEqual(fakes.lookedUp.length, 0);
  });

  // ── a lookup error never marks a payment failed ────────────────────
  await test("a transient Lenco lookup error leaves the payment untouched", async () => {
    const fakes = makeFakes({statusMap: {p_err: new Error("Lenco 503")}});
    const s = await reconcilePendingPayments({
      db: fakeDb([{id: "p_err", data: {provider: "lenco", createdAt: ts(NOW - 3_600_000)}}]),
      apiKey: "test-key", now: NOW,
      getCollectionStatus: fakes.getCollectionStatus,
      activate: fakes.activate, markFailed: fakes.markFailed,
    });
    assert.strictEqual(s.checked, 1);
    assert.strictEqual(s.errors.length, 1);
    assert.strictEqual(s.errors[0].stage, "lookup");
    assert.strictEqual(s.failedClosed.length, 0, "a lookup failure must never mark a payment failed");
    assert.strictEqual(fakes.markFailedCalls.length, 0);
    assert.strictEqual(fakes.activateCalls.length, 0);
  });

  // ── toMillis helper ────────────────────────────────────────────────
  await test("toMillis reads Timestamps, Dates, numbers and ISO strings", async () => {
    assert.strictEqual(toMillis(ts(123)), 123);
    assert.strictEqual(toMillis({toDate: () => new Date(456)}), 456);
    assert.strictEqual(toMillis(new Date(789)), 789);
    assert.strictEqual(toMillis(1000), 1000);
    assert.strictEqual(toMillis("2026-01-01T00:00:00.000Z"), Date.parse("2026-01-01T00:00:00.000Z"));
    assert.strictEqual(toMillis(null), null);
    assert.strictEqual(toMillis("not-a-date"), null);
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
