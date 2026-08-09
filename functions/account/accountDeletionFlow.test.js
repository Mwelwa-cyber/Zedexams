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
