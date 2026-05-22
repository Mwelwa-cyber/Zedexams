/**
 * Storage cleanup module — Firestore triggers that delete the Storage
 * blobs attached to a parent doc when the doc is deleted, and clean up
 * orphaned blobs left behind by image/file swaps, deleted users, and
 * abandoned drafts.
 *
 * Trigger surface:
 *   onLessonDeleted               — lessons/{lessonId}
 *   onLessonUpdated               — lessons/{lessonId}
 *   onQuizQuestionDeleted         — quizzes/{quizId}/questions/{questionId}
 *   onQuizQuestionUpdated         — quizzes/{quizId}/questions/{questionId}
 *   onAssessmentQuestionDeleted   — assessments/{assessmentId}/questions/{questionId}
 *   onAssessmentQuestionUpdated   — assessments/{assessmentId}/questions/{questionId}
 *   onUserDeleted                 — Firebase Auth user.onDelete; wipes
 *                                   every uid-keyed prefix the user owned.
 *   orphanStorageReaper           — daily scheduled sweep that removes
 *                                   blobs whose parent uid / lesson no
 *                                   longer exists. Conservative — see
 *                                   orphanReaper.js for the rules.
 *
 * Past papers already cascade via deletePaper() in src/utils/pastPapers.js.
 * Lower-confidence orphan classes (quiz/assessment images, papers,
 * invoices with missing parent docs) are not auto-reaped; use
 * `node scripts/audit-storage.mjs --delete` to clean them on demand.
 */

const {onLessonDeleted, onLessonUpdated} = require("./onLessonChange");
const {
  onQuizQuestionDeleted,
  onQuizQuestionUpdated,
  onAssessmentQuestionDeleted,
  onAssessmentQuestionUpdated,
} = require("./onQuestionChange");
const {onUserDeleted} = require("./onUserDeleted");
const {orphanStorageReaper} = require("./orphanReaper");

module.exports = {
  onLessonDeleted,
  onLessonUpdated,
  onQuizQuestionDeleted,
  onQuizQuestionUpdated,
  onAssessmentQuestionDeleted,
  onAssessmentQuestionUpdated,
  onUserDeleted,
  orphanStorageReaper,
};
