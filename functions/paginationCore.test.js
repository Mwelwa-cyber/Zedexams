/**
 * Unit tests for server-side pagination guards.
 *
 *   node functions/paginationCore.test.js
 */
const assert = require("node:assert/strict");
const {
  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, DECODE_ERRORS,
  clampPageSize, fingerprintFilters, encodeCursorToken, decodeCursorToken,
  resolveSort, resolvePageRequest, createFirestoreTimestampCodec,
} = require("./paginationCore.js");

let passed = 0;
function test(name, fn) { fn(); passed += 1; }

// ── clampPageSize ────────────────────────────────────────────────────────
test("clampPageSize enforces the server maximum", () => {
  assert.equal(clampPageSize(9999), MAX_PAGE_SIZE);
  assert.equal(clampPageSize(51), MAX_PAGE_SIZE);
  assert.equal(clampPageSize(20), 20);
});
test("clampPageSize falls back on garbage and non-positive", () => {
  assert.equal(clampPageSize(0), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(-1), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize("lots"), DEFAULT_PAGE_SIZE);
  assert.equal(clampPageSize(undefined), DEFAULT_PAGE_SIZE);
});
test("clampPageSize honours a custom max", () => {
  assert.equal(clampPageSize(100, { max: 30 }), 30);
});

// ── fingerprintFilters ───────────────────────────────────────────────────
test("fingerprintFilters is order-independent and drops empties", () => {
  assert.equal(
    fingerprintFilters({ b: "2", a: "1", c: null, d: "" }),
    fingerprintFilters({ a: "1", b: "2" }),
  );
});
test("fingerprintFilters has no delimiter collision between distinct filters", () => {
  // Old key=value&… concatenation collapsed these two DIFFERENT filter sets to
  // the same string ("q=x&status=y"); they must now be distinguishable.
  assert.notEqual(
    fingerprintFilters({ q: "x&status=y" }),
    fingerprintFilters({ q: "x", status: "y" }),
  );
});
test("fingerprintFilters preserves value types (1 vs '1')", () => {
  assert.notEqual(
    fingerprintFilters({ grade: 1 }),
    fingerprintFilters({ grade: "1" }),
  );
});
test("a cursor bound to a numeric filter is rejected for the string filter", () => {
  const numeric = { scope: "s", sortField: "createdAt", sortDirection: "desc", filters: { grade: 1 } };
  const stringy = { ...numeric, filters: { grade: "1" } };
  const token = encodeCursorToken({ orderValues: [1, "d"], binding: numeric });
  assert.equal(decodeCursorToken(token, stringy).error, DECODE_ERRORS.BINDING_MISMATCH);
});

// ── cursor round-trip ────────────────────────────────────────────────────
const binding = { scope: "assessments|u1", sortField: "createdAt", sortDirection: "desc", filters: { grade: "G4" } };

test("a cursor round-trips under the same binding", () => {
  const token = encodeCursorToken({ orderValues: [1700000000000, "doc9"], binding });
  const decoded = decodeCursorToken(token, binding);
  assert.equal(decoded.ok, true);
  assert.deepEqual(decoded.orderValues, [1700000000000, "doc9"]);
});

test("a cursor from a different tenant scope is rejected", () => {
  const token = encodeCursorToken({ orderValues: [1, "d"], binding });
  const other = { ...binding, scope: "assessments|u2" };
  const decoded = decodeCursorToken(token, other);
  assert.equal(decoded.ok, false);
  assert.equal(decoded.error, DECODE_ERRORS.BINDING_MISMATCH);
});

test("a cursor from a different sort order is rejected", () => {
  const token = encodeCursorToken({ orderValues: [1, "d"], binding });
  assert.equal(decodeCursorToken(token, { ...binding, sortDirection: "asc" }).error, DECODE_ERRORS.BINDING_MISMATCH);
  assert.equal(decodeCursorToken(token, { ...binding, sortField: "updatedAt" }).error, DECODE_ERRORS.BINDING_MISMATCH);
});

test("a cursor from a different filter set is rejected", () => {
  const token = encodeCursorToken({ orderValues: [1, "d"], binding });
  assert.equal(decodeCursorToken(token, { ...binding, filters: { grade: "G7" } }).error, DECODE_ERRORS.BINDING_MISMATCH);
});

test("a malformed / empty token is rejected, not crashed on", () => {
  assert.equal(decodeCursorToken("", binding).error, DECODE_ERRORS.MALFORMED);
  assert.equal(decodeCursorToken("not base64!!", binding).error, DECODE_ERRORS.MALFORMED);
  assert.equal(decodeCursorToken(null, binding).error, DECODE_ERRORS.MALFORMED);
});

test("an over-long token is rejected before parsing", () => {
  const huge = "a".repeat(5000);
  assert.equal(decodeCursorToken(huge, binding).error, DECODE_ERRORS.TOO_LONG);
});

