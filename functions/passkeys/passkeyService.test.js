/**
 * Node test for functions/passkeys/passkeyService.js — the Firestore +
 * SimpleWebAuthn shim around passkeyCore's pure decisions. Same in-memory
 * Firestore stub convention as aiOperations.test.js (CI runs `npm ci` at the
 * repo root only, so functions/node_modules does not exist; firebase-admin,
 * firebase-functions, @simplewebauthn/server, and the sibling guards are
 * stubbed via Module._load before the module under test loads).
 *
 * The SimpleWebAuthn stub mimics the library's contract closely enough to
 * exercise OUR logic: it invokes the expectedChallenge callback with the
 * challenge the "client" echoes back, and rejects origins outside
 * expectedOrigin — so challenge-hash comparison, replay, expiry, wrong-origin
 * and uid-resolution paths all run for real.
 *
 * Run: node functions/passkeys/passkeyService.test.js
 */

const assert = require("node:assert");
const Module = require("node:module");

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log(`  ok  ${name}`);
}
async function rejects(name, fn, match) {
  try {
    await fn();
    assert.fail(`expected ${name} to throw`);
  } catch (err) {
    if (match) assert.ok(match(err), `${name}: error did not match — ${err && err.message} ${JSON.stringify(err && err.details)}`);
    passed += 1;
    console.log(`  ok  ${name}`);
  }
}

// ── In-memory Firestore stub ───────────────────────────────────────────────
const SERVER_TS = Symbol("serverTimestamp");
let store = {};

const k = (col, id) => `${col}/${id}`;
const snapFor = (col, id) => {
  const data = store[k(col, id)];
  return {
    exists: data !== undefined,
    id,
    data: () => data,
    ref: makeRef(col, id),
  };
};
function applyUpdate(col, id, data) {
  const key = k(col, id);
  if (store[key] === undefined) throw new Error(`NOT_FOUND: ${key}`);
  store[key] = {...store[key], ...data};
}
function makeRef(col, id) {
  return {
    __col: col, __id: id, id,
    get: async () => snapFor(col, id),
    set: async (data, opts) => {
      const key = k(col, id);
      store[key] = opts && opts.merge ? {...(store[key] || {}), ...data} : {...data};
    },
    update: async (data) => applyUpdate(col, id, data),
    delete: async () => { delete store[k(col, id)]; },
  };
}
function makeQuery(col, field, value) {
  return {
    __query: true, __col: col, __field: field, __value: value,
    get: async () => runQuery(col, field, value),
  };
}
function runQuery(col, field, value) {
  const docs = Object.entries(store)
      .filter(([key]) => key.startsWith(`${col}/`))
      .map(([key, data]) => ({id: key.slice(col.length + 1), data: () => data}))
      .filter((d) => d.data()[field] === value);
  return {docs, empty: docs.length === 0};
}

class AlreadyExistsError extends Error {
  constructor(path) {
    super(`ALREADY_EXISTS: ${path}`);
    this.code = 6;
  }
}

const db = {
  collection: (col) => ({
    doc: (id) => makeRef(col, id),
    where: (field, op, value) => makeQuery(col, field, value),
    add: async (data) => {
      const id = `auto_${Object.keys(store).length}_${Math.floor(Math.random() * 1e6)}`;
      store[k(col, id)] = {...data};
      return makeRef(col, id);
    },
  }),
  doc: (path) => {
    const [col, id] = path.split("/");
    return makeRef(col, id);
  },
  runTransaction: async (fn) => {
    const writes = [];
    const tx = {
      get: async (refOrQuery) => refOrQuery.__query ?
        runQuery(refOrQuery.__col, refOrQuery.__field, refOrQuery.__value) :
        snapFor(refOrQuery.__col, refOrQuery.__id),
      create: (ref, data) => {
        const key = k(ref.__col, ref.__id);
        if (store[key] !== undefined) throw new AlreadyExistsError(key);
        writes.push(() => {
          if (store[key] !== undefined) throw new AlreadyExistsError(key);
          store[key] = {...data};
        });
      },
      update: (ref, data) => writes.push(() => applyUpdate(ref.__col, ref.__id, data)),
      set: (ref, data) => writes.push(() => { store[k(ref.__col, ref.__id)] = {...data}; }),
    };
    const result = await fn(tx);
    writes.forEach((w) => w());
    return result;
  },
};

