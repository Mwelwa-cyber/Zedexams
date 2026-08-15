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

  // Additional stacked figures beyond the primary image.
  if (Array.isArray(questionData.images)) {
    for (const img of questionData.images) {
      add(img && img.url);
    }
  }

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
 * Union of every Storage path referenced by a list of question docs.
 *
 * Used by the per-question cleanup triggers to answer "is this blob still
 * referenced by a SIBLING question?" before deleting it. A quiz's questions
 * routinely share the same uploaded image — the document importer reuses a
 * stem image across a comprehension's sub-questions, a teacher reuses one
 * figure in two questions, and (the failure that motivated this) the
 * `60 → 2000` autosave explosion produced exact duplicate question docs that
 * all point at the SAME `imageUrl`. When `dedupe-quiz-questions.mjs` (or any
 * delete/edit) removed the duplicates, the delete trigger deleted that shared
 * blob even though the surviving question still rendered it — silently
 * blanking the picture for every learner.
 *
 * Returns a Set so the trigger can subtract it from its delete candidates.
 */
function collectLivePathsFromQuestions(questionDatas, bucketName) {
  const live = new Set();
  for (const data of questionDatas || []) {
    for (const p of collectQuestionImagePaths(data, bucketName)) live.add(p);
  }
  return live;
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
 * `deleteByPrefix`, but it says how many objects it found.
 *
 * The difference matters in exactly one caller. The post-purge re-sweep
 * (account/accountPurgeResweeper.js) exists on a HYPOTHESIS — that an ID token
 * surviving its account's deletion is used to upload before it expires. With
 * `deleteByPrefix` alone, a re-sweep that cleaned up a real leak and a
 * re-sweep that found an empty bucket are the same log line, so nobody ever
 * learns whether the window is used in practice or how often. The count is the
 * only evidence this mechanism produces about its own premise.
 *
 * Unlike `deleteByPrefix` this THROWS on failure. Its caller has to leave the
 * job un-closed and retry rather than record a re-sweep it did not manage to
 * perform, and a swallowed error would be indistinguishable from "nothing was
 * there" — the same conflation the count exists to remove.
 *
 * @param {object} bucket   GCS bucket.
 * @param {string} prefix   Full prefix, e.g. `papers/uid123/`.
 * @return {Promise<number>} Objects deleted.
 */
async function deleteByPrefixCounted(bucket, prefix) {
  if (!bucket || !prefix) return 0;
  const [files] = await bucket.getFiles({prefix});
  const found = (files && files.length) || 0;
  if (!found) return 0;
  await bucket.deleteFiles({prefix});
  return found;
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
 *
 * THIS IS THE ONE LIST. Three sweeps read it and none keeps its own copy:
 * the auth-delete cascade (onUserDeleted.js), the orphan reaper
 * (orphanReaper.js), and the post-token-window re-sweep
 * (account/accountPurgeResweeper.js). A prefix added here is covered by all
 * three; a second list somewhere would be covered by one of them, silently.
 */
const USER_KEYED_PREFIXES = Object.freeze([
  "lesson-files/",
  "lesson-presentations/",
  "lesson-images/",
  "quiz-images/",
  "assessment-images/",
  "papers/",
  "invoices/",
  // Teacher Settings branding assets (profile photo, school logo, signature,
  // stamp, letterhead) — fixed filenames under user-branding/{uid}/.
  "user-branding/",
  // Baked diagrams + uploaded source pictures from Visual Studio, keyed
  // visual-studio/{uid}/... — a teacher's own working assets.
  "visual-studio/",
  // Server-generated (Admin SDK) AI images keyed by the owning uid:
  //   note-pictures/{uid}/{noteId}/...  (generateNotePictures)
  //   slide-notes-images/{uid}/{deckId}/... (generateSlideNotes/Diagram)
  // These were previously orphaned on account deletion — the blobs (and their
  // tokened download URLs) outlived the user because no sweep listed them.
  "note-pictures/",
  "slide-notes-images/",
  // ── Added with the post-purge re-sweep (#2258/#2399 follow-up) ──
  // Every one of these is `{prefix}/{ownerUid}/…` in storage.rules and none
  // of them was swept by anything, so the objects outlived the account.
  //
  // Export staging. tmpDownloadReaper.js already clears this on a 1 h age
  // rule, which is a different guarantee: age-based cleanup eventually
  // catches a deleted user's staged file, deletion-based cleanup catches it
  // now. Both, because "eventually" is not what an erasure request asks for.
  "tmp-downloads/",
  // Teacher-uploaded curriculum source documents (uploadCurriculumModule).
  "curriculum-uploads/",
  // Teacher-uploaded sample papers used to extract a paper format.
  "assessment-format-samples/",
  // Cached .docx/.pdf renders of the teacher's own assessments
  // (assessmentExports/exportsCore.js). Client read AND write are denied in
  // storage.rules — these are admin-SDK-written derivatives of the paper the
  // teacher authored, so they die with it.
  "assessment-exports/",
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
  collectLivePathsFromQuestions,
  collectLessonPaths,
  collectLessonPrefixes,
  collectPaperPaths,
  collectUserPrefixes,
  listChildDirs,
  safeDelete,
  deleteByPrefix,
  deleteByPrefixCounted,
  USER_KEYED_PREFIXES,
};
