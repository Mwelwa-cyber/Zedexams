/**
 * functions/cors.js
 *
 * Single source of truth for browser CORS on the bearer-token HTTP
 * endpoints (apiAiChat, apiTextToSpeech, the lesson-plan/worksheet
 * streaming endpoints).
 *
 * Dependency-free (no firebase-admin / firebase-functions imports) so it
 * is unit-tested by the repo-root `npm run test:all` without functions/
 * deps — same pattern as functions/aiPromptPolicy.js.
 *
 * Why: these endpoints used to send `Access-Control-Allow-Origin: *`
 * (or v2 `cors:true`, which reflects ANY origin). They're authenticated
 * with a Firebase ID token in the Authorization header (no cookies, so
 * `*` "works"), but a wildcard still lets any site script the API from a
 * victim's browser. An explicit allow-list is the correct posture.
 *
 * No credentials are used (no Allow-Credentials, no withCredentials), so
 * a single matched origin is echoed back — never `*`.
 */

// Confirmed with the project owner (2026-05-16). Keep in sync with the
// real deployed origins; an origin missing here breaks that surface in
// the browser (payments / chat / TTS).
const ALLOWED_ORIGINS = [
  "https://zedexams.com",
  "https://www.zedexams.com",
  "https://examsprepzambia.web.app",
  "https://examsprepzambia.firebaseapp.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

// Firebase Hosting preview channels: examsprepzambia--<channel>-<hash>.web.app
const PREVIEW_ORIGIN_RE =
  /^https:\/\/examsprepzambia--[a-z0-9][a-z0-9-]*\.web\.app$/;

function isAllowedOrigin(origin) {
  if (!origin || typeof origin !== "string") return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return PREVIEW_ORIGIN_RE.test(origin);
}

const DEFAULT_HEADERS = "Content-Type, Authorization, X-Firebase-AppCheck";
const DEFAULT_METHODS = "GET, POST, OPTIONS";

/**
 * Set CORS response headers from the request Origin.
 *
 * - No Origin header (non-browser: Capacitor native, curl, server) →
 *   ACAO is not set. CORS does not apply to non-browser clients, so the
 *   request proceeds normally — native must keep working.
 * - Allowed browser Origin → echo that exact origin back (never `*`).
 * - Disallowed browser Origin → ACAO not set; the browser blocks the
 *   response. Status is intentionally NOT changed here so non-browser
 *   callers are unaffected and preflight stays a clean 204.
 *
 * Always sets `Vary: Origin` so a shared cache can't serve one origin's
 * ACAO to another.
 */
function applyCors(req, res, opts = {}) {
  res.set("Vary", "Origin");
  res.set("Access-Control-Allow-Headers", opts.headers || DEFAULT_HEADERS);
  res.set("Access-Control-Allow-Methods", opts.methods || DEFAULT_METHODS);
  const origin =
    req && typeof req.get === "function" ? req.get("origin") : undefined;
  if (origin && isAllowedOrigin(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
  }
}

module.exports = {ALLOWED_ORIGINS, isAllowedOrigin, applyCors};
