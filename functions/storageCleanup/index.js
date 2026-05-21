/**
 * Storage cleanup module — Firestore triggers that delete the Storage
 * blobs attached to a parent doc when the doc is deleted, and clean up
 * orphaned blobs left behind by image/file swaps.
 *
 * Trigger surface:
 *   onLessonDeleted               — lessons/{lessonId}
 *   onLessonUpdated               — lessons/{lessonId}
 *   onQuizQuestionDeleted         — quizzes/{quizId}/questions/{questionId}
 *   onQuizQuestionUpdated         — quizzes/{quizId}/questions/{questionId}
 *   onAssessmentQuestionDeleted   — assessments/{assessmentId}/questions/{questionId}
 *   onAssessmentQuestionUpdated   — assessments/{assessmentId}/questions/{questionId}
 *
 * Past papers already cascade via deletePaper() in src/utils/pastPapers.js
 * so no trigger is needed there. Invoices and user-level cascade live
 * outside this module (deferred — see Storage bloat investigation notes).
 */

const {onLessonDeleted, onLessonUpdated} = require("./onLessonChange");
const {
  onQuizQuestionDeleted,
  onQuizQuestionUpdated,
  onAssessmentQuestionDeleted,
  onAssessmentQuestionUpdated,
} = require("./onQuestionChange");

module.exports = {
  onLessonDeleted,
  onLessonUpdated,
  onQuizQuestionDeleted,
  onQuizQuestionUpdated,
  onAssessmentQuestionDeleted,
  onAssessmentQuestionUpdated,
};
