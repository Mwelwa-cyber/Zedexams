// Pure decision logic for WebAuthn passkey auth — no firebase-functions or
// firestore imports so it tests under plain `node` (the *Core.js split).
// The Firestore/SimpleWebAuthn I/O lives in functions/passkeys/passkeyService.js.

const crypto = require("crypto");

// Hard product limits — mirrored in src/services/passkeyService.js copy only,
// enforcement is always server-side here.
const MAX_PASSKEYS_PER_USER = 10;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_NAME_LENGTH = 64;

// Machine-readable error codes surfaced to the client (never raw internals).
const PASSKEY_ERROR_CODES = Object.freeze({
  NOT_SUPPORTED: "PASSKEY_NOT_SUPPORTED",
  CANCELLED: "PASSKEY_CANCELLED",
  CHALLENGE_EXPIRED: "PASSKEY_CHALLENGE_EXPIRED",
  CHALLENGE_REUSED: "PASSKEY_CHALLENGE_REUSED",
  CHALLENGE_INVALID: "PASSKEY_CHALLENGE_INVALID",
  ORIGIN_INVALID: "PASSKEY_ORIGIN_INVALID",
  RP_ID_INVALID: "PASSKEY_RP_ID_INVALID",
  CREDENTIAL_UNKNOWN: "PASSKEY_CREDENTIAL_UNKNOWN",
  CREDENTIAL_REVOKED: "PASSKEY_CREDENTIAL_REVOKED",
  CREDENTIAL_DUPLICATE: "PASSKEY_CREDENTIAL_DUPLICATE",
  VERIFICATION_FAILED: "PASSKEY_VERIFICATION_FAILED",
  COUNTER_ROLLBACK: "PASSKEY_COUNTER_ROLLBACK",
  LIMIT_REACHED: "PASSKEY_LIMIT_REACHED",
  REAUTH_REQUIRED: "PASSKEY_REAUTH_REQUIRED",
  NETWORK_ERROR: "PASSKEY_NETWORK_ERROR",
  RATE_LIMITED: "PASSKEY_RATE_LIMITED",
  DISABLED: "PASSKEY_DISABLED",
});

// Audit event types (passkeyAuditLog collection).
const PASSKEY_AUDIT_EVENTS = Object.freeze({
  REGISTERED: "PASSKEY_REGISTERED",
  AUTH_SUCCEEDED: "PASSKEY_AUTHENTICATION_SUCCEEDED",
  AUTH_FAILED: "PASSKEY_AUTHENTICATION_FAILED",
  RENAMED: "PASSKEY_RENAMED",
  REMOVED: "PASSKEY_REMOVED",
  REVOKED: "PASSKEY_REVOKED",
  CHALLENGE_EXPIRED: "PASSKEY_CHALLENGE_EXPIRED",
  REPLAY_REJECTED: "PASSKEY_REPLAY_REJECTED",
});

/** SHA-256 hex digest — used for challenge + credential-id + IP hashing so raw
 * values never land in Firestore audit rows or logs. */
function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

/** Random base64url challenge id / opaque user handle material. */
function randomBase64Url(bytes = 32) {
  return crypto.randomBytes(bytes).toString("base64url");
}

/**
 * Validate a stored challenge document against the operation being verified.
 * The challenge doc shape: { challengeHash, operation, uid, createdAtMs,
 * expiresAtMs, consumedAtMs }. Returns { ok } or { ok:false, code, audit? }.
 *
 * - `expectedUid` is required for registration (challenge bound to the signed-in
 *   user) and must be null for authentication (pre-auth, no uid yet).
 * - A consumed challenge is a replay: reject regardless of anything else.
 */
function validateChallengeDoc({ doc, nowMs, operation, expectedUid = null }) {
  if (!doc) {
    return { ok: false, code: PASSKEY_ERROR_CODES.CHALLENGE_INVALID };
  }
  if (doc.consumedAtMs) {
    return {
      ok: false,
      code: PASSKEY_ERROR_CODES.CHALLENGE_REUSED,
      audit: PASSKEY_AUDIT_EVENTS.REPLAY_REJECTED,
    };
  }
  if (doc.operation !== operation) {
    return { ok: false, code: PASSKEY_ERROR_CODES.CHALLENGE_INVALID };
  }
  if (typeof doc.expiresAtMs !== "number" || nowMs >= doc.expiresAtMs) {
    return {
      ok: false,
      code: PASSKEY_ERROR_CODES.CHALLENGE_EXPIRED,
      audit: PASSKEY_AUDIT_EVENTS.CHALLENGE_EXPIRED,
    };
  }
  if (operation === "registration") {
    if (!expectedUid || doc.uid !== expectedUid) {
      return { ok: false, code: PASSKEY_ERROR_CODES.CHALLENGE_INVALID };
    }
  } else if (doc.uid) {
    // Authentication challenges are minted pre-auth and must not be bound to a
    // uid — a uid-bound doc used for auth means the operation types were mixed.
    return { ok: false, code: PASSKEY_ERROR_CODES.CHALLENGE_INVALID };
  }
  return { ok: true };
}

/**
 * Signature-counter check (WebAuthn §6.1.1). Authenticators that support
 * counters must strictly increase them; a rollback or repeat on a non-zero
 * counter indicates a cloned credential. Authenticators that always report 0
 * (most platform/passkey authenticators — counters are optional for
 * multi-device credentials) are accepted.
 */
