// Unit tests for functions/security/resetAdminMfa.js + resetAdminMfaCore.js.
// Stubs firebase-admin + firebase-functions via Module._load. Verifies the
// safety rails, factor removal, session revocation, audit trail, and that no
// sensitive values are logged.
//
// Run: node functions/security/resetAdminMfa.test.js

const assert = require("node:assert");
const Module = require("node:module");

// ── Stubs ────────────────────────────────────────────────────────────────
let userStore = {}; // firestore users/{uid}
let authUsers = {}; // auth getUser(uid)
const calls = { updateUser: [], revoke: [], audit: [], adminAudit: [], userSet: [] };

const db = {
  doc(path) {
    const uid = String(path).split("/")[1];
    return {
      async get() {
        const has = Object.prototype.hasOwnProperty.call(userStore, uid);
        const data = has ? userStore[uid] : undefined;
        return { exists: data !== undefined && data !== null, data: () => data };
      },
      async set(patch) {
        calls.userSet.push({ uid, patch });
      },
      async update() {},
    };
  },
  collection(name) {
    return {
      async add(doc) {
        if (name === "securityAuditLogs") calls.audit.push(doc);
        if (name === "adminAuditLogs") calls.adminAudit.push(doc);
        return { id: "x" };
      },
    };
  },
};
const authApi = {
  async getUser(uid) {
    if (!authUsers[uid]) {
      const err = new Error("no user");
      err.code = "auth/user-not-found";
      throw err;
    }
    return authUsers[uid];
  },
  async updateUser(uid, patch) {
    calls.updateUser.push({ uid, patch });
    return { uid };
  },
  async revokeRefreshTokens(uid) {
    calls.revoke.push(uid);
  },
};
const adminStub = {
  firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => "ts" } }),
  auth: () => authApi,
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

const { resetAdminMfa } = require("./resetAdminMfa");
const { validateResetRequest, targetIsAdministrator } = require("./resetAdminMfaCore");

// Build a callable request from a super-admin caller with an MFA-verified,
// recently-authenticated session.
function callerReq(data, tokenOverrides = {}) {
  return {
    auth: {
      uid: "super1",
      token: {
        email: "super@zedexams.com",
        email_verified: true,
        superAdmin: true,
        role: "superAdmin",
        auth_time: Math.floor(Date.now() / 1000), // recent
        firebase: { sign_in_second_factor: "totp" },
        ...tokenOverrides,
      },
    },
    rawRequest: { headers: { "user-agent": "jest" } },
    data,
  };
}

function reset() {
  userStore = {
    super1: { role: "superAdmin", status: "active" },
    admin2: { role: "admin", status: "active" },
    learner3: { role: "learner", status: "active" },
  };
  authUsers = {
    super1: { uid: "super1", customClaims: { superAdmin: true, role: "superAdmin" }, multiFactor: { enrolledFactors: [{ uid: "f1" }] } },
    admin2: { uid: "admin2", customClaims: { admin: true, role: "admin" }, multiFactor: { enrolledFactors: [{ uid: "f2" }] } },
    learner3: { uid: "learner3", customClaims: { role: "learner" }, multiFactor: { enrolledFactors: [] } },
  };
  calls.updateUser.length = 0;
  calls.revoke.length = 0;
  calls.audit.length = 0;
  calls.adminAudit.length = 0;
  calls.userSet.length = 0;
}

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    reset();
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    failures.push({ name, message: err.message });
    console.log(`  FAIL ${name}: ${err.message}`);
  }
}
async function expectCode(fn, code, reason) {
  try {
    await fn();
  } catch (err) {
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    if (reason) assert.equal(err.details?.reason, reason, `expected reason ${reason}, got ${err.details?.reason}`);
    return err;
  }
  throw new Error(`expected throw ${code}`);
}

