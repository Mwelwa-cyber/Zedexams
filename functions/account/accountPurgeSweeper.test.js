"use strict";

// Unit tests for the account-purge tombstones + the sweeper that retries them
// (accountPurgeJobs.js / accountPurgeSweeper.js).
//
// The sweeper is the only thing standing between "the purge failed after the
// Auth user was deleted" and data we promised to erase sitting in Firestore
// forever, so the properties tested here are: it only adopts jobs old enough
// to be genuinely stuck, it closes a job ONLY on a verified purge, and it
// alerts once a job has failed enough times to be a real problem rather than a
// hiccup.
//
// Plain `node` script — the modules import no firebase-admin at load, and the
// sweeper takes every dependency by injection. Run:
//   node functions/account/accountPurgeSweeper.test.js

const assert = require("node:assert");
const {
  hashEmail,
  isStalePurgeJob,
  toMillis,
  STALE_AFTER_MS,
  ALERT_AFTER_ATTEMPTS,
  PURGE_JOBS_COLLECTION,
} = require("./accountPurgeJobs");
const {selectStaleJobs, runAccountPurgeSweep} = require("./accountPurgeSweeper");

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

// ── Tombstone helpers ────────────────────────────────────────────────────

test("hashEmail normalises case and whitespace, and never returns the address", () => {
  assert.strictEqual(hashEmail("  Zed@Example.COM "), hashEmail("zed@example.com"));
  assert.strictEqual(hashEmail(""), null);
  assert.strictEqual(hashEmail(undefined), null);
  assert.match(hashEmail("a@b.com"), /^[0-9a-f]{64}$/);
});

test("toMillis reads Timestamps, Dates, ISO strings and numbers", () => {
  const ms = Date.UTC(2026, 7, 9, 18, 48, 50);
  assert.strictEqual(toMillis({toMillis: () => ms}), ms);
  assert.strictEqual(toMillis({toDate: () => new Date(ms)}), ms);
  assert.strictEqual(toMillis(new Date(ms)), ms);
  assert.strictEqual(toMillis(new Date(ms).toISOString()), ms);
  assert.strictEqual(toMillis(ms), ms);
  assert.strictEqual(toMillis("not a date"), null);
  assert.strictEqual(toMillis(null), null);
});

test("only pending jobs past the window are stale", () => {
  const now = 1_000_000_000;
  const at = (ms) => ({status: "pending", phase: "irreversible", createdAt: new Date(ms).toISOString()});
  assert.strictEqual(isStalePurgeJob(at(now - STALE_AFTER_MS - 1), {now}), true);
  assert.strictEqual(isStalePurgeJob(at(now - 60_000), {now}), false, "a purge still running is not stuck");
  assert.strictEqual(
    isStalePurgeJob({status: "done", createdAt: new Date(now - 86_400_000).toISOString()}, {now}),
    false,
    "a finished deletion is never re-swept",
  );
  // A job whose timestamp cannot be read is exactly the one nothing else will
  // ever finish, so it is swept rather than skipped.
  assert.strictEqual(isStalePurgeJob({status: "pending"}, {now}), true);
});

test("selectStaleJobs caps the batch and drops the fresh ones", () => {
  const now = 1_000_000_000;
  const old = new Date(now - STALE_AFTER_MS - 1).toISOString();
  const jobs = [
    {id: "fresh", data: {status: "pending", phase: "irreversible", createdAt: new Date(now).toISOString()}},
    {id: "a", data: {status: "pending", phase: "irreversible", createdAt: old}},
    {id: "b", data: {status: "pending", phase: "irreversible", createdAt: old}},
    {id: "done", data: {status: "done", createdAt: old}},
  ];
  assert.deepStrictEqual(selectStaleJobs(jobs, {now}).map((j) => j.id), ["a", "b"]);
  assert.deepStrictEqual(selectStaleJobs(jobs, {now, limit: 1}).map((j) => j.id), ["a"]);
});

// ── Sweeper ──────────────────────────────────────────────────────────────

const FieldValue = {
  serverTimestamp: () => "SERVER_TS",
  increment: (n) => ({__op: "increment", by: n}),
};

function fakeDb(jobs) {
  const store = {[PURGE_JOBS_COLLECTION]: JSON.parse(JSON.stringify(jobs))};
  const docRef = (col, id) => ({
    async set(fields, opts) {
      store[col] = store[col] || {};
      const cur = (opts && opts.merge && store[col][id]) || {};
      const next = {...cur};
      for (const [k, v] of Object.entries(fields)) {
        next[k] = v && v.__op === "increment" ? Number(cur[k] || 0) + v.by : v;
      }
      store[col][id] = next;
    },
    async get() {
      const data = store[col] && store[col][id];
      return {exists: data !== undefined, data: () => data};
    },
  });
  return {
    store,
    collection: (col) => ({
      doc: (id) => docRef(col, id),
      where() { return this; },
      limit() { return this; },
      async get() {
        const rows = Object.entries(store[col] || {}).filter(([, d]) => d.status === "pending");
        return {docs: rows.map(([id, data]) => ({id, data: () => data}))};
      },
    }),
  };
}

