// Unit tests for functions/security/requireAdminMfa.js — the composed callable
// guard (verified + active + admin + second-factor). firebase-admin +
// firebase-functions are stubbed via Module._load, same pattern as
// functions/authGuard.test.js.
//
// Run: node functions/security/requireAdminMfa.test.js

const assert = require("node:assert");
const Module = require("node:module");

let userStore = {};

let jobStore = {};
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
      async get() { return snapFor(col, uid); },
    };
  },
  // authGuard.assertActiveAccount reads users/{uid} and accountPurgeJobs/{uid}
  // in one round trip, so the stub models getAll.
  async getAll(...refs) { return refs.map((r) => snapFor(r._col, r._uid)); },
};
const auditWrites = [];
db.collection = () => ({ async add(doc) { auditWrites.push(doc); return { id: "x" }; } });
const adminStub = {
  firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => "ts" } }),
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

const { requireAdminMfa, requireAdminMfaDecoded } = require("./requireAdminMfa");

// Helpers to build a callable request.
function req({ uid = "u1", token = {} } = {}) {
  return { auth: { uid, token: { email: "a@zedexams.com", email_verified: true, ...token } } };
}
const withMfa = { firebase: { sign_in_second_factor: "totp" } };

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}
async function expectCode(fn, code) {
  try {
    await fn();
  } catch (err) {
    assert.equal(err.code, code, `expected ${code}, got ${err.code}`);
    return err;
  }
  throw new Error(`expected throw with code ${code}, but resolved`);
}

(async () => {
  // Unauthenticated
  await test("rejects unauthenticated", async () => {
    await expectCode(() => requireAdminMfa({ auth: null }), "unauthenticated");
  });

  // Teacher (verified) with MFA → still permission-denied (not admin)
  await test("rejects verified teacher even with second factor", async () => {
    userStore = { u1: { role: "teacher", status: "active" } };
    await expectCode(
      () => requireAdminMfa(req({ token: { role: "teacher", ...withMfa } })),
      "permission-denied",
    );
  });

  // Admin without MFA → failed-precondition with reason
  await test("admin without second factor → failed-precondition + reason", async () => {
    userStore = { u1: { role: "admin", status: "active" } };
    const err = await expectCode(
      () => requireAdminMfa(req({ token: { admin: true, role: "admin" } })),
      "failed-precondition",
    );
    assert.equal(err.details?.reason, "admin-mfa-required");
  });

  // Admin with MFA → ok
  await test("admin with second factor → ok", async () => {
    userStore = { u1: { role: "admin", status: "active" } };
    const res = await requireAdminMfa(req({ token: { admin: true, role: "admin", ...withMfa } }));
    assert.equal(res.uid, "u1");
    assert.equal(res.isSuperAdmin, false);
    assert.equal(res.factor, "totp");
    assert.equal(res.mfaSatisfied, true);
  });

  // Monitor mode: admin WITHOUT MFA is allowed through but flagged + audited
  await test("monitor mode allows admin without MFA and records the gap", async () => {
    userStore = { u1: { role: "admin", status: "active" } };
    auditWrites.length = 0;
    const res = await requireAdminMfa(req({ token: { admin: true, role: "admin" } }), {
      enforcement: "monitor",
    });
    assert.equal(res.mfaSatisfied, false);
    assert.equal(res.monitored, true);
    assert.equal(auditWrites.length, 1, "monitor gap should be audited");
    assert.equal(auditWrites[0].outcome, "monitor");
  });

  // Monitor mode still blocks a non-admin
  await test("monitor mode still blocks a non-admin", async () => {
    userStore = { u1: { role: "teacher", status: "active" } };
    await expectCode(
      () => requireAdminMfa(req({ token: { role: "teacher" } }), { enforcement: "monitor" }),
      "permission-denied",
    );
  });

  // Enforce mode: denial is audited
  await test("enforce mode audits the denial", async () => {
    userStore = { u1: { role: "admin", status: "active" } };
    auditWrites.length = 0;
    await expectCode(
      () => requireAdminMfa(req({ token: { admin: true, role: "admin" } }), { enforcement: "enforce" }),
      "failed-precondition",
    );
    assert.equal(auditWrites.length, 1);
    assert.equal(auditWrites[0].outcome, "denied");
  });

  // Suspended admin with MFA → permission-denied (assertVerifiedAuth blocks)
  await test("suspended admin blocked before MFA check", async () => {
    userStore = { u1: { role: "admin", status: "suspended" } };
    await expectCode(
      () => requireAdminMfa(req({ token: { admin: true, role: "admin", ...withMfa } })),
      "permission-denied",
    );
  });

  // Unverified admin → permission-denied (email-unverified)
  await test("unverified admin blocked before MFA check", async () => {
    userStore = { u1: { role: "admin", status: "active" } };
    await expectCode(
      () =>
        requireAdminMfa(req({ token: { admin: true, role: "admin", email_verified: false, ...withMfa } })),
      "permission-denied",
    );
  });

  // Firestore-role fallback: token has NO admin claim (stale, AUTH-M4) but the
  // user doc says admin, and the session used MFA → allowed.
  await test("firestore-role fallback grants admin when claim is stale", async () => {
    userStore = { u1: { role: "admin", status: "active" } };
    const res = await requireAdminMfa(req({ token: { role: "learner", ...withMfa } }));
    assert.equal(res.mfaSatisfied, true);
  });
  // Fallback never bypasses the second-factor requirement.
  await test("firestore-role fallback still requires MFA", async () => {
    userStore = { u1: { role: "admin", status: "active" } };
    await expectCode(
      () => requireAdminMfa(req({ token: { role: "learner" } })),
      "failed-precondition",
    );
  });

  // requireSuperAdmin: plain admin rejected, superAdmin accepted
  await test("requireSuperAdmin rejects plain admin", async () => {
    userStore = { u1: { role: "admin", status: "active" } };
    await expectCode(
      () => requireAdminMfa(req({ token: { admin: true, role: "admin", ...withMfa } }), { requireSuperAdmin: true }),
      "permission-denied",
    );
  });
  await test("requireSuperAdmin accepts superAdmin with MFA", async () => {
    userStore = { u1: { role: "superAdmin", status: "active" } };
    const res = await requireAdminMfa(
      req({ token: { superAdmin: true, role: "superAdmin", ...withMfa } }),
      { requireSuperAdmin: true },
    );
    assert.equal(res.isSuperAdmin, true);
  });

  // Decoded (HTTP) variant
  await test("requireAdminMfaDecoded ok for admin+MFA", async () => {
    userStore = { u1: { role: "admin", status: "active" } };
    const res = await requireAdminMfaDecoded({
      uid: "u1",
      email: "a@zedexams.com",
      email_verified: true,
      admin: true,
      role: "admin",
      ...withMfa,
    });
    assert.equal(res.uid, "u1");
  });
  await test("requireAdminMfaDecoded rejects admin without MFA", async () => {
    userStore = { u1: { role: "admin", status: "active" } };
    await expectCode(
      () =>
        requireAdminMfaDecoded({ uid: "u1", email: "a@x.com", email_verified: true, admin: true, role: "admin" }),
      "failed-precondition",
    );
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
