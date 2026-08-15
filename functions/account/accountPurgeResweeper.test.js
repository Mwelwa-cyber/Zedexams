"use strict";

// Unit tests for the post-deletion Storage re-sweep (accountPurgeResweeper.js)
// and the tombstone fields it runs off (accountPurgeJobs.js).
//
// This is the replacement for the storage.rules deletion gate that #2258 added
// and #2399 removed. The properties that matter, in the order they matter:
//
//   1. IT NEVER TOUCHES A LIVE ACCOUNT. A tombstone can carry
//      `resweepDone: false` and describe an account that was never deleted —
//      a cancelled deletion, or one that crashed before the point of no
//      return, both of which leave the user signed in. Re-sweeping either
//      would delete a live teacher's papers, images and invoices. This is the
//      one failure here that is worse than the bug being fixed, so the guard
//      is mutation-verified below: the test that proves it can FAIL is as
//      important as the test that proves it passes.
//   2. It sweeps only once the token window has closed, and only once.
//   3. A failure leaves the job open for the next run rather than closing it.
//   4. It reports what it FOUND, because zero and "never counted" must not
//      look the same — that count is the only evidence this mechanism ever
//      produces about whether the window it guards is used in practice.
//
// Plain `node` script — the modules import no firebase-admin at load and the
// re-sweep takes every dependency by injection. Run:
//   node functions/account/accountPurgeResweeper.test.js

const assert = require("node:assert");
const {
  PURGE_JOBS_COLLECTION,
  PHASE_IRREVERSIBLE,
  RESWEEP_DELAY_MS,
  isResweepDue,
  openPurgeJob,
} = require("./accountPurgeJobs");
const {
  selectResweepJobs,
  runAccountPurgeResweep,
  ALERT_AFTER_RESWEEP_ATTEMPTS,
} = require("./accountPurgeResweeper");

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push(
    Promise.resolve().then(fn).then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    }).catch((err) => {
      console.error(`  ✗ ${name}\n    ${err.stack || err.message}`);
      process.exitCode = 1;
    }),
  );
}

const NOW = 1_800_000_000_000;
const due = (over = {}) => ({
  uid: "u1",
  status: "done",
  phase: PHASE_IRREVERSIBLE,
  resweepAfter: NOW - 1,
  resweepDone: false,
  ...over,
});

// ── The tombstone fields ─────────────────────────────────────────────────

test("openPurgeJob arms the re-sweep 75 minutes out (60 min token + 15 min slack)", async () => {
  let written = null;
  const db = {collection: () => ({doc: () => ({set: async (f) => { written = f; }})})};
  await openPurgeJob(db, "u1", {
    FieldValue: {serverTimestamp: () => "TS", increment: (n) => ({__op: "increment", by: n})},
    email: "a@b.com",
    now: NOW,
  });
  assert.strictEqual(RESWEEP_DELAY_MS, 75 * 60 * 1000);
  assert.strictEqual(written.resweepAfter, NOW + RESWEEP_DELAY_MS);
  assert.strictEqual(written.resweepDone, false);
});

test("a re-open re-arms the window rather than inheriting the old one", async () => {
  // Unlike `attempts` (increment(0), so a re-open never resets the failure
  // count), these two describe the token window of the attempt now starting.
  // A second attempt mints a second token window and must wait out its own.
  let written = null;
  const db = {collection: () => ({doc: () => ({set: async (f) => { written = f; }})})};
  await openPurgeJob(db, "u1", {
    FieldValue: {serverTimestamp: () => "TS", increment: (n) => ({__op: "increment", by: n})},
    now: NOW + 5_000_000,
  });
  assert.strictEqual(written.resweepAfter, NOW + 5_000_000 + RESWEEP_DELAY_MS);
  assert.strictEqual(written.resweepDone, false);
  assert.deepStrictEqual(written.attempts, {__op: "increment", by: 0});
});

test("a job is due only once the window has passed", () => {
  assert.strictEqual(isResweepDue(due(), {now: NOW}), true);
  assert.strictEqual(isResweepDue(due({resweepAfter: NOW + 1}), {now: NOW}), false);
  assert.strictEqual(isResweepDue(due({resweepAfter: NOW}), {now: NOW}), true, "the boundary is inclusive");
});

