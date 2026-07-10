/**
 * Pure helpers for the daily Firestore backup export (no firebase-admin /
 * firebase-functions deps, so they test under plain `node` — the *Core.js
 * split, same as metaWhatsAppCore / googlePlayBillingCore).
 *
 * The export itself is a Firestore Admin API long-running operation
 * (exportDocuments) into a GCS bucket. These helpers own the two decisions
 * worth pinning in tests: how the destination is resolved/validated from
 * config, and the exact request shape sent to the Admin API.
 */

/**
 * Normalize the configured backup bucket. Accepts "bucket-name" or
 * "gs://bucket-name" (with optional trailing slash); returns a canonical
 * "gs://bucket-name" or null when unset/blank — null means "backups not
 * configured", which the cron treats as skip-with-warning, never a throw,
 * so shipping the function before the bucket exists is safe.
 *
 * @param {string|undefined|null} raw
 * @returns {string|null}
 */
function resolveBackupBucket(raw) {
  const trimmed = String(raw == null ? "" : raw).trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  const bare = trimmed.replace(/^gs:\/\//, "");
  // GCS bucket names: lowercase letters, digits, dashes, underscores, dots.
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bare)) return null;
  return `gs://${bare}`;
}

/**
 * Build the Firestore Admin exportDocuments request. Dated prefix so each
 * day's export lands in its own folder and bucket lifecycle rules can
 * expire old ones.
 *
 * @param {object} p
 * @param {string} p.projectId   — GCP project id (required)
 * @param {string} p.bucketUri   — canonical gs:// uri from resolveBackupBucket
 * @param {string} p.dateKey     — YYYY-MM-DD folder name
 * @param {string} [p.databaseId] — defaults to the "(default)" database
 * @returns {{name: string, outputUriPrefix: string, collectionIds: string[]}}
 */
function buildExportRequest({projectId, bucketUri, dateKey, databaseId = "(default)"}) {
  if (!projectId) throw new Error("projectId is required to build an export request");
  if (!bucketUri || !bucketUri.startsWith("gs://")) {
    throw new Error("bucketUri must be a canonical gs:// uri");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) {
    throw new Error("dateKey must be YYYY-MM-DD");
  }
  return {
    name: `projects/${projectId}/databases/${databaseId}`,
    outputUriPrefix: `${bucketUri}/firestore-exports/${dateKey}`,
    // Empty = export every collection. A partial backup that silently
    // omitted a collection would be worse than none.
    collectionIds: [],
  };
}

module.exports = {resolveBackupBucket, buildExportRequest};
