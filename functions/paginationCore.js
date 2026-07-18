/**
 * functions/paginationCore.js
 *
 * Pure, dependency-free decision logic for server-enforced cursor pagination
 * (Prompt 16 §26/§27). No firebase-admin / firebase-functions imports, so it
 * runs under plain `node functions/paginationCore.test.js` — same *Core.js
 * split as aiOperationsCore.js / metaWhatsAppCore.js. The effectful half (the
 * actual Firestore query with `startAfter`) lives in the callable that uses
 * this module.
 *
 * The contract this enforces for any callable/HTTP endpoint that lists data:
 *   - the page size is clamped server-side to [1, MAX]; a client can never
 *     request an unbounded read, regardless of what it sends
 *   - the sort field must be on an allow-list; an arbitrary orderBy is rejected
 *     (it could hit an unindexed field or leak an ordering the caller shouldn't
 *     control)
 *   - the cursor is an opaque, self-describing token bound to the exact
 *     (scope, sort, filters) it was minted for. A cursor from a different
 *     tenant, collection, filter set, sort order, or endpoint version is
 *     rejected rather than silently returning the wrong page (§26).
 *
 * The token is signed with an HMAC over its payload when a secret is supplied,
 * so it is tamper-evident; unsigned tokens are still validated structurally
 * (the binding fields must match), which is enough for same-origin callables
 * where the transport is already authenticated.
 */

const crypto = require("node:crypto");

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 50;
const MIN_PAGE_SIZE = 1;
const TOKEN_VERSION = 1;

/**
 * Clamp a requested page size into [min, max], defaulting garbage to fallback.
 * The single server-side chokepoint that makes an unbounded read impossible.
 */
function clampPageSize(requested, { min = MIN_PAGE_SIZE, max = MAX_PAGE_SIZE, fallback = DEFAULT_PAGE_SIZE } = {}) {
  const n = Number(requested);
  if (!Number.isFinite(n) || n <= 0) return Math.min(Math.max(fallback, min), max);
  return Math.min(Math.max(Math.floor(n), min), max);
}

/**
 * Recursively sort object keys so a filter value's serialization is stable
 * regardless of the insertion order its keys happened to have. Primitives pass
 * through untouched, so `1` (number) and `'1'` (string) stay distinguishable.
 */
function canonicalizeValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalizeValue(value[k]);
    return out;
  }
  return value;
}

/**
 * Stable, type-preserving fingerprint of a filters object. Two callers with the
 * same effective filters get the same fingerprint so a cursor minted under one
 * is accepted by the other; a changed filter changes the fingerprint and
 * invalidates old cursors (§11).
 *
 * The serialization is a canonical JSON array of `[key, value]` pairs rather
 * than `key=value` concatenation, which had two ambiguities: (1) delimiter
 * collision — `{ q: 'x&status=y' }` and `{ q: 'x', status: 'y' }` both
 * flattened to `q=x&status=y`; (2) type erasure — numeric `1` and string `'1'`
 * both became `"1"`. Either could let a cursor minted for one query be accepted
 * for a materially different one, skipping or duplicating rows. JSON escaping
 * removes the collision and preserves value types.
 */
function fingerprintFilters(filters) {
  if (!filters || typeof filters !== "object") return "";
  const pairs = Object.keys(filters)
    .filter((k) => filters[k] !== undefined && filters[k] !== null && filters[k] !== "")
    .sort()
    .map((k) => [k, canonicalizeValue(filters[k])]);
  return JSON.stringify(pairs);
}

/**
 * The binding a cursor is tied to: identical binding = interchangeable cursor.
 * `scope` should encode the collection + endpoint version + tenant (userId /
 * schoolId), so a cursor never crosses tenants, collections, or API versions.
 */
function bindingString({ scope, sortField, sortDirection, filters }) {
  return [
    String(scope || ""),
    String(sortField || ""),
    String(sortDirection || "asc"),
    fingerprintFilters(filters),
  ].join("|");
}

function sign(payloadB64, secret) {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url").slice(0, 22);
}

