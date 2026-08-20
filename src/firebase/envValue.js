/**
 * src/firebase/envValue.js
 *
 * Whitespace-proofing for the public `VITE_FIREBASE_*` config.
 *
 * WHY THIS EXISTS — the orphaned-session incident:
 * A production build shipped with a trailing newline in VITE_FIREBASE_API_KEY.
 * Firebase Auth keys its persisted session by the API key, so every user who
 * signed in during that window was written to
 *   firebase:authUser:AIzaSy…62bA\n:[DEFAULT]
 * and every build since — reading the clean key — has looked in
 *   firebase:authUser:AIzaSy…62bA:[DEFAULT]
 * and found nothing. Those sessions were not expired or rejected. They were
 * silently unreachable, and the records are still in IndexedDB on those
 * devices today.
 *
 * Nothing failed loudly. The key was accepted, requests succeeded, and the only
 * symptom was users being signed out for no reason they could describe — which
 * is indistinguishable from every other cause of the same complaint.
 *
 * So trimming is applied to EVERY value rather than to the API key alone. The
 * API key is the one that orphans sessions, but a newline in `projectId` or
 * `appId` fails just as quietly, and a rule that covers one field invites the
 * next one to be added without it.
 *
 * Deliberately firebase-free so it unit-tests under plain `node`.
 */

/**
 * Read one env value, trimming surrounding whitespace.
 *
 * Returns `undefined` for absent/blank values rather than `''`, because the
 * Firebase SDK treats a missing key and an empty-string key differently: a
 * missing `apiKey` is a clear init error, while `''` produces the opaque
 * `auth/invalid-api-key` white screen documented in .env.smoke.
 *
 * @param {unknown} value Raw `import.meta.env.*` value.
 * @returns {string|undefined}
 */
export function envValue(value) {
  if (typeof value !== 'string') return value == null ? undefined : value
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Does a raw env value carry surrounding whitespace that `envValue` would strip?
 *
 * Used by the guard test to fail a committed dotenv file rather than let the
 * runtime silently paper over it — trimming is a safety net, not a licence to
 * ship a malformed value.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasSurroundingWhitespace(value) {
  return typeof value === 'string' && value !== value.trim()
}
