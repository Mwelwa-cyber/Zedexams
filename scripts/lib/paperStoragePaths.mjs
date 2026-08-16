/**
 * Every Storage path a single `pastPapers` document still points at.
 *
 * Extracted from scripts/audit-storage.mjs so it can be tested without
 * firebase-admin — that script initialises the Admin SDK and runs main() at
 * module load, so nothing inside it was reachable from a unit test, and this
 * function is the one place where being wrong is destructive.
 *
 * WHY IT IS DESTRUCTIVE. audit-storage.mjs treats any blob under `papers/`
 * that this set does not contain as an orphan, and `--orphans --delete`
 * deletes orphans. A path missed here is a real file deleted.
 *
 * A paper holds files two different ways, and only the first was read until
 * 2026-08-16:
 *
 *   pdfPath / markSchemePath   one uploaded PDF (uploadPaperPdf)
 *   assets[]                   an ordered list of pages (uploadPaperAsset) —
 *                              how every scanned ECZ paper is stored, one
 *                              image per page
 *
 * So the entire scanned archive read as unreferenced. The `--min-age-days`
 * guard is no help: it spares blobs younger than a week, and the archive is
 * years old.
 */

/**
 * @param {object} doc plain object of a pastPapers document's fields
 * @returns {{paths: string[], unreadable: number}}
 *   `unreadable` counts asset entries carrying no usable path. They are
 *   reported rather than ignored: an entry we cannot parse contributes nothing
 *   to the live set, which means its blob is about to be called an orphan, and
 *   that is precisely the case a human must look at before deleting.
 */
export function paperStoragePaths(doc) {
  const paths = [];
  let unreadable = 0;
  if (!doc || typeof doc !== 'object') return { paths, unreadable };

  if (doc.pdfPath) paths.push(String(doc.pdfPath));
  if (doc.markSchemePath) paths.push(String(doc.markSchemePath));

  if (Array.isArray(doc.assets)) {
    for (const a of doc.assets) {
      // Tolerate every shape this array has carried — `{path}` today, the
      // older `{storagePath}` on pre-role-split rows. An unrecognised entry
      // must never silently contribute nothing.
      const p = a?.path || a?.storagePath;
      if (p) paths.push(String(p));
      else unreadable += 1;
    }
  }
  return { paths, unreadable };
}