// ── Typed value codec (§ preserve Firestore ordering types) ────────────────
//
// A cursor's ordering values are round-tripped through JSON, which silently
// flattens non-primitive Firestore types. The worst offender is a Timestamp
// (the default `createdAt` sort): `JSON.stringify` turns it into a plain
// `{ _seconds, _nanoseconds }` map, and Admin SDK `startAfter(...)` then encodes
// that map as a field value rather than a timestamp boundary — so timestamp-
// sorted endpoints can't fetch page two. A pluggable codec lets the effectful
// caller teach this pure module how to serialize/revive its storage types
// without importing firebase-admin here. Primitives pass through unchanged.

const IDENTITY_VALUE_CODEC = Object.freeze({ encode: (v) => v, decode: (v) => v });

const TIMESTAMP_TAG = "__ts__";

/**
 * Build a value codec that round-trips Firestore Timestamps (and passes every
 * other supported ordering type — string/number/boolean/null — through
 * unchanged). Pass the Admin SDK `Timestamp` class so `decode` can rebuild a
 * real instance the query layer can hand to `startAfter(...)`; when it's absent
 * (e.g. a unit test), decode returns the canonical `{ _seconds, _nanoseconds }`
 * shape so callers can still reconstruct it themselves.
 *
 * @param {(new (seconds: number, nanoseconds: number) => any)|null} [Timestamp]
 */
function createFirestoreTimestampCodec(Timestamp) {
  const seconds = (v) => (typeof v._seconds === "number" ? v._seconds : v.seconds);
  const nanos = (v) => (typeof v._nanoseconds === "number" ? v._nanoseconds : v.nanoseconds);
  return {
    encode(value) {
      if (value && typeof value === "object") {
        const s = seconds(value);
        const n = nanos(value);
        const looksLikeTimestamp = typeof s === "number" && typeof n === "number" &&
          (typeof value.toMillis === "function" || "_seconds" in value || "seconds" in value);
        if (looksLikeTimestamp) return { [TIMESTAMP_TAG]: true, s, n };
      }
      return value;
    },
    decode(value) {
      if (value && typeof value === "object" && value[TIMESTAMP_TAG] === true) {
        if (typeof Timestamp === "function") return new Timestamp(value.s, value.n);
        return { _seconds: value.s, _nanoseconds: value.n };
      }
      return value;
    },
  };
}

/**
 * Encode an opaque cursor token from the last document's ordering values
 * (`orderValues` = the array Firestore `startAfter(...)` expects) plus the
 * binding it belongs to. Returns a bounded base64url string.
 *
 * @param {object} args
 * @param {Array<string|number|boolean>} args.orderValues values for startAfter (sort field(s) + document id)
 * @param {object} args.binding { scope, sortField, sortDirection, filters }
 * @param {string} [secret] optional HMAC secret for tamper-evidence
 * @param {{ encode: (v:any)=>any, decode: (v:any)=>any }} [valueCodec] typed round-trip for non-primitive ordering values (see createFirestoreTimestampCodec)
 * @returns {string}
 */
function encodeCursorToken({ orderValues, binding }, secret, valueCodec = IDENTITY_VALUE_CODEC) {
  const values = Array.isArray(orderValues) ? orderValues : [];
  const payload = {
    v: TOKEN_VERSION,
    b: bindingString(binding),
    c: values.map((v) => valueCodec.encode(v)),
  };
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, "utf8").toString("base64url");
  const sig = secret ? sign(b64, secret) : "";
  return sig ? `${b64}.${sig}` : b64;
}

const DECODE_ERRORS = {
  MALFORMED: "CURSOR_MALFORMED",
  BAD_SIGNATURE: "CURSOR_BAD_SIGNATURE",
  WRONG_VERSION: "CURSOR_WRONG_VERSION",
  BINDING_MISMATCH: "CURSOR_BINDING_MISMATCH",
  TOO_LONG: "CURSOR_TOO_LONG",
};

const MAX_TOKEN_LENGTH = 2048;

/**
 * Decode + validate a cursor token against the binding the CURRENT request is
 * running under. Returns `{ ok: true, orderValues }` only when the token is
 * well-formed, correctly signed (if a secret is given), the right version, and
 * bound to the same (scope, sort, filters). Otherwise `{ ok: false, error }`.
 *
 * A caller should treat any `ok: false` as "start from the first page" or
 * reject the request — never fall through to an unbounded read.
 */
