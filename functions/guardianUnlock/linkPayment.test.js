"use strict";

/**
 * linkPayment — paying from the guardian pay link with no login.
 *
 * The things worth pinning are the ones a parent would never see and an
 * attacker would try: that the token is the only credential, that the PLAN
 * and the ACCOUNT come from the stored request and never from the caller,
 * that a token cannot reach another payment, and that the limiter protecting
 * a message to a stranger's phone fails CLOSED.
 *
 * firebase-functions / firebase-admin are stubbed through Module._load so this
 * runs on a root-only install, like the other backend tests.
 *
 * Run: node functions/guardianUnlock/linkPayment.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-functions/v2/https") return {HttpsError};
  if (request === "firebase-admin/firestore") {
    return {
      getFirestore: () => { throw new Error("no real db in this test"); },
      FieldValue: {serverTimestamp: () => "TS"},
      Timestamp: {fromMillis: (n) => n},
    };
  }
  return origLoad.call(this, request, ...rest);
};

const core = require("./linkPaymentCore");
const {buildLinkPaymentHandlers} = require("./linkPayment");

let passed = 0;
async function test(name, fn) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}
async function rejects(promise, code, reasonIncludes) {
  try {
    await promise;
  } catch (err) {
    assert.strictEqual(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
    if (reasonIncludes) assert.strictEqual(err.details?.reason, reasonIncludes);
    return err;
  }
  assert.fail(`expected a ${code} rejection`);
}

// ── Pure core ───────────────────────────────────────────────────────────
const FUTURE = Date.now() + 86_400_000;
const open = {uid: "kid", status: "sent", planId: "term_pass", expiresAt: FUTURE};

(async () => {
  await test("hashToken is the sha256 the request id is, and refuses junk", () => {
    const id = core.hashToken("abc");
    assert.strictEqual(id, require("node:crypto").createHash("sha256").update("abc").digest("hex"));
    assert.strictEqual(core.hashToken("  abc  "), id);
    for (const bad of ["", "   ", null, undefined, 5, "x".repeat(core.MAX_TOKEN_CHARS + 1)]) {
      assert.strictEqual(core.hashToken(bad), null);
    }
  });

  await test("start needs an outstanding, unexpired request with a plan", () => {
    assert.strictEqual(core.decideLinkUse({record: open, purpose: "start"}).ok, true);
    const r = (rec) => core.decideLinkUse({record: rec, purpose: "start"});
    assert.strictEqual(r(null).reason, "unknown");
    assert.strictEqual(r({...open, uid: ""}).reason, "unknown");
    assert.strictEqual(r({...open, status: "paid"}).reason, "already-paid");
    assert.strictEqual(r({...open, status: "withdrawn"}).reason, "withdrawn");
    assert.strictEqual(r({...open, expiresAt: Date.now() - 1}).reason, "expired");
    assert.strictEqual(r({...open, planId: ""}).reason, "no-plan");
  });

  await test("follow keeps working after the request is paid or the link expires", () => {
    const f = (rec) => core.decideLinkUse({record: rec, purpose: "follow"});
    assert.strictEqual(f(open).ok, true);
    assert.strictEqual(f({...open, status: "paid"}).ok, true);
    assert.strictEqual(f({...open, expiresAt: Date.now() - 1}).ok, true);
    assert.strictEqual(f({...open, status: "withdrawn"}).ok, false);
    assert.strictEqual(f(null).ok, false);
  });

  await test("a payment belongs to a request only if BOTH the child and the request match", () => {
    const b = (payment) => core.paymentBelongsToRequest({payment, childUid: "kid", requestId: "R"});
    assert.strictEqual(b({userId: "kid", guardianRequestId: "R"}), true);
    assert.strictEqual(b({userId: "kid", guardianRequestId: "OTHER"}), false);
    assert.strictEqual(b({userId: "kid"}), false);
    assert.strictEqual(b({userId: "stranger", guardianRequestId: "R"}), false);
    assert.strictEqual(b(null), false);
  });

  await test("the public result carries no authorization or internals", () => {
    const out = core.publicPaymentResult({
      paymentId: "p1", status: "pending", requiresOtp: true, amountZMW: "50", message: "hi",
      authorization: {secret: 1}, reference: "r", lencoCollectionId: "x",
    });
    assert.deepStrictEqual(Object.keys(out).sort(),
        ["alreadyPaid", "amountZMW", "message", "paymentId", "requiresOtp", "status"]);
    assert.strictEqual(out.amountZMW, 50);
  });

  // ── Handlers, against an in-memory store ──────────────────────────────
  const TOKEN = "raw-token-123";
  const REQUEST_ID = core.hashToken(TOKEN);

  function setup({record = open, payments = {}, limiter = async () => ({allowed: true}), initiate} = {}) {
    const store = {
      guardianRequests: record ? {[REQUEST_ID]: {...record}} : {},
      payments: {...payments},
    };
    const db = {
      collection: (col) => ({
        doc: (id) => ({
          get: async () => ({exists: store[col]?.[id] !== undefined, data: () => store[col]?.[id]}),
          update: async (patch) => { store[col][id] = {...store[col][id], ...patch}; },
        }),
      }),
    };
    const calls = {initiate: [], status: [], otp: [], limited: []};
    const paymentHandlers = {
      initiateLencoPayment: async (req) => {
        calls.initiate.push(req);
        if (initiate) return initiate(req, store);
        store.payments.pay1 = {userId: req.auth.uid};
        return {paymentId: "pay1", reference: "pay1", status: "pending", requiresOtp: false,
          amountZMW: 50, authorization: {leak: true}};
      },
      getLencoPaymentStatus: async (req) => { calls.status.push(req); return {status: calls.nextStatus || "pending"}; },
      submitLencoOtp: async (req) => { calls.otp.push(req); return {status: calls.nextStatus || "pending"}; },
    };
    const handlers = buildLinkPaymentHandlers({
      paymentHandlers,
      getDb: () => db,
      limit: async (_db, buckets) => { calls.limited.push(buckets); return limiter(); },
    });
    return {handlers, store, calls};
  }
  const req = (data) => ({data, rawRequest: {headers: {"x-forwarded-for": "1.2.3.4"}, get: () => "1.2.3.4"}});

  await test("pay: the plan and the account come from the stored request, never the caller", async () => {
    const {handlers, calls, store} = setup();
    const res = await handlers.guardianLinkPay(req({
      token: TOKEN, phone: "0977123456", operator: "airtel",
      planId: "year_max", beneficiaryUid: "someoneElse", uid: "attacker", amountZMW: 1, expectedAmountZMW: 1,
    }));
    assert.strictEqual(calls.initiate.length, 1);
    const sent = calls.initiate[0];
    assert.strictEqual(sent.auth.uid, "kid");
    assert.deepStrictEqual(sent.auth.token, {});
    assert.deepStrictEqual(sent.data, {
      planId: "term_pass", method: "mobile_money", phone: "0977123456", operator: "airtel",
    });
    assert.strictEqual(res.paymentId, "pay1");
    assert.strictEqual("authorization" in res, false);
    // The tag travels INTO the payment handler (written in the same commit that
    // creates the payment), built from the verified request — never from data.
    assert.deepStrictEqual(sent.trustedPaymentFields, {guardianRequestId: REQUEST_ID});
    assert.strictEqual("trustedPaymentFields" in sent.data, false);
  });

  await test("pay: a bad, unknown, paid or expired token never reaches the payment handler", async () => {
    for (const [data, record, code] of [
      [{token: ""}, open, "invalid-argument"],
      [{token: "nope"}, open, "not-found"],
      [{token: TOKEN}, {...open, status: "paid"}, "failed-precondition"],
      [{token: TOKEN}, {...open, expiresAt: Date.now() - 1}, "failed-precondition"],
      [{token: TOKEN}, {...open, status: "withdrawn"}, "failed-precondition"],
    ]) {
      const {handlers, calls} = setup({record});
      await rejects(handlers.guardianLinkPay(req({...data, phone: "0977123456", operator: "mtn"})), code);
      assert.strictEqual(calls.initiate.length, 0);
    }
  });

  await test("pay: rate-limited per token AND per IP, and FAILS CLOSED when the limiter breaks", async () => {
    const limited = setup({limiter: async () => ({allowed: false})});
    await rejects(limited.handlers.guardianLinkPay(req({token: TOKEN, phone: "0977123456"})), "resource-exhausted", "rate-limited");
    assert.strictEqual(limited.calls.initiate.length, 0);

    const broken = setup({limiter: async () => { throw new Error("firestore down"); }});
    await rejects(broken.handlers.guardianLinkPay(req({token: TOKEN, phone: "0977123456"})), "unavailable");
    assert.strictEqual(broken.calls.initiate.length, 0);

    const buckets = limited.calls.limited[0];
    assert.ok(buckets.some((b) => b.scope.includes(":u:")), "a per-token bucket");
    assert.ok(buckets.some((b) => b.scope.includes(":ip:")), "a per-IP bucket");
  });

  await test("pay: the QUOTED price is enforced, so a repriced plan is refused rather than overcharged", async () => {
    const {handlers, calls} = setup({record: {...open, priceZMW: 120}});
    await handlers.guardianLinkPay(req({token: TOKEN, phone: "0977123456", expectedAmountZMW: 1}));
    assert.strictEqual(calls.initiate[0].data.expectedAmountZMW, 120, "the stored quote, never the caller's number");
    const none = setup({record: {...open, priceZMW: null}});
    await none.handlers.guardianLinkPay(req({token: TOKEN, phone: "0977123456"}));
    assert.strictEqual("expectedAmountZMW" in none.calls.initiate[0].data, false);
  });

  await test("pay: a degraded limiter is a refusal, not a pass (the production limiter never throws)", async () => {
    const degraded = setup({limiter: async () => ({allowed: true, degraded: true})});
    await rejects(degraded.handlers.guardianLinkPay(req({token: TOKEN, phone: "0977123456"})), "unavailable");
    assert.strictEqual(degraded.calls.initiate.length, 0);
    const otp = setup({
      payments: {mine: {userId: "kid", guardianRequestId: REQUEST_ID}},
      limiter: async () => ({allowed: true, degraded: true}),
    });
    await rejects(otp.handlers.guardianLinkPayOtp(req({token: TOKEN, paymentId: "mine", otp: "1"})), "unavailable");
    // Watching a payment moves no money, so a degraded limiter does not stop it.
    const status = setup({
      payments: {mine: {userId: "kid", guardianRequestId: REQUEST_ID}},
      limiter: async () => ({allowed: true, degraded: true}),
    });
    assert.strictEqual((await status.handlers.guardianLinkPayStatus(req({token: TOKEN, paymentId: "mine"}))).status, "pending");
  });

  await test("pay: a REUSED untagged payment of this child is tagged; one of another request is left alone", async () => {
    const reuse = (existing) => setup({
      payments: {pay1: existing},
      initiate: async () => ({paymentId: "pay1", status: "pending", reused: true}),
    });
    const a = reuse({userId: "kid"});
    await a.handlers.guardianLinkPay(req({token: TOKEN, phone: "0977123456"}));
    assert.strictEqual(a.store.payments.pay1.guardianRequestId, REQUEST_ID);
    const b = reuse({userId: "kid", guardianRequestId: "other"});
    await b.handlers.guardianLinkPay(req({token: TOKEN, phone: "0977123456"}));
    assert.strictEqual(b.store.payments.pay1.guardianRequestId, "other");
    const c = reuse({userId: "stranger"});
    await c.handlers.guardianLinkPay(req({token: TOKEN, phone: "0977123456"}));
    assert.strictEqual(c.store.payments.pay1.guardianRequestId, undefined);
  });

  await test("status: only a payment started from THIS request can be followed", async () => {
    const mine = {userId: "kid", guardianRequestId: REQUEST_ID};
    const {handlers, calls} = setup({payments: {
      mine, otherReq: {userId: "kid", guardianRequestId: "other"},
      childOwn: {userId: "kid"}, theirs: {userId: "stranger", guardianRequestId: REQUEST_ID},
    }});
    for (const id of ["otherReq", "childOwn", "theirs", "missing", ""]) {
      await rejects(handlers.guardianLinkPayStatus(req({token: TOKEN, paymentId: id})), id === "" ? "invalid-argument" : "permission-denied");
    }
    assert.strictEqual(calls.status.length, 0);
    const ok = await handlers.guardianLinkPayStatus(req({token: TOKEN, paymentId: "mine"}));
    assert.strictEqual(ok.status, "pending");
    assert.strictEqual(calls.status[0].auth.uid, "kid");
  });

  await test("status: polling still works once the request is paid, and this wrapper never settles it", async () => {
    // Settlement belongs to subscriptionActivation, AFTER access is granted. A
    // provider "successful" is not that: activation can withhold access (an
    // amount mismatch) or fail after the provider answered.
    const {handlers, calls, store} = setup({
      record: {...open, status: "paid"},
      payments: {mine: {userId: "kid", guardianRequestId: REQUEST_ID}},
    });
    calls.nextStatus = "successful";
    const res = await handlers.guardianLinkPayStatus(req({token: TOKEN, paymentId: "mine"}));
    assert.strictEqual(res.status, "successful");
    assert.strictEqual(store.guardianRequests[REQUEST_ID].status, "paid", "untouched here");
  });

  await test("otp: same ownership rule, and the limiter fails closed", async () => {
    const {handlers, calls} = setup({payments: {
      mine: {userId: "kid", guardianRequestId: REQUEST_ID}, stray: {userId: "kid"},
    }});
    await rejects(handlers.guardianLinkPayOtp(req({token: TOKEN, paymentId: "stray", otp: "123456"})), "permission-denied");
    assert.strictEqual(calls.otp.length, 0);
    await handlers.guardianLinkPayOtp(req({token: TOKEN, paymentId: "mine", otp: "123456"}));
    assert.deepStrictEqual(calls.otp[0].data, {paymentId: "mine", otp: "123456"});

    const broken = setup({
      payments: {mine: {userId: "kid", guardianRequestId: REQUEST_ID}},
      limiter: async () => { throw new Error("down"); },
    });
    await rejects(broken.handlers.guardianLinkPayOtp(req({token: TOKEN, paymentId: "mine", otp: "1"})), "unavailable");
    assert.strictEqual(broken.calls.otp.length, 0);
  });

  await test("status: a broken limiter does NOT block a parent who is only watching", async () => {
    const {handlers} = setup({
      payments: {mine: {userId: "kid", guardianRequestId: REQUEST_ID}},
      limiter: async () => { throw new Error("down"); },
    });
    const res = await handlers.guardianLinkPayStatus(req({token: TOKEN, paymentId: "mine"}));
    assert.strictEqual(res.status, "pending");
  });

  console.log(`\nlinkPayment: ${passed} checks passed`);
})().catch((err) => { console.error(err); process.exit(1); });
