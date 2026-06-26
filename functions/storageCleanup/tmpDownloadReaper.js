/**
 * Scheduled sweeper for the `tmp-downloads/` export-staging prefix.
 *
 * saveViaStampedUrl (src/utils/stampedDownload.js) uploads a just-generated
 * file there so its real filename can ride on the download via Content-
 * Disposition metadata (the universal fallback for browsers that mangle blob:
 * download names). The client best-effort deletes its own temp object ~90s
 * later, but a closed tab or a failed delete can leave stragglers — this reaps
 * anything older than an hour so the prefix can never grow unbounded.
 *
 * The pure sweep logic lives in tmpDownloadReaperCore.js (no firebase-admin
 * require) so it can be unit-tested with only the root deps installed.
 */

const admin = require("firebase-admin");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const {reapTmpDownloads} = require("./tmpDownloadReaperCore");

const tmpDownloadReaper = onSchedule(
  {
    schedule: "every 60 minutes",
    timeZone: "Africa/Lusaka",
    region: "us-central1",
    timeoutSeconds: 300,
    memory: "256MiB",
  },
  async () => {
    const bucket = admin.storage().bucket();
    try {
      const deleted = await reapTmpDownloads(bucket, Date.now());
      console.log(`[tmpDownloadReaper] deleted ${deleted} stale temp downloads`);
    } catch (err) {
      console.error("[tmpDownloadReaper] sweep failed", err);
    }
  },
);

module.exports = {tmpDownloadReaper};