function decodeCursorToken(token, currentBinding, secret, valueCodec = IDENTITY_VALUE_CODEC) {
  if (typeof token !== "string" || !token) return { ok: false, error: DECODE_ERRORS.MALFORMED };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, error: DECODE_ERRORS.TOO_LONG };

  let b64 = token;
  let sig = "";
  const dot = token.indexOf(".");
  if (dot >= 0) { b64 = token.slice(0, dot); sig = token.slice(dot + 1); }

  if (secret) {
    const expected = sign(b64, secret);
    const sigBuf = Buffer.from(sig, "utf8");
    const expBuf = Buffer.from(expected, "utf8");
    // Compare BYTE lengths before timingSafeEqual, not character lengths: a
    // client-controlled signature carrying multibyte characters can have the
    // same string length as `expected` while `Buffer.from(sig)` is a different
    // byte length, which makes crypto.timingSafeEqual throw
    // ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH (crashing the request path) instead of
    // returning a clean CURSOR_BAD_SIGNATURE.
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return { ok: false, error: DECODE_ERRORS.BAD_SIGNATURE };
    }
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(b64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, error: DECODE_ERRORS.MALFORMED };
  }
  if (!payload || typeof payload !== "object") return { ok: false, error: DECODE_ERRORS.MALFORMED };
  if (payload.v !== TOKEN_VERSION) return { ok: false, error: DECODE_ERRORS.WRONG_VERSION };
  if (payload.b !== bindingString(currentBinding)) return { ok: false, error: DECODE_ERRORS.BINDING_MISMATCH };
  if (!Array.isArray(payload.c)) return { ok: false, error: DECODE_ERRORS.MALFORMED };

  return { ok: true, orderValues: payload.c.map((v) => valueCodec.decode(v)) };
}

/**
 * Validate a requested sort field against an allow-list, returning a safe
 * `{ sortField, sortDirection }`. An unknown field falls back to the first
 * allowed field; a non-'asc'/'desc' direction falls back to `defaultDirection`.
 */
function resolveSort(requested, allowedFields, { defaultDirection = "desc" } = {}) {
  const allowed = Array.isArray(allowedFields) && allowedFields.length ? allowedFields : ["createdAt"];
  const field = allowed.includes(requested?.field) ? requested.field : allowed[0];
  const dir = requested?.direction === "asc" || requested?.direction === "desc"
    ? requested.direction
    : defaultDirection;
  return { sortField: field, sortDirection: dir };
}

/**
 * One-call resolver for a paginated endpoint: clamps the page size, resolves +
 * validates the sort, and decodes the cursor against the resulting binding.
 * The endpoint then builds its Firestore query from the returned values.
 *
 * @returns {{ pageSize, sortField, sortDirection, cursorValues: array|null, cursorError: string|null }}
 */
function resolvePageRequest({
  requestedPageSize, requestedSort, cursorToken,
  allowedSortFields, scope, filters,
  maxPageSize = MAX_PAGE_SIZE, defaultPageSize = DEFAULT_PAGE_SIZE, defaultSortDirection = "desc",
  secret, valueCodec = IDENTITY_VALUE_CODEC,
} = {}) {
  const pageSize = clampPageSize(requestedPageSize, { max: maxPageSize, fallback: defaultPageSize });
  const { sortField, sortDirection } = resolveSort(requestedSort, allowedSortFields, { defaultDirection: defaultSortDirection });
  const binding = { scope, sortField, sortDirection, filters };

  let cursorValues = null;
  let cursorError = null;
  if (cursorToken) {
    const decoded = decodeCursorToken(cursorToken, binding, secret, valueCodec);
    if (decoded.ok) cursorValues = decoded.orderValues;
    else cursorError = decoded.error;
  }
  return { pageSize, sortField, sortDirection, cursorValues, cursorError };
}

module.exports = {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MIN_PAGE_SIZE,
  TOKEN_VERSION,
  DECODE_ERRORS,
  clampPageSize,
  fingerprintFilters,
  bindingString,
  encodeCursorToken,
  decodeCursorToken,
  resolveSort,
  resolvePageRequest,
  IDENTITY_VALUE_CODEC,
  createFirestoreTimestampCodec,
};
