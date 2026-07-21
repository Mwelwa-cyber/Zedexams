/**
 * src/services/adminMfa.js
 *
 * Reusable TOTP multi-factor service for administrator accounts. All Firebase
 * MFA logic lives here (modular SDK), so UI components never touch the raw
 * enrol/challenge APIs. Compatible with Google Authenticator, Microsoft
 * Authenticator, Authy, 1Password and any other RFC 6238 authenticator.
 *
 * SECURITY CONTRACT:
 *   - The TOTP secret returned by beginTotpEnrollment lives ONLY in the caller's
 *     component memory until enrolment completes. This module never persists,
 *     logs, or transmits it (no console.log, no Firestore, no analytics).
 *   - Firebase Authentication enrolment state is the source of truth for
 *     "does this admin have MFA" — never a Firestore boolean.
 *   - The multi-factor RESOLVER used during a login challenge is likewise held
 *     only in memory by the caller; it is never serialised.
 */

import {
  multiFactor,
  TotpMultiFactorGenerator,
  getMultiFactorResolver,
  reauthenticateWithPopup,
  reauthenticateWithCredential,
  EmailAuthProvider,
} from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import app, { auth, googleProvider } from "../firebase/config";
import { isNativePlatform } from "../utils/runtime";

const functions = getFunctions(app, "us-central1");

/**
 * Best-effort security-audit ping for an MFA enrolment event. Fire-and-forget:
 * a logging hiccup must never block or fail the enrolment itself. `reasonCode`
 * is a short, non-sensitive code for failures only — NEVER the secret or the
 * entered code.
 */
export function recordMfaEnrollmentEvent(event, reasonCode) {
  try {
    const call = httpsCallable(functions, "logAdminMfaEvent");
    return call({ event, reasonCode }).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

export const TOTP_ISSUER = "ZedExams";

// ── Enrolment status ───────────────────────────────────────────────────────

/** The list of enrolled second factors for a user (safe metadata only). */
export function getEnrolledFactors(user) {
  if (!user) return [];
  try {
    return multiFactor(user).enrolledFactors || [];
  } catch {
    return [];
  }
}

/** True when the user has at least one enrolled second factor. */
export function hasMfaEnrolled(user) {
  return getEnrolledFactors(user).length > 0;
}

/** The TOTP factor id constant, exposed so callers can match hints. */
export const TOTP_FACTOR_ID = TotpMultiFactorGenerator.FACTOR_ID;

// ── Reauthentication (Phase 4) ───────────────────────────────────────────────

/** The primary sign-in provider id for a user ('password', 'google.com', …). */
export function primaryProviderId(user) {
  return user?.providerData?.[0]?.providerId || (user?.email ? "password" : "");
}

/**
 * Reauthenticate a Google-provider admin. Uses the existing web popup strategy;
 * the native WebView cannot open the Google reauth popup, so callers on native
 * should fall back to a clear "use the web app" message.
 */
export async function reauthenticateWithGoogle(user) {
  if (isNativePlatform()) {
    const err = new Error("Google reauthentication isn't available in the app.");
    err.code = "auth/operation-not-supported-in-this-environment";
    throw err;
  }
  return reauthenticateWithPopup(user, googleProvider);
}

/**
 * Reauthenticate an email/password admin. The password is used once for the
 * credential and never stored.
 */
export async function reauthenticateWithPassword(user, password) {
  if (!user?.email) {
    const err = new Error("This account has no email to reauthenticate.");
    err.code = "auth/unsupported-first-factor";
    throw err;
  }
  const credential = EmailAuthProvider.credential(user.email, password);
  return reauthenticateWithCredential(user, credential);
}

// ── TOTP enrolment (Phase 5) ─────────────────────────────────────────────────

/**
 * Begin TOTP enrolment: open an MFA session and generate a fresh secret.
 * Returns { secret, qrCodeUrl, secretKey }. The `secret` object is required by
 * completeTotpEnrollment and must be kept in memory only.
 *
 * May throw auth/requires-recent-login when the session is stale — the caller
 * should reauthenticate and retry.
 */
export async function beginTotpEnrollment(user, { requireVerifiedEmail = true } = {}) {
  if (!user) {
    const err = new Error("You must be signed in to set up MFA.");
    err.code = "auth/user-token-expired";
    throw err;
  }
  // For password accounts, Firebase requires a verified email before enrolment.
  if (requireVerifiedEmail && primaryProviderId(user) === "password" && user.emailVerified !== true) {
    const err = new Error("Please verify your email address before setting up MFA.");
    err.code = "auth/unverified-email";
    throw err;
  }
  const mfaUser = multiFactor(user);
  const session = await mfaUser.getSession();
  const secret = await TotpMultiFactorGenerator.generateSecret(session);
  const accountName = user.email || user.uid;
  const qrCodeUrl = secret.generateQrCodeUrl(accountName, TOTP_ISSUER);
  // secretKey is the base32 shared secret shown as the manual-entry fallback.
  return { secret, qrCodeUrl, secretKey: secret.secretKey };
}

/**
 * Complete TOTP enrolment with the 6-digit code from the authenticator app.
 * Only resolves once Firebase confirms the factor is added; then forces an ID
 * token refresh so the app sees the new enrolment state immediately.
 */
export async function completeTotpEnrollment(user, secret, verificationCode, displayName = "Authenticator app") {
  if (!user) {
    const err = new Error("You must be signed in to set up MFA.");
    err.code = "auth/user-token-expired";
    throw err;
  }
  if (!secret) {
    const err = new Error("Your setup session has expired. Please start again.");
    err.code = "auth/invalid-multi-factor-session";
    throw err;
  }
  const code = String(verificationCode || "").replace(/\D/g, "");
  const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code);
  // Throws (and does NOT mark enrolled) on a bad code — the caller surfaces it.
  await multiFactor(user).enroll(assertion, displayName);
  // Refresh the ID token so the second-factor claim + enrolment state are
  // current for the route guard and any immediate privileged call.
  try {
    await user.getIdToken(true);
  } catch {
    /* token refresh is best-effort; the enrol already succeeded */
  }
  return true;
}

/** Remove a specific enrolled factor by uid. */
export async function unenrollFactor(user, factorUid) {
  if (!user) return false;
  await multiFactor(user).unenroll(factorUid);
  try {
    await user.getIdToken(true);
  } catch {
    /* best-effort */
  }
  return true;
}

// ── Login challenge (Phase 6) ────────────────────────────────────────────────

/**
 * Build the multi-factor resolver from an auth/multi-factor-auth-required error.
 * The resolver holds the pending sign-in session and the enrolled hints; keep it
 * in memory only.
 */
export function getResolver(error) {
  return getMultiFactorResolver(auth, error);
}

/** Find the enrolled TOTP hint on a resolver, or null. */
export function findTotpHint(resolver) {
  const hints = resolver?.hints || [];
  return hints.find((h) => h.factorId === TOTP_FACTOR_ID) || hints[0] || null;
}

/**
 * Complete a login MFA challenge with the 6-digit authenticator code. Resolves
 * to the signed-in UserCredential; the normal role/route resolution continues
 * from there.
 */
export async function completeTotpSignIn(resolver, hint, verificationCode) {
  if (!resolver || !hint) {
    const err = new Error("This verification session has expired. Please sign in again.");
    err.code = "auth/invalid-multi-factor-session";
    throw err;
  }
  const code = String(verificationCode || "").replace(/\D/g, "");
  const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
  return resolver.resolveSignIn(assertion);
}
