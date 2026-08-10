"use strict";

/**
 * Closing a web deletion request — by address (the callable's path) and by
 * hash (the sweeper's).
 *
 * These tests live here, and this module exists, because the logic used to sit
 * in `accountDeletionRequests.js`, which imports `firebase-functions`. CI's
 * node runners install root deps only — including the Functions coverage job,
 * which also runs `npm ci` at the root — so every test reaching that file is
 * skipped. Tests that never execute read as coverage and are worse than none.
 *
 * Run: node functions/account/deletionRequestClosure.test.js
 */

const assert = require("node:assert");
const {
  closeDeletionRequests,
  closeDeletionRequestsByEmailHash,
  emailBucketKey,
  OPEN_QUEUE_SCAN_LIMIT,
} = require("./deletionRequestClosure");
const {hashEmail} = require("./accountPurgeJobs");

let passed = 0;
const pending = [];
const test = (name, fn) => pending.push(
    Promise.resolve().then(fn).then(() => {
      passed += 1;
      console.log(`  ✓ ${name}`);
    }).catch((err) => {
      console.error(`  ✗ ${name}\n    ${err.stack || err.message}`);
      process.exitCode = 1;
    }),
);

/** A row that records what was written to it, as a Firestore doc would. */
function row(data) {
  const written = {};
  return {
    written,
    data: () => data,
    ref: {update: async (fields) => Object.assign(written, fields)},
  };
}

/** Firestore stand-in that replays a scripted result and records the query. */
function fakeDb(docs = []) {
  const queries = [];
  const q = {
    __filters: [],
    __limit: null,
    where(field, op, value) { this.__filters.push({field, op, value}); return this; },
    limit(n) { this.__limit = n; return this; },
    async get() {
      queries.push({filters: [...q.__filters], limit: q.__limit});
      q.__filters = [];
      return {empty: docs.length === 0, docs};
    },
  };
  return {queries, collection: () => q};
}

const ts = {serverTimestamp: () => "TS"};

// ── by address ──────────────────────────────────────────────────────

test("closing by address marks the row completed and redacts identity", async () => {
  const r = row({email: "parent@example.com", name: "A Parent", details: "notes", status: "pending"});
  const closed = await closeDeletionRequests(fakeDb([r]), "  Parent@Example.COM ", ts);

  assert.strictEqual(closed, 1);
  assert.strictEqual(r.written.status, "completed");
  assert.strictEqual(r.written.name, "");
  assert.strictEqual(r.written.details, "");
  assert.strictEqual(r.written.ip, null);
  // The address we were asked to delete must not survive in the row created by
  // asking. What is left is a de-duplicable key, not a contactable address.
  assert.strictEqual(r.written.email, `redacted:${emailBucketKey("parent@example.com")}`);
  assert.ok(!r.written.email.includes("parent@example.com"));
});

test("the address query is an equality on the normalised address", async () => {
  const db = fakeDb([row({email: "a@b.com", status: "pending"})]);
  await closeDeletionRequests(db, "A@B.com", ts);
  const {filters} = db.queries[0];
  assert.deepStrictEqual(filters[0], {field: "email", op: "==", value: "a@b.com"});
});

// ── by hash ─────────────────────────────────────────────────────────

test("closing by hash finds exactly the row the tombstone points at", async () => {
  // The sweeper's path: no address exists any more, only hashEmail() off the
  // tombstone, so this is the only way a recovered deletion can drain the queue.
  const address = "parent@example.com";
  const match = row({email: address, emailHash: hashEmail(address), status: "pending"});
  const other = row({email: "someone@else.com", emailHash: hashEmail("someone@else.com"), status: "pending"});

  const closed = await closeDeletionRequestsByEmailHash(
      fakeDb([other, match]), hashEmail("  Parent@Example.COM "), ts,
  );

  assert.strictEqual(closed, 1);
  assert.strictEqual(match.written.status, "completed");
  assert.deepStrictEqual(other.written, {}, "another person's request must be untouched");
});

test("the hash lookup scans the open queue rather than needing an index", async () => {
  // Deliberate: emailHash + status-in would be a composite index that has to
  // be deployed before the code querying it. Recorded so the trade is visible
  // if the queue ever grows past the point where a scan is right.
  const db = fakeDb([row({email: "a@b.com", emailHash: hashEmail("a@b.com"), status: "pending"})]);
  await closeDeletionRequestsByEmailHash(db, hashEmail("a@b.com"), ts);
  const {filters, limit} = db.queries[0];
  assert.strictEqual(filters.length, 1, "status only — no emailHash equality in the query");
  assert.strictEqual(filters[0].field, "status");
  assert.strictEqual(limit, OPEN_QUEUE_SCAN_LIMIT);
});

test("a row written before emailHash existed is skipped, not guessed at", async () => {
  // The stated limit of the recovery path. Those rows are still closed by the
  // handler path, which has the address.
  const legacy = row({email: "parent@example.com", status: "pending"});
  const closed = await closeDeletionRequestsByEmailHash(
      fakeDb([legacy]), hashEmail("parent@example.com"), ts,
  );
  assert.strictEqual(closed, 0);
  assert.deepStrictEqual(legacy.written, {});
});

test("both lookups redact from the ROW's own address", async () => {
  // The hash path has no caller-supplied address, so the redaction key can only
  // come from the row. Using the same source on both keeps them from producing
  // different keys for the same person.
  const a = row({email: "Person@Example.com", emailHash: hashEmail("person@example.com"), status: "pending"});
  const b = row({email: "Person@Example.com", status: "pending"});
  await closeDeletionRequestsByEmailHash(fakeDb([a]), hashEmail("person@example.com"), ts);
  await closeDeletionRequests(fakeDb([b]), "person@example.com", ts);
  assert.strictEqual(a.written.email, b.written.email);
});

// ── refusals ────────────────────────────────────────────────────────

test("an empty identifier closes nothing at all", async () => {
  // The failure this guards is total: an empty address falling through to a
  // query with no constraint would close and redact the entire support queue.
  const r = row({email: "parent@example.com", status: "pending"});
  const db = fakeDb([r]);
  for (const empty of ["", "   ", null, undefined]) {
    assert.strictEqual(await closeDeletionRequests(db, empty, ts), 0);
    assert.strictEqual(await closeDeletionRequestsByEmailHash(db, empty, ts), 0);
  }
  assert.deepStrictEqual(r.written, {});
  assert.strictEqual(db.queries.length, 0, "no query should even be issued");
});

test("an empty queue is 0, not a throw", async () => {
  assert.strictEqual(await closeDeletionRequests(fakeDb([]), "a@b.com", ts), 0);
  assert.strictEqual(await closeDeletionRequestsByEmailHash(fakeDb([]), hashEmail("a@b.com"), ts), 0);
});

Promise.all(pending).then(() => {
  console.log(`\n  ${passed} deletion-request closure tests passed`);
});
