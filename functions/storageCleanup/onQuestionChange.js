/**
 * Question-level cascade + orphan cleanup, shared between quizzes and
 * assessments because their question subcollections store images in the
 * same shape (`imageUrl` + `optionMedia[].imageUrl`).
 *
 *   delete trigger:  fires per question (the parent delete helpers cascade
 *                    the subcollection one doc at a time). For each deleted
 *                    question we remove every Storage blob it referenced.
 *
 *   update trigger:  diff old vs new image refs. Anything that was on the
 *                    OLD doc but is no longer on the NEW doc gets deleted.
 *                    Catches image swaps and diagram regenerations.
 */

const admin = require("firebase-admin");
const {onDocumentDeleted, onDocumentUpdated} =
  require("firebase-functions/v2/firestore");

const {
  collectQuestionImagePaths,
  collectLivePathsFromQuestions,
  safeDelete,
} = require("./helpers");

/**
 * Build the set of Storage paths still referenced by the OTHER questions in
 * the same subcollection (every sibling except `excludeId`). The per-question
 * cleanup must never delete a blob a sibling still renders — quizzes routinely
 * share one image across questions (comprehension stems, reused figures, and
 * the exact-duplicate docs left by the historical `60 → 2000` autosave
 * explosion that `dedupe-quiz-questions.mjs` removes).
 *
 * Reads the whole sibling collection in one round-trip. Bounded by the quiz's
 * question count, and only called when there is at least one blob actually up
 * for deletion (the triggers early-return otherwise), so the hot autosave path
 * — which removes no images — never pays for it.
 */
async function liveSiblingPaths(collectionRef, excludeId, bucketName) {
  const snap = await collectionRef.get();
  const datas = [];
  snap.forEach((d) => {
    if (d.id !== excludeId) datas.push(d.data());
  });
  return collectLivePathsFromQuestions(datas, bucketName);
}

// Collocated with the (default) Firestore database in africa-south1 so the
// Eventarc trigger and the function compute share a region — no cross-region
// hop per delete/update event. The Storage bucket these handlers sweep is
// also africa-south1, so the blob deletes stay in-region too.
const COMMON_OPTS = {
  region: "africa-south1",
  timeoutSeconds: 60,
  memory: "256MiB",
};

function makeDeletedTrigger(documentPath) {
  return onDocumentDeleted(
    {document: documentPath, ...COMMON_OPTS},
    async (event) => {
      try {
        const data = event.data && event.data.data();
        if (!data) return;
        const bucket = admin.storage().bucket();
        const paths = collectQuestionImagePaths(data, bucket.name);
        if (paths.length === 0) return;
        // Don't delete a blob a sibling question still references. If the
        // sibling read throws it bubbles to the catch below and NOTHING is
        // deleted — leaking an orphan (reaped later by audit-storage) is far
        // safer than deleting an image a live question still renders.
        const live = await liveSiblingPaths(
          event.data.ref.parent, event.data.ref.id, bucket.name);
        for (const path of paths) {
          if (!live.has(path)) await safeDelete(bucket, path);
        }
      } catch (err) {
        console.warn(`[storageCleanup] deleted(${documentPath}) failed`,
          (err && err.message) || err);
      }
    },
  );
}

function makeUpdatedTrigger(documentPath) {
  return onDocumentUpdated(
    {document: documentPath, ...COMMON_OPTS},
    async (event) => {
      try {
        const before = event.data && event.data.before &&
          event.data.before.data();
        const after = event.data && event.data.after && event.data.after.data();
        if (!before || !after) return;
        const bucket = admin.storage().bucket();
        const newPaths = new Set(
          collectQuestionImagePaths(after, bucket.name),
        );
        // Candidates: paths this question dropped (on the OLD doc, gone from
        // the NEW one). An unchanged image is in newPaths, so a plain autosave
        // produces an empty list and skips the sibling read entirely.
        const removed = collectQuestionImagePaths(before, bucket.name)
          .filter((path) => !newPaths.has(path));
        if (removed.length === 0) return;
        // A dropped image may still be referenced by a sibling question (shared
        // figure / leftover duplicate). Keep it if so — same conservative rule
        // as the delete trigger.
        const live = await liveSiblingPaths(
          event.data.after.ref.parent, event.data.after.ref.id, bucket.name);
        for (const path of removed) {
          if (!live.has(path)) await safeDelete(bucket, path);
        }
      } catch (err) {
        console.warn(`[storageCleanup] updated(${documentPath}) failed`,
          (err && err.message) || err);
      }
    },
  );
}

module.exports = {
  onQuizQuestionDeleted:
    makeDeletedTrigger("quizzes/{quizId}/questions/{questionId}"),
  onQuizQuestionUpdated:
    makeUpdatedTrigger("quizzes/{quizId}/questions/{questionId}"),
  onAssessmentQuestionDeleted:
    makeDeletedTrigger("assessments/{assessmentId}/questions/{questionId}"),
  onAssessmentQuestionUpdated:
    makeUpdatedTrigger("assessments/{assessmentId}/questions/{questionId}"),
};
