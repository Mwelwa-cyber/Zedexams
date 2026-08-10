// Unit tests for functions/authGuard.js — the shared callable/HTTP guard.
// Focus: the P0 suspended-account enforcement added to assertVerifiedAuth /
// assertDecodedVerified / assertActiveAccount, plus the existing verified +
// unverified/grace behaviour and the fail-open-on-read-error contract.
//
// Run: node functions/authGuard.test.js  (wired as npm run test:auth-guard)
//
// firebase-admin + firebase-functions/v2/https are stubbed via Module._load
// before authGuard.js loads (same pattern as aiBudgetEnforcement.test.js).

const assert = require("node:assert");
const Module = require("node:module");

let userStore = {};
let jobStore = {};
let getShouldThrow = false;

const storeFor = (col) => (col === "accountPurgeJobs" ? jobStore : userStore);

const snapFor = (col, uid) => {
  const store = storeFor(col);
  const has = Object.prototype.hasOwnProperty.call(store, uid);
  const data = has ? store[uid] : undefined;
  return { exists: data !== undefined && data !== null, data: () => data };
};

const db = {
  doc(path) {
    const [col, uid] = String(path).split("/");
    return {
      _col: col,
      _uid: uid,
      async get() {
        if (getShouldThrow) throw new Error("firestore unavailable");
        return snapFor(col, uid);
      },
    };
  },
  // assertActiveAccount reads the user doc and the deletion tombstone in ONE
  // round trip, so the stub has to model getAll rather than doc().get().
  async getAll(...refs) {
    if (getShouldThrow) throw new Error("firestore unavailable");
    return refs.map((r) => snapFor(r._col, r._uid));
  },
};
const firestoreFn = () => db;
const adminStub = {
  firestore: firestoreFn,
  auth: () => ({ revokeRefreshTokens: async () => {} }),
};

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") return adminStub;
  if (request === "firebase-functions/v2/https") {
    return { HttpsError, onCall: (opts, handler) => handler };
  }
  return origLoad.call(this, request, ...rest);
};

const {
  assertVerifiedAuth,
  assertDecodedVerified,
  assertActiveAccount,
} = require("./authGuard");

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`  FAIL ${name}`);
    console.log(`       ${err.message}`);
  }
}

const req = (uid, { verified = true } = {}) => ({
  auth: { uid, token: { email: `${uid}@test.com`, email_verified: verified } },
});
const graceUntilFuture = () => ({ toMillis: () => Date.now() + 3600_000 });

