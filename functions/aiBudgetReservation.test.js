"use strict";

/**
 * Node test for the reservation-based AI budget gate.
 * Run: node functions/aiBudgetReservation.test.js
 *
 * Covers the pure helpers plus the Firestore transaction ops against an
 * in-memory stub that SERIALISES transactions (modelling Firestore's
 * serializable isolation), so the "no overspend under concurrency" invariant
 * is actually exercised:
 *   - reserve success / gate-off / idempotent retry
 *   - settle reconciliation (unused budget returned) + idempotency
 *   - release on provider failure + idempotency
 *   - expiry + reclaim of stranded reservations
 *   - budget exhaustion rejection
 *   - estimate larger than a bucket → fail-open signal
 *   - hundreds of concurrent reservations never exceed the ceiling
 */

const assert = require("node:assert");
const R = require("./aiBudgetReservation");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
const approx = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

// ── In-memory Firestore stub (serialised transactions) ────────────────────
function makeDb() {
  const store = new Map(); // "a/b/c" -> data object
  const pathOf = (segs) => segs.join("/");

  function docRef(segs) {
    return {
      _segs: segs,
      collection(name) { return colRef([...segs, name]); },
      async get() {
        const d = store.get(pathOf(segs));
        return {exists: d !== undefined, id: segs[segs.length - 1], data: () => (d ? {...d} : undefined)};
      },
      async set(data, opts) {
        const p = pathOf(segs);
        const cur = store.get(p) || {};
        store.set(p, opts && opts.merge ? {...cur, ...data} : {...data});
      },
    };
  }
  function colRef(segs) {
    const filters = [];
    let lim = Infinity;
    const ref = {
      doc(id) { return docRef([...segs, id]); },
      where(field, op, val) { filters.push({field, op, val}); return ref; },
      limit(n) { lim = n; return ref; },
      async get() {
        const prefix = pathOf(segs) + "/";
        const docs = [];
        for (const [p, d] of store.entries()) {
          if (!p.startsWith(prefix)) continue;
          if (p.slice(prefix.length).includes("/")) continue; // direct children only
          if (!filters.every((f) => applyOp(d[f.field], f.op, f.val))) continue;
          docs.push({id: p.slice(prefix.length), data: () => ({...d})});
        }
        const limited = docs.slice(0, lim);
        return {docs: limited, size: limited.length, forEach: (cb) => limited.forEach(cb)};
      },
    };
    return ref;
  }
  function applyOp(a, op, b) {
    if (op === "==") return a === b;
    if (op === "<=") return a <= b;
    if (op === ">=") return a >= b;
    return false;
  }

  let chain = Promise.resolve();
  return {
    _store: store,
    collection(name) { return colRef([name]); },
    runTransaction(fn) {
      const run = () => fn({
        get: (ref) => ref.get(),
        set: (ref, data, opts) => ref.set(data, opts),
        update: (ref, data) => ref.set(data, {merge: true}),
      });
      const p = chain.then(run, run); // serialise, survive prior errors
      chain = p.catch(() => {});
      return p;
    },
  };
}

function bucketReserved(db, month, bucketId) {
  const d = db._store.get(`aiBudgetBuckets/${month}/buckets/${bucketId}`);
  return d ? Number(d.reservedUsd || 0) : 0;
}
function totalReserved(db, month, buckets) {
  let t = 0;
  for (let i = 0; i < buckets; i += 1) t += bucketReserved(db, month, i);
  return t;
}

console.log("aiBudgetReservation");

// ── Pure helpers ──────────────────────────────────────────────────────────
ok("bucket count default", R.resolveBucketCount({}) === R.DEFAULT_BUCKET_COUNT);
ok("bucket count parses env", R.resolveBucketCount({AI_BUDGET_BUCKETS: "16"}) === 16);
ok("bucket count rejects junk", R.resolveBucketCount({AI_BUDGET_BUCKETS: "x"}) === R.DEFAULT_BUCKET_COUNT);
ok("ttl default", R.resolveTtlMs({}) === R.DEFAULT_TTL_MS);
ok("ttl parses env", R.resolveTtlMs({AI_RESERVATION_TTL_MS: "5000"}) === 5000);
ok("per-bucket cap partitions the budget", approx(R.perBucketCapUsd(100, 8), 12.5));
ok("caps sum to the budget", approx(R.perBucketCapUsd(100, 8) * 8, 100));
{
  const order = R.bucketOrder(8, () => 0.5);
  ok("bucketOrder is a permutation of 0..n-1",
    order.length === 8 && new Set(order).size === 8 && Math.max(...order) === 7);
}
ok("isExpired true past ttl", R.isExpired({status: "open", expiresAt: 100}, 200) === true);
ok("isExpired false before ttl", R.isExpired({status: "open", expiresAt: 300}, 200) === false);
ok("isExpired false when not open", R.isExpired({status: "settled", expiresAt: 100}, 200) === false);

