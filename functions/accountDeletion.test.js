"use strict";

// Unit tests for the account-deletion purge (functions/accountDeletion.js).
// Plain `node` assertion script — run via `npm run test:account-deletion`.
// Uses an in-memory fake Firestore so no emulator is needed.

const assert = require("assert");
const {
  UID_DOC_COLLECTIONS,
  FIELD_QUERY_COLLECTIONS,
  ARRAY_MEMBERSHIP_COLLECTIONS,
  purgeUserData,
} = require("./accountDeletion");

// ── Minimal in-memory Firestore double ──────────────────────────────────
function makeFakeDb(seed) {
  const store = JSON.parse(JSON.stringify(seed));
  const recursiveDeleted = [];

  const FieldValue = {
    arrayRemove: (value) => ({__op: "arrayRemove", value}),
  };

  function docRef(col, id) {
    return {
      __col: col,
      __id: id,
      async update(fields) {
        const cur = store[col] && store[col][id];
        if (!cur) return;
        for (const [k, v] of Object.entries(fields)) {
          if (v && v.__op === "arrayRemove") {
            cur[k] = (cur[k] || []).filter((x) => x !== v.value);
          } else {
            cur[k] = v;
          }
        }
      },
      delete() {
        if (store[col]) delete store[col][id];
      },
    };
  }

  function makeQuery(col, filters, lim) {
    return {
      limit: (n) => makeQuery(col, filters, n),
      async get() {
        let rows = Object.entries(store[col] || {}).filter(([, data]) =>
          filters.every(({field, op, val}) => {
            const cell = data[field];
            if (op === "==") return cell === val;
            if (op === "array-contains") {
              return Array.isArray(cell) && cell.includes(val);
            }
            return false;
          }),
        );
        if (lim) rows = rows.slice(0, lim);
        const docs = rows.map(([id, data]) => ({
          id,
          ref: docRef(col, id),
          data: () => data,
        }));
        return {docs, size: docs.length, empty: docs.length === 0};
      },
    };
  }

  return {
    store,
    recursiveDeleted,
    FieldValue,
    collection: (col) => ({
      doc: (id) => docRef(col, id),
      where: (field, op, val) => makeQuery(col, [{field, op, val}]),
    }),
    batch() {
      const ops = [];
      return {
        delete: (ref) => ops.push(ref),
        async commit() {
          ops.forEach((r) => r.delete());
        },
      };
    },
    async recursiveDelete(ref) {
      recursiveDeleted.push(`${ref.__col}/${ref.__id}`);
      if (store[ref.__col]) delete store[ref.__col][ref.__id];
    },
  };
}

// ── Config sanity ───────────────────────────────────────────────────────
(function configShape() {
  assert.ok(UID_DOC_COLLECTIONS.includes("users"), "must purge users/{uid}");
  assert.strictEqual(
    new Set(UID_DOC_COLLECTIONS).size,
    UID_DOC_COLLECTIONS.length,
    "UID_DOC_COLLECTIONS has duplicates",
  );
  for (const c of UID_DOC_COLLECTIONS) {
    assert.strictEqual(typeof c, "string");
    assert.ok(c.length > 0);
  }
  for (const e of FIELD_QUERY_COLLECTIONS) {
    assert.ok(e.collection && e.field, `bad field entry: ${JSON.stringify(e)}`);
  }
  const fieldKeys = FIELD_QUERY_COLLECTIONS.map((e) => `${e.collection}.${e.field}`);
  assert.strictEqual(
    new Set(fieldKeys).size,
    fieldKeys.length,
    "FIELD_QUERY_COLLECTIONS has duplicate collection.field pairs",
  );
  for (const e of ARRAY_MEMBERSHIP_COLLECTIONS) {
    assert.ok(e.collection && e.field);
  }
  console.log("✓ config shape");
})();

