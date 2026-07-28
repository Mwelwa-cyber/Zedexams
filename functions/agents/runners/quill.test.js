/**
 * Unit tests for Quill's QA-smoke decision logic.
 *
 * Plain Node assertions, no test runner (repo convention). Firestore is
 * injected as an in-memory fake, so this never touches Firebase or the
 * network. firebase-admin resolves from the root install but is never
 * initialised — only the static Timestamp class is exercised.
 *
 *   node functions/agents/runners/quill.test.js
 */

const assert = require("node:assert");
const {runQuill, kbHealthCheck} = require("./quill");

let passed = 0;
function test(name, fn) {
  return Promise.resolve(fn()).then(() => {
    passed += 1;
    console.log(`  ok — ${name}`);
  });
}

const NOW = 1_700_000_000_000;
const HOUR = 60 * 60 * 1000;

const toMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : v);

/**
 * In-memory Firestore-ish handle honouring exactly the query shapes Quill
 * issues: agentJobs orderBy/limit + where(status)==… (+ createdAt bounds),
 * aiGenerations where(createdAt >=).select(), and the two-level
 * cbcKnowledgeBase reads. Collections listed in `failing` reject from get()
 * to exercise the .catch(() => null) fallbacks.
 */
function fakeDb({agentJobs = [], generations = 0, kbVersions = [], kbTopics = {}, failing = []} = {}) {
  function query(name, filters) {
    return {
      orderBy() {
        return query(name, filters);
      },
      limit() {
        return query(name, filters);
      },
      select() {
        return query(name, filters);
      },
      where(field, op, value) {
        return query(name, [...filters, {field, op, value}]);
      },
      async get() {
        if (failing.includes(name)) throw new Error(`unavailable: ${name}`);
        if (name === "agentJobs") {
          let rows = agentJobs.slice();
          for (const f of filters) {
            rows = rows.filter((r) => {
              const v = f.field === "status" ? r.status : r.createdAt;
              if (f.op === "==") return v === f.value;
              if (f.op === "<") return toMs(v) < toMs(f.value);
              if (f.op === ">=") return toMs(v) >= toMs(f.value);
              return true;
            });
          }
          const docs = rows.map((r) => ({id: r.id, data: () => r}));
          return {docs, size: docs.length, forEach: (cb) => docs.forEach(cb)};
        }
        if (name === "aiGenerations") return {size: generations};
        if (name === "cbcKnowledgeBase") {
          const docs = kbVersions.map((id) => ({id}));
          return {empty: docs.length === 0, size: docs.length, docs};
        }
        const topics = name.match(/^cbcKnowledgeBase\/(.+)\/topics$/);
        if (topics) return {size: kbTopics[topics[1]] || 0};
        throw new Error(`unexpected collection: ${name}`);
      },
    };
  }
  return {collection: (name) => query(name, [])};
}

