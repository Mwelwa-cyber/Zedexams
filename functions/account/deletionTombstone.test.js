/**
 * The account-deletion tombstone, and the race it closes.
 *
 * Run: node functions/account/deletionTombstone.test.js
 *
 * The interesting test is the last one: it replays the actual production
 * sequence — purge removes users/{uid}, the client's listener notices and calls
 * bootstrapUserProfile mid-purge, the Auth user still exists — and asserts the
 * profile does NOT come back. It is written against the tombstone helpers
 * rather than the handler (the handler needs an initialised firebase-admin),
 * and it fails if the guard is removed, which is checked explicitly below.
 */
const assert = require("node:assert");
const {
  DELETION_TOMBSTONES,
  markDeletionStarted,
  markDeletionComplete,
  isDeleting,
} = require("./deletionTombstone");

const FieldValue = {serverTimestamp: () => "SERVER_TS"};

/** Minimal Firestore double: one collection of docs, plus failure injection. */
function fakeDb({failReads = false} = {}) {
  const docs = new Map();
  return {
    docs,
    collection(name) {
      assert.strictEqual(name, DELETION_TOMBSTONES, `unexpected collection ${name}`);
      return {
        doc(id) {
          return {
            async set(data, opts) {
              const prev = opts?.merge ? (docs.get(id) || {}) : {};
              docs.set(id, {...prev, ...data});
            },
            async get() {
              if (failReads) throw new Error("firestore unavailable");
              return {exists: docs.has(id), data: () => docs.get(id)};
            },
          };
        },
      };
    },
  };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

/** Remove `//` and block comments, string-aware so a `//` inside a literal survives. */
function stripComments(text) {
  let out = "";
  let inString = null;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === "\\") { out += text[i + 1] ?? ""; i += 1; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") { inString = ch; out += ch; continue; }
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      i = nl === -1 ? text.length : nl - 1;
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    out += ch;
  }
  return out;
}

test("a fresh uid has no tombstone", async () => {
  const db = fakeDb();
  assert.strictEqual(await isDeleting(db, "uid-1"), false);
});

test("markDeletionStarted makes isDeleting true", async () => {
  const db = fakeDb();
  await markDeletionStarted(db, "uid-1", {FieldValue});
  assert.strictEqual(await isDeleting(db, "uid-1"), true);
  assert.strictEqual(db.docs.get("uid-1").status, "in_progress");
});

test("a COMPLETED deletion still refuses — the tombstone is permanent", async () => {
  // A client waking an hour later with a still-valid cached token must not be
  // able to rebuild the profile either. "Deletion finished, tombstone cleared"
  // would re-open exactly the window this closes.
  const db = fakeDb();
  await markDeletionStarted(db, "uid-1", {FieldValue});
  await markDeletionComplete(db, "uid-1", {FieldValue});
  assert.strictEqual(db.docs.get("uid-1").status, "complete");
  assert.strictEqual(await isDeleting(db, "uid-1"), true);
});

test("one uid's tombstone does not affect another", async () => {
  // Deletion mints a NEW uid on re-registration, even for the same email, so a
  // returning user is never blocked by their own past deletion.
  const db = fakeDb();
  await markDeletionStarted(db, "old-uid", {FieldValue});
  assert.strictEqual(await isDeleting(db, "new-uid"), false);
});

test("an unreadable tombstone fails CLOSED", async () => {
  // Declining a genuine repair costs a retry. Missing a tombstone resurrects a
  // deleted account. Those are not comparable, so an error is never read as
  // "no tombstone".
  const db = fakeDb({failReads: true});
  assert.strictEqual(await isDeleting(db, "uid-1"), true);
});

test("a missing uid fails CLOSED", async () => {
  assert.strictEqual(await isDeleting(fakeDb(), ""), true);
  assert.strictEqual(await isDeleting(fakeDb(), undefined), true);
});

test("markDeletionStarted refuses without a uid or FieldValue", async () => {
  await assert.rejects(() => markDeletionStarted(fakeDb(), "", {FieldValue}), /uid is required/);
  await assert.rejects(() => markDeletionStarted(fakeDb(), "u", {}), /FieldValue/);
});

