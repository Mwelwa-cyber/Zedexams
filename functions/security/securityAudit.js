// Security audit ledger for MFA + admin-security events.
//
// Separate collection from adminAuditLogs (content/user moderation) so the
// security-sensitive trail — enrolments, challenges, resets, session
// revocations, role grants, denied access — is queryable on its own and can be
// restricted to super admins at the rules layer. Writes go through the Admin
// SDK (bypassing Firestore rules, which deny all client writes here) so the log
// is tamper-resistant.
//
// SAFETY: this writer accepts ONLY the fixed safe metadata fields below. TOTP
// secrets, QR URIs, authenticator codes, passwords, raw ID/refresh tokens and
// service-account credentials must NEVER be passed — and even if a caller
// mistakenly does, only the allow-listed keys are persisted, and `metadata` is
// shallow-scrubbed of any obviously-sensitive key.

const admin = require("firebase-admin");

// Canonical event types (Phase 11). Kept as a frozen map so callers reference a
// constant instead of a stray string literal.
const SECURITY_EVENTS = Object.freeze({
  MFA_ENROLL_STARTED: "mfa.enroll.started",
  MFA_ENROLL_COMPLETED: "mfa.enroll.completed",
  MFA_ENROLL_FAILED: "mfa.enroll.failed",
  MFA_CHALLENGE_COMPLETED: "mfa.challenge.completed",
  MFA_CHALLENGE_FAILED: "mfa.challenge.failed",
  MFA_RESET_REQUESTED: "mfa.reset.requested",
  MFA_RESET_APPROVED: "mfa.reset.approved",
  MFA_FACTORS_REMOVED: "mfa.factors.removed",
  ADMIN_SESSIONS_REVOKED: "admin.sessions.revoked",
  ADMIN_ROLE_GRANTED: "admin.role.granted",
  ADMIN_ROLE_REMOVED: "admin.role.removed",
  ADMIN_ACCESS_DENIED_NO_MFA: "admin.access.denied_no_mfa",
  // An admin aimed a role or status change at their own account. Both admin
  // screens disable the control, so this only fires for a stale client or a
  // direct callable invocation. See security/selfTargetGuardCore.js.
  ADMIN_SELF_TARGET_DENIED: "admin.self_target.denied",
});

// Keys that must never be written even if a caller passes them by mistake.
const FORBIDDEN_METADATA_KEYS = new Set([
  "secret",
  "totpSecret",
  "sharedSecret",
  "secretKey",
  "qrCodeUrl",
  "qrCodeUri",
  "otpauth",
  "code",
  "verificationCode",
  "otp",
  "password",
  "idToken",
  "refreshToken",
  "token",
  "credential",
  "serviceAccount",
  "privateKey",
]);

function scrubMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const out = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) continue;
    // Only keep primitive-ish, obviously-safe values; drop nested objects that
    // could smuggle a secret.
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
      out[key] = typeof value === "string" ? value.slice(0, 500) : value;
    }
  }
  return Object.keys(out).length ? out : null;
}

/**
 * writeSecurityAudit — append one security event to securityAuditLogs.
 *
 * Fields (all optional except eventType + actorUid): actorUid, targetUid,
 * actorRole, reason, requestId, userAgent, outcome ('success' | 'failure' |
 * 'denied' | 'started'), plus a scrubbed `metadata` bag. Never throws — an
 * audit failure must not break the action it records.
 */
async function writeSecurityAudit({
  eventType,
  actorUid = null,
  targetUid = null,
  actorRole = null,
  outcome = null,
  reason = null,
  requestId = null,
  userAgent = null,
  metadata = null,
}) {
  if (!eventType) {
    console.error("[securityAudit] eventType is required");
    return;
  }
  try {
    await admin.firestore().collection("securityAuditLogs").add({
      eventType,
      actorUid,
      targetUid,
      actorRole,
      outcome,
      reason: reason ? String(reason).slice(0, 500) : null,
      requestId: requestId ? String(requestId).slice(0, 200) : null,
      userAgent: userAgent ? String(userAgent).slice(0, 400) : null,
      metadata: scrubMetadata(metadata),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[securityAudit] write failed", { eventType, err: err?.message });
  }
}

// Pull coarse request metadata (userAgent) from a callable request without
// pulling anything sensitive. IP is deliberately omitted (not reliably safe/PII
// in this context); userAgent is enough for triage.
function requestMetaFrom(request) {
  const rawReq = request?.rawRequest;
  const userAgent = rawReq?.headers?.["user-agent"] || rawReq?.get?.("user-agent") || null;
  return { userAgent: userAgent ? String(userAgent).slice(0, 400) : null };
}

module.exports = {
  SECURITY_EVENTS,
  writeSecurityAudit,
  scrubMetadata,
  requestMetaFrom,
};
