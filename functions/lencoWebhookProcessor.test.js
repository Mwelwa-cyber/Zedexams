/**
 * Unit tests for the Lenco webhook event dispatch.
 *
 * The signature check is tested in lencoService.test.js; this covers what
 * happens after a verified event arrives: payment resolution (by reference,
 * then by Lenco collection id) and status→action routing. Every effectful
 * dependency (Firestore, activate, markFailed) is injected, so this never
 * touches Firebase or the network.
 *
 *   node functions/lencoWebhookProcessor.test.js
 */

const assert = require("node:assert");
const {processLencoWebhookEvent} = require("./lencoWebhookProcessor");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

// A Firestore fake. Seed `docs` (id→data) for direct doc().get() and
// `byCollectionId` (lencoCollectionId→{id,data}) for the fallback query.
// Records every update() so the "still pending" path is assertable.
function fakeDb({docs = {}, byCollectionId = {}} = {}) {
  const updates = [];
  const db = {
    collection(name) {
      assert.strictEqual(name, "payments");
      return {
        doc(id) {
          return {
            id,
            async get() {
              return docs[id] ?
                {id, exists: true, data: () => docs[id]} :
                {id, exists: false, data: () => undefined};
            },
            async update(patch) {
              updates.push({id, patch});
              return {ok: true};
            },
          };
        },
        where(field, op, value) {
          assert.strictEqual(field, "lencoCollectionId");
          assert.strictEqual(op, "==");
          return {
            limit() {
              return {
                async get() {
                  const hit = byCollectionId[value];
                  if (!hit) return {empty: true, docs: []};
                  return {
                    empty: false,
                    docs: [{id: hit.id, exists: true, data: () => hit.data}],
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  return {db, updates};
}

function makeSinks(activateResult = {ok: true}) {
  const activateCalls = [];
  const markFailedCalls = [];
  return {
    activateCalls,
    markFailedCalls,
    activate: async (a) => {
      activateCalls.push(a);
      return activateResult;
    },
    markFailed: async (a) => {
      markFailedCalls.push(a);
      return {ok: true};
    },
  };
}

async function run() {
  // ── successful → activate ──────────────────────────────────────────
  await test("a successful event activates the subscription by reference", async () => {
    const {db, updates} = fakeDb({docs: {pay_1: {userId: "u1"}}});
    const s = makeSinks();
    const out = await processLencoWebhookEvent({
      event: {event: "collection.successful", data: {reference: "pay_1", status: "successful", amount: 75, currency: "ZMW"}},
      db, activate: s.activate, markFailed: s.markFailed,
    });
    assert.deepStrictEqual(out, {matched: true, action: "activated", paymentId: "pay_1", status: "successful", overCollected: null});
    // The collected amount + currency flow through to activation for verification.
    assert.deepStrictEqual(s.activateCalls, [{paymentId: "pay_1", lencoStatus: "successful", collectedAmount: 75, collectedCurrency: "ZMW"}]);
    assert.strictEqual(s.markFailedCalls.length, 0);
    assert.strictEqual(updates.length, 0, "activation must not also write lencoStatus");
  });

  // ── successful but under-collected → amount_mismatch, no activation ──
  await test("an under-collected successful event surfaces amount_mismatch", async () => {
    const {db} = fakeDb({docs: {pay_1b: {userId: "u1"}}});
    const s = makeSinks({ok: false, reason: "amount-mismatch", amountMismatch: {paymentId: "pay_1b", reason: "under-collection"}});
    const out = await processLencoWebhookEvent({
      event: {event: "collection.successful", data: {reference: "pay_1b", status: "successful", amount: 10, currency: "ZMW"}},
      db, activate: s.activate, markFailed: s.markFailed,
    });
    assert.strictEqual(out.action, "amount_mismatch");
    assert.strictEqual(out.amountMismatch.reason, "under-collection");
  });

  // ── failed → markFailed, with reason passthrough ───────────────────
  await test("a failed event marks the payment failed and forwards the reason", async () => {
    const {db} = fakeDb({docs: {pay_2: {userId: "u2"}}});
    const s = makeSinks();
    const out = await processLencoWebhookEvent({
      event: {event: "collection.failed", data: {reference: "pay_2", status: "failed", reasonForFailure: "insufficient funds"}},
      db, activate: s.activate, markFailed: s.markFailed,
    });
    assert.strictEqual(out.action, "failed");
    assert.deepStrictEqual(s.markFailedCalls, [
      {paymentId: "pay_2", lencoStatus: "failed", reason: "insufficient funds"},
    ]);
    assert.strictEqual(s.activateCalls.length, 0);
  });

  // ── routing can key off the event type when status is absent ───────
  await test("routes on the event type suffix when data.status is missing", async () => {
    const {db} = fakeDb({docs: {pay_3: {}}});
    const s = makeSinks();
    const out = await processLencoWebhookEvent({
      event: {type: "payment.successful", data: {reference: "pay_3", amount: 10, currency: "ZMW"}},
      db, activate: s.activate, markFailed: s.markFailed,
    });
    assert.strictEqual(out.action, "activated");
    // status was empty → activate is called with the default "successful".
    assert.deepStrictEqual(s.activateCalls, [{paymentId: "pay_3", lencoStatus: "successful", collectedAmount: 10, collectedCurrency: "ZMW"}]);
  });

  // ── pending / other status → mirror update, no activation ──────────
  await test("a still-pending status updates lencoStatus and does nothing else", async () => {
    const {db, updates} = fakeDb({docs: {pay_4: {}}});
    const s = makeSinks();
    const out = await processLencoWebhookEvent({
      event: {event: "collection.pending", data: {reference: "pay_4", status: "pay-offline"}},
      db, activate: s.activate, markFailed: s.markFailed,
    });
    assert.strictEqual(out.action, "updated");
    assert.deepStrictEqual(updates, [{id: "pay_4", patch: {lencoStatus: "pay-offline"}}]);
    assert.strictEqual(s.activateCalls.length, 0);
    assert.strictEqual(s.markFailedCalls.length, 0);
  });

  // ── fallback resolution by Lenco collection id ─────────────────────
  await test("resolves the payment by lencoCollectionId when the reference does not map", async () => {
    const {db} = fakeDb({
      docs: {},
      byCollectionId: {col_99: {id: "pay_5", data: {userId: "u5"}}},
    });
    const s = makeSinks();
    const out = await processLencoWebhookEvent({
      event: {event: "collection.successful", data: {reference: "unknown-ref", id: "col_99", status: "successful", amount: 50, currency: "ZMW"}},
      db, activate: s.activate, markFailed: s.markFailed,
    });
    assert.strictEqual(out.matched, true);
    assert.strictEqual(out.paymentId, "pay_5", "paymentId switches to the resolved doc id");
    assert.deepStrictEqual(s.activateCalls, [{paymentId: "pay_5", lencoStatus: "successful", collectedAmount: 50, collectedCurrency: "ZMW"}]);
  });

  // ── no matching payment → ignored, no side effects ─────────────────
  await test("returns ignored (no side effects) when nothing matches", async () => {
    const {db, updates} = fakeDb({docs: {}, byCollectionId: {}});
    const s = makeSinks();
    const out = await processLencoWebhookEvent({
      event: {event: "collection.successful", data: {reference: "nope", id: "also-nope", status: "successful"}},
      db, activate: s.activate, markFailed: s.markFailed,
    });
    assert.deepStrictEqual(out, {matched: false, action: "ignored", paymentId: null, status: "successful"});
    assert.strictEqual(s.activateCalls.length, 0);
    assert.strictEqual(s.markFailedCalls.length, 0);
    assert.strictEqual(updates.length, 0);
  });

  // ── a missing reference must not blow up the doc lookup ────────────
  await test("handles an event with no reference and no collection id", async () => {
    const {db} = fakeDb({docs: {}});
    const s = makeSinks();
    const out = await processLencoWebhookEvent({
      event: {event: "collection.successful", data: {status: "successful"}},
      db, activate: s.activate, markFailed: s.markFailed,
    });
    assert.strictEqual(out.matched, false);
    assert.strictEqual(s.activateCalls.length, 0);
  });

  // ── a totally empty event is ignored, not thrown ───────────────────
  await test("an empty event body is ignored", async () => {
    const {db} = fakeDb({docs: {}});
    const s = makeSinks();
    const out = await processLencoWebhookEvent({event: {}, db, activate: s.activate, markFailed: s.markFailed});
    assert.strictEqual(out.matched, false);
    assert.strictEqual(out.status, "");
  });

  // ── duplicate webhook delivery (Lenco retries on our 5xx, and can also
  //    redeliver) — the processor routes BOTH deliveries to activation and
  //    delegates dedup to activateSubscriptionFromPayment's transaction,
  //    which no-ops once payments/{id}.status is already successful. This
  //    pins that contract: same event twice → two activate calls, no error,
  //    no markFailed — never a second entitlement path of its own. ─────────
  await test("a duplicated successful event is safely routed twice to idempotent activation", async () => {
    const {db} = fakeDb({docs: {pay_dup: {userId: "u1", status: "successful"}}});
    const s = makeSinks();
    const event = {event: "collection.successful", data: {reference: "pay_dup", status: "successful", amount: 75, currency: "ZMW"}};
    const first = await processLencoWebhookEvent({event, db, activate: s.activate, markFailed: s.markFailed});
    const second = await processLencoWebhookEvent({event, db, activate: s.activate, markFailed: s.markFailed});
    assert.strictEqual(first.action, "activated");
    assert.strictEqual(second.action, "activated");
    assert.strictEqual(s.activateCalls.length, 2); // both delegated
    assert.strictEqual(s.markFailedCalls.length, 0);
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