const staleAt = () => new Date(Date.now() - STALE_AFTER_MS - 1000).toISOString();
const noAuth = {deleteUser: async () => {}};

test("a stale job is retried, verified and closed", async () => {
  const db = fakeDb({u1: {uid: "u1", status: "pending", phase: "irreversible", attempts: 1, createdAt: staleAt()}});
  const purged = [];
  const out = await runAccountPurgeSweep({
    db,
    auth: noAuth,
    FieldValue,
    purge: async (_db, uid) => { purged.push(uid); return {errors: [], verified: true}; },
    alert: async () => { throw new Error("must not alert on success"); },
  });
  assert.deepStrictEqual(purged, ["u1"]);
  assert.strictEqual(db.store[PURGE_JOBS_COLLECTION].u1.status, "done");
  assert.strictEqual(out.completed, 1);
  assert.strictEqual(out.failed, 0);
});

test("a job younger than the window is left alone", async () => {
  const db = fakeDb({u1: {uid: "u1", status: "pending", phase: "irreversible", attempts: 0, createdAt: new Date().toISOString()}});
  const out = await runAccountPurgeSweep({
    db,
    auth: noAuth,
    FieldValue,
    purge: async () => { throw new Error("must not purge a job that may still be running"); },
    alert: async () => {},
  });
  assert.strictEqual(out.swept, 0);
  assert.strictEqual(db.store[PURGE_JOBS_COLLECTION].u1.status, "pending");
});

test("an unverified purge is NOT closed, and counts as a failure", async () => {
  const db = fakeDb({u1: {uid: "u1", status: "pending", phase: "irreversible", attempts: 0, createdAt: staleAt()}});
  const out = await runAccountPurgeSweep({
    db,
    auth: noAuth,
    FieldValue,
    purge: async () => ({errors: ["users/u1: boom"], verified: false}),
    alert: async () => {},
  });
  assert.strictEqual(out.failed, 1);
  assert.strictEqual(out.completed, 0);
  const job = db.store[PURGE_JOBS_COLLECTION].u1;
  assert.strictEqual(job.status, "pending");
  assert.strictEqual(job.attempts, 1);
});

test("the sweeper deletes a surviving Auth user before the data, like the handler", async () => {
  const order = [];
  const db = fakeDb({u1: {uid: "u1", status: "pending", phase: "irreversible", attempts: 0, createdAt: staleAt()}});
  await runAccountPurgeSweep({
    db,
    auth: {deleteUser: async (uid) => { order.push(`deleteUser:${uid}`); }},
    FieldValue,
    purge: async (_db, uid) => { order.push(`purge:${uid}`); return {errors: [], verified: true}; },
    alert: async () => {},
  });
  assert.deepStrictEqual(order, ["deleteUser:u1", "purge:u1"]);
});

test("an already-deleted Auth user does not stop the sweep", async () => {
  const db = fakeDb({u1: {uid: "u1", status: "pending", phase: "irreversible", attempts: 0, createdAt: staleAt()}});
  const err = new Error("gone");
  err.code = "auth/user-not-found";
  const out = await runAccountPurgeSweep({
    db,
    auth: {deleteUser: async () => { throw err; }},
    FieldValue,
    purge: async () => ({errors: [], verified: true}),
    alert: async () => {},
  });
  assert.strictEqual(out.completed, 1);
});

test("a job that never reached the point of no return is NOT adopted, however old", async () => {
  const calls = [];
  const db = fakeDb({
    // Pending, ancient, and no phase marker: a run that died between opening
    // the tombstone and deleting the Auth user. The account was never deleted.
    u1: {uid: "u1", status: "pending", attempts: 0, createdAt: staleAt()},
  });
  const out = await runAccountPurgeSweep({
    db,
    auth: {async deleteUser(uid) { calls.push(`deleteUser:${uid}`); }},
    FieldValue,
    purge: async () => { calls.push("purge"); return {verified: true, errors: []}; },
    alert: async () => {},
  });
  assert.strictEqual(out.swept, 0,
    "adopted, the sweeper would delete an account whose deletion never started — " +
    "and on a crash path no catch ran to cancel anything");
  assert.deepEqual(calls, [], "nothing was deleted and nothing was purged");
});

test("a purge that VERIFIED but reported errors is not closed by the sweeper either", async () => {
  const db = fakeDb({
    u1: {uid: "u1", status: "pending", phase: "irreversible", attempts: 0, createdAt: staleAt()},
  });
  const out = await runAccountPurgeSweep({
    db,
    auth: noAuth,
    FieldValue,
    purge: async () => ({verified: true, errors: ["results: deadline-exceeded"]}),
    alert: async () => {},
  });
  assert.strictEqual(out.completed, 0);
  assert.strictEqual(db.store[PURGE_JOBS_COLLECTION].u1.status, "pending",
    "the recovery path is the last actor — closing here strands the data for good");
});

