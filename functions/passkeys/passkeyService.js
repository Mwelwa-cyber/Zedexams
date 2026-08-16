// WebAuthn passkey auth — the effectful half (Firestore + SimpleWebAuthn +
// Firebase Auth). Pure decisions live in passkeyCore.js; the onCall wrappers
// (region/App Check/telemetry) live in functions/index.js like the other
// teacher-tool runners.
//
// Security model:
//   - Credentials + challenges live in server-only collections (rules deny
//     every client read/write); the client only ever sees the safe metadata
//     returned by these handlers.
//   - The uid a passkey signs in is resolved ONLY from the stored credential
//     record — never from anything the client sends.
//   - Challenges are single-use: consumed inside a transaction BEFORE the
//     WebAuthn response is verified, so a replayed assertion always finds an
//     already-consumed challenge.
//   - No custom cryptography: all verification is @simplewebauthn/server.

const {HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {assertVerifiedAuth, assertActiveAccount} = require("../authGuard");
const {assertCallableRateLimit} = require("../rateLimit");
const core = require("./passkeyCore");

const {PASSKEY_ERROR_CODES: CODES, PASSKEY_AUDIT_EVENTS: EVENTS} = core;

/**
 * @simplewebauthn/server is loaded on the first passkey call, not at module
 * load.
 *
 * functions/index.js requires this module, so its 17.7 MiB of RSS and ~114 ms
 * of load were charged to all 196 exports for a library only the four passkey
 * flow callables use — and passkeys are behind a feature flag that defaults to
 * OFF, so on current production traffic nothing reaches it at all.
 *
 * This does NOT weaken the "no custom cryptography" rule stated at the top of
 * this file: the same library performs the same verification, it is simply
 * resolved when a passkey request arrives. Node caches the module, so only the
 * first passkey call on an instance pays for it.
 */
function webauthn() {
  return require("@simplewebauthn/server");
}

// ── Relying-party configuration ──────────────────────────────────────────
// Environment-managed (functions env / .env.local for emulator), never
// scattered per-callsite. Production defaults are baked in; a dev deployment
// overrides with e.g. PASSKEY_RP_ID=localhost,
// PASSKEY_ALLOWED_ORIGINS=http://localhost:5173. Wildcards are refused by
// resolveExpectedOrigins (fail-closed to the production origin).
const RP_NAME = "ZedExams";
function rpId() {
  return process.env.PASSKEY_RP_ID || "zedexams.com";
}
function expectedOrigins() {
  // Defaults include both deployed hostnames (apex + www) via
  // core.PRODUCTION_ORIGINS; env adds dev origins, never wildcards.
  return core.resolveExpectedOrigins(process.env.PASSKEY_ALLOWED_ORIGINS);
}
// Sensitive changes (add/remove a passkey) require a recent first-factor
// sign-in; older sessions get PASSKEY_REAUTH_REQUIRED and the UI asks the
// user to sign in again first.
function reauthWindowMs() {
  const mins = Number(process.env.PASSKEY_REAUTH_WINDOW_MIN) || 60;
  return mins * 60 * 1000;
}

const db = () => admin.firestore();
const CREDENTIALS = "passkeyCredentials";
const CHALLENGES = "webauthnChallenges";
const AUDIT = "passkeyAuditLog";
const USER_HANDLES = "passkeyUserHandles";

// ── Rollout flag ─────────────────────────────────────────────────────────
// settings/global.featureFlags.passkeyAuthenticationEnabled gates the whole
// feature (fail-closed: missing doc/field/read error == disabled). Optional
// staged rollout: passkeyRolloutRoles / passkeyRolloutUids narrow WHO may
// register; sign-in only needs the master flag (only enrolled users can
// authenticate anyway). Management (list/rename/remove) is never gated so a
// user can always clean up credentials even mid-rollback.
async function getPasskeyFlags() {
  try {
    const snap = await db().doc("settings/global").get();
    const flags = (snap.exists && snap.data()?.featureFlags) || {};
    return {
      enabled: flags.passkeyAuthenticationEnabled === true,
      rolloutRoles: Array.isArray(flags.passkeyRolloutRoles) ?
        flags.passkeyRolloutRoles : [],
      rolloutUids: Array.isArray(flags.passkeyRolloutUids) ?
        flags.passkeyRolloutUids : [],
    };
  } catch (err) {
    console.warn("[passkeys] flag read failed — failing closed:", err?.message || err);
    return {enabled: false, rolloutRoles: [], rolloutUids: []};
  }
}

function disabledError() {
  return new HttpsError("failed-precondition",
      "Passkey sign-in is not available yet.", {code: CODES.DISABLED});
}

// Administrator accounts are under mandatory TOTP MFA, and the MFA guard
// deliberately never accepts a custom-token session as second-factor proof —
// so a passkey session would lock an admin out of every privileged callable.
// Refused at registration AND sign-in.
function adminMfaError() {
  return new HttpsError("failed-precondition",
      "Administrator accounts sign in with email, password and an authenticator code.",
      {code: CODES.ADMIN_MFA_REQUIRED});
}

// ── Audit log ────────────────────────────────────────────────────────────
// Append-only security trail (server-only collection). Never stores raw
// credential ids, challenges, assertions, tokens, or full user agents —
// only hashes and coarse categories. Best-effort: an audit write failure
// must never break the auth flow itself.
async function writeAudit(type, {uid = null, credentialId = null, result, request}) {
  try {
    const raw = request?.rawRequest;
    const ua = raw?.get ? raw.get("user-agent") : "";
    const ipHeader = raw?.get ? raw.get("x-forwarded-for") : "";
    const ip = String(ipHeader || "").split(",")[0].trim();
    await db().collection(AUDIT).add({
      type,
      result,
      uid,
      credentialIdHash: credentialId ? core.sha256Hex(credentialId) : null,
      uaSummary: core.summarizeUserAgent(ua),
      ipHash: ip ? core.sha256Hex(ip) : null,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.warn("[passkeys] audit write failed:", err?.message || err);
  }
}

// ── Latency telemetry (regional migration) ───────────────────────────────
// Per-stage timings for the sign-in path so the us-central1 → africa-south1
// move is measured, not guessed. The line carries ONLY stage names,
// millisecond durations, the serving region and an outcome word — never
// uids, challenges, credential ids, tokens, assertions, or any payload
// fragment — so it is always safe in Cloud Logging. Best-effort: telemetry
// must never break the auth flow.
function logAuthTimings(op, region, timer, outcome = "success") {
  try {
    const {stages, totalMs} = timer.snapshot();
    console.info("[passkeys] PASSKEY_AUTH_TIMINGS", JSON.stringify({
      event: "PASSKEY_AUTH_TIMINGS",
      op,
      region: region || "unspecified",
      outcome,
      stages,
      totalMs,
    }));
  } catch {
    // Swallow — a telemetry failure must never fail authentication.
  }
}

// ── Challenge storage ────────────────────────────────────────────────────
// Only the SHA-256 of the challenge is stored (the raw value goes to the
// client once and is compared back via SimpleWebAuthn's expectedChallenge
// callback). expiresAt doubles as the Firestore TTL reap field, same
// convention as rateLimits.expireAt / processedEvents.expiresAt.
async function storeChallenge({challenge, operation, uid}) {
  const now = Date.now();
  const ref = db().collection(CHALLENGES).doc(core.randomBase64Url(16));
  await ref.set({
    challengeHash: core.sha256Hex(challenge),
    operation,
    uid: uid || null,
    createdAt: admin.firestore.Timestamp.fromMillis(now),
    expiresAt: admin.firestore.Timestamp.fromMillis(now + core.CHALLENGE_TTL_MS),
    consumedAt: null,
  });
  return ref.id;
}

// Atomically validate + consume the challenge. Consuming happens BEFORE
// WebAuthn verification so a replayed response can never race a second
// verification through the same challenge. Throws on any invalid state.
async function consumeChallenge({challengeId, operation, expectedUid, request}) {
  if (typeof challengeId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(challengeId)) {
    throw new HttpsError("invalid-argument", "Invalid challenge.",
        {code: CODES.CHALLENGE_INVALID});
  }
  const ref = db().collection(CHALLENGES).doc(challengeId);
  const verdict = await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : null;
    const result = core.validateChallengeDoc({
      doc: data && {
        operation: data.operation,
        uid: data.uid,
        expiresAtMs: data.expiresAt?.toMillis?.() ?? null,
        // ANY non-null consumedAt means consumed — never depend on it being
        // a materialised Timestamp (a pending serverTimestamp isn't one).
        consumedAtMs: data.consumedAt ? (data.consumedAt.toMillis?.() ?? 1) : null,
      },
      nowMs: Date.now(),
      operation,
      expectedUid: expectedUid || null,
    });
    if (data) {
      // Mark consumed even on a failed validation (expired/mismatched) so the
      // same doc can never be probed repeatedly.
      tx.update(ref, {consumedAt: admin.firestore.FieldValue.serverTimestamp()});
    }
    return {...result, challengeHash: data?.challengeHash || null};
  });
  if (!verdict.ok) {
    if (verdict.audit) {
      await writeAudit(verdict.audit, {uid: expectedUid, result: "rejected", request});
    }
    const message = verdict.code === CODES.CHALLENGE_EXPIRED ?
      "This request expired. Please try again." :
      "This request could not be verified. Please try again.";
    throw new HttpsError("failed-precondition", message, {code: verdict.code});
  }
  return {ref, challengeHash: verdict.challengeHash};
}

// Stable opaque WebAuthn user handle (never the Firebase UID, which would be
// readable by anything enumerating the authenticator's credential store, and
// never the email — the handle must survive an email change unchanged).
// Server-only collection, keyed by uid; minted ONCE inside a transaction so
// two concurrent options calls can never race each other into two different
// handles. Handle stability matters beyond privacy: authenticators overwrite
// a discoverable credential with the same (rpId, userHandle), so an unstable
// handle would leave duplicate same-email entries in the device's password
// manager on every re-registration.
async function getOrCreateUserHandle(uid) {
  const ref = db().collection(USER_HANDLES).doc(uid);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && typeof snap.data()?.handle === "string") {
      return snap.data().handle;
    }
    const handle = core.randomBase64Url(32);
    tx.set(ref, {
      handle,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return handle;
  });
}

