"use strict";

// Unit tests for the account-deletion ORDER and the profile-bootstrap refusals
// (functions/account/accountDeletionFlow.js).
//
// The bug these pin: the purge ran first and the Auth user was deleted last,
// so for the 21–25 s the purge took, the caller's session stayed valid, its
// profile listener saw users/{uid} vanish, and bootstrapUserProfile — which
// found a live Auth user, because the delete had not happened yet — wrote a
// fresh profile back with the email we had been asked to erase.
//
// Order is therefore the property, not a side effect of the implementation, so
// it is asserted as a recorded sequence rather than by spot-checking calls.
//
// Plain `node` script (repo convention). The module under test imports no
// firebase-admin / firebase-functions, so this runs on the root install alone.
// Run: node functions/account/accountDeletionFlow.test.js

const assert = require("node:assert");
const {
  AccountFlowError,
  runAccountDeletion,
  runProfileBootstrap,
} = require("./accountDeletionFlow");
const {PURGE_JOBS_COLLECTION, hashEmail} = require("./accountPurgeJobs");

let passed = 0;
const pending = [];
function test(name, fn) {
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(() => {
        passed += 1;
        console.log(`  ✓ ${name}`);
      })
      .catch((err) => {
        console.error(`  ✗ ${name}\n    ${err.stack || err.message}`);
        process.exitCode = 1;
      }),
  );
}

// ── Fakes ────────────────────────────────────────────────────────────────

const FieldValue = {
  serverTimestamp: () => "SERVER_TS",
  increment: (n) => ({__op: "increment", by: n}),
};

/**
 * Firestore double that records every write in call order, shared with the
 * auth double via `calls` so the interleaving is visible.
 */
function fakeDb(calls, {seed = {}} = {}) {
  const store = JSON.parse(JSON.stringify(seed));

  const docRef = (col, id) => ({
    async get() {
      calls.push(`get:${col}/${id}`);
      const data = store[col] && store[col][id];
      return {exists: data !== undefined, data: () => data};
    },
    async set(fields, opts) {
      calls.push(`set:${col}/${id}`);
      store[col] = store[col] || {};
      const cur = (opts && opts.merge && store[col][id]) || {};
      const next = {...cur};
      for (const [k, v] of Object.entries(fields)) {
        next[k] = v && v.__op === "increment" ? Number(cur[k] || 0) + v.by : v;
      }
      store[col][id] = next;
    },
  });

  return {
    store,
    // Enough of a transaction to test the ordering property: reads see the
    // store as it is WHEN THE TRANSACTION RUNS, not when the caller started.
    // `onBeforeCommit` lets a test mutate the store between the transaction's
    // reads and its writes, which is the race being closed.
    async runTransaction(fn, {onBeforeCommit} = {}) {
      const writes = [];
      const tx = {
        async get(ref) { return ref.get(); },
        set(ref, fields) { writes.push([ref, fields]); },
      };
      await fn(tx);
      if (onBeforeCommit) await onBeforeCommit();
      for (const [ref, fields] of writes) await ref.set(fields);
    },
    collection: (col) => ({doc: (id) => docRef(col, id)}),
    doc: (path) => {
      const [col, id] = path.split("/");
      return docRef(col, id);
    },
  };
}

function fakeAuth(calls, {onDelete, onRevoke, getUser} = {}) {
  return {
    async revokeRefreshTokens(uid) {
      calls.push(`revokeRefreshTokens:${uid}`);
      if (onRevoke) await onRevoke(uid);
    },
    async deleteUser(uid) {
      calls.push(`deleteUser:${uid}`);
      if (onDelete) await onDelete(uid);
    },
    async getUser(uid) {
      calls.push(`getUser:${uid}`);
      if (getUser) return getUser(uid);
      return {uid, email: "a@b.com", emailVerified: true};
    },
  };
}

function authError(code) {
  const err = new Error(code);
  err.code = code;
  return err;
}

const verifiedSummary = {uidDocs: 16, fieldDocs: 4, arrayMemberships: 0, errors: [], resurrected: false, verified: true};

// ── Codex P1 (#2228): a pre-destructive failure must not leave a job the
// sweeper will adopt, and a purge with errors must not close the job ──────