(async () => {
  const month = "2026-07";

  // ── Gate off when no budget ───────────────────────────────────────────
  {
    const db = makeDb();
    const res = await R.reserveBudget(db, {month, generationId: "g0", estCostUsd: 0.5, monthlyBudgetUsd: 0, now: 1000});
    ok("no budget → allowed, no reservation, mode disabled",
      res.allowed && res.reservation === null && res.mode === "disabled");
  }

  // ── Reserve success (with provider identity) ──────────────────────────
  {
    const db = makeDb();
    const res = await R.reserveBudget(db, {
      month, generationId: "g1", estCostUsd: 0.30, monthlyBudgetUsd: 8, provider: "anthropic",
      bucketCount: 4, ttlMs: 1000, now: 1000, rng: () => 0,
    });
    ok("reserve → allowed + open reservation", res.allowed && res.reservation && res.reservation.status === "open");
    ok("reserve → held amount recorded", approx(res.reservation.reservedUsd, 0.30));
    ok("reserve → bucket holds the amount", approx(totalReserved(db, month, 4), 0.30));
    ok("reserve → provider recorded on the handle", res.reservation.provider === "anthropic");
    const stored = db._store.get(`aiBudgetBuckets/${month}/reservations/g1`);
    ok("reserve → provider persisted on the reservation doc", stored.provider === "anthropic");
  }

  // ── Idempotent retry (same generationId) ──────────────────────────────
  {
    const db = makeDb();
    const a = await R.reserveBudget(db, {month, generationId: "gid", estCostUsd: 0.20, monthlyBudgetUsd: 8, bucketCount: 4, now: 1000});
    const b = await R.reserveBudget(db, {month, generationId: "gid", estCostUsd: 0.20, monthlyBudgetUsd: 8, bucketCount: 4, now: 1000});
    ok("duplicate reserve is allowed", a.allowed && b.allowed);
    ok("duplicate reserve is flagged idempotent", b.mode === "idempotent");
    ok("duplicate reserve does NOT double-charge the bucket", approx(totalReserved(db, month, 4), 0.20));
  }

  // ── Settle reconciles to actual (returns the unused difference) ────────
  {
    const db = makeDb();
    const r = await R.reserveBudget(db, {month, generationId: "gs", estCostUsd: 0.50, monthlyBudgetUsd: 8, bucketCount: 4, now: 1000});
    ok("pre-settle bucket holds the reserved max", approx(totalReserved(db, month, 4), 0.50));
    const s = await R.settleReservation(db, {month, generationId: "gs", actualCostUsd: 0.12, now: 2000});
    ok("settle succeeds", s.settled === true);
    ok("settle swaps reserved for actual (0.50 → 0.12)", approx(totalReserved(db, month, 4), 0.12));
    const s2 = await R.settleReservation(db, {month, generationId: "gs", actualCostUsd: 0.99, now: 3000});
    ok("second settle is a no-op (idempotent)", s2.settled === false && s2.reason === "not_open");
    ok("bucket unchanged after duplicate settle", approx(totalReserved(db, month, 4), 0.12));
    void r;
  }

  // ── Release on provider failure returns the whole reservation ─────────
  {
    const db = makeDb();
    await R.reserveBudget(db, {month, generationId: "gf", estCostUsd: 0.40, monthlyBudgetUsd: 8, bucketCount: 4, now: 1000});
    const rel = await R.releaseReservation(db, {month, generationId: "gf", now: 2000});
    ok("release succeeds", rel.released === true);
    ok("release frees the full held amount", approx(totalReserved(db, month, 4), 0));
    const rel2 = await R.releaseReservation(db, {month, generationId: "gf", now: 3000});
    ok("second release is a no-op (idempotent)", rel2.released === false);
  }

  // ── Expiry + reclaim of a stranded reservation ────────────────────────
  {
    const db = makeDb();
    // Reserve with a short ttl so it's already expired at reclaim time.
    await R.reserveBudget(db, {month, generationId: "gexp", estCostUsd: 0.40, monthlyBudgetUsd: 8, bucketCount: 4, ttlMs: 10, now: 1000});
    ok("stranded reservation still held before reclaim", approx(totalReserved(db, month, 4), 0.40));
    const n = await R.reclaimExpiredReservations(db, {month, now: 5000});
    ok("reclaim frees exactly the one expired reservation", n === 1);
    ok("reclaim returns its budget", approx(totalReserved(db, month, 4), 0));
    const again = await R.reclaimExpiredReservations(db, {month, now: 6000});
    ok("reclaim is idempotent (nothing left to reclaim)", again === 0);
  }

  // ── Reserve auto-reclaims expired holds when buckets look full ─────────
  {
    const db = makeDb();
    // Fill every bucket with an already-expired reservation (cap 0.25 each).
    for (let i = 0; i < 4; i += 1) {
      await R.reserveBudget(db, {month, generationId: `old${i}`, estCostUsd: 0.25, monthlyBudgetUsd: 1, bucketCount: 4, ttlMs: 10, now: 1000, rng: () => 0});
    }
    ok("all buckets full of expired holds", approx(totalReserved(db, month, 4), 1.0));
    // A fresh reserve should reclaim the expired ones and then succeed.
    const fresh = await R.reserveBudget(db, {month, generationId: "fresh", estCostUsd: 0.25, monthlyBudgetUsd: 1, bucketCount: 4, ttlMs: 1000, now: 9000});
    ok("fresh reserve succeeds after auto-reclaim", fresh.allowed === true);
  }

  // ── Budget exhausted → hard reject ────────────────────────────────────
  {
    const db = makeDb();
    // budget 1, 4 buckets (cap 0.25), amount 0.25 → exactly 4 fit, 5th rejected.
    const results = [];
    for (let i = 0; i < 6; i += 1) {
      results.push(await R.reserveBudget(db, {month, generationId: `x${i}`, estCostUsd: 0.25, monthlyBudgetUsd: 1, bucketCount: 4, ttlMs: 100000, now: 1000}));
    }
    const allowed = results.filter((r) => r.allowed).length;
    ok("exactly budget/amount reservations fit (4)", allowed === 4);
    ok("over-budget reservations are rejected", results.some((r) => !r.allowed && r.reason === "budget_exhausted"));
    ok("total reserved never exceeds the ceiling", totalReserved(db, month, 4) <= 1 + 1e-9);
  }

  // ── Estimate larger than one bucket → fail-open signal ────────────────
  {
    const db = makeDb();
    const res = await R.reserveBudget(db, {month, generationId: "big", estCostUsd: 0.5, monthlyBudgetUsd: 1, bucketCount: 8, now: 1000});
    ok("oversized estimate is not a hard reject", res.allowed === false && res.reason === "estimate_exceeds_bucket");
  }

  // ── No overspend under HUNDREDS of concurrent reservations ────────────
  {
    const db = makeDb();
    const budget = 1.0;
    const buckets = 4;      // cap 0.25 each
    const amount = 0.1;     // each bucket holds 2 (0.2) → 8 total fit → $0.80
    const N = 400;
    const calls = [];
    for (let i = 0; i < N; i += 1) {
      calls.push(R.reserveBudget(db, {
        month, generationId: `c${i}`, estCostUsd: amount,
        monthlyBudgetUsd: budget, bucketCount: buckets, ttlMs: 100000, now: 1000,
      }));
    }
    const results = await Promise.all(calls);
    const allowed = results.filter((r) => r.allowed).length;
    const held = totalReserved(db, month, buckets);
    ok(`concurrent: ${allowed} of ${N} reservations admitted`, allowed === 8);
    ok("concurrent: total held never exceeds the budget", held <= budget + 1e-9);
    ok("concurrent: held equals the admitted sum", approx(held, allowed * amount));
    ok("concurrent: every bucket is within its cap",
      [0, 1, 2, 3].every((b) => bucketReserved(db, month, b) <= 0.25 + 1e-9));
  }

  // ── Concurrent DUPLICATES of one id never double-charge ───────────────
  {
    const db = makeDb();
    const dupes = await Promise.all(Array.from({length: 20}, () =>
      R.reserveBudget(db, {month, generationId: "same", estCostUsd: 0.1, monthlyBudgetUsd: 8, bucketCount: 4, ttlMs: 100000, now: 1000})));
    ok("all duplicate reserves are allowed", dupes.every((r) => r.allowed));
    ok("duplicates charge the bucket exactly once", approx(totalReserved(db, month, 4), 0.1));
  }

  console.log(`\n─── ${passed} assertions · all passed ───`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
