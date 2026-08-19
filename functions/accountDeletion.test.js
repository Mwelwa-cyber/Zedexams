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
  evaluateDeletionAuth,
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
      async get() {
        const data = store[col] && store[col][id];
        return {exists: data !== undefined, data: () => data};
      },
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
    // A collection group is modelled as a flat pseudo-collection keyed
    // `__group:<name>`, so the query machinery above serves it unchanged.
    // The real thing spans every subcollection of that name at any depth;
    // what matters for this suite is that the purge ISSUES the query and
    // deletes what comes back.
    collectionGroup: (group) => ({
      where: (field, op, val) => makeQuery(`__group:${group}`, [{field, op, val}]),
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
    // The Daily Quiz attempt (the learner's answers AND the once-a-day lock).
    dailyAttempts: {
      "u1_2026-08-20": {uid: "u1", grade: "7", points: 40},
      "u2_2026-08-20": {uid: "u2", grade: "7", points: 60},
    },
    // The weekly board, reachable only by collection group.
    "__group:entries": {
      lb_u1: {uid: "u1", displayName: "A", points: 230},
      lb_u2: {uid: "u2", displayName: "C", points: 410},
    },
    results: {
      r1: {userId: "u1", score: 5},
      r2: {userId: "u2", score: 9},
      r3: {userId: "u1", score: 7},
    },
    quizzes: {q1: {createdBy: "u1"}, q2: {createdBy: "u2"}},
    payments: {p1: {userId: "u1", phone: "0977"}},
    // LEGAL-004 newly-covered user-owned collections.
    teacherProfiles: {u1: {schoolLevel: "primary"}, u2: {schoolLevel: "secondary"}},
    drafts: {u1: {}, u2: {}},
    parentLinks: {
      pl1: {parentUid: "u1", learnerUid: "u3"}, // u1 is the parent
      pl2: {parentUid: "u4", learnerUid: "u1"}, // u1 is the learner
      pl3: {parentUid: "u4", learnerUid: "u5"}, // unrelated
    },
    familyInviteCodes: {fc1: {learnerUid: "u1", createdBy: "u1"}, fc2: {learnerUid: "u2"}},
    assessmentExports: {ae1: {ownerUid: "u1"}, ae2: {ownerUid: "u2"}},
    teacherLibraryItems: {tl1: {ownerUid: "u1"}, tl2: {ownerUid: "u2"}},
    visualProjects: {vp1: {ownerId: "u1"}, vp2: {ownerId: "u2"}},
    schoolLicences: {sl1: {memberUids: ["u1", "u2"]}, sl2: {memberUids: ["u3"]}},
  });

  const summary = await purgeUserData(db, uid, {FieldValue: db.FieldValue});

  // uid docs gone
  assert.strictEqual(db.store.users.u1, undefined, "users/u1 not deleted");
  assert.ok(db.store.users.u2, "users/u2 wrongly deleted");
  assert.strictEqual(db.store.badges.u1, undefined);
  assert.strictEqual(db.store.learnerStats.u1, undefined);
  assert.ok(db.recursiveDeleted.includes("users/u1"), "users/u1 via recursiveDelete");

  assert.ok(!db.store.dailyAttempts["u1_2026-08-20"], "the learner's daily attempt was purged");
  assert.ok(db.store.dailyAttempts["u2_2026-08-20"], "another learner's attempt was left alone");

  // The weekly-board row is a SUBCOLLECTION doc carrying the learner's
  // display name. It is reachable only by collection group — a
  // `db.collection('leaderboards')` query cannot see it at all — which is
  // how a child's name would otherwise survive their own account deletion.
  assert.ok(
    !db.store["__group:entries"]["lb_u1"],
    "the departing learner's weekly-board entry was purged",
  );
  assert.ok(
    db.store["__group:entries"]["lb_u2"],
    "another learner's board entry was left alone",
  );

  // field-query docs gone, others kept
  assert.strictEqual(db.store.results.r1, undefined);
  assert.strictEqual(db.store.results.r3, undefined);
  assert.ok(db.store.results.r2, "other user's result wrongly deleted");
  assert.strictEqual(db.store.payments.p1, undefined);
  assert.strictEqual(db.store.quizzes.q1, undefined);
  assert.ok(db.store.quizzes.q2);

  // recursive collection (quizzes) went through recursiveDelete
  assert.ok(db.recursiveDeleted.includes("quizzes/q1"), "quizzes/q1 cascaded");

  // LEGAL-004 newly-covered collections: user's rows gone, others kept.
  assert.strictEqual(db.store.teacherProfiles.u1, undefined, "teacherProfiles/u1 not deleted");
  assert.ok(db.store.teacherProfiles.u2, "other teacherProfile wrongly deleted");
  assert.ok(db.recursiveDeleted.includes("teacherProfiles/u1"), "teacherProfiles/u1 cascaded");
  assert.strictEqual(db.store.drafts.u1, undefined, "drafts/u1 not deleted");
  assert.ok(db.recursiveDeleted.includes("drafts/u1"), "drafts/u1 cascaded");
  // parentLinks: rows where EITHER side is u1 are removed; the unrelated one stays.
  assert.strictEqual(db.store.parentLinks.pl1, undefined, "parentLink (u1 as parent) not deleted");
  assert.strictEqual(db.store.parentLinks.pl2, undefined, "parentLink (u1 as learner) not deleted");
  assert.ok(db.store.parentLinks.pl3, "unrelated parentLink wrongly deleted");
  assert.strictEqual(db.store.familyInviteCodes.fc1, undefined, "u1 invite code not deleted");
  assert.ok(db.store.familyInviteCodes.fc2, "other invite code wrongly deleted");
  assert.strictEqual(db.store.assessmentExports.ae1, undefined, "u1 export cache not deleted");
  assert.ok(db.store.assessmentExports.ae2);
  assert.strictEqual(db.store.teacherLibraryItems.tl1, undefined, "u1 teacher library item not deleted");
  assert.ok(db.store.teacherLibraryItems.tl2, "other teacher library item wrongly deleted");
  assert.strictEqual(db.store.visualProjects.vp1, undefined, "u1 visual project not deleted");
  assert.ok(db.store.visualProjects.vp2);
  // schoolLicences: uid pulled from the shared roster, the licence itself kept.
  assert.deepStrictEqual(db.store.schoolLicences.sl1.memberUids, ["u2"], "u1 not removed from licence roster");
  assert.ok(db.store.schoolLicences.sl2, "other licence wrongly touched");

  assert.ok(summary.uidDocs >= 3);
  assert.ok(summary.fieldDocs >= 4);
  // schoolLicences is the only remaining ARRAY_MEMBERSHIP_COLLECTIONS entry —
  // classes.learners / classes.pendingLearners / assignments.learnerUids went
  // with the learner/teacher class feature.
  assert.ok(summary.arrayMemberships >= 1);
  assert.deepStrictEqual(summary.errors, [], `unexpected errors: ${summary.errors}`);
  assert.ok(other === "u2");
  // The purge PROVES users/{uid} is gone rather than assuming its own deletes
  // stuck; nothing recreated the doc here, so nothing was resurrected.
  assert.strictEqual(summary.verified, true, "a clean purge must verify");
  assert.strictEqual(summary.resurrected, false, "nothing recreated the profile here");
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

