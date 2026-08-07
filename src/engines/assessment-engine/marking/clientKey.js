/**
 * Grade against the answer key the client already holds — today's behaviour,
 * reached through the canonical model instead of through a raw Firestore doc.
 *
 * ## It projects; it does not grade
 *
 * `computeQuizScore` owns every type-specific rule (AI verdicts for text
 * answers, tolerance for numeric, regions for hotspot, per-blank keys for
 * fill-in-the-blanks, and strict equality for the rest) and is the scorer the
 * old path calls. Re-deriving any of that here would be the fork this phase
 * exists to remove, so the only new logic is the PROJECTION: turning a
 * canonical question back into the shape that scorer reads.
 *
 * That projection is the whole risk surface, and it is guarded twice —
 * `answerKeyCoverage.test.js` proves the normaliser carries every field a
 * grader reads, and the replay comparison proves the round trip
 * `raw → normalise → project → score` lands on the same numbers as
 * `raw → score`.
 *
 * ## The one mapping that is not a pass-through
 *
 * `topic`. The canonical model holds `topicIds: string[]`; `computeQuizScore`
 * groups by a single `topic` string and rolls an absent one under 'General'.
 * So the projection takes the FIRST id and leaves it undefined when there is
 * none — leaving it undefined rather than writing 'General' here, because
 * 'General' is the scorer's default and duplicating it would put the same
 * decision in two places.
 */
import { computeQuizScore } from '../../../utils/quizScoring.js'

/**
 * A canonical question, in the shape `computeQuizScore` grades.
 *
 * The answer key is spread LAST so a canonical field can never be overwritten
 * by a stored one of the same name. They do not overlap today — a test asserts
 * it — but the ordering makes the guarantee structural rather than incidental.
 */
export function projectForScoring(question) {
  return {
    ...question.answerKey,
    id: question.id,
    type: question.type,
    marks: question.marks,
    topic: question.topicIds?.[0],
  }
}

/**
 * @param {object} args
 * @param {object} args.assessment  canonical assessment
 * @param {object} args.answers     questionId → the learner's answer
 * @returns {import('./index.js').Verdict}
 */
export function markWithClientKey({ assessment, answers }) {
  const questions = (assessment?.questions ?? []).map(projectForScoring)
  const result = computeQuizScore(questions, answers)
  return {
    graded: true,
    score: result.score,
    total: result.total,
    percentage: result.percentage,
    topicScores: result.topicScores,
    pending: result.pending,
    pendingIds: result.pendingIds,
  }
}
