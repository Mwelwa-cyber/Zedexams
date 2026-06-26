/**
 * Unit tests for the content auto-publish gate.
 *
 * Plain Node assertions, no test runner (repo convention). Firestore is
 * injected with a fake, so this never touches Firebase.
 *
 *   node functions/agents/runners/gate.test.js
 */

const assert = require("node:assert");
const {runContentGate, evaluateContentJob} = require("./gate");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

const NOW = 1_700_000_000_000;

function fakeDb(jobs) {
  const writes = [];
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
        jobs.forEach((j) => cb({id: j.id, data: () => j.data}));
      }};
    },
    doc(id) {
      return {async set(obj) {
        writes.push({id, obj});
        const t = jobs.find((x) => x.id === id);
        if (t) Object.assign(t.data, obj);
      }};
    },
  };
  return {writes, collection() {
    return q;
  }};
}

const passing = () => ({
  department: "content", status: "awaiting_approval",
  input: {tool: "worksheet"},
  output: {aria: {draft: {x: 1}}, cala: {aligned: true, gaps: []}, reva: {verdict: "approve"}},
});

async function run() {
  // ── the bar ─────────────────────────────────────────────────────────
  await test("evaluateContentJob is off unless the flag is set", async () => {
    assert.strictEqual(evaluateContentJob(passing(), {}).approve, false);
    assert.strictEqual(evaluateContentJob(passing(), {autoPublish: false}).approve, false);
    assert.strictEqual(evaluateContentJob(passing(), {autoPublish: true}).approve, true);
  });

  await test("the bar holds anything not aligned / with gaps / not Reva-approved", async () => {
    const cfg = {autoPublish: true};
    const notAligned = passing(); notAligned.output.cala.aligned = false;
    const gappy = passing(); gappy.output.cala.gaps = ["missing outcome 3.2"];
    const revise = passing(); revise.output.reva.verdict = "revise";
    assert.strictEqual(evaluateContentJob(notAligned, cfg).approve, false);
    assert.strictEqual(evaluateContentJob(gappy, cfg).approve, false);
    assert.strictEqual(evaluateContentJob(revise, cfg).approve, false);
  });

  // ── the sweep ───────────────────────────────────────────────────────
  await test("auto-approves only the clean content jobs and writes the approve flip", async () => {
    const gap = passing(); gap.output.cala.gaps = ["x"];
    const rev = passing(); rev.output.reva.verdict = "revise";
    const db = fakeDb([
      {id: "g_ok", data: passing()},
      {id: "g_gap", data: gap},
      {id: "g_revise", data: rev},
      {id: "g_rollup", data: {department: "content", status: "awaiting_approval", output: {vigil: {}}}}, // no aria → skip
      {id: "g_seed", data: {department: "content", status: "awaiting_approval", seed: true, output: {aria: {}}}}, // seed → skip
    ]);

    const s = await runContentGate({db, config: {autoPublish: true}, now: NOW});

    assert.strictEqual(s.enabled, true);
    assert.strictEqual(s.evaluated, 3, "g_rollup and g_seed are skipped before evaluation");
    assert.deepStrictEqual(s.autoApproved.map((a) => a.id), ["g_ok"]);
    assert.deepStrictEqual(s.held.map((h) => h.id).sort(), ["g_gap", "g_revise"]);
    assert.strictEqual(s.errors.length, 0);

    // Only g_ok was written, with the exact human-equivalent approve fields.
    assert.strictEqual(db.writes.length, 1);
    const w = db.writes[0];
    assert.strictEqual(w.id, "g_ok");
    assert.strictEqual(w.obj.status, "approved");
    assert.strictEqual(w.obj.reviewedBy, "system");
    assert.strictEqual(w.obj.autoApproved, true);
    assert.ok(w.obj.reviewedAt instanceof Date);
  });

  await test("with the flag off, nothing is approved or written", async () => {
    const db = fakeDb([{id: "g_ok", data: passing()}]);
    const s = await runContentGate({db, config: {}, now: NOW});
    assert.strictEqual(s.enabled, false);
    assert.strictEqual(s.evaluated, 1);
    assert.strictEqual(s.autoApproved.length, 0);
    assert.strictEqual(s.held.length, 1);
    assert.strictEqual(db.writes.length, 0, "publishing nothing while disabled");
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
