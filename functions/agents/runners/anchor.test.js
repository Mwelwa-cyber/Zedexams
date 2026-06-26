/**
 * Unit tests for Anchor's retention-cohort logic.
 *
 * Plain Node assertions, no test runner (repo convention). Firestore is
 * injected with a fake; the analysis is pure.
 *
 *   node functions/agents/runners/anchor.test.js
 */

const assert = require("node:assert");
const {runAnchor, analyzeRetention} = require("./anchor");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

const NOW = Date.parse("2026-06-19T00:00:00Z");
const ago = (days) => new Date(NOW - days * 86400000).toISOString().slice(0, 10);

function fakeDb(docs) {
  const q = {
    where() {
      return q;
    },
    orderBy() {
      return q;
    },
    limit() {
      return q;
    },
    async get() {
      return {forEach(cb) {
        docs.forEach((d) => cb({id: d.id, data: () => d.data}));
      }};
    },
  };
  return {collection() {
    return q;
  }};
}

async function run() {
  // ── the cohort logic ────────────────────────────────────────────────
  await test("flags lapsed-but-engaged learners and buckets them by silence", async () => {
    const records = [
      {uid: "active", lastActivityDate: ago(5), examsCompleted: 9}, // too recent → skip
      {uid: "lapsed18", lastActivityDate: ago(18), examsCompleted: 5}, // 14-21d
      {uid: "lapsed25", lastActivityDate: ago(25), examsCompleted: 12}, // 22-30d, most engaged
      {uid: "lapsed40", lastActivityDate: ago(40), examsCompleted: 4}, // 31-45d
      {uid: "gone", lastActivityDate: ago(60), examsCompleted: 8}, // beyond window → skip
      {uid: "tourist", lastActivityDate: ago(18), examsCompleted: 1}, // not engaged enough → skip
      {uid: "nodate", examsCompleted: 9}, // no lastActivityDate → skip
    ];

    const r = analyzeRetention(records, {nowMs: NOW});

    assert.strictEqual(r.atRisk, 3);
    assert.deepStrictEqual(r.buckets, {"14-21d": 1, "22-30d": 1, "31-45d": 1});
    // Most valuable to win back leads the sample.
    assert.strictEqual(r.sample[0].uid, "lapsed25");
    assert.strictEqual(r.sample[0].examsCompleted, 12);
    assert.ok(r.sample[0].nudge.includes("went quiet 25 days ago"));
  });

  await test("ties break toward the more recently lapsed learner", async () => {
    const records = [
      {uid: "older", lastActivityDate: ago(30), examsCompleted: 6},
      {uid: "newer", lastActivityDate: ago(16), examsCompleted: 6},
    ];
    const r = analyzeRetention(records, {nowMs: NOW});
    assert.strictEqual(r.sample[0].uid, "newer");
  });

  // ── the run (date-range query) ──────────────────────────────────────
  await test("runAnchor reads learnerStats and surfaces the cohort", async () => {
    const db = fakeDb([
      {id: "a", data: {lastActivityDate: ago(18), examsCompleted: 5, bestPercentage: 72, longestStreak: 4}},
      {id: "b", data: {lastActivityDate: ago(33), examsCompleted: 7, bestPercentage: 88, longestStreak: 9}},
    ]);
    const s = await runAnchor({db, nowMs: NOW});
    assert.strictEqual(s.scanned, 2);
    assert.strictEqual(s.atRisk, 2);
    assert.strictEqual(s.sample[0].uid, "b", "the more engaged learner leads");
    assert.strictEqual(s.errors.length, 0);
  });

  await test("a query failure is recorded, not thrown", async () => {
    const db = {collection() {
      return {where() {
        return this;
      }, orderBy() {
        return this;
      }, limit() {
        return this;
      }, async get() {
        throw new Error("missing index");
      }};
    }};
    const s = await runAnchor({db, nowMs: NOW});
    assert.strictEqual(s.errors.length, 1);
    assert.strictEqual(s.errors[0].stage, "query");
    assert.strictEqual(s.atRisk, 0);
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
