// Pure guard for the Assessment Paper Studio edit loader.
//
// When the studio opens an existing paper, it reads two documents in parallel:
// the assessment summary doc (containing questionCount / totalMarks) and the
// questions subcollection. `getAssessmentQuestions` re-throws on a read error,
// so a thrown error is caught by the studio's outer .catch() before this guard
// is ever reached. A zero-length questions array here means either the paper
// genuinely has no questions, or there is a data inconsistency (the counts say
// content exists but no question documents are present in the subcollection).
//
// shouldBlockHydration() resolves that data-inconsistency case with the summary:
//   - If the paper claims it has content (questionCount > 0 OR totalMarks > 0)
//     but the questions array is empty, that is a failed read, not an empty
//     paper. The studio must NOT hydrate it — hydrating would show a blank editor
//     and the next autosave would clobber the real questionCount / totalMarks
//     with 0, permanently destroying the paper's metadata.
//   - If both signal "empty" (questionCount === 0 AND totalMarks === 0), the
//     paper really is a new/empty shell and it is safe to open in the builder.
//   - If questions arrived, hydration proceeds normally regardless of the counts.
//
// DEFENSIVE NOTE: the return value is used as a hard gate — true means "do not
// hydrate, show a retry error". The only safe default when uncertain is false
// (proceed), because a false positive hides a real paper from the teacher. We
// only block when we have positive evidence (a non-zero count + zero results).

/**
 * @param {{ assessment: object, questions: unknown[] }} opts
 * @returns {boolean} true when hydration must be blocked (failed read detected)
 */
export function shouldBlockHydration({ assessment, questions }) {
  // If the assessment doc is absent, the caller handles it separately.
  if (!assessment) return false
  // If questions is not an array or has items, hydration is fine.
  if (!Array.isArray(questions) || questions.length > 0) return false
  // The paper's own metadata says it has content — so zero questions is a read
  // failure, not an empty paper.
  if ((assessment.questionCount ?? 0) > 0) return true
  if ((assessment.totalMarks ?? 0) > 0) return true
  return false
}