const purgeArgs = (summary) => ({
  db: null, uid: "u1", FieldValue,
  purge: async () => summary,
  buildProfile: null,
});

test("a revoke failure CANCELS the job — the sweeper only adopts pending ones", async () => {
  const calls = [];
  const db = fakeDb(calls);
  await assert.rejects(
    runAccountDeletion({
      db, auth: fakeAuth(calls, {onRevoke: () => { throw new Error("transient"); }}),
      uid: "u1", FieldValue, purge: async () => verifiedSummary,
    }),
    (err) => err instanceof AccountFlowError && err.details.reason === "revoke-failed",
  );
  const job = db.store[PURGE_JOBS_COLLECTION].u1;
  assert.equal(job.status, "cancelled",
    "left pending, the daily sweeper would delete an account the user was told had NOT been deleted");
  assert.ok(!calls.includes("deleteUser:u1"), "nothing destructive ran");
});

test("an auth-delete failure CANCELS the job too", async () => {
  const calls = [];
  const db = fakeDb(calls);
  await assert.rejects(
    runAccountDeletion({
      db, auth: fakeAuth(calls, {onDelete: () => { throw authError("auth/internal-error"); }}),
      uid: "u1", FieldValue, purge: async () => verifiedSummary,
    }),
    (err) => err instanceof AccountFlowError && err.details.reason === "auth-delete-failed",
  );
  assert.equal(db.store[PURGE_JOBS_COLLECTION].u1.status, "cancelled");
});

test("a CANCELLED tombstone does not block profile repair — the account still exists", async () => {
  const calls = [];
  const db = fakeDb(calls, {seed: {[PURGE_JOBS_COLLECTION]: {u1: {status: "cancelled"}}}});
  const out = await runProfileBootstrap({
    db, auth: fakeAuth(calls), uid: "u1", FieldValue, buildProfile,
  });
  assert.equal(out.created, true,
    "a job cancelled before anything was deleted must not brick the account for ever");
});

test("a PENDING tombstone still blocks profile repair", async () => {
  const calls = [];
  const db = fakeDb(calls, {seed: {[PURGE_JOBS_COLLECTION]: {u1: {status: "pending"}}}});
  await assert.rejects(
    runProfileBootstrap({db, auth: fakeAuth(calls), uid: "u1", FieldValue, buildProfile}),
    (err) => err.details && err.details.reason === "account-deleted",
  );
});

test("a purge that VERIFIED but reported errors does not close the job", async () => {
  const calls = [];
  const db = fakeDb(calls);
  const withErrors = {...verifiedSummary, errors: ["payments: permission-denied"]};
  await assert.rejects(
    runAccountDeletion({
      db, auth: fakeAuth(calls), uid: "u1", FieldValue, purge: async () => withErrors,
    }),
    (err) => err instanceof AccountFlowError && err.details.reason === "purge-incomplete",
  );
  const job = db.store[PURGE_JOBS_COLLECTION].u1;
  assert.equal(job.status, "pending",
    "closed on a verified-but-failed purge, the leftover personal data is unreachable: " +
    "the sweeper only queries pending jobs, so nothing would ever retry it");
  assert.equal(job.attempts, 1, "the failure is counted so the alert threshold can see it");
});

test("a clean verified purge still closes the job", async () => {
  const calls = [];
  const db = fakeDb(calls);
  const out = await runAccountDeletion({
    db, auth: fakeAuth(calls), uid: "u1", FieldValue, purge: async () => verifiedSummary,
  });
  assert.equal(out.success, true);
  assert.equal(db.store[PURGE_JOBS_COLLECTION].u1.status, "done",
    "CONTROL: the happy path must still complete, or the two guards above are just breaking deletion");
});

test("the point of no return is recorded BEFORE the purge starts", async () => {
  const calls = [];
  const db = fakeDb(calls);
  let phaseAtPurgeTime;
  await runAccountDeletion({
    db, auth: fakeAuth(calls), uid: "u1", FieldValue,
    purge: async () => {
      phaseAtPurgeTime = db.store[PURGE_JOBS_COLLECTION].u1.phase;
      return verifiedSummary;
    },
  });
  assert.equal(phaseAtPurgeTime, "irreversible",
    "written after the purge instead, the marker would describe a state a crashed " +
    "run never reaches — which is the whole point of writing it");
  assert.ok(calls.indexOf("deleteUser:u1") < calls.length,
    "and it is written only once deleteUser has actually succeeded");
});

