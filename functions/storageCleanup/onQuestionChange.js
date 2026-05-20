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

const {collectQuestionImagePaths, safeDelete} = require("./helpers");

const COMMON_OPTS = {
  region: "us-central1",
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
        for (const path of paths) await safeDelete(bucket, path);
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
        const oldPaths = new Set(
          collectQuestionImagePaths(before, bucket.name),
        );
        const newPaths = new Set(
          collectQuestionImagePaths(after, bucket.name),
        );
        for (const path of oldPaths) {
          if (!newPaths.has(path)) await safeDelete(bucket, path);
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