async function listActiveCredentials(uid) {
  const snap = await db().collection(CREDENTIALS).where("uid", "==", uid).get();
  return snap.docs
      .map((d) => ({id: d.id, ...d.data()}))
      .filter((c) => !c.revokedAt);
}

function requireRecentAuth(request) {
  const authTimeSec = Number(request.auth?.token?.auth_time) || 0;
  if (Date.now() - authTimeSec * 1000 > reauthWindowMs()) {
    throw new HttpsError("failed-precondition",
        "For security, please sign out and sign in again, then retry.",
        {code: CODES.REAUTH_REQUIRED});
  }
}

function credentialIdFromResponse(response) {
  const id = response?.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9_-]{16,1024}$/.test(id)) {
    throw new HttpsError("invalid-argument", "Invalid credential.",
        {code: CODES.CREDENTIAL_UNKNOWN});
  }
  return id;
}

// ── Handlers (wrapped by onCall in functions/index.js) ───────────────────

// Registration step 1 — requires a signed-in, recently-authenticated user.
async function runGeneratePasskeyRegistrationOptions(request) {
  const uid = await assertVerifiedAuth(request);
  await assertCallableRateLimit(request, {action: "passkeyRegister"});
  const flags = await getPasskeyFlags();
  const profileSnap = await db().doc(`users/${uid}`).get();
  const role = profileSnap.exists ? profileSnap.data()?.role : null;
  if (core.isAdminRole(role)) throw adminMfaError();
  if (!core.isPasskeyRolloutAllowed({flags, role, uid})) throw disabledError();
  requireRecentAuth(request);

  const existing = await listActiveCredentials(uid);
  const limitVerdict = core.canRegisterAnotherPasskey(existing.length);
  if (!limitVerdict.ok) {
    throw new HttpsError("failed-precondition",
        `You can have at most ${core.MAX_PASSKEYS_PER_USER} passkeys. Remove one to add another.`,
        {code: limitVerdict.code});
  }

  const userHandle = await getOrCreateUserHandle(uid);
  const email = request.auth.token?.email || profileSnap.data()?.email || "ZedExams user";
  const options = await webauthn().generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: rpId(),
    userID: Buffer.from(userHandle, "base64url"),
    userName: email,
    userDisplayName: profileSnap.data()?.displayName || email,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: c.id,
      transports: Array.isArray(c.transports) ? c.transports : undefined,
    })),
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
  });
  const challengeId = await storeChallenge({
    challenge: options.challenge,
    operation: "registration",
    uid,
  });
  return {options, challengeId};
}

