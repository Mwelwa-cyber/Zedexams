/**
 * Unit tests for Compass's attempt-aggregation logic.
 *
 * Plain Node assertions, no test runner (repo convention). Firestore is
 * injected with a fake; the aggregation is pure.
 *
 *   node functions/agents/runners/compass.test.js
 */

const assert = require("node:assert");
const {runCompass, aggregateAttempts} = require("./compass");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

const NOW = 1_700_000_000_000;

// rep(n, record) → n copies of a record (with distinct userIds so learner
// counts are meaningful).
function rep(n, base) {
  return Array.from({length: n}, (_, i) => ({...base, userId: `${base.subject}-u${i}`}));
}

function fakeDb({results = [], exam_attempts = []}) {
  function coll(docs) {
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
          docs.forEach((d, i) => cb({id: String(i), data: () => d}));
        }};
      },
    };
    return q;
  }
  return {collection(name) {
    return name === "results" ? coll(results) : coll(exam_attempts);
  }};
}

async function run() {
  // ── aggregation ─────────────────────────────────────────────────────
  await test("ranks struggling, high-demand areas to the top of the backlog", async () => {
    const records = [
      ...rep(10, {grade: 9, subject: "Chemistry", percentage: 48}), // struggle: high demand, low mastery
      ...rep(12, {grade: 7, subject: "English", percentage: 82}), // active, doing well
      ...rep(3, {grade: 8, subject: "History", percentage: 30}), // low-mastery but too few attempts → not flagged struggle
    ];
    const agg = aggregateAttempts(records, {struggleThreshold: 55, minAttempts: 8});

    assert.strictEqual(agg.totalAttempts, 25);
    assert.strictEqual(agg.distinctAreas, 3);
    assert.strictEqual(agg.struggleCount, 1, "only Grade 9 Chemistry clears both thresholds");
    assert.strictEqual(agg.backlog[0].subject, "Chemistry", "highest priority = high demand x low mastery");
    assert.ok(agg.backlog[0].recommendation.includes("struggling"));
    assert.strictEqual(agg.backlog[0].learners, 10);
    // English is active enough to make the backlog, framed as expansion not struggle.
    const eng = agg.backlog.find((b) => b.subject === "English");
    assert.ok(eng && eng.struggle === false && eng.recommendation.includes("Active area"));
    // History (3 attempts) is below minAttempts → not in the backlog.
    assert.ok(!agg.backlog.some((b) => b.subject === "History"));
  });

  await test("ignores records with no subject or an unusable percentage", async () => {
    const records = [
      {grade: 9, subject: "", percentage: 50, userId: "a"}, // no subject
      {grade: 9, subject: "Maths", percentage: "NaN", userId: "b"}, // bad pct
      {grade: 9, subject: "Maths", percentage: 70, userId: "c"}, // good
    ];
    const agg = aggregateAttempts(records);
    assert.strictEqual(agg.totalAttempts, 1);
    assert.strictEqual(agg.distinctAreas, 1);
  });

  await test("clamps out-of-range percentages and treats string/number grades alike", async () => {
    const records = [
      {grade: "9", subject: "Bio", percentage: 150, userId: "a"}, // clamps to 100
      {grade: 9, subject: "Bio", percentage: 100, userId: "b"}, // same group as "9"
    ];
    const agg = aggregateAttempts(records, {minAttempts: 1});
    assert.strictEqual(agg.distinctAreas, 1, "grade 9 and '9' fold into one area");
    assert.strictEqual(agg.backlog[0].avgPercentage, 100);
  });

  // ── the run (reads two collections) ─────────────────────────────────
  await test("runCompass samples results + exam_attempts and aggregates", async () => {
    const db = fakeDb({
      results: rep(9, {grade: 9, subject: "Chemistry", percentage: 50}),
      exam_attempts: rep(9, {grade: 12, subject: "Physics", percentage: 40}),
    });
    const s = await runCompass({db, now: NOW});
    assert.strictEqual(s.sampled, 18);
    assert.strictEqual(s.totalAttempts, 18);
    assert.strictEqual(s.distinctAreas, 2);
    assert.ok(s.backlog.length >= 1);
    assert.strictEqual(s.errors.length, 0);
  });

  await test("a failing collection query is recorded, the other still aggregates", async () => {
    const db = {
      collection(name) {
        if (name === "results") {
          return {where() {
            return this;
          }, orderBy() {
            return this;
          }, limit() {
            return this;
          }, async get() {
            throw new Error("missing index");
          }};
        }
        const docs = rep(9, {grade: 12, subject: "Physics", percentage: 40});
        const q = {where() {
          return q;
        }, orderBy() {
          return q;
        }, limit() {
          return q;
        }, async get() {
          return {forEach(cb) {
            docs.forEach((d, i) => cb({id: String(i), data: () => d}));
          }};
        }};
        return q;
      },
    };
    const s = await runCompass({db, now: NOW});
    assert.strictEqual(s.errors.length, 1);
    assert.strictEqual(s.errors[0].collection, "results");
    assert.strictEqual(s.sampled, 9, "exam_attempts still sampled despite the results error");
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
