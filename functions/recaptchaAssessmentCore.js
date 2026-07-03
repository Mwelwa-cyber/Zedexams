/**
 * Pure, dependency-free helpers for the reCAPTCHA Enterprise assessment flow.
 *
 * Split out from the Cloud Function (recaptchaEnterprise.js + the
 * assessRecaptcha export in index.js) so the request-building and
 * score-interpretation logic tests under plain `node` with no
 * firebase-functions / google-auth-library dependency — the same `*Core.js`
 * pattern as metaWhatsAppCore.js. See functions/recaptchaAssessment.test.js.
 *
 * WHAT THIS IS: the app already attests all backend traffic with Firebase App
 * Check (reCAPTCHA v3 on web, Play Integrity on native — see
 * src/firebase/config.js). This is a SEPARATE, action-level signal: the native
 * Android reCAPTCHA Enterprise SDK mints a per-action token (login / signup /
 * …) that this server scores. App Check answers "is this a real ZedExams
 * client?"; reCAPTCHA Enterprise answers "does THIS login attempt look like a
 * bot?". They stack.
 */

// Public reCAPTCHA Enterprise site key for the Android app. Site keys are
// public by design (they ship inside the APK) — the secret half of the
// exchange is this server-side assessment call, which a compromised client
// cannot forge. Overridable via env so a staging key can be swapped in without
// a code change.
const ANDROID_SITE_KEY =
  process.env.RECAPTCHA_ANDROID_SITE_KEY ||
  "6LewHUMtAAAAAPCk2gQ-v3Ew6tZKYk3w2a3xRvDP";

// Score thresholds. reCAPTCHA returns 0.0 (very likely a bot) … 1.0 (very
// likely human). Below BLOCK we return verdict 'block'; between BLOCK and
// CHALLENGE we return 'challenge' (advisory — there's no interactive challenge
// UI yet, so the client currently treats it the same as allow); at or above
// CHALLENGE we 'allow'. Deliberately lenient for the initial rollout so a
// noisy model can't lock real Zambian users out; tighten once the score
// distribution is observed on /admin.
const DEFAULT_THRESHOLDS = Object.freeze({block: 0.3, challenge: 0.5});

// reCAPTCHA mobile tokens are long opaque strings. Anything shorter than this
// is junk (or an empty/garbage spam call) and is not worth a paid Assessment
// API round-trip — short-circuit to 'skip' before we ever call Google.
const MIN_TOKEN_LENGTH = 20;

/**
 * Resolve the GCP / Firebase project id that owns the reCAPTCHA key. Cloud
 * Functions injects GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT at runtime; the
 * literal is the last-resort fallback for local/test contexts.
 * @returns {string}
 */
function resolveProjectId() {
  return (
    process.env.RECAPTCHA_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "examsprepzambia"
  );
}

/**
 * REST endpoint for creating an assessment in the given project.
 * @param {string} projectId
 * @returns {string}
 */
function assessmentUrl(projectId) {
  return `https://recaptchaenterprise.googleapis.com/v1/projects/${projectId}/assessments`;
}

/**
 * Build the createAssessment request body. `expectedAction` is included when an
 * action is supplied so Google can flag a token whose baked-in action doesn't
 * match what the server expected (a replay / tampering signal).
 * @param {{token: string, action?: string, siteKey: string}} args
 * @returns {{event: object}}
 */
function buildAssessmentRequest({token, action, siteKey}) {
  const event = {token, siteKey};
  if (action) event.expectedAction = action;
  return {event};
}

/**
 * True when the token is long enough to be a genuine reCAPTCHA token worth
 * sending to the Assessment API.
 * @param {string} token
 * @returns {boolean}
 */
function isAssessableToken(token) {
  return typeof token === "string" && token.length >= MIN_TOKEN_LENGTH;
}

/**
 * Turn a raw createAssessment response into a client-facing verdict.
 *
 * The client policy (src/utils/recaptcha.js) is: proceed unless verdict ===
 * 'block'. So this function only returns 'block' when there is a genuine,
 * trustworthy low-score signal. Setup-time ambiguities (invalid token, action
 * mismatch, missing score) resolve to 'skip' so a misconfiguration during
 * rollout can never lock users out — fail open by construction.
 *
 * @param {object} assessment raw createAssessment response
 * @param {{expectedAction?: string, thresholds?: {block:number, challenge:number}}} [opts]
 * @returns {{verdict: 'allow'|'challenge'|'block'|'skip', score: (number|null),
 *   valid: boolean, tokenAction: (string|null), reasons: string[],
 *   invalidReason?: string, actionMismatch?: boolean, reason?: string}}
 */
function interpretAssessment(assessment, opts = {}) {
  const thresholds = opts.thresholds || DEFAULT_THRESHOLDS;
  const tokenProps = assessment?.tokenProperties || {};
  const risk = assessment?.riskAnalysis || {};

  const valid = tokenProps.valid === true;
  const tokenAction =
    typeof tokenProps.action === "string" ? tokenProps.action : null;
  const reasons = Array.isArray(risk.reasons) ? risk.reasons : [];
  const score = typeof risk.score === "number" ? risk.score : null;

  // Invalid token — expired, forged, duplicate, or (most likely during setup)
  // a key/package mismatch. Surface why, but don't block: fail open.
  if (!valid) {
    return {
      verdict: "skip",
      score: null,
      valid: false,
      tokenAction,
      reasons,
      invalidReason: tokenProps.invalidReason || "UNKNOWN",
    };
  }

  // Action baked into the token doesn't match what the server expected. This
  // *can* be tampering, but it's also the classic symptom of the client
  // labelling actions differently than the server — skip during rollout.
  if (opts.expectedAction && tokenAction && tokenAction !== opts.expectedAction) {
    return {
      verdict: "skip",
      score,
      valid: true,
      tokenAction,
      reasons,
      actionMismatch: true,
    };
  }

  // Valid token but no score (shouldn't happen for a valid token, but guard) —
  // nothing to act on.
  if (score === null) {
    return {
      verdict: "skip",
      score: null,
      valid: true,
      tokenAction,
      reasons,
      reason: "no-score",
    };
  }

  let verdict = "allow";
  if (score < thresholds.block) verdict = "block";
  else if (score < thresholds.challenge) verdict = "challenge";

  return {verdict, score, valid: true, tokenAction, reasons};
}

module.exports = {
  ANDROID_SITE_KEY,
  DEFAULT_THRESHOLDS,
  MIN_TOKEN_LENGTH,
  resolveProjectId,
  assessmentUrl,
  buildAssessmentRequest,
  isAssessableToken,
  interpretAssessment,
};