// ── purgeUserData: happy path ───────────────────────────────────────────
(async function purgesEverything() {
  const uid = "u1";
  const other = "u2";
  const db = makeFakeDb({
    users: {u1: {email: "a@b.com", displayName: "A"}, u2: {email: "c@d.com"}},
    badges: {u1: {count: 3}},
    learnerStats: {u1: {xp: 100}},
    results: {
      r1: {userId: "u1", score: 5},
      r2: {userId: "u2", score: 9},
      r3: {userId: "u1", score: 7},
    },
    quizzes: {q1: {createdBy: "u1"}, q2: {createdBy: "u2"}},
    payments: {p1: {userId: "u1", phone: "0977"}},
    // Class owned by another teacher; u1 is a member and a pending member.
    classes: {
      c1: {teacherUid: "u2", learners: ["u1", "u3"], pendingLearners: ["u1"]},
      c2: {teacherUid: "u1", learners: ["u3"]},
    },
    assignments: {a1: {teacherUid: "u2", learnerUids: ["u1", "u3"]}},
  });

  const summary = await purgeUserData(db, uid, {FieldValue: db.FieldValue});

  // uid docs gone
  assert.strictEqual(db.store.users.u1, undefined, "users/u1 not deleted");
  assert.ok(db.store.users.u2, "users/u2 wrongly deleted");
  assert.strictEqual(db.store.badges.u1, undefined);
  assert.strictEqual(db.store.learnerStats.u1, undefined);
  assert.ok(db.recursiveDeleted.includes("users/u1"), "users/u1 via recursiveDelete");

  // field-query docs gone, others kept
  assert.strictEqual(db.store.results.r1, undefined);
  assert.strictEqual(db.store.results.r3, undefined);
  assert.ok(db.store.results.r2, "other user's result wrongly deleted");
  assert.strictEqual(db.store.payments.p1, undefined);
  assert.strictEqual(db.store.quizzes.q1, undefined);
  assert.ok(db.store.quizzes.q2);

  // recursive collection (quizzes) went through recursiveDelete
  assert.ok(db.recursiveDeleted.includes("quizzes/q1"), "quizzes/q1 cascaded");

  // class owned by u1 deleted; class owned by u2 keeps its doc but drops u1
  assert.strictEqual(db.store.classes.c2, undefined, "u1-owned class not deleted");
  assert.ok(db.store.classes.c1, "other teacher's class wrongly deleted");
  assert.deepStrictEqual(db.store.classes.c1.learners, ["u3"], "u1 not removed from learners");
  assert.deepStrictEqual(db.store.classes.c1.pendingLearners, [], "u1 not removed from pendingLearners");
  assert.deepStrictEqual(db.store.assignments.a1.learnerUids, ["u3"], "u1 not removed from learnerUids");

  assert.ok(summary.uidDocs >= 3);
  assert.ok(summary.fieldDocs >= 4);
  assert.ok(summary.arrayMemberships >= 3);
  assert.deepStrictEqual(summary.errors, [], `unexpected errors: ${summary.errors}`);
  assert.ok(other === "u2");
  console.log("✓ purgeUserData removes all user data and only that user's data");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ── purgeUserData: resilient to a failing collection ────────────────────
(async function resilientToFailure() {
  const db = makeFakeDb({users: {u1: {email: "a@b.com"}}, results: {r1: {userId: "u1"}}});
  // Make one field query throw; the rest must still run.
  const realCollection = db.collection.bind(db);
  db.collection = (col) => {
    if (col === "results") {
      return {where: () => { throw new Error("boom"); }, doc: () => ({})};
    }
    return realCollection(col);
  };

  const summary = await purgeUserData(db, "u1", {FieldValue: db.FieldValue});
  assert.strictEqual(db.store.users.u1, undefined, "users/u1 must still be deleted");
  assert.ok(
    summary.errors.some((e) => e.includes("results")),
    "the failing collection should be recorded in errors",
  );
  console.log("✓ purgeUserData is best-effort: one failure does not abort the purge");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

// ── input guards ────────────────────────────────────────────────────────
(async function guards() {
  const db = makeFakeDb({});
  await assert.rejects(() => purgeUserData(db, "", {FieldValue: db.FieldValue}), /uid is required/);
  await assert.rejects(() => purgeUserData(db, "u1", {}), /FieldValue/);
  console.log("✓ input guards");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

console.log("All accountDeletion tests passed.");