async function main() {
  // ── active / legacy / missing-doc pass paths ──────────────────
  await test("active account passes and returns the uid", async () => {
    userStore = { u_active: { role: "learner", status: "active" } };
    const uid = await assertVerifiedAuth(req("u_active"));
    assert.strictEqual(uid, "u_active");
  });

  await test("legacy account with no status field passes (absence == active)", async () => {
    userStore = { u_legacy: { role: "learner" } };
    assert.strictEqual(await assertVerifiedAuth(req("u_legacy")), "u_legacy");
  });

  await test("verified caller with no user doc yet passes (bootstrap repair path)", async () => {
    userStore = {};
    assert.strictEqual(await assertVerifiedAuth(req("u_nodoc")), "u_nodoc");
  });

  // ── a deletion in flight closes the callable surface ───────────

  await test("a caller whose deletion tombstone exists is rejected, even with a valid token", async () => {
    // The window: revokeRefreshTokens stops new tokens being minted, but one
    // already held in another tab stays valid for up to an hour.
    userStore = { u_del: { status: "active" } };
    jobStore = { u_del: { status: "pending", phase: "irreversible" } };
    await assert.rejects(assertVerifiedAuth(req("u_del")), (e) => e.code === "failed-precondition");
  });

  await test("the tombstone is checked even after the purge deleted the user doc", async () => {
    // This is the case the status field CANNOT cover: no users/{uid} at all, so
    // the status read finds nothing and the old guard returned happily.
    userStore = {};
    jobStore = { u_gone: { status: "pending", phase: "irreversible" } };
    await assert.rejects(assertVerifiedAuth(req("u_gone")), (e) => e.code === "failed-precondition");
  });

  await test("a CANCELLED tombstone does not lock the account out", async () => {
    // The deletion aborted before anything was destroyed; the account lives.
    userStore = { u_cancel: { status: "active" } };
    jobStore = { u_cancel: { status: "cancelled" } };
    assert.strictEqual(await assertVerifiedAuth(req("u_cancel")), "u_cancel");
  });

  await test("a Firestore blip still fails OPEN — availability beats the bounded window", async () => {
    userStore = {};
    jobStore = { u_blip: { status: "pending" } };
    getShouldThrow = true;
    try {
      assert.strictEqual(await assertVerifiedAuth(req("u_blip")), "u_blip");
    } finally {
      getShouldThrow = false;
    }
  });

  // ── suspended / deleted are rejected ──────────────────────────
  await test("suspended account is rejected with reason account-suspended", async () => {
    userStore = { u_susp: { role: "learner", status: "suspended" } };
    await assert.rejects(assertVerifiedAuth(req("u_susp")), (err) => {
      assert.strictEqual(err.code, "permission-denied");
      assert.strictEqual(err.details?.reason, "account-suspended");
      return true;
    });
  });

  await test("deleted account is rejected", async () => {
    userStore = { u_del: { role: "learner", status: "deleted" } };
    await assert.rejects(assertVerifiedAuth(req("u_del")), (err) => {
      assert.strictEqual(err.details?.reason, "account-suspended");
      return true;
    });
  });

  await test("assertActiveAccount alone throws for a suspended uid", async () => {
    userStore = { u_susp2: { status: "suspended" } };
    await assert.rejects(assertActiveAccount("u_susp2"), (err) => {
      assert.strictEqual(err.details?.reason, "account-suspended");
      return true;
    });
  });

  await test("assertDecodedVerified (HTTP path) rejects a suspended account", async () => {
    userStore = { u_http: { status: "suspended", email_verified: true } };
    await assert.rejects(
      assertDecodedVerified({ uid: "u_http", email: "u_http@test.com", email_verified: true }),
      (err) => {
        assert.strictEqual(err.details?.reason, "account-suspended");
        return true;
      },
    );
  });

  // ── unauth / unverified still enforced (regressions) ──────────
  await test("missing auth.uid throws unauthenticated", async () => {
    await assert.rejects(assertVerifiedAuth({}), (err) => {
      assert.strictEqual(err.code, "unauthenticated");
      return true;
    });
  });

  await test("unverified email with no grace throws email-unverified", async () => {
    userStore = { u_unv: { role: "learner" } };
    await assert.rejects(assertVerifiedAuth(req("u_unv", { verified: false })), (err) => {
      assert.strictEqual(err.details?.reason, "email-unverified");
      return true;
    });
  });

  await test("unverified email WITHIN grace passes when active", async () => {
    userStore = { u_grace: { role: "learner", verificationGraceUntil: graceUntilFuture() } };
    assert.strictEqual(await assertVerifiedAuth(req("u_grace", { verified: false })), "u_grace");
  });

  await test("unverified+grace but SUSPENDED is still rejected", async () => {
    userStore = {
      u_grace_susp: { status: "suspended", verificationGraceUntil: graceUntilFuture() },
    };
    await assert.rejects(assertVerifiedAuth(req("u_grace_susp", { verified: false })), (err) => {
      assert.strictEqual(err.details?.reason, "account-suspended");
      return true;
    });
  });

  // ── fail-open on transient read error (availability) ──────────
  await test("status read error fails OPEN (does not lock out the platform)", async () => {
    userStore = { u_active2: { status: "active" } };
    getShouldThrow = true;
    try {
      assert.strictEqual(await assertVerifiedAuth(req("u_active2")), "u_active2");
    } finally {
      getShouldThrow = false;
    }
  });

  console.log("");
  console.log(`─── ${passed + failures.length} tests · ${passed} passed · ${failures.length} failed ───`);
  if (failures.length > 0) {
    failures.forEach((f) => console.log(`  × ${f.name}\n    ${f.message}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