test("a finished re-sweep is never repeated", () => {
  assert.strictEqual(isResweepDue(due({resweepDone: true}), {now: NOW}), false);
});

test("a `done` job IS re-swept — that is the normal case, not the exception", () => {
  // The purge takes ~25 s and the window is 75 min, so by the time a re-sweep
  // is due virtually every job is closed. A `status === "pending"` filter here
  // (which is what the OTHER sweeper wants) would re-sweep only the deletions
  // that had already failed.
  assert.strictEqual(isResweepDue(due({status: "done"}), {now: NOW}), true);
  assert.strictEqual(isResweepDue(due({status: "pending"}), {now: NOW}), true);
});

test("an unreadable or missing due time fails CLOSED", () => {
  // Opposite of isStalePurgeJob, which fails OPEN because a job it cannot age
  // is one nothing else will finish. Here failing open means sweeping DURING
  // the window the delay exists to wait out. The next run retries.
  assert.strictEqual(isResweepDue(due({resweepAfter: undefined}), {now: NOW}), false);
  assert.strictEqual(isResweepDue(due({resweepAfter: "not a date"}), {now: NOW}), false);
  assert.strictEqual(isResweepDue(null, {now: NOW}), false);
});

// ── The guard: never touch an account that still exists ──────────────────

test("a CANCELLED deletion is never re-swept — that account still exists", () => {
  assert.strictEqual(isResweepDue(due({status: "cancelled", phase: undefined}), {now: NOW}), false);
  // Even if a cancelled job somehow carried the phase marker, `cancelled` is
  // refused on its own name — the guard must not depend on noticing that a
  // cancellation implies no marker.
  assert.strictEqual(isResweepDue(due({status: "cancelled"}), {now: NOW}), false);
});

test("a deletion that crashed before the point of no return is never re-swept", () => {
  // openPurgeJob ran (so the fields are armed) but markPurgeIrreversible never
  // did — a timeout, an OOM, an eviction. The Auth user is intact and the user
  // is still signed in.
  assert.strictEqual(isResweepDue(due({phase: undefined}), {now: NOW}), false);
  assert.strictEqual(isResweepDue(due({phase: "something-else"}), {now: NOW}), false);
});

test("the live-account guard can FAIL — it is load-bearing, not decorative", () => {
  // Mutation check. If `isResweepDue` stopped requiring PHASE_IRREVERSIBLE,
  // this is the input that would start being swept: a live user's tombstone
  // from a deletion that was cancelled and whose account was never touched.
  // Assert the naive predicate the guard replaces WOULD have taken it, so a
  // future edit that drops the phase check cannot leave these tests green.
  const liveAccount = due({status: "cancelled", phase: undefined});
  const naive = (j, now) => j.resweepDone !== true && j.resweepAfter <= now;
  assert.strictEqual(naive(liveAccount, NOW), true, "the naive rule sweeps a live account");
  assert.strictEqual(isResweepDue(liveAccount, {now: NOW}), false, "the real one refuses it");
});

test("selectResweepJobs drops the undue and the unsafe, and caps the batch", () => {
  const jobs = [
    {id: "ready", data: due()},
    {id: "early", data: due({resweepAfter: NOW + 60_000})},
    {id: "cancelled", data: due({status: "cancelled", phase: undefined})},
    {id: "no-phase", data: due({phase: undefined})},
    {id: "closed", data: due({resweepDone: true})},
    {id: "ready2", data: due()},
  ];
  assert.deepStrictEqual(
    selectResweepJobs(jobs, {now: NOW}).map((j) => j.id),
    ["ready", "ready2"],
  );
  assert.deepStrictEqual(
    selectResweepJobs(jobs, {now: NOW, limit: 1}).map((j) => j.id),
    ["ready"],
  );
});

// ── The sweep ────────────────────────────────────────────────────────────

const FieldValue = {
  serverTimestamp: () => "SERVER_TS",
  increment: (n) => ({__op: "increment", by: n}),
};

