/**
 * functions/lencoService.test.js
 *
 * Plain `node` assertion script (no test runner) — same style as the
 * rest of the repo's `test:*` suite. Run: `node functions/lencoService.test.js`
 * or `npm run test:lenco`. Auto-discovered by scripts/run-all-tests.mjs.
 *
 * Covers the pure, network-free surface: operator detection, phone
 * normalization, request shaping (via an injected fetch), error
 * propagation, and webhook signature verification (HMAC-SHA512 keyed by
 * SHA256 of the API token).
 */

const assert = require("node:assert");
const crypto = require("node:crypto");
const lenco = require("./lencoService");

// Collect tests and run them through one async-aware runner so async
// assertion failures actually fail the process (a naive try/catch around
// a sync call would let a rejected promise slip through).
const tests = [];
function test(name, fn) {
  tests.push({name, fn});
}

// Helper: build a fake fetch that records the call and returns a body.
function fakeFetch({status = 200, json = {}} = {}) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({url, opts});
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(json),
    };
  };
  fn.calls = calls;
  return fn;
}

// ── detectOperator ──────────────────────────────────────────────────
test("detectOperator maps MTN prefixes", () => {
  assert.strictEqual(lenco.detectOperator("0966123456"), "mtn");
  assert.strictEqual(lenco.detectOperator("+260761234567"), "mtn");
});
test("detectOperator maps Airtel prefixes", () => {
  assert.strictEqual(lenco.detectOperator("0977740465"), "airtel");
  assert.strictEqual(lenco.detectOperator("260971234567"), "airtel");
});
test("detectOperator maps Zamtel prefixes", () => {
  assert.strictEqual(lenco.detectOperator("0951234567"), "zamtel");
});
test("detectOperator handles bare 9-digit nationals", () => {
  assert.strictEqual(lenco.detectOperator("966123456"), "mtn");
});
test("detectOperator returns null on unknown / garbage", () => {
  assert.strictEqual(lenco.detectOperator("0991234567"), null);
  assert.strictEqual(lenco.detectOperator("hello"), null);
  assert.strictEqual(lenco.detectOperator(""), null);
});

// ── normalizePhone ──────────────────────────────────────────────────
test("normalizePhone yields 2609XXXXXXXX", () => {
  assert.strictEqual(lenco.normalizePhone("0977740465"), "260977740465");
  assert.strictEqual(lenco.normalizePhone("+260 977 740 465"), "260977740465");
  assert.strictEqual(lenco.normalizePhone("977740465"), "260977740465");
});
test("normalizePhone returns '' on invalid", () => {
  assert.strictEqual(lenco.normalizePhone("123"), "");
  assert.strictEqual(lenco.normalizePhone(""), "");
});

// ── request shaping ─────────────────────────────────────────────────
test("initiateMobileMoneyCollection POSTs the documented payload", async () => {
  const fetchImpl = fakeFetch({json: {status: true, data: {id: "col_1", status: "otp-required"}}});
  const res = await lenco.initiateMobileMoneyCollection({
    apiKey: "tok_123", operator: "airtel", phone: "260977740465",
    amount: 75, reference: "ref_abc", bearer: "merchant", fetchImpl,
  });
  const {url, opts} = fetchImpl.calls[0];
  assert.ok(url.endsWith("/collections/mobile-money"), `url was ${url}`);
  assert.strictEqual(opts.method, "POST");
  assert.strictEqual(opts.headers.Authorization, "Bearer tok_123");
  assert.strictEqual(opts.headers.accept, "application/json");
  assert.deepStrictEqual(JSON.parse(opts.body), {
    operator: "airtel", bearer: "merchant", phone: "260977740465",
    amount: 75, reference: "ref_abc", country: "zm",
  });
  assert.strictEqual(res.data.status, "otp-required");
});

test("submitMobileMoneyOtp posts reference + otp", async () => {
  const fetchImpl = fakeFetch({json: {status: true, data: {status: "successful"}}});
  await lenco.submitMobileMoneyOtp({apiKey: "tok", reference: "ref_abc", otp: "000000", fetchImpl});
  const {url, opts} = fetchImpl.calls[0];
  assert.ok(url.endsWith("/collections/mobile-money/submit-otp"));
  assert.deepStrictEqual(JSON.parse(opts.body), {reference: "ref_abc", otp: "000000"});
});

test("getCollectionStatus is a GET with the reference in the path", async () => {
  const fetchImpl = fakeFetch({json: {status: true, data: {status: "pending"}}});
  await lenco.getCollectionStatus({apiKey: "tok", reference: "ref abc", fetchImpl});
  const {url, opts} = fetchImpl.calls[0];
  assert.strictEqual(opts.method, "GET");
  assert.ok(url.endsWith("/collections/status/ref%20abc"), `url was ${url}`);
  assert.strictEqual(opts.body, undefined);
});