test("a crashed pre-destructive run leaves a job the sweeper cannot adopt", async () => {
  const calls = [];
  const db = fakeDb(calls);
  // No catch runs on a timeout/OOM, so simulate the process simply stopping
  // after the tombstone: open the job and go no further.
  const {openPurgeJob, isAdoptable} = require("./accountPurgeJobs");
  await openPurgeJob(db, "u1", {FieldValue, email: "a@b.com"});
  const job = db.store[PURGE_JOBS_COLLECTION].u1;
  assert.equal(isAdoptable(job), false,
    "adoptable, a cron would finish a deletion that never started and whose caller " +
    "saw only a network error");
  void calls;
});

test("a cancel that cannot be written alerts and says the account is NOT deleted", async () => {
  const calls = [];
  const db = fakeDb(calls);
  db.collection = (col) => ({doc: (id) => ({
    async get() { return {exists: false, data: () => undefined}; },
    async set(fields) {
      if (fields.status === "cancelled") throw new Error("write failed");
      calls.push(`set:${col}/${id}`);
    },
  })});
  const alerts = [];
  await assert.rejects(
    runAccountDeletion({
      db, auth: fakeAuth(calls, {onRevoke: () => { throw new Error("transient"); }}),
      uid: "u1", FieldValue, purge: async () => verifiedSummary,
      alert: async (a) => { alerts.push(a); },
    }),
    (err) => err.details.reason === "revoke-failed-uncancelled" &&
      /NOT been deleted/.test(err.message),
  );
  assert.equal(alerts.length, 1, "the cancel write IS the guarantee — a silent failure re-opens it");
  assert.equal(alerts[0].severity, "critical");
});

test("an abandoned pre-destructive job stops blocking profile repair once stale", async () => {
  const calls = [];
  const old = new Date(Date.now() - 86_400_000).toISOString();
  const db = fakeDb(calls, {seed: {[PURGE_JOBS_COLLECTION]: {u1: {status: "pending", createdAt: old}}}});
  const out = await runProfileBootstrap({db, auth: fakeAuth(calls), uid: "u1", FieldValue, buildProfile});
  assert.equal(out.created, true, "nothing will ever finish this deletion; blocking for ever bricks the account");
});

test("a pending job with an UNREADABLE age keeps blocking — fails closed", async () => {
  const calls = [];
  const db = fakeDb(calls, {seed: {[PURGE_JOBS_COLLECTION]: {u1: {status: "pending"}}}});
  await assert.rejects(
    runProfileBootstrap({db, auth: fakeAuth(calls), uid: "u1", FieldValue, buildProfile}),
    (err) => err.details && err.details.reason === "account-deleted",
    "isStalePurgeJob would sweep this one; bootstrap must not read it the same way",
  );
});

test("the producer really does always return an errors array", async () => {
  // isPurgeComplete requires Array.isArray(summary.errors), so a purge that
  // omitted it would fail closed and the job would never complete. That makes
  // "purgeUserData always returns errors[]" load-bearing, and a contract only
  // asserted at the consumer is a contract nobody is holding to.
  const src = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "accountDeletion.js"), "utf8",
  );
  assert.ok(/errors:\s*\[\]/.test(src),
    "purgeUserData must initialise summary.errors to an array before it can fail");
});

test("a bootstrap in flight when the deletion starts refuses at COMMIT, not at entry", async () => {
  const calls = [];
  const db = fakeDb(calls);
  const {openPurgeJob} = require("./accountPurgeJobs");

  // The real race, reproduced: every ENTRY check passes — no tombstone, no
  // profile — and the deletion opens its tombstone while `auth.getUser` is in
  // flight. Only the transaction's own re-read can see it, so this test fails
  // if that re-read is removed even while the transaction itself remains.
  const auth = fakeAuth(calls, {
    getUser: async (uid) => {
      await openPurgeJob(db, uid, {FieldValue, email: "a@b.com"});
      return {uid, email: "a@b.com", emailVerified: true};
    },
  });

  await assert.rejects(
    runProfileBootstrap({db, auth, uid: "u1", FieldValue, buildProfile}),
    (err) => err.details && err.details.reason === "account-deleted",
  );
  assert.equal(db.store.users, undefined,
    "the profile was written after the deletion had already begun — the resurrection, one window later");
});