const mintedTokens = [];
const firestoreFn = () => db;
firestoreFn.FieldValue = {serverTimestamp: () => SERVER_TS};
firestoreFn.Timestamp = {
  fromMillis: (ms) => ({__ms: ms, toMillis: () => ms}),
};

class HttpsError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

// ── SimpleWebAuthn stub ────────────────────────────────────────────────────
let regCounter = 0;
let authCounter = 0;
const webauthnStub = {
  generateRegistrationOptions: async (opts) => ({
    challenge: `reg-challenge-${++regCounter}`,
    rp: {id: opts.rpID, name: opts.rpName},
    user: {
      id: Buffer.from(opts.userID).toString("base64url"),
      name: opts.userName,
    },
    excludeCredentials: opts.excludeCredentials,
    authenticatorSelection: opts.authenticatorSelection,
  }),
  generateAuthenticationOptions: async (opts) => ({
    challenge: `auth-challenge-${++authCounter}`,
    rpId: opts.rpID,
    userVerification: opts.userVerification,
  }),
  verifyRegistrationResponse: async ({response, expectedChallenge, expectedOrigin}) => {
    if (!(await expectedChallenge(response.__challenge))) {
      throw new Error("Custom challenge verifier returned false");
    }
    if (response.__origin && !expectedOrigin.includes(response.__origin)) {
      throw new Error(`Unexpected registration response origin "${response.__origin}"`);
    }
    return {
      verified: true,
      registrationInfo: {
        credential: {
          id: response.id,
          publicKey: new Uint8Array([1, 2, 3, 4]),
          counter: 0,
          transports: ["internal"],
        },
        credentialDeviceType: "multiDevice",
        credentialBackedUp: true,
      },
    };
  },
  verifyAuthenticationResponse: async ({response, expectedChallenge, expectedOrigin, credential}) => {
    if (!(await expectedChallenge(response.__challenge))) {
      throw new Error("Custom challenge verifier returned false");
    }
    if (response.__origin && !expectedOrigin.includes(response.__origin)) {
      throw new Error(`Unexpected authentication response origin "${response.__origin}"`);
    }
    if (response.__badSignature) {
      throw new Error("Signature verification failed");
    }
    return {
      verified: true,
      authenticationInfo: {
        newCounter: response.__newCounter !== undefined ? response.__newCounter : credential.counter,
      },
    };
  },
};

// ── Sibling guard stubs (authGuard reads Firestore; rateLimit is fail-open;
//    both are covered by their own test files) ─────────────────────────────
const authGuardStub = {
  assertVerifiedAuth: async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError("unauthenticated", "Please sign in first.");
    }
    return request.auth.uid;
  },
  assertActiveAccount: async (uid) => {
    const status = store[`users/${uid}`] && store[`users/${uid}`].status;
    if (status === "suspended" || status === "deleted") {
      throw new HttpsError("permission-denied", "Your account has been suspended.");
    }
  },
};
const rateLimitStub = {assertCallableRateLimit: async () => {}};

const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "firebase-admin") {
    return {firestore: firestoreFn, auth: () => ({
      createCustomToken: async (uid) => {
        mintedTokens.push(uid);
        return `custom-token-for-${uid}`;
      },
    })};
  }
  if (request === "firebase-functions/v2/https") return {HttpsError};
  if (request === "@simplewebauthn/server") return webauthnStub;
  if (request.endsWith("authGuard")) return authGuardStub;
  if (request.endsWith("rateLimit")) return rateLimitStub;
  return origLoad.call(this, request, ...rest);
};

const svc = require("./passkeyService");

// passkeyService resolves @simplewebauthn/server LAZILY — on the first passkey
// call rather than at module load — so the library stays off the Cloud
// Functions cold-start path that every one of the ~196 exports pays for (see
// the webauthn() note in passkeyService.js).
//
// That stub therefore has to OUTLIVE the module load. Every other stub above is
// captured into a const while passkeyService is being required, so restoring
// the real loader afterwards is fine for those; this one is required during the
// tests themselves. CI installs only the root workspace (see the header note),
// so falling through to the real loader here is a MODULE_NOT_FOUND, not merely
// a slower test.
Module._load = function (request, ...rest) {
  if (request === "@simplewebauthn/server") return webauthnStub;
  return origLoad.call(this, request, ...rest);
};