// Registration step 2 — verify the attestation, persist the credential.
async function runVerifyPasskeyRegistration(request) {
  const uid = await assertVerifiedAuth(request);
  await assertCallableRateLimit(request, {action: "passkeyRegister"});
  const flags = await getPasskeyFlags();
  if (!flags.enabled) throw disabledError();

  const {challengeId, response, name} = request.data || {};
  if (!response || typeof response !== "object") {
    throw new HttpsError("invalid-argument", "Missing registration response.",
        {code: CODES.VERIFICATION_FAILED});
  }
  const {challengeHash} = await consumeChallenge({
    challengeId, operation: "registration", expectedUid: uid, request,
  });

  let verification;
  try {
    verification = await webauthn().verifyRegistrationResponse({
      response,
      expectedChallenge: (clientChallenge) =>
        core.sha256Hex(clientChallenge) === challengeHash,
      expectedOrigin: expectedOrigins(),
      expectedRPID: rpId(),
      requireUserVerification: true,
    });
  } catch (err) {
    await writeAudit(EVENTS.AUTH_FAILED, {uid, result: "registration-verify-error", request});
    console.warn("[passkeys] registration verification failed:", err?.message);
    throw new HttpsError("failed-precondition",
        "We could not verify this passkey. Try again or use another sign-in method.",
        {code: CODES.VERIFICATION_FAILED});
  }
  if (!verification.verified || !verification.registrationInfo) {
    throw new HttpsError("failed-precondition",
        "We could not verify this passkey. Try again or use another sign-in method.",
        {code: CODES.VERIFICATION_FAILED});
  }

  const {credential, credentialDeviceType, credentialBackedUp} =
    verification.registrationInfo;
  const rawUa = request.rawRequest?.get ? request.rawRequest.get("user-agent") : "";
  const ipHeader = request.rawRequest?.get ?
    request.rawRequest.get("x-forwarded-for") : "";
  const ip = String(ipHeader || "").split(",")[0].trim();
  const friendlyName = core.sanitizePasskeyName(
      name, core.defaultPasskeyNameFromUa(rawUa));

  const credRef = db().collection(CREDENTIALS).doc(credential.id);
  try {
    await db().runTransaction(async (tx) => {
      const dupe = await tx.get(credRef);
      if (dupe.exists) {
        throw new HttpsError("already-exists",
            "This passkey is already registered.",
            {code: CODES.CREDENTIAL_DUPLICATE});
      }
      const mine = await tx.get(
          db().collection(CREDENTIALS).where("uid", "==", uid));
      const active = mine.docs.filter((d) => !d.data().revokedAt).length;
      const verdict = core.canRegisterAnotherPasskey(active);
      if (!verdict.ok) {
        throw new HttpsError("failed-precondition",
            `You can have at most ${core.MAX_PASSKEYS_PER_USER} passkeys.`,
            {code: verdict.code});
      }
      tx.create(credRef, {
        credentialId: credential.id,
        uid,
        publicKey: Buffer.from(credential.publicKey).toString("base64url"),
        counter: credential.counter || 0,
        transports: credential.transports || response?.response?.transports || [],
        deviceType: credentialDeviceType || null,
        backedUp: credentialBackedUp === true,
        name: friendlyName,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtMs: Date.now(),
        lastUsedAt: null,
        lastUsedAtMs: null,
        revokedAt: null,
        createdByIpHash: ip ? core.sha256Hex(ip) : null,
        userAgentSummary: core.summarizeUserAgent(rawUa),
      });
    });
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    console.error("[passkeys] credential write failed:", err?.message || err);
    throw new HttpsError("internal", "Could not save this passkey. Please try again.",
        {code: CODES.VERIFICATION_FAILED});
  }

  await writeAudit(EVENTS.REGISTERED, {
    uid, credentialId: credential.id, result: "success", request,
  });
  return {
    passkey: core.credentialDocToSafeMetadata(credential.id, {
      name: friendlyName,
      deviceType: credentialDeviceType || null,
      backedUp: credentialBackedUp === true,
      transports: credential.transports || [],
      createdAtMs: Date.now(),
      lastUsedAtMs: null,
    }),
  };
}