function evaluateCounter({ storedCounter, newCounter }) {
  const stored = Number(storedCounter) || 0;
  const next = Number(newCounter) || 0;
  if (next === 0 && stored === 0) {
    return { ok: true, updatedCounter: 0 };
  }
  if (next > stored) {
    return { ok: true, updatedCounter: next };
  }
  return {
    ok: false,
    code: PASSKEY_ERROR_CODES.COUNTER_ROLLBACK,
    audit: PASSKEY_AUDIT_EVENTS.REPLAY_REJECTED,
  };
}

/** Credential docs with revokedAt set (or missing entirely) must never mint a
 * session. Returns { ok, uid } or { ok:false, code }. */
function validateCredentialForAuth(credentialDoc) {
  if (!credentialDoc || !credentialDoc.uid) {
    return { ok: false, code: PASSKEY_ERROR_CODES.CREDENTIAL_UNKNOWN };
  }
  if (credentialDoc.revokedAt) {
    return { ok: false, code: PASSKEY_ERROR_CODES.CREDENTIAL_REVOKED };
  }
  return { ok: true, uid: credentialDoc.uid };
}

/** Per-user cap. `existingCount` is the number of non-revoked credentials. */
function canRegisterAnotherPasskey(existingCount, limit = MAX_PASSKEYS_PER_USER) {
  if (Number(existingCount) >= limit) {
    return { ok: false, code: PASSKEY_ERROR_CODES.LIMIT_REACHED };
  }
  return { ok: true };
}

/** Friendly device name: trimmed, control chars stripped, bounded, defaulted. */
function sanitizePasskeyName(raw, fallback = "My passkey") {
  const cleaned = String(raw || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return cleaned || fallback;
}

/**
 * Staged-rollout gate. The master flag must be on; when either rollout list
 * is non-empty the caller must match one of them (uid allowlist OR role
 * allowlist). Empty lists with the flag on == everyone.
 */
function isPasskeyRolloutAllowed({ flags, role, uid }) {
  if (!flags || flags.enabled !== true) return false;
  const roles = Array.isArray(flags.rolloutRoles) ? flags.rolloutRoles : [];
  const uids = Array.isArray(flags.rolloutUids) ? flags.rolloutUids : [];
  if (roles.length === 0 && uids.length === 0) return true;
  if (uid && uids.includes(uid)) return true;
  if (role && roles.includes(role)) return true;
  return false;
}

/** Coarse device/browser category for audit rows — deliberately lossy so no
 * fingerprintable UA string is stored. */
function summarizeUserAgent(ua) {
  const s = String(ua || "").toLowerCase();
  if (!s) return "unknown";
  const os = s.includes("android")
    ? "android"
    : /iphone|ipad|ipod/.test(s)
      ? "ios"
      : s.includes("windows")
        ? "windows"
        : s.includes("mac os")
          ? "macos"
          : s.includes("linux")
            ? "linux"
            : "other";
  const browser = s.includes("edg/")
    ? "edge"
    : s.includes("samsungbrowser")
      ? "samsung-internet"
      : s.includes("firefox")
        ? "firefox"
        : s.includes("chrome")
          ? "chrome"
          : s.includes("safari")
            ? "safari"
            : "other";
  return `${os}/${browser}`;
}

/** Suggested default passkey name from the UA category (user can rename). */
function defaultPasskeyNameFromUa(ua) {
  const summary = summarizeUserAgent(ua);
  const [os] = summary.split("/");
  switch (os) {
    case "android": return "Android device";
    case "ios": return "iPhone or iPad";
    case "windows": return "Windows computer";
    case "macos": return "Mac";
    case "linux": return "Linux computer";
    default: return "My passkey";
  }
}

/** The only credential fields the client may ever see. Never the public key,
 * counter internals, or hashes. */
function credentialDocToSafeMetadata(id, doc) {
  return {
    id,
    name: doc.name || "My passkey",
    deviceType: doc.deviceType || null,
    backedUp: doc.backedUp === true,
    transports: Array.isArray(doc.transports) ? doc.transports : [],
    createdAtMs: typeof doc.createdAtMs === "number" ? doc.createdAtMs : null,
    lastUsedAtMs: typeof doc.lastUsedAtMs === "number" ? doc.lastUsedAtMs : null,
  };
}

/**
 * Parse the PASSKEY_ALLOWED_ORIGINS config (comma-separated) into a strict
 * origin allowlist. Wildcards are refused outright — a misconfigured value
 * fails closed to the production origin only.
 */
function resolveExpectedOrigins(rawList, productionOrigin = "https://zedexams.com") {
  const entries = String(rawList || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = entries.filter(
    (o) => /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(o) && !o.includes("*"),
  );
  if (!valid.includes(productionOrigin)) valid.push(productionOrigin);
  return valid;
}

module.exports = {
  MAX_PASSKEYS_PER_USER,
  CHALLENGE_TTL_MS,
  MAX_NAME_LENGTH,
  PASSKEY_ERROR_CODES,
  PASSKEY_AUDIT_EVENTS,
  sha256Hex,
  randomBase64Url,
  validateChallengeDoc,
  evaluateCounter,
  validateCredentialForAuth,
  canRegisterAnotherPasskey,
  sanitizePasskeyName,
  summarizeUserAgent,
  defaultPasskeyNameFromUa,
  credentialDocToSafeMetadata,
  resolveExpectedOrigins,
  isPasskeyRolloutAllowed,
};
