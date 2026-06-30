/**
 * Unit tests for functions/agents/circuitBreaker.js — the per-agent auto-pause.
 * Plain node: throws on first failed assertion.
 *
 *   node functions/agents/circuitBreaker.test.js
 */
const assert = require("node:assert");
const {evaluateBreaker, recordAgentFailure, DEFAULT_THRESHOLD} =
  require("./circuitBreaker");

// ── evaluateBreaker (pure) ─────────────────────────────────────────
(function testEvaluate() {
  const now = 1_000_000_000;
  const HOUR = 60 * 60 * 1000;

  // First failure: not tripped.
  let r = evaluateBreaker([], now);
  assert.strictEqual(r.failuresInWindow, 1);
  assert.strictEqual(r.tripped, false, "1 failure does not trip");

  // Two prior within the hour + this one = 3 → trips at the default threshold.
  r = evaluateBreaker([now - 1000, now - 2000], now);
  assert.strictEqual(r.failuresInWindow, 3);
  assert.strictEqual(r.tripped, true, "3 within window trips");
  assert.strictEqual(DEFAULT_THRESHOLD, 3);

  // Old failures outside the window are pruned, so they don't count.
  r = evaluateBreaker([now - HOUR - 1, now - HOUR - 2], now);
  assert.strictEqual(r.failuresInWindow, 1, "stale failures pruned");
  assert.strictEqual(r.tripped, false);

  // Garbage values are ignored.
  r = evaluateBreaker([NaN, "x", null, now - 500], now);
  assert.strictEqual(r.failuresInWindow, 2, "non-finite entries dropped");

  // Custom threshold.
  r = evaluateBreaker([now - 100], now, {threshold: 2});
  assert.strictEqual(r.tripped, true, "custom threshold of 2 trips on 2nd");
})();

// ── recordAgentFailure (Firestore-backed) ──────────────────────────
function makeDb(initialDoc) {
  const store = {data: initialDoc, writes: []};
  const ref = {
    async get() {
      return {exists: store.data != null, data: () => store.data || {}};
    },
    async set(update, opts) {
      store.writes.push({update, opts});
      store.data = {...(store.data || {}), ...update};
    },
  };
  return {
    db: {collection: () => ({doc: () => ref})},
    store,
  };
}

(async function testRecord() {
  const now = 2_000_000_000;

  // 1) First two failures: record but don't pause.
  {
    const {db, store} = makeDb({});
    let alerts = 0;
    const r1 = await recordAgentFailure({db, agentId: "aria", now, alert: async () => { alerts++; }});
    assert.strictEqual(r1.tripped, false, "1st failure no trip");
    assert.strictEqual(store.data.paused, undefined, "not paused after 1");
    const r2 = await recordAgentFailure({db, agentId: "aria", now: now + 1, alert: async () => { alerts++; }});
    assert.strictEqual(r2.tripped, false, "2nd failure no trip");
    assert.strictEqual(alerts, 0, "no alert before trip");

    // 3rd failure trips → pause + single alert.
    const r3 = await recordAgentFailure({db, agentId: "aria", now: now + 2, errorMessage: "boom", alert: async () => { alerts++; }});
    assert.strictEqual(r3.tripped, true, "3rd failure trips");
    assert.strictEqual(store.data.paused, true, "paused after trip");
    assert.strictEqual(store.data.pausedBy, "circuit-breaker", "pause provenance stamped");
    assert.strictEqual(alerts, 1, "alert fired exactly once on the trip");
  }

  // 2) Already paused by an admin: no re-pause, no alert.
  {
    const {db, store} = makeDb({paused: true, recentFailures: [now - 100, now - 200]});
    let alerts = 0;
    const r = await recordAgentFailure({db, agentId: "cala", now, alert: async () => { alerts++; }});
    assert.strictEqual(r.alreadyPaused, true, "sees existing pause");
    assert.strictEqual(alerts, 0, "no alert when already paused");
    assert.strictEqual(store.data.paused, true, "stays paused");
  }

  // 3) Best-effort: a throwing db never propagates.
  {
    const db = {collection: () => ({doc: () => ({get: async () => { throw new Error("fs down"); }})})};
    const r = await recordAgentFailure({db, agentId: "reva", now});
    assert.strictEqual(r.tripped, false, "swallows db error");
  }

  // 4) Missing args are a no-op.
  const noop = await recordAgentFailure({db: null, agentId: "x"});
  assert.strictEqual(noop.tripped, false, "null db → no-op");

  console.log("All circuitBreaker tests passed.");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
