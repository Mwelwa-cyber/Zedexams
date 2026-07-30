/**
 * Pure helpers for the Firebase Storage backup HEALTH CHECK (DR-003). No
 * firebase-admin / firebase-functions deps so they test under plain `node`
 * (the *Core.js split, same as firestoreBackupCore / metaWhatsAppCore).
 *
 * Why a health check and not a copy loop: the Firestore export (DR-001) covers
 * Firestore only — generated images, uploads, exports and past papers in the
 * Storage bucket have NO backup, and a delete (accidental or malicious) is
 * unrecoverable. The correct fix is infrastructure the operator provisions
 * once: Object Versioning on the primary bucket + a scheduled cross-region
 * mirror (Storage Transfer Service). A Cloud Function copying the whole bucket
 * object-by-object every day would be the wrong architecture (cost, timeouts,
 * scale). What CODE adds is what closes the actual risk — making that mirror
 * VERIFIABLE: a daily check that the backup bucket received recent objects, so
 * a silently-broken mirror alerts instead of being discovered during a
 * disaster. These helpers own the two decisions worth pinning in tests: how the
 * backup destination is resolved from config, and how "fresh / stale / empty"
 * is decided from the newest backed-up object's timestamp.
 */

const HOUR_MS = 60 * 60 * 1000;

// A daily mirror plus generous slack: a backup older than this is treated as a
// failed/stalled mirror and alerts. Tunable via STORAGE_BACKUP_MAX_AGE_HOURS.
const DEFAULT_MAX_AGE_HOURS = 26;

/**
 * Normalize the configured Storage backup bucket to a BARE bucket name (the
 * shape admin.storage().bucket(name) wants). Accepts "bucket-name" or
 * "gs://bucket-name" (optional trailing slash). Returns null when unset/blank
 * or syntactically invalid — null means "Storage backup not configured", which
 * the checker treats as misconfigured-in-prod / skip-in-dev, never a throw, so
 * deploying before the mirror exists is safe.
 *
 * @param {string|undefined|null} raw
 * @returns {string|null}
 */
function resolveStorageBackupBucket(raw) {
  const trimmed = String(raw == null ? "" : raw).trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const bare = trimmed.replace(/^gs:\/\//, "");
  // GCS bucket names: lowercase letters, digits, dashes, underscores, dots.
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bare)) return null;
  return bare;
}

/**
 * Resolve the maxAge threshold (ms) from an hours value, falling back to the
 * default when unset/invalid/non-positive. Pure.
 * @param {string|number|undefined} rawHours
 * @returns {number}
 */
function resolveMaxAgeMs(rawHours) {
  const n = parseFloat(rawHours);
  return (Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_HOURS) * HOUR_MS;
}

module.exports = {
  HOUR_MS,
  DEFAULT_MAX_AGE_HOURS,
  resolveStorageBackupBucket,
  resolveMaxAgeMs,
};