test("HMAC signing makes a tampered token fail", () => {
  const secret = "s3cr3t";
  const token = encodeCursorToken({ orderValues: [1, "d"], binding }, secret);
  assert.equal(decodeCursorToken(token, binding, secret).ok, true);
  // flip a payload character
  const tampered = `${"x" + token.slice(1)}`;
  const res = decodeCursorToken(tampered, binding, secret);
  assert.equal(res.ok, false);
  assert.ok(res.error === DECODE_ERRORS.BAD_SIGNATURE || res.error === DECODE_ERRORS.MALFORMED || res.error === DECODE_ERRORS.BINDING_MISMATCH);
});

test("a multibyte signature is rejected cleanly, not crashed on (no timingSafeEqual throw)", () => {
  const secret = "s3cr3t";
  const token = encodeCursorToken({ orderValues: [1, "d"], binding }, secret);
  const b64 = token.slice(0, token.indexOf("."));
  // A multibyte '€' is 1 JS char but 3 UTF-8 bytes: string length can match the
  // expected 22-char signature while the byte length differs — the exact input
  // that used to throw ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH.
  const multibyteSig = "€".repeat(22);
  let res;
  assert.doesNotThrow(() => { res = decodeCursorToken(`${b64}.${multibyteSig}`, binding, secret); });
  assert.equal(res.ok, false);
  assert.equal(res.error, DECODE_ERRORS.BAD_SIGNATURE);
});

// ── typed value codec (Firestore Timestamp round-trip) ─────────────────────
// A minimal stand-in for the Admin SDK Timestamp so the pure module is testable
// without firebase-admin. Sorting by createdAt hands one of these as an order
// value; it must survive the cursor round-trip as a real instance.
class FakeTimestamp {
  constructor(seconds, nanoseconds) { this._seconds = seconds; this._nanoseconds = nanoseconds; }
  toMillis() { return this._seconds * 1000 + Math.floor(this._nanoseconds / 1e6); }
}

test("a Firestore Timestamp order value round-trips through the cursor", () => {
  const codec = createFirestoreTimestampCodec(FakeTimestamp);
  const ts = new FakeTimestamp(1_700_000_000, 500);
  const token = encodeCursorToken({ orderValues: [ts, "doc9"], binding }, undefined, codec);
  const decoded = decodeCursorToken(token, binding, undefined, codec);
  assert.equal(decoded.ok, true);
  const [revived, docId] = decoded.orderValues;
  assert.ok(revived instanceof FakeTimestamp, "timestamp should be a real instance, not a plain map");
  assert.equal(revived._seconds, 1_700_000_000);
  assert.equal(revived._nanoseconds, 500);
  assert.equal(docId, "doc9");
});

test("without JSON flattens a Timestamp to an unusable map (regression guard)", () => {
  // Default identity codec: JSON.stringify turns the timestamp into a plain
  // object — decode returns a map, NOT a Timestamp — which is exactly the
  // startAfter() failure the typed codec exists to prevent.
  const ts = new FakeTimestamp(123, 0);
  const token = encodeCursorToken({ orderValues: [ts, "d"], binding });
  const decoded = decodeCursorToken(token, binding);
  assert.equal(decoded.ok, true);
  assert.ok(!(decoded.orderValues[0] instanceof FakeTimestamp));
});

// ── resolveSort ──────────────────────────────────────────────────────────
test("resolveSort rejects a non-allowed field and bad direction", () => {
  const allowed = ["createdAt", "updatedAt"];
  assert.deepEqual(resolveSort({ field: "password", direction: "sideways" }, allowed), { sortField: "createdAt", sortDirection: "desc" });
  assert.deepEqual(resolveSort({ field: "updatedAt", direction: "asc" }, allowed), { sortField: "updatedAt", sortDirection: "asc" });
});

// ── resolvePageRequest ───────────────────────────────────────────────────
test("resolvePageRequest clamps, resolves sort, and surfaces a cursor error", () => {
  const res = resolvePageRequest({
    requestedPageSize: 999,
    requestedSort: { field: "createdAt", direction: "desc" },
    cursorToken: "garbage",
    allowedSortFields: ["createdAt"],
    scope: "assessments|u1",
    filters: { grade: "G4" },
  });
  assert.equal(res.pageSize, MAX_PAGE_SIZE);
  assert.equal(res.sortField, "createdAt");
  assert.equal(res.cursorValues, null);
  assert.equal(res.cursorError, DECODE_ERRORS.MALFORMED);
});

test("resolvePageRequest accepts a matching cursor end-to-end", () => {
  const scope = "assessments|u1";
  const filters = { grade: "G4" };
  const binding2 = { scope, sortField: "createdAt", sortDirection: "desc", filters };
  const token = encodeCursorToken({ orderValues: [123, "d1"], binding: binding2 });
  const res = resolvePageRequest({
    requestedPageSize: 20,
    requestedSort: { field: "createdAt", direction: "desc" },
    cursorToken: token,
    allowedSortFields: ["createdAt"],
    scope, filters,
  });
  assert.equal(res.pageSize, 20);
  assert.deepEqual(res.cursorValues, [123, "d1"]);
  assert.equal(res.cursorError, null);
});

console.log(`paginationCore.test.js: ${passed} passed`);