function fakeDb(jobs) {
  const store = {[PURGE_JOBS_COLLECTION]: JSON.parse(JSON.stringify(jobs))};
  return {
    store,
    collection: (col) => ({
      doc: (id) => ({
        async set(fields, opts) {
          store[col] = store[col] || {};
          const cur = (opts && opts.merge && store[col][id]) || {};
          const next = {...cur};
          for (const [k, v] of Object.entries(fields)) {
            next[k] = v && v.__op === "increment" ? Number(cur[k] || 0) + v.by : v;
          }
          store[col][id] = next;
        },
      }),
      where() { return this; },
      limit() { return this; },
      async get() {
        // Mirrors the real query: equality on resweepDone === false. A doc
        // MISSING the field does not match, which is the production behaviour
        // for tombstones written before this change existed.
        const rows = Object.entries(store[col] || {})
          .filter(([, d]) => d.resweepDone === false);
        return {docs: rows.map(([id, data]) => ({id, data: () => data}))};
      },
    }),
  };
}

/** A bucket-shaped fake keyed by the objects it holds under each prefix. */
function fakeStorage(objectsByPrefix = {}) {
  const seen = [];
  return {
    seen,
    async deletePrefix(_bucket, prefix) {
      seen.push(prefix);
      const n = objectsByPrefix[prefix] || 0;
      delete objectsByPrefix[prefix];
      return n;
    },
  };
}

const PREFIXES = ["papers/", "quiz-images/"];
const collectPrefixes = (uid) => PREFIXES.map((p) => `${p}${uid}/`);

test("a due job has every prefix re-enumerated and is then closed", async () => {
  const db = fakeDb({u1: due()});
  const storage = fakeStorage();
  const out = await runAccountPurgeResweep({
    db,
    bucket: {},
    FieldValue,
    collectPrefixes,
    deletePrefix: storage.deletePrefix,
    alert: async () => { throw new Error("must not alert on a clean sweep"); },
    now: NOW,
  });
  assert.deepStrictEqual(storage.seen, ["papers/u1/", "quiz-images/u1/"]);
  const job = db.store[PURGE_JOBS_COLLECTION].u1;
  assert.strictEqual(job.resweepDone, true);
  assert.strictEqual(job.resweepDeleted, 0);
  assert.strictEqual(out.completed, 1);
  assert.strictEqual(out.leaked, 0);
});

test("a job still inside its token window is not touched", async () => {
  const db = fakeDb({u1: due({resweepAfter: NOW + 60_000})});
  const out = await runAccountPurgeResweep({
    db,
    bucket: {},
    FieldValue,
    collectPrefixes,
    deletePrefix: async () => { throw new Error("must not sweep before the window closes"); },
    alert: async () => {},
    now: NOW,
  });
  assert.strictEqual(out.due, 0);
  assert.strictEqual(db.store[PURGE_JOBS_COLLECTION].u1.resweepDone, false);
});

test("a live account's tombstone is never enumerated, let alone deleted", async () => {
  const db = fakeDb({
    cancelled: due({uid: "cancelled", status: "cancelled", phase: undefined}),
    crashed: due({uid: "crashed", phase: undefined}),
  });
  const out = await runAccountPurgeResweep({
    db,
    bucket: {},
    FieldValue,
    collectPrefixes,
    deletePrefix: async () => { throw new Error("must never delete a live account's storage"); },
    alert: async () => {},
    now: NOW,
  });
  assert.strictEqual(out.scanned, 2, "both were fetched by the query");
  assert.strictEqual(out.due, 0, "and both were refused by the guard");
});

test("objects found are counted, recorded and alerted — the window was used", async () => {
  const db = fakeDb({u1: due()});
  const storage = fakeStorage({"papers/u1/": 2, "quiz-images/u1/": 1});
  const alerts = [];
  const out = await runAccountPurgeResweep({
    db,
    bucket: {},
    FieldValue,
    collectPrefixes,
    deletePrefix: storage.deletePrefix,
    alert: async (a) => { alerts.push(a); },
    now: NOW,
  });
  assert.strictEqual(out.objectsDeleted, 3);
  assert.strictEqual(out.leaked, 1);
  assert.strictEqual(db.store[PURGE_JOBS_COLLECTION].u1.resweepDeleted, 3);
  assert.strictEqual(alerts.length, 1);
  assert.strictEqual(alerts[0].severity, "info", "cleanup worked; this is an observation, not a failure");
  assert.strictEqual(db.store[PURGE_JOBS_COLLECTION].u1.resweepDone, true);
});

