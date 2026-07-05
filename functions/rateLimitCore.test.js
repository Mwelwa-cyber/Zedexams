"use strict";

// Plain-node assertion tests for the pure rate-limiter helpers. Run with
// `npm run test:rate-limit` (or `node functions/rateLimitCore.test.js`).

const assert = require("assert");
const {
  sanitizeKeyPart,
  windowStartFor,
  rateLimitDocId,
  evaluate,
  retryAfterSeconds,
  clientIpFrom,
} = require("./rateLimitCore");

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

console.log("rateLimitCore");

test("sanitizeKeyPart strips slashes and disallowed chars", () => {
  assert.strictEqual(sanitizeKeyPart("a/b\\c"), "a_b_c");
  assert.strictEqual(sanitizeKeyPart("ok.id:1-2_3"), "ok.id:1-2_3");
  assert.strictEqual(sanitizeKeyPart("space bar!"), "space_bar_");
});

test("sanitizeKeyPart neutralises reserved leading dots", () => {
  assert.strictEqual(sanitizeKeyPart("."), "_");
  assert.strictEqual(sanitizeKeyPart(".."), "_");
  assert.strictEqual(sanitizeKeyPart("...x"), "_x");
});

test("sanitizeKeyPart falls back to 'unknown' for empty input", () => {
  assert.strictEqual(sanitizeKeyPart(""), "unknown");
  assert.strictEqual(sanitizeKeyPart(null), "unknown");
  assert.strictEqual(sanitizeKeyPart(undefined), "unknown");
});

test("sanitizeKeyPart truncates to maxLength", () => {
  assert.strictEqual(sanitizeKeyPart("a".repeat(500), 10).length, 10);
});

test("windowStartFor floors to the window boundary", () => {
  assert.strictEqual(windowStartFor(0, 60000), 0);
  assert.strictEqual(windowStartFor(59999, 60000), 0);
  assert.strictEqual(windowStartFor(60000, 60000), 60000);
  assert.strictEqual(windowStartFor(60001, 60000), 60000);
  assert.strictEqual(windowStartFor(125000, 60000), 120000);
});

test("windowStartFor returns 0 for invalid input", () => {
  assert.strictEqual(windowStartFor(NaN, 60000), 0);
  assert.strictEqual(windowStartFor(1000, 0), 0);
  assert.strictEqual(windowStartFor(1000, -5), 0);
});

test("rateLimitDocId composes scope + window and stays id-safe", () => {
  assert.strictEqual(rateLimitDocId("aiChat:u:xyz", 120000), "aiChat:u:xyz_120000");
  assert.strictEqual(rateLimitDocId("a/b", 60000), "a_b_60000");
  assert.ok(!rateLimitDocId("x", 0).includes("/"));
});

test("evaluate allows below the cap and blocks at/over it", () => {
  assert.deepStrictEqual(evaluate(0, 3), { allowed: true, remaining: 3 });
  assert.deepStrictEqual(evaluate(2, 3), { allowed: true, remaining: 1 });
  assert.deepStrictEqual(evaluate(3, 3), { allowed: false, remaining: 0 });
  assert.deepStrictEqual(evaluate(9, 3), { allowed: false, remaining: 0 });
});

test("evaluate treats a non-positive limit as no cap", () => {
  assert.strictEqual(evaluate(1000, 0).allowed, true);
  assert.strictEqual(evaluate(1000, -1).allowed, true);
});

test("retryAfterSeconds ceils remaining window and floors at 1", () => {
  assert.strictEqual(retryAfterSeconds(120000, 120000, 60000), 60);
  assert.strictEqual(retryAfterSeconds(179000, 120000, 60000), 1);
  assert.strictEqual(retryAfterSeconds(179999, 120000, 60000), 1);
  assert.strictEqual(retryAfterSeconds(150500, 120000, 60000), 30);
});

test("clientIpFrom prefers the leftmost X-Forwarded-For entry", () => {
  assert.strictEqual(clientIpFrom("41.1.2.3, 10.0.0.1, 10.0.0.2"), "41.1.2.3");
  assert.strictEqual(clientIpFrom("  41.1.2.3  "), "41.1.2.3");
});

test("clientIpFrom falls back to the peer IP then 'unknown'", () => {
  assert.strictEqual(clientIpFrom("", "8.8.8.8"), "8.8.8.8");
  assert.strictEqual(clientIpFrom(null, null), "unknown");
  assert.strictEqual(clientIpFrom(undefined, ""), "unknown");
});

test("clientIpFrom truncates absurdly long values", () => {
  assert.strictEqual(clientIpFrom("a".repeat(200)).length, 64);
});

console.log(`\n${passed} assertions passed.`);
