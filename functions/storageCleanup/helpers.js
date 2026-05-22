/**
 * Helpers for Firestore-doc → Storage-blob cascade cleanup.
 *
 * Triggers in this module fire when a parent doc is deleted or updated and
 * use these helpers to translate the doc's image-URL fields back into the
 * Storage paths so we can remove the blobs.
 */

/**
 * Convert a Storage download/signed URL (or a gs:// URI) into the
 * bucket-relative object path. Returns null when:
 *   - the input is empty or not a recognised URL shape,
 *   - the URL points at a bucket other than `bucketName`.
 *
 * Forms we handle:
 *   gs://{bucket}/{path}
 *   https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encoded-path}?...
 *   https://storage.googleapis.com/{bucket}/{path}?...        (signed URLs)
 */
function parseStoragePathFromUrl(url, bucketName) {
  if (!url) return null;
  const str = String(url).trim();
  if (!str) return null;

  if (str.startsWith("gs://")) {
    const rest = str.slice("gs://".length);
    const slash = rest.indexOf("/");
    if (slash <= 0) return null;
    const bucket = rest.slice(0, slash);
    if (bucketName && bucket !== bucketName) return null;
    return rest.slice(slash + 1) || null;
  }

  const fb = str.match(
    /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/([^/]+)\/o\/([^?]+)/,
  );
  if (fb) {
    if (bucketName && fb[1] !== bucketName) return null;
    try {
      return decodeURIComponent(fb[2]) || null;
    } catch {
      return null;
    }
  }

  const sg = str.match(/^https:\/\/storage\.googleapis\.com\/([^/]+)\/([^?]+)/);
  if (sg) {
    if (bucketName && sg[1] !== bucketName) return null;
    try {
      return decodeURIComponent(sg[2]) || null;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Pull every Storage object path referenced by a quiz/assessment question
 * doc. Looks at `imageUrl`, each `optionMedia[].imageUrl`, and any
 * passage-level image (legacy field that some imports populate).
 *
 * Image refs that resolve to library diagrams (questionData.imageDiagram or
 * optionMedia[].diagram) are intentionally ignored — those are SVG library
 * keys rendered client-side, not Storage blobs.
 */
function collectQuestionImagePaths(questionData, bucketName) {
  const paths = new Set();
  if (!questionData) return [];

  const add = (url) => {
    const p = parseStoragePathFromUrl(url, bucketName);
    if (p) paths.add(p);
  };

  add(questionData.imageUrl);

  if (Array.isArray(questionData.optionMedia)) {
    for (const slot of questionData.optionMedia) {
      add(slot && slot.imageUrl);
    }
  }

  const passage = questionData.passage;
  if (passage && typeof passage === "object") add(passage.imageUrl);

  return [...paths];
}

/**
 * Pull every individually-tracked Storage path stored on a lesson doc.
 * Covers both lesson modes:
 *   - file notes: `storagePath`
 *   - slide-builder: `slides[].imageStoragePath` (or imageUrl as fallback)
 *   - pptx_viewer:   `presentation.sourcePath` + `presentation.slideImages[].storagePath`
 *
 * For inline rich-text images we rely on the prefix sweep
 * (`lesson-files/{uid}/{batch}/inline/...`) — there's no field that lists
 * them individually.
 */
function collectLessonPaths(lessonData, bucketName) {
  const paths = new Set();
  if (!lessonData) return [];

  const add = (p) => {
    if (p) paths.add(String(p));
  };

  add(lessonData.storagePath);

  if (Array.isArray(lessonData.slides)) {
    for (const slide of lessonData.slides) {
      if (!slide) continue;
      if (slide.imageStoragePath) {
        add(slide.imageStoragePath);
      } else {
        const fromUrl = parseStoragePathFromUrl(slide.imageUrl, bucketName);
        if (fromUrl) add(fromUrl);
      }
    }
  }

  const pres = lessonData.presentation;
  if (pres) {
    add(pres.sourcePath);
    if (Array.isArray(pres.slideImages)) {
      for (const slide of pres.slideImages) {
        if (slide) add(slide.storagePath);
      }
    }
  }

  return [...paths];
}

/**
 * Storage path prefixes that cover the entire batch folder for a lesson.
 * Deleting these recursively catches inline images and any stragglers
 * that aren't individually tracked on the doc.
 */
function collectLessonPrefixes(lessonData) {
  if (!lessonData) return [];
  const uid = lessonData.createdBy;
  const batch = lessonData.assetBatchId;
  if (!uid || !batch) return [];
  return [
    `lesson-files/${uid}/${batch}/`,
    `lesson-presentations/${uid}/${batch}/`,
  ];
}

/**
 * Delete a single Storage object. 404s are swallowed (the file is already
 * gone, which is fine). Other errors are logged but never thrown — a
 * cleanup failure must not break the user-visible delete.
 */
async function safeDelete(bucket, path) {
  if (!bucket || !path) return;
  try {
    await bucket.file(path).delete({ignoreNotFound: true});
  } catch (err) {
    if (err && (err.code === 404 || err.code === "storage/object-not-found")) {
      return;
    }
    console.warn(`[storageCleanup] delete failed: ${path}`,
      (err && err.message) || err);
  }
}

/**
 * Recursively delete every object under a prefix. Used to clear an
 * entire lesson asset-batch folder (which may contain inline images that
 * aren't enumerated on the doc).
 */
async function deleteByPrefix(bucket, prefix) {
  if (!bucket || !prefix) return;
  try {
    await bucket.deleteFiles({prefix});
  } catch (err) {
    console.warn(`[storageCleanup] deleteByPrefix failed: ${prefix}`,
      (err && err.message) || err);
  }
}

/**
 * Top-level storage prefixes keyed by a user uid. When a user is deleted
 * we sweep each of these, and the orphan reaper iterates them looking
 * for blobs whose owning uid no longer exists in `users/`.
 *
 * `papers/` and `lesson-images/`, `lesson-files/`, `lesson-presentations/`,
 * `quiz-images/`, `assessment-images/` all use the same `{prefix}/{uid}/...`
 * layout. `invoices/{uid}/{paymentId}.pdf` matches too.
 *
 * `syllabi/` is intentionally excluded — it's admin-owned static content
 * not bound to a single uid.
 */
const USER_KEYED_PREFIXES = Object.freeze([
  "lesson-files/",
  "lesson-presentations/",
  "lesson-images/",
  "quiz-images/",
  "assessment-images/",
  "papers/",
  "invoices/",
]);

/**
 * Every storage prefix that the given uid owns. Used by the auth-delete
 * cascade and by the reaper when it confirms a uid is gone from users/.
 */
function collectUserPrefixes(uid) {
  if (!uid) return [];
  return USER_KEYED_PREFIXES.map((p) => `${p}${uid}/`);
}

/**
 * List the immediate child "directories" under a prefix using the GCS
 * `delimiter: '/'` trick. Returns the child segment without the trailing
 * slash. e.g. listing `lesson-files/` with children
 * `lesson-files/abc/...` and `lesson-files/def/...` returns
 * `['abc', 'def']`.
 *
 * Handles pagination via the auto-pagination wrapper that
 * `@google-cloud/storage` provides on getFiles. Caps at `limit` returned
 * child segments so we never load an unbounded list into memory.
 */
async function listChildDirs(bucket, prefix, limit = 10000) {
  if (!bucket || !prefix) return [];
  const out = [];
  let query = {
    prefix,
    delimiter: "/",
    autoPaginate: false,
    maxResults: 1000,
  };
  while (true) {
    const [, nextQuery, apiResponse] = await bucket.getFiles(query);
    const childPrefixes = (apiResponse && apiResponse.prefixes) || [];
    for (const p of childPrefixes) {
      const tail = p.slice(prefix.length).replace(/\/$/, "");
      if (tail) out.push(tail);
      if (out.length >= limit) return out;
    }
    if (!nextQuery) break;
    query = {...query, ...nextQuery};
  }
  return out;
}

/**
 * Pull every Storage object path referenced by a single past-paper doc.
 * Mirrors collectQuestionImagePaths in shape so the reaper can use a
 * common "is this path live?" check.
 */
function collectPaperPaths(paperData) {
  if (!paperData) return [];
  const out = new Set();
  if (paperData.pdfPath) out.add(String(paperData.pdfPath));
  if (paperData.markSchemePath) out.add(String(paperData.markSchemePath));
  return [...out];
}

module.exports = {
  parseStoragePathFromUrl,
  collectQuestionImagePaths,
  collectLessonPaths,
  collectLessonPrefixes,
  collectPaperPaths,
  collectUserPrefixes,
  listChildDirs,
  safeDelete,
  deleteByPrefix,
  USER_KEYED_PREFIXES,
};