(async () => {
  // Pure core checks
  await test("core: missing uid", () =>
    assert.equal(validateResetRequest({ actorUid: "a", targetUid: "", reason: "lost phone" }).code, "invalid-argument"));
  await test("core: short reason", () =>
    assert.equal(validateResetRequest({ actorUid: "a", targetUid: "b", reason: "x" }).code, "invalid-argument"));
  await test("core: self reset forbidden", () => {
    const r = validateResetRequest({ actorUid: "a", targetUid: "a", reason: "lost phone" });
    assert.equal(r.ok, false);
    assert.equal(r.reason, "self-reset-forbidden");
  });
  await test("core: valid passes", () =>
    assert.equal(validateResetRequest({ actorUid: "a", targetUid: "b", reason: "lost phone" }).ok, true));
  await test("core: targetIsAdministrator via claims", () =>
    assert.equal(targetIsAdministrator({ claims: { admin: true } }), true));
  await test("core: targetIsAdministrator via firestore role", () =>
    assert.equal(targetIsAdministrator({ claims: {}, firestoreRole: "superAdmin" }), true));
  await test("core: learner target not admin", () =>
    assert.equal(targetIsAdministrator({ claims: { role: "learner" }, firestoreRole: "learner" }), false));

  // Callable: a plain admin caller cannot reset (requireSuperAdmin)
  await test("plain admin caller is rejected", async () => {
    await expectCode(
      () =>
        resetAdminMfa({
          auth: {
            uid: "admin2",
            token: {
              email: "a@x.com",
              email_verified: true,
              admin: true,
              role: "admin",
              auth_time: Math.floor(Date.now() / 1000),
              firebase: { sign_in_second_factor: "totp" },
            },
          },
          data: { uid: "admin2b", reason: "lost phone" },
        }),
      "permission-denied",
    );
  });

  // Callable: super admin without a second factor is rejected (enforce default)
  await test("super admin without MFA is rejected", async () => {
    await expectCode(
      () => resetAdminMfa(callerReq({ uid: "admin2", reason: "lost phone" }, { firebase: {} })),
      "failed-precondition",
      "admin-mfa-required",
    );
  });

  // Callable: stale auth_time → requires-recent-login
  await test("stale auth requires recent login", async () => {
    await expectCode(
      () => resetAdminMfa(callerReq({ uid: "admin2", reason: "lost phone" }, { auth_time: 1000 })),
      "failed-precondition",
      "requires-recent-login",
    );
  });

  // Callable: self-reset forbidden
  await test("self-reset forbidden", async () => {
    await expectCode(
      () => resetAdminMfa(callerReq({ uid: "super1", reason: "lost phone" })),
      "failed-precondition",
      "self-reset-forbidden",
    );
  });

  // Callable: reason required
  await test("reason required", async () => {
    await expectCode(() => resetAdminMfa(callerReq({ uid: "admin2", reason: "" })), "invalid-argument");
  });

  // Callable: target must be an admin
  await test("target must be admin", async () => {
    await expectCode(
      () => resetAdminMfa(callerReq({ uid: "learner3", reason: "lost phone" })),
      "failed-precondition",
      "target-not-admin",
    );
  });

  // Callable: not found
  await test("missing target → not-found", async () => {
    await expectCode(() => resetAdminMfa(callerReq({ uid: "ghost", reason: "lost phone" })), "not-found");
  });

  // Happy path: super admin resets admin2
  await test("happy path removes factors, revokes tokens, audits", async () => {
    const res = await resetAdminMfa(callerReq({ uid: "admin2", reason: "lost authenticator device" }));
    assert.equal(res.ok, true);
    assert.equal(res.targetUid, "admin2");
    // factors removed via enrolledFactors:null
    assert.equal(calls.updateUser.length, 1);
    assert.deepEqual(calls.updateUser[0].patch, { multiFactor: { enrolledFactors: null } });
    // sessions revoked
    assert.deepEqual(calls.revoke, ["admin2"]);
    // status mirror written server-side
    assert.equal(calls.userSet[0].patch.mfaEnrolled, false);
    // audit events present
    const events = calls.audit.map((a) => a.eventType);
    assert.ok(events.includes("mfa.reset.requested"));
    assert.ok(events.includes("mfa.factors.removed"));
    assert.ok(events.includes("admin.sessions.revoked"));
    assert.ok(events.includes("mfa.reset.approved"));
    // admin ledger line
    assert.equal(calls.adminAudit.length, 1);
    // NO sensitive values logged anywhere
    const blob = JSON.stringify(calls.audit) + JSON.stringify(calls.adminAudit);
    for (const bad of ["secret", "otpauth", "password", "refreshToken", "idToken", "verificationCode"]) {
      assert.ok(!blob.toLowerCase().includes(bad.toLowerCase()), `audit must not contain ${bad}`);
    }
  });

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exit(1);
})();