// Authentication step 1 — pre-auth: rate-limited per IP, App Check observed.
// `meta.region` is the serving region stamped by the onCall wrapper in
// functions/index.js — telemetry only, never a behaviour switch.
async function runGeneratePasskeyAuthenticationOptions(request, meta = {}) {
  const timer = core.createStageTimer();
  await assertCallableRateLimit(request, {action: "passkeyAuth", ipPerMin: 30});
  const flags = await getPasskeyFlags();
  if (!flags.enabled) throw disabledError();
  timer.mark("preChecks");

  const options = await webauthn().generateAuthenticationOptions({
    rpID: rpId(),
    userVerification: "required",
    allowCredentials: [], // discoverable credentials — the authenticator picks
  });
  timer.mark("optionsGenerate");
  const challengeId = await storeChallenge({
    challenge: options.challenge,
    operation: "authentication",
    uid: null,
  });
  timer.mark("challengeStore");
  logAuthTimings("generateAuthenticationOptions", meta.region, timer);
  return {options, challengeId};
}

// Authentication step 2 — verify the assertion, resolve the uid from the
// stored credential (NEVER from the client), mint a custom token.
// `meta.region` is the serving region stamped by the onCall wrapper in
// functions/index.js — telemetry only, never a behaviour switch.
async function runVerifyPasskeyAuthentication(request, meta = {}) {
  const timer = core.createStageTimer();
  await assertCallableRateLimit(request, {action: "passkeyAuth", ipPerMin: 30});
  const flags = await getPasskeyFlags();
  if (!flags.enabled) throw disabledError();

  const {challengeId, response} = request.data || {};
  if (!response || typeof response !== "object") {
    throw new HttpsError("invalid-argument", "Missing authentication response.",
        {code: CODES.VERIFICATION_FAILED});
  }
  const credentialId = credentialIdFromResponse(response);
  timer.mark("preChecks");
  const {challengeHash} = await consumeChallenge({
    challengeId, operation: "authentication", expectedUid: null, request,
  });
  timer.mark("challengeConsume");

  const credSnap = await db().collection(CREDENTIALS).doc(credentialId).get();
  const credData = credSnap.exists ? credSnap.data() : null;
  timer.mark("credentialLookup");
  // Duplicate-chooser diagnostics (docs/PASSKEYS.md → "Seeing the account
  // twice"): logs ONLY the SHA-256 of the credential id — comparing this
  // hash across two chooser rows distinguishes a stale device-side
  // credential from a provider display duplicate. Never raw ids/assertions.
  console.info("[passkeys] PASSKEY_CREDENTIAL_SELECTED", JSON.stringify({
    event: "PASSKEY_CREDENTIAL_SELECTED",
    credentialIdHash: core.sha256Hex(credentialId),
    credentialFound: Boolean(credData),
    credentialStatus: credData ? (credData.revokedAt ? "revoked" : "active") : "unknown",
  }));
  const credVerdict = core.validateCredentialForAuth(credData);
  if (!credVerdict.ok) {
    await writeAudit(EVENTS.AUTH_FAILED, {
      uid: credData?.uid || null, credentialId,
      result: credVerdict.code === CODES.CREDENTIAL_REVOKED ? "revoked" : "unknown-credential",
      request,
    });
    throw new HttpsError("failed-precondition",
        "This passkey is no longer linked to a ZedExams account. Use another sign-in method.",
        {code: credVerdict.code});
  }
  const uid = credVerdict.uid;

  let verification;
  try {
    verification = await webauthn().verifyAuthenticationResponse({
      response,
      expectedChallenge: (clientChallenge) =>
        core.sha256Hex(clientChallenge) === challengeHash,
      expectedOrigin: expectedOrigins(),
      expectedRPID: rpId(),
      credential: {
        id: credentialId,
        publicKey: Buffer.from(credData.publicKey, "base64url"),
        counter: Number(credData.counter) || 0,
        transports: Array.isArray(credData.transports) ? credData.transports : undefined,
      },
      requireUserVerification: true,
    });
  } catch (err) {
    await writeAudit(EVENTS.AUTH_FAILED, {uid, credentialId, result: "verify-error", request});
    console.warn("[passkeys] authentication verification failed:", err?.message);
    throw new HttpsError("failed-precondition",
        "We could not verify this passkey. Try again or use another sign-in method.",
        {code: CODES.VERIFICATION_FAILED});
  }
  if (!verification.verified || !verification.authenticationInfo) {
    await writeAudit(EVENTS.AUTH_FAILED, {uid, credentialId, result: "not-verified", request});
    throw new HttpsError("failed-precondition",
        "We could not verify this passkey. Try again or use another sign-in method.",
        {code: CODES.VERIFICATION_FAILED});
  }
  timer.mark("webauthnVerify");

  // Clone detection (WebAuthn §6.1.1): a rolled-back or repeated non-zero
  // counter means two authenticators hold "the same" credential. The check
  // and the counter bump happen in ONE transaction against a fresh read so
  // two concurrent assertions can never both pass on the same stored value
  // (the second sees the first's committed counter and is rejected), and a
  // just-revoked/removed credential is re-checked at the same moment.
  const counterVerdict = await db().runTransaction(async (tx) => {
    const fresh = await tx.get(credSnap.ref);
    const freshData = fresh.exists ? fresh.data() : null;
    const stillValid = core.validateCredentialForAuth(freshData);
    if (!stillValid.ok) return stillValid;
    const verdict = core.evaluateCounter({
      storedCounter: freshData.counter,
      newCounter: verification.authenticationInfo.newCounter,
    });
    if (verdict.ok) {
      tx.update(credSnap.ref, {
        counter: verdict.updatedCounter,
        lastUsedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastUsedAtMs: Date.now(),
      });
    }
    return verdict;
  });
  if (!counterVerdict.ok) {
    await writeAudit(EVENTS.REPLAY_REJECTED, {
      uid, credentialId,
      result: counterVerdict.code === CODES.COUNTER_ROLLBACK ?
        "counter-rollback" : "credential-invalidated-mid-auth",
      request,
    });
    throw new HttpsError("failed-precondition",
        "We could not verify this passkey. Try again or use another sign-in method.",
        {code: CODES.VERIFICATION_FAILED});
  }
  timer.mark("counterTxn");

  // Suspended/deleted accounts must not mint a session (throws HttpsError),
  // and admin accounts never mint passkey sessions at all — their mandatory
  // TOTP MFA cannot be satisfied by a custom token (requireAdminMfaCore).
  await assertActiveAccount(uid);
  const profileSnap = await db().doc(`users/${uid}`).get();
  if (core.isAdminRole(profileSnap.exists ? profileSnap.data()?.role : null)) {
    await writeAudit(EVENTS.AUTH_FAILED, {uid, credentialId, result: "admin-mfa-required", request});
    throw adminMfaError();
  }
  timer.mark("profileLookup");

  const customToken = await admin.auth().createCustomToken(uid);
  timer.mark("customToken");
  await writeAudit(EVENTS.AUTH_SUCCEEDED, {uid, credentialId, result: "success", request});
  timer.mark("auditWrite");
  logAuthTimings("verifyAuthentication", meta.region, timer);
  // The token is returned once over TLS and never logged or stored.
  return {token: customToken};
}

