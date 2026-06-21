/**
 * Plain-node unit test for reapTmpDownloads — the age filter that keeps the
 * tmp-downloads/ export-staging prefix from growing unbounded.
 *
 * Run: node functions/storageCleanup/tmpDownloadReaper.test.js
 */

const assert = require("assert");
const { reapTmpDownloads } = require("./tmpDownloadReaperCore");

function fakeFile(name, timeCreated) {
  let deleted = false;
  return {
    name,
    metadata: { timeCreated },
    get deleted() { return deleted; },
    delete: async () => { deleted = true; },
  };
}

function fakeBucket(files) {
  return {
    files,
    getFiles: async ({ prefix }) => {
      assert.strictEqual(prefix, "tmp-downloads/", "sweeps only the temp prefix");
      return [files];
    },
  };
}

async function run() {
  const now = Date.UTC(2026, 5, 21, 12, 0, 0); // fixed "now"
  const iso = (ms) => new Date(ms).toISOString();

  const fresh = fakeFile("tmp-downloads/u1/fresh.docx", iso(now - 5 * 60 * 1000)); // 5 min old
  const stale = fakeFile("tmp-downloads/u1/stale.docx", iso(now - 2 * 60 * 60 * 1000)); // 2 h old
  const borderline = fakeFile("tmp-downloads/u2/edge.pdf", iso(now - 59 * 60 * 1000)); // 59 min old
  const noMeta = fakeFile("tmp-downloads/u3/weird.bin", undefined);

  const bucket = fakeBucket([fresh, stale, borderline, noMeta]);
  const deleted = await reapTmpDownloads(bucket, now);

  assert.strictEqual(stale.deleted, true, "files older than 1h are deleted");
  assert.strictEqual(fresh.deleted, false, "fresh files are kept");
  assert.strictEqual(borderline.deleted, false, "files under 1h are kept");
  assert.strictEqual(noMeta.deleted, false, "files without a timestamp are kept (not reaped blindly)");
  assert.strictEqual(deleted, 1, "exactly one stale file reaped");

  console.log("tmpDownloadReaper.test.js: OK");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
