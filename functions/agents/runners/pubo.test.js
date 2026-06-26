/**
 * Unit tests for Pubo — the Publisher runner.
 *
 * Pubo is the only agent allowed to publish, so its refusal gates and its
 * admin-override audit logic are the high-value surface. The Firestore
 * handle is injected (a capturing fake), so this never touches Firebase;
 * `admin.firestore.FieldValue.serverTimestamp()` is a local sentinel and
 * needs no network.
 *
 *   node functions/agents/runners/pubo.test.js
 */

const assert = require("node:assert");
const {runPubo} = require("./pubo");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

// A Firestore fake: collection().doc().get()/set(). Seed `exists` and
// capture every set() payload so the test can assert what Pubo wrote.
function fakeDb({exists = true} = {}) {
  const writes = [];
  const db = {
    collection(name) {
      assert.strictEqual(name, "aiGenerations", "Pubo only ever publishes aiGenerations");
      return {
        doc(docId) {
          return {
            async get() {
              return {exists, id: docId};
            },
            async set(payload, opts) {
              writes.push({docId, payload, opts});
              return {ok: true};
            },
          };
        },
      };
    },
  };
  return {db, writes};
}

// A fully-approved job with Aria/Cala/Reva output present.
function approvedJob(overrides = {}) {
  return {
    id: "job-1",
    status: "approved",
    reviewedBy: "admin-1",
    output: {
      aria: {generationId: "gen-1"},
      cala: {aligned: true, gaps: [], drift: []},
      reva: {verdict: "approve"},
    },
    ...overrides,
  };
}

async function run() {
  // ── refusal gates ──────────────────────────────────────────────────
  await test("refuses a job that is not approved", async () => {
    const {db} = fakeDb();
    await assert.rejects(
      () => runPubo({job: approvedJob({status: "awaiting_approval"}), db}),
      /expected "approved"/,
    );
  });

  await test("refuses when Aria left no generationId", async () => {
    const {db} = fakeDb();
    const job = approvedJob();
    job.output.aria = {};
    await assert.rejects(() => runPubo({job, db}), /no aria\.generationId/);
  });

  await test("refuses when Cala never ran", async () => {
    const {db} = fakeDb();
    const job = approvedJob();
    delete job.output.cala;
    await assert.rejects(() => runPubo({job, db}), /Cala must run/);
  });

  await test("refuses when Reva never ran", async () => {
    const {db} = fakeDb();
    const job = approvedJob();
    delete job.output.reva;
    await assert.rejects(() => runPubo({job, db}), /Reva must run/);
  });

  await test("refuses when the reserved aiGenerations doc is missing", async () => {
    const {db} = fakeDb({exists: false});
    await assert.rejects(() => runPubo({job: approvedJob(), db}), /not found/);
  });

  // ── the happy path flips visibility to public ──────────────────────
  await test("publishes: flips visibility to public and stamps approval metadata", async () => {
    const {db, writes} = fakeDb();
    const out = await runPubo({job: approvedJob(), db});

    assert.strictEqual(writes.length, 1);
    assert.strictEqual(writes[0].docId, "gen-1");
    assert.deepStrictEqual(writes[0].opts, {merge: true});
    assert.strictEqual(writes[0].payload.visibility, "public");
    assert.strictEqual(writes[0].payload.approvedBy, "admin-1");
    assert.strictEqual(writes[0].payload.approvedJobId, "job-1");
    assert.strictEqual(writes[0].payload.publishedBy, "agent:pubo");

    assert.deepStrictEqual(out.publishedRefs, [
      {collection: "aiGenerations", docId: "gen-1"},
    ]);
  });

  // ── override audit logic ───────────────────────────────────────────
  await test("a clean alignment carries no override forward", async () => {
    const {db, writes} = fakeDb();
    const out = await runPubo({
      job: approvedJob({overrideReason: "ignored when aligned"}),
      db,
    });
    assert.strictEqual(writes[0].payload.approvedWithOverride, false);
    assert.strictEqual(writes[0].payload.overrideReason, null);
    assert.strictEqual(out.approvedWithOverride, false);
  });

  await test("an unaligned draft + admin reason records an active override", async () => {
    const {db, writes} = fakeDb();
    const job = approvedJob({overrideReason: "  Teacher accepts the gap for revision week  "});
    job.output.cala = {aligned: false, gaps: [{outcome: "x"}], drift: []};
    const out = await runPubo({job, db});
    assert.strictEqual(writes[0].payload.approvedWithOverride, true);
    assert.strictEqual(
      writes[0].payload.overrideReason,
      "Teacher accepts the gap for revision week",
      "override reason is trimmed",
    );
    assert.strictEqual(out.approvedWithOverride, true);
  });

  await test("an unaligned draft with NO reason is not treated as an override", async () => {
    const {db, writes} = fakeDb();
    const job = approvedJob();
    job.output.cala = {aligned: false, gaps: [], drift: [{outcome: "ENG.9.9.9"}]};
    // no overrideReason supplied
    await runPubo({job, db});
    assert.strictEqual(writes[0].payload.approvedWithOverride, false);
    assert.strictEqual(writes[0].payload.overrideReason, null);
  });

  console.log(`\n${passed} passed`);
}

run().catch((err) => {
  console.error("\nTEST FAILED:", err && err.message);
  process.exit(1);
});