async function run() {
  // ── healthy pass ───────────────────────────────────────────────────
  await test("clean snapshot reports ok with no regressions", async () => {
    const db = fakeDb({
      agentJobs: [
        {id: "j1", status: "done", createdAt: NOW - HOUR},
        {id: "j2", status: "done", createdAt: NOW - HOUR},
        {id: "j3", status: "awaiting_approval", createdAt: NOW - HOUR},
      ],
      generations: 4,
      kbVersions: ["v1", "v2"],
      kbTopics: {v2: 12},
    });
    const report = await runQuill({db, now: NOW});
    assert.deepStrictEqual(report.statusCounts, {done: 2, awaiting_approval: 1});
    assert.deepStrictEqual(report.stuck, []);
    assert.deepStrictEqual(report.failures, []);
    assert.strictEqual(report.recentGenerations, 4);
    assert.strictEqual(report.kb.ok, true);
    assert.strictEqual(report.kb.latestVersion, "v2");
    assert.strictEqual(report.kb.topicsLatest, 12);
    assert.deepStrictEqual(report.regressions, []);
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.ranAt, new Date(NOW).toISOString());
  });

  // ── stuck-job detection ────────────────────────────────────────────
  await test("running >2h is stuck; a fresh running job is not", async () => {
    const db = fakeDb({
      agentJobs: [
        {id: "old", status: "running", createdAt: NOW - 3 * HOUR, agentId: "aria", department: "content", updatedAt: NOW - 3 * HOUR},
        {id: "fresh", status: "running", createdAt: NOW - HOUR},
      ],
      kbVersions: ["v1"],
      kbTopics: {v1: 5},
    });
    const report = await runQuill({db, now: NOW});
    assert.deepStrictEqual(report.stuck, [
      {id: "old", agentId: "aria", department: "content", stuckSince: NOW - 3 * HOUR},
    ]);
    assert.deepStrictEqual(report.regressions, ["1 jobs stuck in 'running' for >2h."]);
    assert.strictEqual(report.ok, false);
  });

  // ── failure reporting ──────────────────────────────────────────────
  await test("recent failures carry truncated errors; 3+ raises a regression", async () => {
    const db = fakeDb({
      agentJobs: [1, 2, 3].map((n) => ({
        id: `f${n}`, status: "failed", createdAt: NOW - HOUR, agentId: "cala",
        error: "x".repeat(400),
      })),
      kbVersions: ["v1"],
      kbTopics: {v1: 5},
    });
    const report = await runQuill({db, now: NOW});
    assert.strictEqual(report.failures.length, 3);
    assert.strictEqual(report.failures[0].error.length, 300);
    assert.ok(report.regressions.includes("3 agentJobs failed in the last 24h."));
  });

  await test("two failures stay below the regression threshold", async () => {
    const db = fakeDb({
      agentJobs: [1, 2].map((n) => ({id: `f${n}`, status: "failed", createdAt: NOW - HOUR, error: "boom"})),
      kbVersions: ["v1"],
      kbTopics: {v1: 5},
    });
    const report = await runQuill({db, now: NOW});
    assert.strictEqual(report.failures.length, 2);
    assert.deepStrictEqual(report.regressions, []);
  });

  await test("a failure outside the 24h window is ignored", async () => {
    const db = fakeDb({
      agentJobs: [{id: "old", status: "failed", createdAt: NOW - 25 * HOUR, error: "boom"}],
      kbVersions: ["v1"],
      kbTopics: {v1: 5},
    });
    const report = await runQuill({db, now: NOW});
    assert.deepStrictEqual(report.failures, []);
  });

  // ── KB health ──────────────────────────────────────────────────────
  await test("empty KB is a regression", async () => {
    const db = fakeDb({kbVersions: []});
    const report = await runQuill({db, now: NOW});
    assert.deepStrictEqual(report.kb, {versions: 0, topicsLatest: 0, ok: false, note: "No KB versions found."});
    assert.ok(report.regressions.includes("CBC knowledge base is empty or unreachable."));
  });

  await test("latest KB version with zero topics is not ok", async () => {
    const kb = await kbHealthCheck(fakeDb({kbVersions: ["v1", "v2"], kbTopics: {v1: 9, v2: 0}}));
    assert.strictEqual(kb.latestVersion, "v2");
    assert.strictEqual(kb.topicsLatest, 0);
    assert.strictEqual(kb.ok, false);
  });

  // ── degraded reads never throw ─────────────────────────────────────
  await test("failing generation/stuck/failure queries degrade to null/empty", async () => {
    const db = fakeDb({
      agentJobs: [{id: "j1", status: "done", createdAt: NOW - HOUR}],
      failing: ["aiGenerations"],
      kbVersions: ["v1"],
      kbTopics: {v1: 5},
    });
    const report = await runQuill({db, now: NOW});
    assert.strictEqual(report.recentGenerations, null);
    assert.strictEqual(report.ok, true);
  });

  console.log(`\nAll ${passed} quill runner tests passed.`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