// ── Management (all require the signed-in owner) ─────────────────────────

async function runListUserPasskeys(request) {
  const uid = await assertVerifiedAuth(request);
  const credentials = await listActiveCredentials(uid);
  credentials.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  return {
    passkeys: credentials.map((c) => core.credentialDocToSafeMetadata(c.id, c)),
    limit: core.MAX_PASSKEYS_PER_USER,
  };
}

async function runRenameUserPasskey(request) {
  const uid = await assertVerifiedAuth(request);
  await assertCallableRateLimit(request, {action: "passkeyManage"});
  const {credentialId, name} = request.data || {};
  const ref = await assertOwnedCredential(uid, credentialId);
  const friendlyName = core.sanitizePasskeyName(name);
  await ref.update({name: friendlyName});
  await writeAudit(EVENTS.RENAMED, {uid, credentialId, result: "success", request});
  return {name: friendlyName};
}

async function runRemoveUserPasskey(request) {
  const uid = await assertVerifiedAuth(request);
  await assertCallableRateLimit(request, {action: "passkeyManage"});
  requireRecentAuth(request);
  const {credentialId} = request.data || {};
  const ref = await assertOwnedCredential(uid, credentialId);
  // Delete outright (the user may re-register the same authenticator later);
  // the audit row keeps the hashed trail. Sign-in fails immediately after:
  // verification looks the credential up by id on every attempt.
  await ref.delete();
  await writeAudit(EVENTS.REMOVED, {uid, credentialId, result: "success", request});
  return {removed: true};
}

async function assertOwnedCredential(uid, credentialId) {
  if (typeof credentialId !== "string" || !/^[A-Za-z0-9_-]{16,1024}$/.test(credentialId)) {
    throw new HttpsError("invalid-argument", "Invalid passkey.",
        {code: CODES.CREDENTIAL_UNKNOWN});
  }
  const ref = db().collection(CREDENTIALS).doc(credentialId);
  const snap = await ref.get();
  if (!snap.exists || snap.data()?.uid !== uid) {
    // Same error for "not found" and "not yours" — no credential enumeration.
    throw new HttpsError("not-found", "This passkey was not found.",
        {code: CODES.CREDENTIAL_UNKNOWN});
  }
  return ref;
}

module.exports = {
  runGeneratePasskeyRegistrationOptions,
  runVerifyPasskeyRegistration,
  runGeneratePasskeyAuthenticationOptions,
  runVerifyPasskeyAuthentication,
  runListUserPasskeys,
  runRenameUserPasskey,
  runRemoveUserPasskey,
};