// ── Fixtures ───────────────────────────────────────────────────────────────
const NOW_SEC = Math.floor(Date.now() / 1000);
function callerRequest(uid, data = {}, authTimeSec = NOW_SEC) {
  return {
    auth: uid ? {uid, token: {email: `${uid}@example.com`, auth_time: authTimeSec}} : null,
    data,
    rawRequest: {get: () => ""},
  };
}
function enableFlag() {
  store["settings/global"] = {featureFlags: {passkeyAuthenticationEnabled: true}};
}
function auditRows(type) {
  return Object.entries(store)
      .filter(([key, v]) => key.startsWith("passkeyAuditLog/") && v.type === type)
      .map(([, v]) => v);
}

const CRED_A = "credAAAAAAAAAAAAAAAA"; // ≥16 url-safe chars (id shape guard)
const CRED_B = "credBBBBBBBBBBBBBBBB";

async function registerFor(uid, credentialId, name) {
  const opts = await svc.runGeneratePasskeyRegistrationOptions(callerRequest(uid));
  return svc.runVerifyPasskeyRegistration(callerRequest(uid, {
    challengeId: opts.challengeId,
    response: {id: credentialId, __challenge: opts.options.challenge},
    name: name || "",
  }));
}

async function main() {
  // ── Feature flag gating ──────────────────────────────────────────────────
  store = {};
  await rejects("registration options are refused while the flag is off",
      () => svc.runGeneratePasskeyRegistrationOptions(callerRequest("u1")),
      (e) => e.details && e.details.code === "PASSKEY_DISABLED");
  await rejects("authentication options are refused while the flag is off",
      () => svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null)),
      (e) => e.details && e.details.code === "PASSKEY_DISABLED");

  // ── Registration ─────────────────────────────────────────────────────────
  store = {};
  enableFlag();
  store["users/u1"] = {role: "teacher", displayName: "Teacher One"};

  await rejects("signed-out user cannot request registration options",
      () => svc.runGeneratePasskeyRegistrationOptions(callerRequest(null)),
      (e) => e.code === "unauthenticated");

  await rejects("stale session cannot register (recent auth required)",
      () => svc.runGeneratePasskeyRegistrationOptions(
          callerRequest("u1", {}, NOW_SEC - 48 * 3600)),
      (e) => e.details && e.details.code === "PASSKEY_REAUTH_REQUIRED");

  store["users/adm1"] = {role: "admin"};
  await rejects("admin accounts cannot register a passkey (mandatory TOTP MFA)",
      () => svc.runGeneratePasskeyRegistrationOptions(callerRequest("adm1")),
      (e) => e.details && e.details.code === "PASSKEY_ADMIN_MFA_REQUIRED");

  const reg = await registerFor("u1", CRED_A, "My phone");
  ok("authenticated user registers a passkey", reg.passkey && reg.passkey.id === CRED_A);
  ok("registered passkey stores the caller's uid server-side",
      store[`passkeyCredentials/${CRED_A}`].uid === "u1");
  ok("stored public key is base64url, never raw bytes echoed to client",
      typeof store[`passkeyCredentials/${CRED_A}`].publicKey === "string" &&
      !("publicKey" in reg.passkey));
  ok("registration is audited", auditRows("PASSKEY_REGISTERED").length === 1);
  ok("registration audit stores a hash, not the credential id",
      auditRows("PASSKEY_REGISTERED")[0].credentialIdHash !== CRED_A);

  await rejects("duplicate credential id is rejected", async () => {
    const opts = await svc.runGeneratePasskeyRegistrationOptions(callerRequest("u1"));
    await svc.runVerifyPasskeyRegistration(callerRequest("u1", {
      challengeId: opts.challengeId,
      response: {id: CRED_A, __challenge: opts.options.challenge},
    }));
  }, (e) => e.details && e.details.code === "PASSKEY_CREDENTIAL_DUPLICATE");

  await rejects("wrong challenge value is rejected", async () => {
    const opts = await svc.runGeneratePasskeyRegistrationOptions(callerRequest("u1"));
    await svc.runVerifyPasskeyRegistration(callerRequest("u1", {
      challengeId: opts.challengeId,
      response: {id: CRED_B, __challenge: "some-forged-challenge"},
    }));
  }, (e) => e.details && e.details.code === "PASSKEY_VERIFICATION_FAILED");

  await rejects("wrong origin is rejected", async () => {
    const opts = await svc.runGeneratePasskeyRegistrationOptions(callerRequest("u1"));
    await svc.runVerifyPasskeyRegistration(callerRequest("u1", {
      challengeId: opts.challengeId,
      response: {id: CRED_B, __challenge: opts.options.challenge, __origin: "https://evil.example"},
    }));
  }, (e) => e.details && e.details.code === "PASSKEY_VERIFICATION_FAILED");

  await rejects("another user's registration challenge is rejected", async () => {
    store["users/u2"] = {role: "teacher"};
    const opts = await svc.runGeneratePasskeyRegistrationOptions(callerRequest("u2"));
    await svc.runVerifyPasskeyRegistration(callerRequest("u1", {
      challengeId: opts.challengeId,
      response: {id: CRED_B, __challenge: opts.options.challenge},
    }));
  }, (e) => e.details && e.details.code === "PASSKEY_CHALLENGE_INVALID");

  {
    const opts = await svc.runGeneratePasskeyRegistrationOptions(callerRequest("u1"));
    ok("registration options exclude already-registered credentials",
        opts.options.excludeCredentials.some((c) => c.id === CRED_A));
    ok("registration options demand resident key + user verification",
        opts.options.authenticatorSelection.residentKey === "required" &&
        opts.options.authenticatorSelection.userVerification === "required");
    // Expire it by rewriting expiresAt into the past.
    const key = Object.keys(store).find((s) =>
      s.startsWith("webauthnChallenges/") && s.endsWith(opts.challengeId));
    store[key].expiresAt = firestoreFn.Timestamp.fromMillis(Date.now() - 1000);
    await rejects("expired registration challenge is rejected",
        () => svc.runVerifyPasskeyRegistration(callerRequest("u1", {
          challengeId: opts.challengeId,
          response: {id: CRED_B, __challenge: opts.options.challenge},
        })),
        (e) => e.details && e.details.code === "PASSKEY_CHALLENGE_EXPIRED");
  }

  const multi = await registerFor("u1", CRED_B, "Laptop");
  ok("multiple passkeys can be registered", multi.passkey.id === CRED_B);

  {
    const opts = await svc.runGeneratePasskeyRegistrationOptions(callerRequest("u1"));
    const excluded = opts.options.excludeCredentials.map((c) => c.id);
    ok("excludeCredentials carries ALL active credentials, not only the newest",
        excluded.includes(CRED_A) && excluded.includes(CRED_B) && excluded.length === 2);
  }

  // WebAuthn user handle stability — an unstable handle makes the device's
  // password manager keep a separate same-email entry per registration
  // (duplicate chooser rows) instead of overwriting.
  {
    const first = await svc.runGeneratePasskeyRegistrationOptions(callerRequest("u1"));
    const second = await svc.runGeneratePasskeyRegistrationOptions(callerRequest("u1"));
    ok("the WebAuthn user handle is stable across registrations",
        first.options.user.id === second.options.user.id &&
        typeof first.options.user.id === "string" && first.options.user.id.length > 0);
    const emailChanged = {
      auth: {uid: "u1", token: {email: "renamed@example.com", auth_time: NOW_SEC}},
      data: {},
      rawRequest: {get: () => ""},
    };
    const third = await svc.runGeneratePasskeyRegistrationOptions(emailChanged);
    ok("changing the account email does not change the user handle",
        third.options.user.id === first.options.user.id &&
        third.options.user.name === "renamed@example.com");
    ok("the user handle is never the raw Firebase uid",
        Buffer.from(first.options.user.id, "base64url").toString("utf8") !== "u1");
  }

  // ── Authentication ───────────────────────────────────────────────────────
  mintedTokens.length = 0;
  const authOpts = await svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null));
  ok("auth options demand user verification", authOpts.options.userVerification === "required");

  {
    const result = await svc.runVerifyPasskeyAuthentication(callerRequest(null, {
      challengeId: authOpts.challengeId,
      response: {id: CRED_A, __challenge: authOpts.options.challenge, __newCounter: 0},
    }));
    ok("valid passkey mints a custom token for the CREDENTIAL owner's uid",
        result.token === "custom-token-for-u1" && mintedTokens.join(",") === "u1");
    ok("successful auth updates lastUsedAt",
        store[`passkeyCredentials/${CRED_A}`].lastUsedAtMs > 0);
    ok("successful auth is audited",
        auditRows("PASSKEY_AUTHENTICATION_SUCCEEDED").length === 1);
  }

  await rejects("replayed assertion (consumed challenge) is rejected",
      () => svc.runVerifyPasskeyAuthentication(callerRequest(null, {
        challengeId: authOpts.challengeId,
        response: {id: CRED_A, __challenge: authOpts.options.challenge},
      })),
      (e) => e.details && e.details.code === "PASSKEY_CHALLENGE_REUSED");
  ok("replay is audited", auditRows("PASSKEY_REPLAY_REJECTED").length >= 1);

  await rejects("unknown credential is rejected without minting", async () => {
    const opts = await svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null));
    await svc.runVerifyPasskeyAuthentication(callerRequest(null, {
      challengeId: opts.challengeId,
      response: {id: "unknownCred12345678", __challenge: opts.options.challenge},
    }));
  }, (e) => e.details && e.details.code === "PASSKEY_CREDENTIAL_UNKNOWN");

  await rejects("revoked credential cannot authenticate", async () => {
    store[`passkeyCredentials/${CRED_B}`].revokedAt = firestoreFn.Timestamp.fromMillis(Date.now());
    const opts = await svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null));
    await svc.runVerifyPasskeyAuthentication(callerRequest(null, {
      challengeId: opts.challengeId,
      response: {id: CRED_B, __challenge: opts.options.challenge},
    }));
  }, (e) => e.details && e.details.code === "PASSKEY_CREDENTIAL_REVOKED");

  await rejects("invalid signature is rejected", async () => {
    const opts = await svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null));
    await svc.runVerifyPasskeyAuthentication(callerRequest(null, {
      challengeId: opts.challengeId,
      response: {id: CRED_A, __challenge: opts.options.challenge, __badSignature: true},
    }));
  }, (e) => e.details && e.details.code === "PASSKEY_VERIFICATION_FAILED");

  await rejects("wrong-origin assertion is rejected", async () => {
    const opts = await svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null));
    await svc.runVerifyPasskeyAuthentication(callerRequest(null, {
      challengeId: opts.challengeId,
      response: {id: CRED_A, __challenge: opts.options.challenge, __origin: "https://evil.example"},
    }));
  }, (e) => e.details && e.details.code === "PASSKEY_VERIFICATION_FAILED");

  {
    // Counter rollback: set stored counter high, replay a lower one.
    store[`passkeyCredentials/${CRED_A}`].counter = 10;
    const opts = await svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null));
    await rejects("counter rollback is rejected (possible cloned credential)",
        () => svc.runVerifyPasskeyAuthentication(callerRequest(null, {
          challengeId: opts.challengeId,
          response: {id: CRED_A, __challenge: opts.options.challenge, __newCounter: 3},
        })),
        (e) => e.details && e.details.code === "PASSKEY_VERIFICATION_FAILED");
    store[`passkeyCredentials/${CRED_A}`].counter = 0;
  }

  await rejects("a credential whose owner became an admin cannot mint a session", async () => {
    store["users/u1"].role = "admin";
    const opts = await svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null));
    await svc.runVerifyPasskeyAuthentication(callerRequest(null, {
      challengeId: opts.challengeId,
      response: {id: CRED_A, __challenge: opts.options.challenge, __newCounter: 0},
    }));
  }, (e) => e.details && e.details.code === "PASSKEY_ADMIN_MFA_REQUIRED");
  store["users/u1"].role = "teacher";

  await rejects("suspended account cannot mint a session via passkey", async () => {
    store["users/u1"].status = "suspended";
    const opts = await svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null));
    await svc.runVerifyPasskeyAuthentication(callerRequest(null, {
      challengeId: opts.challengeId,
      response: {id: CRED_A, __challenge: opts.options.challenge, __newCounter: 0},
    }));
  }, (e) => e.code === "permission-denied");
  store["users/u1"].status = "active";

  const mintedBeforeFailures = mintedTokens.length;
  ok("no tokens were minted by any failed authentication", mintedBeforeFailures === 1);

  // ── Management ───────────────────────────────────────────────────────────
  delete store[`passkeyCredentials/${CRED_B}`].revokedAt;
  {
    const list = await svc.runListUserPasskeys(callerRequest("u1"));
    ok("owner lists exactly their passkeys", list.passkeys.length === 2);
    ok("listing exposes no publicKey/counter fields",
        list.passkeys.every((p) => !("publicKey" in p) && !("counter" in p)));
    ok("listed passkeys carry an explicit active status",
        list.passkeys.every((p) => p.status === "active"));
    store["users/u9"] = {role: "learner"};
    const other = await svc.runListUserPasskeys(callerRequest("u9"));
    ok("another user's list is empty (no cross-user reads)", other.passkeys.length === 0);
  }

  // Two credentials with identical friendly names (and the same account
  // email) must BOTH render — the list keys on credential id, never
  // name/email dedup which would hide a genuine sibling passkey.
  {
    store[`passkeyCredentials/${CRED_A}`].name = "Samsung phone";
    store[`passkeyCredentials/${CRED_B}`].name = "Samsung phone";
    const list = await svc.runListUserPasskeys(callerRequest("u1"));
    ok("identical names are never deduplicated (unique ids remain)",
        list.passkeys.length === 2 &&
        new Set(list.passkeys.map((p) => p.id)).size === 2);
  }

  // Revoked credentials disappear from the active list without touching
  // their sibling.
  {
    store[`passkeyCredentials/${CRED_B}`].revokedAt = firestoreFn.Timestamp.fromMillis(1);
    const list = await svc.runListUserPasskeys(callerRequest("u1"));
    ok("revoked credentials are excluded from the active list",
        list.passkeys.length === 1 && list.passkeys[0].id === CRED_A);
    delete store[`passkeyCredentials/${CRED_B}`].revokedAt;
  }

  // Duplicate-chooser diagnostics: the assertion path logs ONLY a SHA-256
  // of the credential id. The same captured run also proves the regional-
  // migration timing telemetry: every required stage is present and NOTHING
  // sensitive (challenge, credential id, token, uid) reaches the log line.
  {
    const logged = [];
    const origInfo = console.info;
    console.info = (...args) => logged.push(args.join(" "));
    try {
      const opts = await svc.runGeneratePasskeyAuthenticationOptions(
          callerRequest(null), {region: "africa-south1"});
      await svc.runVerifyPasskeyAuthentication(callerRequest(null, {
        challengeId: opts.challengeId,
        response: {id: CRED_A, __challenge: opts.options.challenge, __newCounter: 0},
      }), {region: "africa-south1"});
    } finally {
      console.info = origInfo;
    }
    const line = logged.find((l) => l.includes("PASSKEY_CREDENTIAL_SELECTED"));
    const expectedHash = require("node:crypto")
        .createHash("sha256").update(CRED_A).digest("hex");
    ok("credential selection logs the SHA-256 hash, never the raw id",
        Boolean(line) && line.includes(expectedHash) && !line.includes(CRED_A));
    ok("credential selection log records found/active status",
        line.includes("\"credentialFound\":true") &&
        line.includes("\"credentialStatus\":\"active\""));

    const timingLines = logged.filter((l) => l.includes("PASSKEY_AUTH_TIMINGS"));
    ok("both sign-in-path handlers log stage timings", timingLines.length === 2);
    const verifyLine = timingLines.find((l) => l.includes("\"op\":\"verifyAuthentication\""));
    const parsed = JSON.parse(verifyLine.slice(verifyLine.indexOf("{")));
    const core = require("./passkeyCore");
    const requiredStages = core.PASSKEY_AUTH_TIMING_STAGES;
    ok("verify timing log carries every canonical stage",
        requiredStages.every((s) => typeof parsed.stages[s] === "number"));
    ok("timing log records the serving region", parsed.region === "africa-south1");
    ok("timing log carries ONLY the whitelisted top-level keys",
        JSON.stringify(Object.keys(parsed).sort()) ===
        JSON.stringify(["event", "op", "outcome", "region", "stages", "totalMs"]));
    ok("timing log stage values are plain durations",
        Object.values(parsed.stages).every((v) => typeof v === "number") &&
        typeof parsed.totalMs === "number");
    ok("timing log never contains challenge, credential id, token, or uid",
        !verifyLine.includes(CRED_A) &&
        !verifyLine.includes("challenge-") &&
        !verifyLine.includes("custom-token") &&
        !("uid" in parsed));
    const optionsLine = timingLines.find((l) =>
      l.includes("\"op\":\"generateAuthenticationOptions\""));
    const parsedOpts = JSON.parse(optionsLine.slice(optionsLine.indexOf("{")));
    ok("options timing log never contains the raw challenge",
        !optionsLine.includes("auth-challenge-") &&
        typeof parsedOpts.stages.challengeStore === "number");

    // Handlers invoked WITHOUT region meta (the original us-central1 call
    // sites pass it explicitly; a missing meta must never throw).
    const opts2 = await svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null));
    ok("handlers still work without region meta (backwards compatible)",
        Boolean(opts2.challengeId));
  }

  await rejects("user cannot rename another user's credential",
      () => svc.runRenameUserPasskey(callerRequest("u9", {credentialId: CRED_A, name: "Stolen"})),
      (e) => e.details && e.details.code === "PASSKEY_CREDENTIAL_UNKNOWN");

  {
    const r = await svc.runRenameUserPasskey(callerRequest("u1", {credentialId: CRED_A, name: "Renamed phone"}));
    ok("owner can rename a passkey", r.name === "Renamed phone" &&
        store[`passkeyCredentials/${CRED_A}`].name === "Renamed phone");
  }

  await rejects("user cannot remove another user's credential",
      () => svc.runRemoveUserPasskey(callerRequest("u9", {credentialId: CRED_A})),
      (e) => e.details && e.details.code === "PASSKEY_CREDENTIAL_UNKNOWN");

  {
    await svc.runRemoveUserPasskey(callerRequest("u1", {credentialId: CRED_B}));
    ok("owner can remove a passkey", store[`passkeyCredentials/${CRED_B}`] === undefined);
    const opts = await svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null));
    await rejects("removed credential can no longer authenticate",
        () => svc.runVerifyPasskeyAuthentication(callerRequest(null, {
          challengeId: opts.challengeId,
          response: {id: CRED_B, __challenge: opts.options.challenge},
        })),
        (e) => e.details && e.details.code === "PASSKEY_CREDENTIAL_UNKNOWN");
    ok("removal is audited", auditRows("PASSKEY_REMOVED").length === 1);
    // The sibling credential must be completely untouched by the removal.
    const opts2 = await svc.runGeneratePasskeyAuthenticationOptions(callerRequest(null));
    const stillWorks = await svc.runVerifyPasskeyAuthentication(callerRequest(null, {
      challengeId: opts2.challengeId,
      response: {id: CRED_A, __challenge: opts2.options.challenge, __newCounter: 0},
    }));
    ok("removing one passkey does not affect the other (sibling still signs in)",
        stillWorks.token === "custom-token-for-u1" &&
        store[`passkeyCredentials/${CRED_A}`] !== undefined);
  }

  // ── Limit ────────────────────────────────────────────────────────────────
  {
    // u1 currently has 1 (CRED_A). Fill to the cap of 10, then expect refusal.
    for (let i = 1; i <= 9; i++) {
      await registerFor("u1", `bulkCred${String(i).padStart(12, "0")}`);
    }
    await rejects("11th passkey is refused (limit enforced)",
        () => svc.runGeneratePasskeyRegistrationOptions(callerRequest("u1")),
        (e) => e.details && e.details.code === "PASSKEY_LIMIT_REACHED");
  }

  console.log(`\npasskeyService: ${passed} tests passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