// ── purgeUserData: the resurrection it exists to catch ──────────────────
//
// The production failure, reproduced: something writes users/{uid} back
// AFTER the purge has deleted it and moved on to the field queries. Before
// the verify step the purge never looked again — it returned errors: [] and
// the handler reported success over a profile that had just been recreated
// with the email we were asked to erase. Three such orphans exist.
(async function catchesResurrection() {
  const db = makeFakeDb({users: {u1: {email: "zedexams@gmail.com"}}, results: {r1: {userId: "u1"}}});

  // Recreate the profile mid-purge, exactly once, the way the profile-repair
  // callable did: after the uid-doc sweep, while the field queries run.
  const realCollection = db.collection.bind(db);
  let resurrections = 1;
  db.collection = (col) => {
    if (col === "results" && resurrections > 0) {
      resurrections -= 1;
      db.store.users.u1 = {email: "zedexams@gmail.com", role: "learner", emailVerified: true};
    }
    return realCollection(col);
  };

  const summary = await purgeUserData(db, "u1", {FieldValue: db.FieldValue});

  assert.strictEqual(summary.resurrected, true, "a recreated profile must be REPORTED, not swallowed");
  assert.strictEqual(summary.verified, true, "and then actually deleted, and proved gone");
  assert.strictEqual(db.store.users.u1, undefined, "the resurrected profile survived the purge");
  console.log("✓ purgeUserData catches a profile recreated mid-purge and re-deletes it");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

// A verification that cannot READ users/{uid} reports verified:false. An
// unverifiable purge is not a verified one — the handler refuses to report
// success on it, which is the whole point of the flag.
(async function unverifiableIsNotVerified() {
  const db = makeFakeDb({users: {u1: {email: "a@b.com"}}});
  const realCollection = db.collection.bind(db);
  db.collection = (col) => {
    if (col === "users") {
      return {
        doc: () => ({get: async () => { throw new Error("read failed"); }}),
        where: () => realCollection(col).where("x", "==", "y"),
      };
    }
    return realCollection(col);
  };

  const summary = await purgeUserData(db, "u1", {FieldValue: db.FieldValue});
  assert.strictEqual(summary.verified, false, "an unreadable users doc must not read as verified");
  assert.ok(summary.errors.some((e) => e.includes("verify users/u1")), "the failure is recorded");
  console.log("✓ purgeUserData reports verified:false when it cannot prove the profile is gone");
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

// ── evaluateDeletionAuth: recent-login (re-auth) step-up gate (LEGAL-003) ─
(function reauthGate() {
  const NOW = 1_700_000_000_000; // fixed clock (ms) — deterministic, no wall-clock
  const nowSec = Math.floor(NOW / 1000);
  const maxAge = 5 * 60;
  const at = (secsAgo) => ({auth_time: nowSec - secsAgo});

  // Fresh sign-in passes.
  assert.strictEqual(
    evaluateDeletionAuth(at(0), {maxAgeSeconds: maxAge, now: NOW}).ok,
    true,
    "a just-authenticated token must be allowed to delete",
  );
  assert.strictEqual(
    evaluateDeletionAuth(at(60), {maxAgeSeconds: maxAge, now: NOW}).ok,
    true,
    "auth_time one minute old is still fresh",
  );

  // Exactly at the window boundary is allowed; one second past is not.
  assert.strictEqual(
    evaluateDeletionAuth(at(maxAge), {maxAgeSeconds: maxAge, now: NOW}).ok,
    true,
    "auth_time exactly at the window edge is allowed",
  );
  const justStale = evaluateDeletionAuth(at(maxAge + 1), {maxAgeSeconds: maxAge, now: NOW});
  assert.strictEqual(justStale.ok, false, "auth_time one second past the window is rejected");
  assert.strictEqual(justStale.reason, "requires-recent-login");

  // A long-persisted / stolen session (old auth_time) is refused.
  const stale = evaluateDeletionAuth(at(3600), {maxAgeSeconds: maxAge, now: NOW});
  assert.strictEqual(stale.ok, false, "an hour-old session must re-authenticate");
  assert.strictEqual(stale.reason, "requires-recent-login");

  // Fail CLOSED: a token with no/invalid auth_time is treated as ancient.
  for (const bad of [{}, {auth_time: 0}, {auth_time: "nope"}, {auth_time: -5}, {auth_time: NaN}]) {
    const r = evaluateDeletionAuth(bad, {maxAgeSeconds: maxAge, now: NOW});
    assert.strictEqual(r.ok, false, `missing/invalid auth_time must fail closed: ${JSON.stringify(bad)}`);
    assert.strictEqual(r.reason, "requires-recent-login");
    assert.strictEqual(r.ageSeconds, Infinity);
  }

  // No token at all → not authenticated.
  for (const noTok of [null, undefined, "token", 42]) {
    const r = evaluateDeletionAuth(noTok, {maxAgeSeconds: maxAge, now: NOW});
    assert.strictEqual(r.ok, false, "a non-object token must be rejected");
    assert.strictEqual(r.reason, "no-auth");
  }

  // A future auth_time (clock skew) clamps to age 0 rather than going negative.
  assert.strictEqual(
    evaluateDeletionAuth({auth_time: nowSec + 30}, {maxAgeSeconds: maxAge, now: NOW}).ok,
    true,
    "slight clock skew (auth_time in the near future) is treated as fresh",
  );

  // Default window is applied when no override is passed.
  assert.strictEqual(
    typeof evaluateDeletionAuth(at(0), {now: NOW}).maxAgeSeconds,
    "number",
    "a default max-age window is resolved when none is supplied",
  );

  console.log("✓ evaluateDeletionAuth enforces a recent re-auth and fails closed");
})();

console.log("All accountDeletion tests passed.");
