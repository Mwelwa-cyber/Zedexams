/**
 * quizStatus — the one place a quiz's display status is derived.
 *
 * Previously lived in utils/quizAssignments.js and took an
 * `activeAssignments` count, because a published quiz that had been
 * assigned to at least one class read as "Active" rather than
 * "Published". The class/assignment feature is gone, so a quiz can no
 * longer be assigned to anyone and the 'active' status is unreachable —
 * it is not returned here and QuizStatusBadge no longer renders it.
 *
 * Status is otherwise the quiz's own publish state, normalised.
 */

/**
 * @param {{status?: string, isPublished?: boolean} | null | undefined} quiz
 * @returns {'draft'|'pending'|'scheduled'|'published'|'completed'|'archived'}
 */
export function deriveQuizStatus(quiz) {
  if (!quiz) return 'draft'
  const raw = String(quiz.status || '').toLowerCase()
  if (raw === 'archived') return 'archived'
  if (raw === 'completed') return 'completed'
  if (quiz.isPublished) return 'published'
  if (raw === 'scheduled') return 'scheduled'
  if (raw === 'pending') return 'pending'
  return 'draft'
}