test("alerts only once a job has failed ALERT_AFTER_ATTEMPTS times", async () => {
  const alerts = [];
  const alert = async (a) => { alerts.push(a); };
  const run = (attempts) => runAccountPurgeSweep({
    db: fakeDb({u1: {uid: "u1", status: "pending", phase: "irreversible", attempts, createdAt: staleAt()}}),
    auth: noAuth,
    FieldValue,
    purge: async () => { throw new Error("still broken"); },
    alert,
  });

  await run(ALERT_AFTER_ATTEMPTS - 2); // this run makes it ALERT_AFTER_ATTEMPTS - 1
  assert.strictEqual(alerts.length, 0, "a couple of failures is a hiccup, not an incident");

  const out = await run(ALERT_AFTER_ATTEMPTS - 1); // this run reaches the threshold
  assert.strictEqual(alerts.length, 1, "the alert must fire ON the threshold run, not after it");
  assert.strictEqual(out.alerted, 1);
  assert.strictEqual(alerts[0].severity, "critical");
  assert.match(alerts[0].lines.join("\n"), /u1/);
});

test("an alert that fails does not lose the failure bookkeeping", async () => {
  const db = fakeDb({u1: {uid: "u1", status: "pending", phase: "irreversible", attempts: 5, createdAt: staleAt()}});
  const out = await runAccountPurgeSweep({
    db,
    auth: noAuth,
    FieldValue,
    purge: async () => { throw new Error("still broken"); },
    alert: async () => { throw new Error("smtp down"); },
  });
  assert.strictEqual(out.failed, 1);
  assert.strictEqual(out.alerted, 0);
  assert.strictEqual(db.store[PURGE_JOBS_COLLECTION].u1.attempts, 6);
});

// ── Post-purge cleanup parity ────────────────────────────────────────────
// A deletion the sweeper recovers must be as complete as one the callable
// finished. Before this, the analytics purge and the support-queue close lived
// inline in the handler, so a recovered deletion left the PostHog person and
// its event history in place and reported `completed` regardless.

test("a recovered deletion runs the same post-purge cleanup as the handler", async () => {
  const db = fakeDb({u1: {
    uid: "u1", status: "pending", phase: "irreversible", attempts: 0,
    createdAt: staleAt(), emailHash: hashEmail("person@example.com"),
  }});
  const seen = [];
  const out = await runAccountPurgeSweep({
    db,
    auth: noAuth,
    FieldValue,
    purge: async () => ({errors: [], verified: true}),
    cleanup: async (args) => { seen.push(args); return {analytics: {ok: true}}; },
    alert: async () => { throw new Error("must not alert on success"); },
  });
  assert.strictEqual(out.completed, 1);
  assert.strictEqual(seen.length, 1, "cleanup must run on the recovery path");
  assert.strictEqual(seen[0].uid, "u1");
  // The hash, because there is no address left to pass: the Auth user was
  // deleted before the purge began and the tombstone never stored one.
  assert.strictEqual(seen[0].emailHash, hashEmail("person@example.com"));
  assert.strictEqual(seen[0].email, undefined);
  assert.strictEqual(out.cleanupDegraded, 0);
});

test("cleanup never runs for a purge that did not verify", async () => {
  // Cleaning up after a purge that left data behind would drain the support
  // queue for a deletion that has not happened.
  const db = fakeDb({u1: {uid: "u1", status: "pending", phase: "irreversible", attempts: 0, createdAt: staleAt()}});
  let ran = 0;
  await runAccountPurgeSweep({
    db,
    auth: noAuth,
    FieldValue,
    purge: async () => ({errors: [], verified: false}),
    cleanup: async () => { ran += 1; return {}; },
    alert: async () => {},
  });
  assert.strictEqual(ran, 0);
});

test("a cleanup that throws degrades the run, it does not fail the job", async () => {
  // The purge has already verified — the data is gone. Marking the job failed
  // here would leave a finished deletion pending, re-swept daily for ever, and
  // eventually paging someone about data that no longer exists.
  const db = fakeDb({u1: {uid: "u1", status: "pending", phase: "irreversible", attempts: 0, createdAt: staleAt()}});
  const out = await runAccountPurgeSweep({
    db,
    auth: noAuth,
    FieldValue,
    purge: async () => ({errors: [], verified: true}),
    cleanup: async () => { throw new Error("posthog unreachable"); },
    alert: async () => { throw new Error("must not alert: the deletion succeeded"); },
  });
  assert.strictEqual(out.completed, 1);
  assert.strictEqual(out.failed, 0);
  assert.strictEqual(out.cleanupDegraded, 1, "a silent degraded run reads as a clean one");
  assert.strictEqual(db.store[PURGE_JOBS_COLLECTION].u1.status, "done");
});

test("an unreachable analytics profile is counted, not swallowed", async () => {
  const db = fakeDb({u1: {uid: "u1", status: "pending", phase: "irreversible", attempts: 0, createdAt: staleAt()}});
  const out = await runAccountPurgeSweep({
    db,
    auth: noAuth,
    FieldValue,
    purge: async () => ({errors: [], verified: true}),
    cleanup: async () => ({analytics: {ok: false, error: "threw"}}),
    alert: async () => {},
  });
  assert.strictEqual(out.completed, 1);
  assert.strictEqual(out.cleanupDegraded, 1);
});

Promise.all(pending).then(() => {
  console.log(`\n  ${passed} passed`);
});