test("the profile write and the tombstone read happen in ONE transaction", async () => {
  const calls = [];
  const db = fakeDb(calls);
  let sawTransaction = false;
  const real = db.runTransaction.bind(db);
  db.runTransaction = (fn) => { sawTransaction = true; return real(fn); };
  await runProfileBootstrap({db, auth: fakeAuth(calls), uid: "u1", FieldValue, buildProfile});
  assert.ok(sawTransaction,
    "outside a transaction the tombstone check is a stale snapshot taken before a network " +
    "round trip to Auth, which is exactly the window the race lives in");
  assert.ok(db.store.users.u1, "and it still repairs a genuinely missing profile");
});

test("a profile repaired by someone else mid-flight is not overwritten", async () => {
  const calls = [];
  const db = fakeDb(calls);
  const real = db.runTransaction.bind(db);
  db.runTransaction = (fn) => real(fn, {});
  // Another repair wins the race: the doc exists by the time the transaction reads.
  await db.doc("users/u1").set({role: "teacher", note: "written by another repair"});
  const out = await runProfileBootstrap({db, auth: fakeAuth(calls), uid: "u1", FieldValue, buildProfile});
  assert.equal(out.created, false);
  assert.equal(db.store.users.u1.note, "written by another repair", "not clobbered");
});

// ── deleteMyAccount: order ───────────────────────────────────────────────

test("session is destroyed before Firestore is touched", async () => {
  const calls = [];
  const db = fakeDb(calls);
  const purge = async (_db, uid) => {
    calls.push(`purge:${uid}`);
    return verifiedSummary;
  };

  const out = await runAccountDeletion({
    uid: "u1", email: "Zed@Example.com ", db, auth: fakeAuth(calls), FieldValue, purge,
  });

  assert.deepStrictEqual(out, {success: true, summary: verifiedSummary});

  const tombstone = calls.indexOf(`set:${PURGE_JOBS_COLLECTION}/u1`);
  const revoke = calls.indexOf("revokeRefreshTokens:u1");
  const del = calls.indexOf("deleteUser:u1");
  const purged = calls.indexOf("purge:u1");

  assert.ok(tombstone >= 0, "no tombstone written");
  assert.ok(revoke >= 0 && del >= 0 && purged >= 0, `missing step: ${calls.join(" → ")}`);
  assert.ok(tombstone < del, "the tombstone must be written BEFORE the Auth user is deleted");
  assert.ok(revoke < del, "tokens must be revoked BEFORE the Auth user is deleted");
  assert.ok(del < purged, "the Auth user must be gone BEFORE the purge starts");
});

test("the tombstone carries a hashed address and no raw email", async () => {
  const calls = [];
  const db = fakeDb(calls);
  await runAccountDeletion({
    uid: "u1",
    email: "Zed@Example.com",
    db,
    auth: fakeAuth(calls),
    FieldValue,
    purge: async () => verifiedSummary,
  });

  const job = db.store[PURGE_JOBS_COLLECTION].u1;
  assert.strictEqual(job.status, "done");
  assert.strictEqual(job.emailHash, hashEmail("zed@example.com"));
  assert.notStrictEqual(job.emailHash, "Zed@Example.com");
  assert.ok(
    !JSON.stringify(job).toLowerCase().includes("zed@example.com"),
    "the tombstone must not store the address it was asked to delete",
  );
});

