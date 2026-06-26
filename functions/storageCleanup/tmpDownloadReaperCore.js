/**
 * Pure sweep logic for the tmp-downloads/ reaper, with NO firebase-admin /
 * firebase-functions requires — so a plain `node` test can import it without the
 * functions/ dependencies installed (CI only installs the root deps).
 */

const MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const DELETE_LIMIT_PER_RUN = 5000;

/**
 * Delete every object under `tmp-downloads/` whose creation time is older than
 * one hour. Files without a parseable timestamp are left alone (never reaped
 * blindly). `bucket` is the GCS bucket; `nowMs` is injectable for testing.
 *
 * @returns {Promise<number>} count of objects deleted.
 */
async function reapTmpDownloads(bucket, nowMs) {
  const cutoff = nowMs - MAX_AGE_MS;
  let deleted = 0;
  const [files] = await bucket.getFiles({ prefix: "tmp-downloads/" });
  for (const file of files || []) {
    if (deleted >= DELETE_LIMIT_PER_RUN) break;
    const created = file.metadata && file.metadata.timeCreated;
    const ms = created ? Date.parse(created) : NaN;
    if (!Number.isFinite(ms) || ms >= cutoff) continue;
    try {
      await file.delete({ ignoreNotFound: true });
      deleted += 1;
    } catch (err) {
      console.warn("[tmpDownloadReaper] delete failed",
        (err && err.message) || err);
    }
  }
  return deleted;
}

module.exports = { reapTmpDownloads, MAX_AGE_MS, DELETE_LIMIT_PER_RUN };
