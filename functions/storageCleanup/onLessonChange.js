/**
 * Lesson cascade-delete + update-orphan handlers.
 *
 *   onLessonDeleted:  when lessons/{lessonId} is deleted, remove every
 *                     Storage blob attached to it. Sweeps the whole
 *                     `lesson-files/{uid}/{batch}/` and
 *                     `lesson-presentations/{uid}/{batch}/` folders so
 *                     inline rich-text images are caught too.
 *
 *   onLessonUpdated:  detects three update-driven orphan scenarios and
 *                     cleans up the stale blobs:
 *                       1. assetBatchId rotated  → old batch folder dies
 *                       2. PPTX re-imported      → slides removed from
 *                          presentation.slideImages get deleted
 *                       3. file note replaced    → old storagePath dies
 */

const admin = require("firebase-admin");
const {onDocumentDeleted, onDocumentUpdated} =
  require("firebase-functions/v2/firestore");

const {
  collectLessonPaths,
  collectLessonPrefixes,
  safeDelete,
  deleteByPrefix,
} = require("./helpers");

const COMMON_OPTS = {
  document: "lessons/{lessonId}",
  region: "us-central1",
  timeoutSeconds: 120,
  memory: "256MiB",
};

async function purgeLessonAssets(lessonData) {
  if (!lessonData) return;
  const bucket = admin.storage().bucket();

  for (const prefix of collectLessonPrefixes(lessonData)) {
    await deleteByPrefix(bucket, prefix);
  }

  for (const path of collectLessonPaths(lessonData, bucket.name)) {
    await safeDelete(bucket, path);
  }
}

const onLessonDeleted = onDocumentDeleted(COMMON_OPTS, async (event) => {
  try {
    const data = event.data && event.data.data();
    await purgeLessonAssets(data);
  } catch (err) {
    console.warn("[storageCleanup] onLessonDeleted failed",
      (err && err.message) || err);
  }
});

const onLessonUpdated = onDocumentUpdated(COMMON_OPTS, async (event) => {
  try {
    const before = event.data && event.data.before && event.data.before.data();
    const after = event.data && event.data.after && event.data.after.data();
    if (!before || !after) return;
    const bucket = admin.storage().bucket();

    // (1) assetBatchId rotated — clear the old batch folders wholesale.
    const oldBatch = before.assetBatchId;
    const newBatch = after.assetBatchId;
    if (oldBatch && oldBatch !== newBatch) {
      const stale = {createdBy: before.createdBy, assetBatchId: oldBatch};
      for (const prefix of collectLessonPrefixes(stale)) {
        await deleteByPrefix(bucket, prefix);
      }
    }

    // (2) PPTX re-imported into the same batch — slideImages array gets
    // replaced. Delete any storagePath that no longer appears in the
    // new array.
    const oldSlides = new Set(
      (Array.isArray(before.presentation && before.presentation.slideImages) ?
        before.presentation.slideImages :
        [])
        .map((s) => s && s.storagePath)
        .filter(Boolean),
    );
    const newSlides = new Set(
      (Array.isArray(after.presentation && after.presentation.slideImages) ?
        after.presentation.slideImages :
        [])
        .map((s) => s && s.storagePath)
        .filter(Boolean),
    );
    for (const path of oldSlides) {
      if (!newSlides.has(path)) await safeDelete(bucket, path);
    }

    // (2b) PPTX source file replaced.
    const oldSource = before.presentation && before.presentation.sourcePath;
    const newSource = after.presentation && after.presentation.sourcePath;
    if (oldSource && oldSource !== newSource) {
      await safeDelete(bucket, oldSource);
    }

    // (3) File note swapped out.
    const oldStoragePath = before.storagePath;
    const newStoragePath = after.storagePath;
    if (oldStoragePath && oldStoragePath !== newStoragePath) {
      await safeDelete(bucket, oldStoragePath);
    }
  } catch (err) {
    console.warn("[storageCleanup] onLessonUpdated failed",
      (err && err.message) || err);
  }
});

module.exports = {onLessonDeleted, onLessonUpdated};