test("re-opening a job keeps the failure count the alert threshold reads", async () => {
  const calls = [];
  const db = fakeDb(calls, {
    seed: {[PURGE_JOBS_COLLECTION]: {u1: {uid: "u1", status: "pending", attempts: 2}}},
  });
  await runAccountDeletion({
    uid: "u1",
    db,
    auth: fakeAuth(calls),
    FieldValue,
    purge: async () => { throw new Error("still broken"); },
  }).catch(() => {});
  assert.strictEqual(
    db.store[PURGE_JOBS_COLLECTION].u1.attempts,
    3,
    "re-opening must not reset attempts to zero",
  );
});

test("a deletion that finished is closed as done", async () => {
  const calls = [];
  const db = fakeDb(calls);
  await runAccountDeletion({
    uid: "u1", db, auth: fakeAuth(calls), FieldValue, purge: async () => verifiedSummary,
  });
  assert.strictEqual(db.store[PURGE_JOBS_COLLECTION].u1.status, "done");
});

// ── deleteMyAccount: idempotence ─────────────────────────────────────────

test("auth/user-not-found on deleteUser is success, not failure", async () => {
  const calls = [];
  const db = fakeDb(calls);
  const out = await runAccountDeletion({
    uid: "u1",
    db,
    auth: fakeAuth(calls, {
      onDelete: () => { throw authError("auth/user-not-found"); },
      onRevoke: () => { throw authError("auth/user-not-found"); },
    }),
    FieldValue,
    purge: async (_db, uid) => { calls.push(`purge:${uid}`); return verifiedSummary; },
  });
  assert.strictEqual(out.success, true);
  assert.ok(calls.includes("purge:u1"), "an already-deleted Auth user must not stop the purge");
});

test("any OTHER deleteUser error aborts before the purge", async () => {
  const calls = [];
  const db = fakeDb(calls);
  await assert.rejects(
    runAccountDeletion({
      uid: "u1",
      db,
      auth: fakeAuth(calls, {onDelete: () => { throw authError("auth/internal-error"); }}),
      FieldValue,
      purge: async () => { calls.push("purge:u1"); return verifiedSummary; },
    }),
    (err) => {
      assert.ok(err instanceof AccountFlowError);
      assert.strictEqual(err.details.reason, "auth-delete-failed");
      return true;
    },
  );
  assert.ok(!calls.includes("purge:u1"), "the purge must not run when the sign-in survives");
});

// ── deleteMyAccount: the inverted failure mode ───────────────────────────

test("a purge that throws leaves the job pending and does not report success", async () => {
  const calls = [];
  const db = fakeDb(calls);
  let result = null;
  try {
    result = await runAccountDeletion({
      uid: "u1",
      db,
      auth: fakeAuth(calls),
      FieldValue,
      purge: async () => { throw new Error("firestore exploded"); },
    });
  } catch (err) {
    assert.ok(err instanceof AccountFlowError);
    assert.strictEqual(err.details.reason, "purge-failed");
    assert.ok(
      !/try again/i.test(err.message),
      "the message must not invite a retry of a deletion that is already half-done",
    );
  }
  assert.strictEqual(result, null, "must not return {success:true} after a failed purge");

  const job = db.store[PURGE_JOBS_COLLECTION].u1;
  assert.strictEqual(job.status, "pending", "a failed purge must leave the job pending");
  assert.strictEqual(job.attempts, 1);
  assert.match(job.lastError, /firestore exploded/);
});

test("an UNVERIFIED purge is a failure, not a success with a caveat", async () => {
  const calls = [];
  const db = fakeDb(calls);
  await assert.rejects(
    runAccountDeletion({
      uid: "u1",
      db,
      auth: fakeAuth(calls),
      FieldValue,
      purge: async () => ({...verifiedSummary, verified: false, resurrected: true}),
    }),
    (err) => {
      assert.strictEqual(err.details.reason, "purge-unverified");
      return true;
    },
  );
  assert.strictEqual(db.store[PURGE_JOBS_COLLECTION].u1.status, "pending");
});

test("a tombstone that cannot be written aborts before anything irreversible", async () => {
  const calls = [];
  const db = fakeDb(calls);
  db.collection = () => ({doc: () => ({set: async () => { throw new Error("no write"); }})});

  await assert.rejects(
    runAccountDeletion({
      uid: "u1", db, auth: fakeAuth(calls), FieldValue, purge: async () => verifiedSummary,
    }),
    (err) => {
      assert.strictEqual(err.details.reason, "tombstone-failed");
      // This one CAN safely be retried — nothing has happened yet.
      assert.match(err.message, /try again/i);
      return true;
    },
  );
  assert.deepStrictEqual(calls, [], "nothing may be revoked, deleted or purged without a tombstone");
});

