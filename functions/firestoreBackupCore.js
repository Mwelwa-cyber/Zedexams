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

/**
 * Build the Firestore Admin importDocuments request for a RESTORE. The
 * inputUriPrefix must be the SAME folder buildExportRequest wrote to for a
 * given day, so a restore is the exact inverse of a backup. Used by
 * scripts/restore-firestore.mjs (see docs/production-readiness/
 * 14-backup-and-disaster-recovery.md). Restoring is destructive-by-overwrite
 * and MUST target a scratch database first — never blind-import into prod.
 *
 * @param {object} p
 * @param {string} p.projectId    — GCP project id (required)
 * @param {string} p.bucketUri    — canonical gs:// uri from resolveBackupBucket
 * @param {string} p.dateKey      — YYYY-MM-DD folder the export landed in
 * @param {string} [p.databaseId] — target database (default "(default)")
 * @returns {{name: string, inputUriPrefix: string, collectionIds: string[]}}
 */
function buildImportRequest({projectId, bucketUri, dateKey, databaseId = "(default)"}) {
  if (!projectId) throw new Error("projectId is required to build an import request");
  if (!bucketUri || !bucketUri.startsWith("gs://")) {
    throw new Error("bucketUri must be a canonical gs:// uri");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey))) {
    throw new Error("dateKey must be YYYY-MM-DD");
  }
  return {
    name: `projects/${projectId}/databases/${databaseId}`,
    inputUriPrefix: `${bucketUri}/firestore-exports/${dateKey}`,
    collectionIds: [],
  };
}

// ── Runtime environment classification ─────────────────────────────────────
// A missing backup bucket means very different things in prod vs a dev/emulator
// run: in production it is a MISCONFIGURATION that must alert loudly (the whole
// DR floor is off); in a dev/emulator run it is an expected, explicit SKIP.
// Pure so the classification is unit-testable without a live runtime.
//
// Emulator/dev markers (any present ⇒ non-production):
//   FUNCTIONS_EMULATOR=true, FIRESTORE_EMULATOR_HOST, FIREBASE_EMULATOR_HUB,
//   NODE_ENV=development/test.
/**
 * @param {Record<string,string|undefined>} [env]
 * @returns {boolean} true when this looks like a real production runtime.
 */
function isProductionRuntime(env = {}) {
  const e = env || {};
  if (String(e.FUNCTIONS_EMULATOR) === "true") return false;
  if (e.FIRESTORE_EMULATOR_HOST) return false;
  if (e.FIREBASE_EMULATOR_HUB) return false;
  const nodeEnv = String(e.NODE_ENV || "").toLowerCase();
  if (nodeEnv === "development" || nodeEnv === "test") return false;
  return true;
}

/**
 * Categorise an export/import failure so logs + alerts carry a stable,
 * greppable category instead of a raw provider string. Pure.
 *
 * @param {string|Error} err
 * @returns {{code: string, category: string}}
 *   category ∈ 'permission' | 'timeout' | 'destination' | 'quota' | 'unknown'
 */
function classifyExportError(err) {
  const msg = String((err && err.message) || err || "").slice(0, 500);
  const m = msg.toUpperCase();
  let category = "unknown";
  if (/PERMISSION_DENIED|\bIAM\b|FORBIDDEN|\b403\b|UNAUTHENTICATED|\b401\b/.test(m)) {
    category = "permission";
  } else if (/DEADLINE_EXCEEDED|TIMEOUT|ETIMEDOUT|DEADLINE/.test(m)) {
    category = "timeout";
  } else if (/BUCKET|NO SUCH OBJECT|NOT_FOUND|\b404\b|STORAGE|NO_SUCH_BUCKET/.test(m)) {
    category = "destination";
  } else if (/RESOURCE_EXHAUSTED|QUOTA|RATE_LIMIT|\b429\b/.test(m)) {
    category = "quota";
  }
  // A short machine code from the leading TOKEN of the message, if any.
  const codeMatch = /^([A-Z][A-Z0-9_]{2,40})[:\s]/.exec(msg.trim());
  const code = codeMatch ? codeMatch[1] : category.toUpperCase();
  return {code, category};
}

// ── Retention selection (pure) ─────────────────────────────────────────────
// Decide which daily exports to prune. Retention is primarily a GCS bucket
// LIFECYCLE rule (see the runbook) — this pure selector is the code-level
// safeguard for an optional cleanup runner, with hard guarantees the tests
// pin. It NEVER deletes the newest export, never deletes an incomplete
// (still-being-created / unverified) export, and always keeps at least
// `keepMinimum` of the most-recent COMPLETED exports. Ambiguous metadata
// fails safe (kept).
/**
 * @param {Array<{path?: string, dateKey?: string, createdAtMs?: number,
 *   completed?: boolean}>} exports
 * @param {object} [opts]
 * @param {number} [opts.retentionDays=30]
 * @param {number} [opts.keepMinimum=7]
 * @param {number} [opts.nowMs]  — millis (injected; no Date.now in pure code)
 * @returns {{toDelete: Array<object>, kept: Array<object>}}
 */
function selectExportsToDelete(exports, {retentionDays = 30, keepMinimum = 7, nowMs} = {}) {
  const list = Array.isArray(exports) ? exports.slice() : [];
  const now = Number.isFinite(nowMs) ? nowMs : 0;
  // Newest first by createdAtMs (fallback to dateKey string order).
  list.sort((a, b) => {
    const at = Number(a && a.createdAtMs) || 0;
    const bt = Number(b && b.createdAtMs) || 0;
    if (bt !== at) return bt - at;
    return String((b && b.dateKey) || "").localeCompare(String((a && a.dateKey) || ""));
  });
  const completed = list.filter((e) => e && e.completed === true);
  const newestCompletedPath = completed.length ? completed[0].path : null;
  const cutoff = now - retentionDays * 24 * 60 * 60 * 1000;
  let keptCompleted = 0;
  const toDelete = [];
  const kept = [];
  for (const e of list) {
    // Fail-safe: never touch anything not explicitly marked completed.
    if (!e || e.completed !== true) { kept.push(e); continue; }
    // Never the newest completed export.
    if (e.path && e.path === newestCompletedPath) { kept.push(e); keptCompleted++; continue; }
    // Always keep at least `keepMinimum` most-recent completed exports.
    if (keptCompleted < keepMinimum) { kept.push(e); keptCompleted++; continue; }
    // Only age out completed exports older than the retention window.
    const created = Number(e.createdAtMs) || 0;
    if (created > 0 && created < cutoff) { toDelete.push(e); } else { kept.push(e); }
  }
  return {toDelete, kept};
}

module.exports = {
  resolveBackupBucket,
  buildExportRequest,
  buildImportRequest,
  isProductionRuntime,
  classifyExportError,
  selectExportsToDelete,
};