test("initiateCardCollection hyphenates expiry fields and strips spaces", async () => {
  const fetchImpl = fakeFetch({json: {status: true, data: {status: "pay-offline"}}});
  await lenco.initiateCardCollection({
    apiKey: "tok", amount: 79, reference: "ref_card",
    card: {number: "4111 1111 1111 1111", cvv: "123", expiryMonth: "12", expiryYear: "27", name: "A B"},
    fetchImpl,
  });
  const body = JSON.parse(fetchImpl.calls[0].opts.body);
  assert.strictEqual(body.card.number, "4111111111111111");
  assert.strictEqual(body.card["expiry-month"], "12");
  assert.strictEqual(body.card["expiry-year"], "27");
  assert.strictEqual(body.currency, "ZMW");
});

test("lencoRequest throws with the API message on non-2xx", async () => {
  const fetchImpl = fakeFetch({status: 400, json: {status: false, message: "Insufficient balance"}});
  await assert.rejects(
    () => lenco.getCollectionStatus({apiKey: "tok", reference: "ref", fetchImpl}),
    /Insufficient balance/,
  );
});

test("lencoRequest throws when API key missing", async () => {
  await assert.rejects(
    () => lenco.lencoRequest({apiKey: "", path: "/x", fetchImpl: fakeFetch()}),
    /API key/,
  );
});

// ── webhook signature ───────────────────────────────────────────────
test("webhookHashKey is SHA256 of the token", () => {
  const token = "tok_live_123";
  const expected = crypto.createHash("sha256").update(token).digest("hex");
  assert.strictEqual(lenco.webhookHashKey(token), expected);
});

test("verifyWebhookSignature accepts a correct signature (derived key)", () => {
  const token = "tok_live_123";
  const body = JSON.stringify({event: "collection.successful", data: {reference: "r1", status: "successful"}});
  const hashKey = crypto.createHash("sha256").update(token).digest("hex");
  const sig = crypto.createHmac("sha512", hashKey).update(body).digest("hex");
  assert.strictEqual(lenco.verifyWebhookSignature({rawBody: body, signature: sig, apiToken: token}), true);
});

test("verifyWebhookSignature accepts an explicit webhookKey over a Buffer body", () => {
  const hashKey = "dashboard_hash_key";
  const body = Buffer.from("{\"a\":1}", "utf8");
  const sig = crypto.createHmac("sha512", hashKey).update(body).digest("hex");
  assert.strictEqual(lenco.verifyWebhookSignature({rawBody: body, signature: sig, webhookKey: hashKey}), true);
});

test("verifyWebhookSignature rejects a tampered body", () => {
  const token = "tok";
  const body = "{\"amount\":75}";
  const hashKey = crypto.createHash("sha256").update(token).digest("hex");
  const sig = crypto.createHmac("sha512", hashKey).update(body).digest("hex");
  const tampered = "{\"amount\":7500}";
  assert.strictEqual(lenco.verifyWebhookSignature({rawBody: tampered, signature: sig, apiToken: token}), false);
});

test("verifyWebhookSignature accepts the raw-bytes SHA256 key derivation", () => {
  // Lenco's spec is ambiguous (hex string vs raw bytes of the SHA256);
  // a signature keyed by the RAW bytes must also verify.
  const token = "tok_live_123";
  const body = JSON.stringify({event: "collection.successful", data: {reference: "r2", status: "successful"}});
  const rawKey = crypto.createHash("sha256").update(token).digest(); // Buffer, not hex
  const sig = crypto.createHmac("sha512", rawKey).update(body).digest("hex");
  assert.strictEqual(lenco.verifyWebhookSignature({rawBody: body, signature: sig, apiToken: token}), true);
});

test("verifyWebhookSignature rejects missing / wrong-length signature", () => {
  const token = "tok";
  assert.strictEqual(lenco.verifyWebhookSignature({rawBody: "x", signature: "", apiToken: token}), false);
  assert.strictEqual(lenco.verifyWebhookSignature({rawBody: "x", signature: "deadbeef", apiToken: token}), false);
});

test("isTerminalStatus only for successful / failed", () => {
  assert.strictEqual(lenco.isTerminalStatus("successful"), true);
  assert.strictEqual(lenco.isTerminalStatus("failed"), true);
  assert.strictEqual(lenco.isTerminalStatus("pending"), false);
  assert.strictEqual(lenco.isTerminalStatus("otp-required"), false);
});

(async () => {
  let passed = 0;
  for (const t of tests) {
    try {
      await t.fn();
      passed += 1;
    } catch (err) {
      console.error(`✗ ${t.name}`);
      console.error(err);
      process.exit(1);
    }
  }
  console.log(`✓ lencoService: ${passed}/${tests.length} checks passed.`);
})();