test("REGRESSION: the profile is not resurrected mid-purge", async () => {
  // Replays the production sequence, in order, with the timings observed
  // (resurrecting call landed +5s, +5s and +2s into a 21-25s purge).
  const db = fakeDb();
  const uid = "uid-deleting";
  const users = new Map([[uid, {role: "learner"}]]);
  const authUsers = new Set([uid]); // Auth user still exists during the purge.

  // The bootstrap handler's decision, as the handler makes it.
  const bootstrapWouldCreate = async () => {
    if (users.has(uid)) return false;              // profile present, no repair
    if (await isDeleting(db, uid)) return false;   // ← the guard under test
    return authUsers.has(uid);                     // getUser(uid) still succeeds
  };

  // deleteMyAccount: tombstone, then purge.
  await markDeletionStarted(db, uid, {FieldValue});
  users.delete(uid);                                // purge removes users/{uid}

  // +5s: the client's profile listener sees the document vanish and calls
  // bootstrapUserProfile to "repair" it.
  assert.strictEqual(await bootstrapWouldCreate(), false,
    "profile was resurrected during the purge");

  // Purge finishes; Auth user deleted; tombstone closed.
  authUsers.delete(uid);
  await markDeletionComplete(db, uid, {FieldValue});

  // A late retry on a stale-but-valid token must also be refused.
  assert.strictEqual(await bootstrapWouldCreate(), false,
    "profile was resurrected after the deletion completed");
  assert.strictEqual(users.has(uid), false);
});

test("CONTROL: without the tombstone check, the same sequence DOES resurrect", async () => {
  // Proves the regression test above is load-bearing rather than decorative —
  // remove the guard and it reproduces the original bug.
  const db = fakeDb();
  const uid = "uid-deleting";
  const users = new Map([[uid, {role: "learner"}]]);
  const authUsers = new Set([uid]);

  const bootstrapWithoutGuard = async () => {
    if (users.has(uid)) return false;
    return authUsers.has(uid); // the pre-fix handler: only checks Auth
  };

  await markDeletionStarted(db, uid, {FieldValue});
  users.delete(uid);
  assert.strictEqual(await bootstrapWithoutGuard(), true,
    "control failed: the unguarded handler should have resurrected the profile");
});

test("the HANDLERS are actually wired to the tombstone", () => {
  // The tests above prove the helper works; they do not prove anything calls
  // it. The handlers cannot be driven here (they need an initialised
  // firebase-admin), so the wiring is asserted against the source — which is
  // what a future refactor quietly dropping the guard would break.
  const fs = require("node:fs");
  const raw = fs.readFileSync(require.resolve("./accountCallableHandlers.js"), "utf8");
  // Strip comments first. The comment explaining this very race quotes
  // `admin.auth().getUser(uid)` verbatim, so an unstripped scan matched the
  // PROSE and reported the guard as mis-ordered while the code was correct —
  // the same reason scripts/lib/functionsManifest.mjs strips before parsing.
  const src = stripComments(raw);

  const bootstrap = src.slice(src.indexOf("bootstrapUserProfile:"), src.indexOf("deleteMyAccount:"));
  assert.ok(/isDeleting\(/.test(bootstrap),
    "bootstrapUserProfile no longer consults the tombstone — the resurrection race is re-opened");
  assert.ok(
    bootstrap.indexOf("isDeleting(") < bootstrap.indexOf("admin.auth().getUser("),
    "the tombstone must be checked BEFORE getUser — after it, the profile is already being rebuilt",
  );

  const del = src.slice(src.indexOf("deleteMyAccount:"));
  assert.ok(/markDeletionStarted\(/.test(del), "deleteMyAccount no longer writes a tombstone");
  assert.ok(
    del.indexOf("markDeletionStarted(") < del.indexOf("purgeUserData("),
    "the tombstone must be written BEFORE the purge, or it lands after the race it prevents",
  );
  assert.ok(/revokeRefreshTokens\(/.test(del), "deleteMyAccount no longer revokes refresh tokens");
  assert.ok(/resurrectedProfileRemoved/.test(del),
    "deleteMyAccount no longer re-checks for a resurrected profile");
});

(async () => {
  let passed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      passed += 1;
    } catch (err) {
      console.error(`✗ ${name}`);
      console.error(`  ${err.message}`);
      process.exit(1);
    }
  }
  console.log(`deletion tombstone: ${passed} passed`);
})();
