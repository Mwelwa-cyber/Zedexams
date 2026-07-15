"use strict";

/**
 * aiBudgetReservation — a reservation-based hard ceiling for AI spend.
 *
 * WHY NOT JUST READ THE MONTHLY TOTAL?
 * ------------------------------------
 * The old gate read one eventually-consistent month-to-date total and
 * compared it to the ceiling. Under concurrency that's unsafe: N requests
 * can all read the same stale "under budget" total in the same instant and
 * all proceed, collectively blowing past the ceiling. A shared analytics
 * counter (even sharded) is a REPORT, not a lock.
 *
 * This module makes the ceiling enforceable:
 *   1. Before an AI call, the caller estimates a CONSERVATIVE max cost.
 *   2. That amount is atomically RESERVED from one of several monthly
 *      budget buckets (a distributed lock — spreads write contention while
 *      still serialising per bucket).
 *   3. The buckets partition the monthly budget: sum of per-bucket caps ==
 *      monthly budget, and each bucket transaction enforces its own cap, so
 *      the TOTAL reserved can never exceed the budget no matter how many
 *      reservations race.
 *   4. After the call, the reservation is reconciled to the ACTUAL cost —
 *      the unused difference is returned to the bucket — and the reservation
 *      is closed.
 *   5. Provider errors release the reservation; abandoned reservations
 *      expire and are reclaimed, so a crash mid-call can't permanently
 *      strand budget.
 *   6. Reserve / settle / release are IDEMPOTENT on the generation id, so a
 *      retried request never double-reserves or double-records.
 *
 * Firestore layout (server-only, admin SDK):
 *   aiBudgetBuckets/{month}/buckets/{bucketId}
 *     { reservedUsd, updatedAt }        // outstanding reservations + settled spend
 *   aiBudgetBuckets/{month}/reservations/{generationId}
 *     { bucketId, month, reservedUsd, actualUsd, status, createdAt, expiresAt }
 *       status: 'open' | 'settled' | 'released' | 'expired'
 *
 * Pure helpers (bucket count, cap, order, expiry) are exported for direct
 * unit testing; the Firestore ops take an injectable `db` so tests drive
 * them against an in-memory serialised stub.
 */

const COLLECTION = "aiBudgetBuckets";
const EPS = 1e-9;

const DEFAULT_BUCKET_COUNT = 8;
const MAX_BUCKET_COUNT = 64;
const DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 min — longer than any single generation
const DEFAULT_RECLAIM_LIMIT = 50;

// ── Pure helpers ───────────────────────────────────────────────────────────