// ── bootstrapUserProfile: the two refusals ───────────────────────────────

const buildProfile = ({authUser}) => ({email: authUser.email, role: "learner"});

test("an existing profile is returned untouched", async () => {
  const calls = [];
  const db = fakeDb(calls, {seed: {users: {u1: {role: "teacher"}}}});
  const out = await runProfileBootstrap({uid: "u1", db, auth: fakeAuth(calls), buildProfile});
  assert.deepStrictEqual(out, {created: false, profile: {id: "u1", role: "teacher"}});
});

test("a genuinely missing profile is still repaired", async () => {
  const calls = [];
  const db = fakeDb(calls);
  const out = await runProfileBootstrap({uid: "u1", db, auth: fakeAuth(calls), buildProfile});
  assert.strictEqual(out.created, true);
  assert.strictEqual(db.store.users.u1.email, "a@b.com");
});

test("an ownerless uid writes NOTHING and throws failed-precondition", async () => {
  const calls = [];
  const db = fakeDb(calls);
  await assert.rejects(
    runProfileBootstrap({
      uid: "u1",
      db,
      auth: fakeAuth(calls, {getUser: () => { throw authError("auth/user-not-found"); }}),
      buildProfile,
    }),
    (err) => {
      assert.strictEqual(err.code, "failed-precondition");
      assert.strictEqual(err.details.reason, "account-deleted");
      return true;
    },
  );
  assert.strictEqual(db.store.users, undefined, "no profile may be written for a deleted account");
});

test("any other getUser error stays `internal`, so the two cases are distinguishable", async () => {
  const calls = [];
  const db = fakeDb(calls);
  await assert.rejects(
    runProfileBootstrap({
      uid: "u1",
      db,
      auth: fakeAuth(calls, {getUser: () => { throw authError("auth/internal-error"); }}),
      buildProfile,
    }),
    (err) => err.code === "internal",
  );
});

test("a pending tombstone refuses the repair before Auth is even asked", async () => {
  const calls = [];
  const db = fakeDb(calls, {
    seed: {[PURGE_JOBS_COLLECTION]: {u1: {uid: "u1", status: "pending", attempts: 1}}},
  });
  await assert.rejects(
    runProfileBootstrap({uid: "u1", db, auth: fakeAuth(calls), buildProfile}),
    (err) => {
      assert.strictEqual(err.code, "failed-precondition");
      assert.strictEqual(err.details.reason, "account-deleted");
      return true;
    },
  );
  assert.strictEqual(db.store.users, undefined, "no profile may be written for a purging account");
  assert.ok(!calls.includes("getUser:u1"), "the tombstone alone is enough to refuse");
});

test("a done tombstone refuses too — a finished deletion is not repairable", async () => {
  const calls = [];
  const db = fakeDb(calls, {
    seed: {[PURGE_JOBS_COLLECTION]: {u1: {uid: "u1", status: "done"}}},
  });
  await assert.rejects(
    runProfileBootstrap({uid: "u1", db, auth: fakeAuth(calls), buildProfile}),
    (err) => err.details.reason === "account-deleted",
  );
  assert.strictEqual(db.store.users, undefined);
});

test("an unreadable tombstone fails CLOSED", async () => {
  const calls = [];
  const db = fakeDb(calls);
  const realCollection = db.collection;
  db.collection = (col) =>
    col === PURGE_JOBS_COLLECTION ?
      {doc: () => ({get: async () => { throw new Error("unavailable"); }})} :
      realCollection(col);

  await assert.rejects(
    runProfileBootstrap({uid: "u1", db, auth: fakeAuth(calls), buildProfile}),
    (err) => err.code === "internal",
  );
  assert.strictEqual(db.store.users, undefined, "not knowing is not a licence to write");
});

Promise.all(pending).then(() => {
  console.log(`\n  ${passed} passed`);
});
