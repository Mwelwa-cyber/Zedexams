"use strict";

/**
 * idempotency — small, reusable server-side primitives for making
 * consequential operations safe against duplicate delivery, client
 * double-taps, and callable retries.
 *
 * Two concerns, both keyed on a stable string:
 *
 *   1. CLIENT idempotency key — a value the client mints ONCE per logical
 *      action (one "Assign work" press, one "Generate" click) and resends on
 *      every retry of that action. `deriveIdempotentId(namespace, key)` turns
 *      it into a deterministic Firestore doc id, namespaced so one user's key
 *      can never collide with another's. The caller then does a transactional
 *      create-if-absent at that id: the first request creates the record, and
 *      every retry with the same key resolves the SAME doc and returns the
 *      existing result instead of repeating the side effect.
 *
 *   2. TRIGGER / event dedup — Eventarc + Firestore deliver events
 *      AT-LEAST-ONCE, so a trigger body can run more than once for the same
 *      logical event. `claimEventOnce(db, {...})` atomically claims
 *      `processedEvents/{scope}_{eventId}` via a create() (which fails closed
 *      with ALREADY_EXISTS on a duplicate), so the body runs at most once per
 *      (scope, eventId).
 *
 * The pure helpers (id derivation, key validation, id sanitisation) take no
 * Firestore and are unit-tested directly under plain node; `claimEventOnce`
 * takes an injectable `db` so it can be driven against an in-memory stub.
 */

const crypto = require("crypto");

// A client idempotency key must be a bounded, opaque token — long enough to
// be collision-resistant (a UUID/push id), short enough to bound abuse.
const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** True when `key` is a well-formed client idempotency key. */
function isValidIdempotencyKey(key) {
  return typeof key === "string" && KEY_RE.test(key);
}

/**
 * Deterministic, collision-resistant Firestore doc id for a client
 * idempotency key, namespaced so the same key from two different actors (or
 * two different operations) never maps to the same doc. Returns null when the
 * key is malformed, so the caller can fall back to a non-idempotent path
 * rather than trust attacker-controlled input as a doc id.
 *
 * @param {string} namespace  e.g. `assignment:{uid}` — the trust boundary.
 * @param {string} key        the client-minted idempotency key.
 * @returns {string|null}     `${prefix}${sha256hex}` (66 chars) or null.
 */
function deriveIdempotentId(namespace, key, prefix = "idem_") {
  if (!isValidIdempotencyKey(key)) return null;
  if (typeof namespace !== "string" || !namespace) return null;
  const hash = crypto
      .createHash("sha256")
      .update(`${namespace}|${key}`)
      .digest("hex");
  return `${prefix}${hash}`;
}

// Firestore doc ids may not contain '/', can't be '.'/'..', and are capped at
// 1500 bytes. Eventarc ids are normally safe, but sanitise defensively so a
// surprising id can never throw or, worse, path-escape.
function sanitizeEventId(eventId) {
  const raw = typeof eventId === "string" ? eventId : "";
  const cleaned = raw.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 200);
  return cleaned || null;
}

/** Deterministic doc id under `processedEvents` for a (scope, eventId). */
function processedEventId(scope, eventId) {
  const safeScope = String(scope || "event").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60);
  const safeEvent = sanitizeEventId(eventId);
  if (!safeEvent) return null;
  return `${safeScope}_${safeEvent}`;
}

/**
 * Claim an event exactly once. Uses `.create()` — atomic in Firestore, so of
 * N concurrent/duplicate deliveries exactly one create() succeeds and the
 * rest get ALREADY_EXISTS (gRPC code 6). Returns:
 *   { claimed: true }                        — first delivery, proceed
 *   { claimed: false, duplicate: true }      — a duplicate, skip the body
 *   { claimed: true, degraded: true }        — id unresolvable / store error:
 *                                              fail OPEN so dedup never blocks
 *                                              a legitimate first run.
 *
 * Fails open deliberately: the guard is a safety net against DOUBLE work, not
 * a correctness gate — its own failure must not drop a real event.
 */
async function claimEventOnce(db, {scope, eventId, now = Date.now(), ttlMs = 7 * 24 * 60 * 60 * 1000} = {}) {
  const id = processedEventId(scope, eventId);
  if (!id) return {claimed: true, degraded: true};
  const ref = db.collection("processedEvents").doc(id);
  try {
    await ref.create({
      scope: String(scope || "event"),
      eventId: String(eventId || ""),
      at: now,
      // A Date, NOT `now + ttlMs`. Firestore TTL reaps only TIMESTAMP fields;
      // a numeric expiry is silently ignored, so the policy would report as
      // enabled while processedEvents grew for ever with nothing erroring.
      // The admin SDK serialises a JS Date to a Timestamp on write, which gets
      // the right stored type without importing firebase-admin here — this
      // module is deliberately dependency-free so it tests against a fake db.
      // Guarded by scripts/check-ttl-policies.mjs (ttl-field-is-timestamp).
      expiresAt: new Date(now + ttlMs),
    });
    return {claimed: true};
  } catch (err) {
    // 6 = ALREADY_EXISTS: another delivery already claimed this event.
    if (err && (err.code === 6 || err.code === "already-exists")) {
      return {claimed: false, duplicate: true};
    }
    // Any other store error: fail open so a first, legitimate run proceeds.
    console.warn("[idempotency] claimEventOnce failed (allowing run)", err && err.message);
    return {claimed: true, degraded: true};
  }
}

module.exports = {
  KEY_RE,
  isValidIdempotencyKey,
  deriveIdempotentId,
  sanitizeEventId,
  processedEventId,
  claimEventOnce,
};