/** Number of monthly budget buckets. AI_BUDGET_BUCKETS-tunable. */
function resolveBucketCount(env = process.env) {
  const raw = parseInt(env.AI_BUDGET_BUCKETS, 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_BUCKET_COUNT;
  return Math.min(raw, MAX_BUCKET_COUNT);
}

/** Reservation time-to-live before it may be reclaimed. AI_RESERVATION_TTL_MS. */
function resolveTtlMs(env = process.env) {
  const raw = parseInt(env.AI_RESERVATION_TTL_MS, 10);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_MS;
  return raw;
}

/** Per-bucket cap so the caps sum EXACTLY to the monthly budget. */
function perBucketCapUsd(monthlyBudgetUsd, bucketCount) {
  const budget = Math.max(0, Number(monthlyBudgetUsd) || 0);
  const n = Math.max(1, Math.floor(Number(bucketCount) || DEFAULT_BUCKET_COUNT));
  return budget / n;
}

/** Randomised bucket visit order (Fisher-Yates) so racers don't all pile
 *  onto bucket 0 first. */
function bucketOrder(bucketCount, rng = Math.random) {
  const n = Math.max(1, Math.floor(Number(bucketCount) || DEFAULT_BUCKET_COUNT));
  const a = Array.from({length: n}, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

/** True when an open reservation is past its TTL and may be reclaimed. */
function isExpired(reservation, now) {
  if (!reservation || reservation.status !== "open") return false;
  return Number(reservation.expiresAt) <= Number(now);
}

// ── Firestore refs ─────────────────────────────────────────────────────────

function monthRoot(db, month) {
  return db.collection(COLLECTION).doc(month);
}
function bucketRef(db, month, bucketId) {
  return monthRoot(db, month).collection("buckets").doc(String(bucketId));
}
function reservationsCol(db, month) {
  return monthRoot(db, month).collection("reservations");
}
function reservationRef(db, month, generationId) {
  return reservationsCol(db, month).doc(String(generationId));
}

// ── Reserve ────────────────────────────────────────────────────────────────

/**
 * Atomically reserve `estCostUsd` for `generationId` against the month's
 * budget. Returns:
 *   { allowed:true,  reservation, mode }   — reserved / idempotent hit / gate off
 *   { allowed:false, reason }              — 'budget_exhausted' | 'estimate_exceeds_bucket'
 *
 * mode: 'disabled' (no ceiling armed), 'idempotent' (existing open/settled
 * reservation for this id), or 'reserved'. The caller decides how to treat a
 * false result: 'budget_exhausted' should block; anything else should fail
 * OPEN (allow, no reservation) so a granularity artefact never bricks AI.
 */
async function reserveBudget(db, {
  month, generationId, estCostUsd, monthlyBudgetUsd,
  bucketCount, ttlMs, now = Date.now(), rng = Math.random,
}) {
  if (!(Number(monthlyBudgetUsd) > 0)) {
    return {allowed: true, reservation: null, mode: "disabled"};
  }
  const buckets = bucketCount || resolveBucketCount();
  const ttl = ttlMs || resolveTtlMs();
  const cap = perBucketCapUsd(monthlyBudgetUsd, buckets);
  const amount = Math.max(0, Number(estCostUsd) || 0);
  const resRef = reservationRef(db, month, generationId);

  // Idempotency fast-path: an existing open/settled reservation for this id
  // is reused as-is (a retried request must not reserve twice).
  const pre = await resRef.get();
  if (pre.exists) {
    const d = pre.data() || {};
    if (d.status === "open" || d.status === "settled") {
      return {allowed: true, mode: "idempotent", reservation: toHandle(generationId, month, d)};
    }
  }

  // A single estimate larger than one bucket's cap can't be guaranteed within
  // a bucket without breaking the invariant. Signal the caller to fail open.
  if (amount > cap + EPS) {
    return {allowed: false, reason: "estimate_exceeds_bucket"};
  }

  const order = bucketOrder(buckets, rng);
  for (let pass = 0; pass < 2; pass += 1) {
    for (const bId of order) {
      const got = await tryReserveInBucket(db, {
        month, bucketId: bId, generationId, resRef, amount, cap, now, ttl,
      });
      if (got) return {allowed: true, mode: got.mode, reservation: got.reservation};
    }
    // First pass full — reclaim anything expired, then try once more.
    if (pass === 0) {
      await reclaimExpiredReservations(db, {month, now}).catch(() => 0);
    }
  }
  return {allowed: false, reason: "budget_exhausted"};
}

async function tryReserveInBucket(db, {
  month, bucketId, generationId, resRef, amount, cap, now, ttl,
}) {
  const bRef = bucketRef(db, month, bucketId);
  return db.runTransaction(async (tx) => {
    // Reads before writes (Firestore requirement).
    const rSnap = await tx.get(resRef);
    if (rSnap.exists) {
      const d = rSnap.data() || {};
      if (d.status === "open" || d.status === "settled") {
        // Won by a concurrent reserve for the SAME id — idempotent success.
        return {mode: "idempotent", reservation: toHandle(generationId, month, d)};
      }
    }
    const bSnap = await tx.get(bRef);
    const reserved = bSnap.exists ? Number(bSnap.data().reservedUsd || 0) : 0;
    if (reserved + amount > cap + EPS) return null; // bucket full → caller tries next
    tx.set(bRef, {reservedUsd: reserved + amount, updatedAt: now}, {merge: true});
    const doc = {
      bucketId, month, reservedUsd: amount, actualUsd: null,
      status: "open", createdAt: now, expiresAt: now + ttl,
    };
    tx.set(resRef, doc, {merge: true});
    return {mode: "reserved", reservation: toHandle(generationId, month, doc)};
  });
}

function toHandle(generationId, month, d) {
  return {
    id: String(generationId),
    month,
    bucketId: d.bucketId,
    reservedUsd: Number(d.reservedUsd || 0),
    status: d.status,
  };
}

// ── Settle ─────────────────────────────────────────────────────────────────

/**
 * Reconcile a reservation to the actual cost: swap the reserved amount for
 * the actual spend in its bucket (returning the unused difference) and mark
 * the reservation settled. Idempotent — a missing/closed reservation is a
 * no-op. Never throws.
 */
async function settleReservation(db, {month, generationId, actualCostUsd, now = Date.now()}) {
  const resRef = reservationRef(db, month, generationId);
  const actual = Math.max(0, Number(actualCostUsd) || 0);
  try {
    return await db.runTransaction(async (tx) => {
      const rSnap = await tx.get(resRef);
      if (!rSnap.exists) return {settled: false, reason: "missing"};
      const r = rSnap.data() || {};
      if (r.status !== "open") return {settled: false, reason: "not_open"};
      const bRef = bucketRef(db, month, r.bucketId);
      const bSnap = await tx.get(bRef);
      const reserved = bSnap.exists ? Number(bSnap.data().reservedUsd || 0) : 0;
      // Replace the held reservation with the actual spend.
      const newReserved = Math.max(0, reserved - Number(r.reservedUsd || 0) + actual);
      tx.set(bRef, {reservedUsd: newReserved, updatedAt: now}, {merge: true});
      tx.set(resRef, {status: "settled", actualUsd: actual, settledAt: now}, {merge: true});
      return {settled: true, actualUsd: actual};
    });
  } catch (err) {
    console.warn("[aiBudgetReservation] settle failed", err?.message || err);
    return {settled: false, reason: "error"};
  }
}

// ── Release / reclaim ────────────────────────────────────────────────────────

async function releaseAt(db, {month, generationId, now, status}) {
  const resRef = reservationRef(db, month, generationId);
  return db.runTransaction(async (tx) => {
    const rSnap = await tx.get(resRef);
    if (!rSnap.exists) return {released: false, reason: "missing"};
    const r = rSnap.data() || {};
    if (r.status !== "open") return {released: false, reason: "not_open"};
    const bRef = bucketRef(db, month, r.bucketId);
    const bSnap = await tx.get(bRef);
    const reserved = bSnap.exists ? Number(bSnap.data().reservedUsd || 0) : 0;
    const newReserved = Math.max(0, reserved - Number(r.reservedUsd || 0));
    tx.set(bRef, {reservedUsd: newReserved, updatedAt: now}, {merge: true});
    tx.set(resRef, {status, releasedAt: now}, {merge: true});
    return {released: true};
  });
}

/**
 * Release a reservation whose AI call failed — returns its full held amount
 * to the bucket. Idempotent; never throws.
 */
async function releaseReservation(db, {month, generationId, now = Date.now()}) {
  try {
    return await releaseAt(db, {month, generationId, now, status: "released"});
  } catch (err) {
    console.warn("[aiBudgetReservation] release failed", err?.message || err);
    return {released: false, reason: "error"};
  }
}

/**
 * Reclaim open reservations past their TTL (a crash / timeout stranded them).
 * Returns the count reclaimed. Never throws — a reclaim hiccup just means the
 * budget frees a little later.
 */
async function reclaimExpiredReservations(db, {month, now = Date.now(), limit = DEFAULT_RECLAIM_LIMIT} = {}) {
  let reclaimed = 0;
  try {
    const snap = await reservationsCol(db, month)
        .where("status", "==", "open")
        .where("expiresAt", "<=", now)
        .limit(limit)
        .get();
    const ids = snap.docs.map((d) => d.id);
    for (const id of ids) {
      const r = await releaseAt(db, {month, generationId: id, now, status: "expired"})
          .catch(() => null);
      if (r && r.released) reclaimed += 1;
    }
  } catch (err) {
    console.warn("[aiBudgetReservation] reclaim failed", err?.message || err);
  }
  return reclaimed;
}

/** Sum reservedUsd across all buckets for the month (reporting). */
async function getReservedTotalUsd(db, {month}) {
  try {
    const snap = await monthRoot(db, month).collection("buckets").get();
    let total = 0;
    snap.forEach((d) => {
      total += Number((d.data() || {}).reservedUsd || 0);
    });
    return total;
  } catch (err) {
    console.warn("[aiBudgetReservation] reserved-total read failed", err?.message || err);
    return 0;
  }
}

module.exports = {
  COLLECTION,
  DEFAULT_BUCKET_COUNT,
  DEFAULT_TTL_MS,
  resolveBucketCount,
  resolveTtlMs,
  perBucketCapUsd,
  bucketOrder,
  isExpired,
  reserveBudget,
  settleReservation,
  releaseReservation,
  reclaimExpiredReservations,
  getReservedTotalUsd,
};
