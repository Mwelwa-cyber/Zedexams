/**
 * Unit tests for server-side pagination guards.
 *
 *   node functions/paginationCore.test.js
 */
const assert = require("node:assert/strict");
const {
  DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, DECODE_ERRORS,
  clampPageSize, fingerprintFilters, encodeCursorToken, decodeCursorToken,
  resolveSort, resolvePageRequest,
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
