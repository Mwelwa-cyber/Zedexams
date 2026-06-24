/**
 * functions/imageProxyCore.js
 *
 * Pure URL-gate for the same-origin image proxy (SSRF guard). Kept
 * dependency-free (no firebase-functions / firebase-admin) so it is unit-tested
 * by the repo-root `npm run test:all` without functions/ deps — same pattern as
 * functions/cors.js. The onRequest wrapper lives in functions/imageProxy.js.
 */

// Only these hosts ever serve our Storage objects: the Firebase download-URL
// host (…/v0/b/<bucket>/o/<path>?alt=media&token=…) and the raw GCS host used
// by signed URLs (…/<bucket>/<path>?…). Blocking everything else stops the
// classic SSRF targets (localhost, 169.254.169.254 metadata, internal hosts).
const ALLOWED_HOSTS = new Set([
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
]);

/**
 * Validate a candidate image URL and return the safe, normalised URL string to
 * fetch, or null if it must be rejected. Pure (no I/O).
 *
 * @param {string} raw
 * @param {string} projectId The Firebase project id; both the newer
 *   `<project>.firebasestorage.app` and legacy `<project>.appspot.com` bucket
 *   names start with it, so a single prefix check covers both and keeps us from
 *   proxying arbitrary public GCS buckets.
 * @returns {string|null}
 */
function resolveStorageTarget(raw, projectId = "examsprepzambia") {
  if (!raw || typeof raw !== "string") return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (!ALLOWED_HOSTS.has(u.hostname)) return null;

  let bucket = null;
  if (u.hostname === "firebasestorage.googleapis.com") {
    // /v0/b/<bucket>/o/<encoded-path>
    const m = u.pathname.match(/^\/v0\/b\/([^/]+)\/o\//);
    if (m) bucket = decodeURIComponent(m[1]);
  } else {
    // storage.googleapis.com/<bucket>/<path>
    const m = u.pathname.match(/^\/([^/]+)\//);
    if (m) bucket = decodeURIComponent(m[1]);
  }
  if (!bucket) return null;
  // Must be one of THIS project's buckets (…firebasestorage.app / …appspot.com).
  if (bucket !== projectId && !bucket.startsWith(`${projectId}.`)) return null;

  return u.toString();
}

module.exports = {ALLOWED_HOSTS, resolveStorageTarget};