test("a failed prefix leaves the job OPEN for the next run", async () => {
  const db = fakeDb({u1: due()});
  const out = await runAccountPurgeResweep({
    db,
    bucket: {},
    FieldValue,
    collectPrefixes,
    deletePrefix: async (_b, prefix) => {
      if (prefix.startsWith("quiz-images/")) throw new Error("listing failed");
      return 0;
    },
    alert: async () => {},
    now: NOW,
  });
  assert.strictEqual(out.failed, 1);
  assert.strictEqual(out.completed, 0);
  const job = db.store[PURGE_JOBS_COLLECTION].u1;
  assert.strictEqual(job.resweepDone, false, "a partial sweep must never close the job");
  assert.strictEqual(job.resweepAttempts, 1);
});

test("a repeatedly failing re-sweep alerts, and only then", async () => {
  const run = (resweepAttempts) => {
    const alerts = [];
    const db = fakeDb({u1: due({resweepAttempts})});
    return runAccountPurgeResweep({
      db,
      bucket: {},
      FieldValue,
      collectPrefixes,
      deletePrefix: async () => { throw new Error("boom"); },
      alert: async (a) => { alerts.push(a); },
      now: NOW,
    }).then(() => alerts);
  };
  assert.strictEqual((await run(0)).length, 0, "one failure is a hiccup");
  const alerts = await run(ALERT_AFTER_RESWEEP_ATTEMPTS - 1);
  assert.strictEqual(alerts.length, 1, "the alert fires on the run that reaches the threshold");
  assert.strictEqual(alerts[0].severity, "critical");
});

test("re-sweeping is idempotent — a second run over the same uid is a no-op", async () => {
  const db = fakeDb({u1: due()});
  const storage = fakeStorage({"papers/u1/": 2});
  const deps = {
    db,
    bucket: {},
    FieldValue,
    collectPrefixes,
    deletePrefix: storage.deletePrefix,
    alert: async () => {},
    now: NOW,
  };
  const first = await runAccountPurgeResweep(deps);
  const second = await runAccountPurgeResweep(deps);
  assert.strictEqual(first.objectsDeleted, 2);
  assert.strictEqual(second.due, 0, "the closed job is outside the query on the second pass");
  assert.strictEqual(second.objectsDeleted, 0);
});

test("a tombstone predating the re-sweep fields is not picked up", async () => {
  // A missing field never matches an equality query, so the old jobs are
  // invisible to this sweep. Correct rather than a gap — their token windows
  // closed long before the code shipped — but asserted so it is a decision
  // someone made rather than something nobody noticed.
  const db = fakeDb({old: {uid: "old", status: "done", phase: PHASE_IRREVERSIBLE}});
  const out = await runAccountPurgeResweep({
    db,
    bucket: {},
    FieldValue,
    collectPrefixes,
    deletePrefix: async () => { throw new Error("must not sweep a pre-existing tombstone"); },
    alert: async () => {},
    now: NOW,
  });
  assert.strictEqual(out.scanned, 0);
});

test("the sweep walks the SAME prefix list the purge-time cascade uses", async () => {
  // Not a second enumerator. If USER_KEYED_PREFIXES grows, this grows with it;
  // a local copy here would drift towards covering less than the cascade does.
  const {collectUserPrefixes, USER_KEYED_PREFIXES} = require("../storageCleanup/helpers");
  const {resweepUidStorage} = require("./accountPurgeResweeper");
  const seen = [];
  const deleted = await resweepUidStorage("u9", {
    bucket: {},
    collectPrefixes: collectUserPrefixes,
    deletePrefix: async (_b, p) => { seen.push(p); return 1; },
  });
  assert.deepStrictEqual(seen, USER_KEYED_PREFIXES.map((p) => `${p}u9/`));
  assert.strictEqual(deleted, USER_KEYED_PREFIXES.length);
});

Promise.all(pending).then(() => {
  console.log(`\n${passed} passed`);
});
