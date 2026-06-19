/**
 * src/utils/quizScoring.js
 *
 * Pure client-side quiz scorer — the marks/percentage/topic-breakdown a
 * learner sees the moment they submit a practice quiz (QuizRunnerV2's
 * handleSubmit). Extracted from the component so the scoring rules can be
 * unit-tested directly, without rendering the runner or standing up Firebase.
 *
 * Server-authoritative principle: correctness is re-derived from each
 * question's persisted answer key (correctAnswer / tolerance / correctRegion),
 * never from any `correct` flag the client may have stored alongside the
 * learner's response — except for text-answer types (short_answer / diagram),
 * which are marked upstream by the AI grader and carry their verdict on the
 * answer object itself.
 *
 * Matchers are imported straight from the dependency-free grading modules
 * (not examService) so this stays Firebase-free and node/jsdom testable.
 */

import { numericMatches } from './numericGrading.js'
import { hotspotMatches } from './hotspotGrading.js'

export function isTextAnswerType(type) {
  return type === 'short_answer' || type === 'diagram'
}

export function isNumericType(type) {
  return type === 'numeric'
}

export function isHotspotType(type) {
  return type === 'hotspot'
}

/**
 * Decide whether a single answer is correct for its question type.
 *
 *   - text (short_answer / diagram): trust the upstream AI verdict stored as
 *     `answer.correct === true`.
 *   - numeric: re-grade via numericMatches(answer, correctAnswer, tolerance).
 *   - hotspot: re-grade via hotspotMatches(answer, correctRegion).
 *   - everything else (mcq / truefalse): strict-equality against correctAnswer.
 */
export function isQuestionCorrect(question, answer) {
  if (!question) return false
  if (isTextAnswerType(question.type)) return answer?.correct === true
  if (isNumericType(question.type)) {
    return numericMatches(answer, question.correctAnswer, question.tolerance)
  }
  if (isHotspotType(question.type)) {
    return hotspotMatches(answer, question.correctRegion)
  }
  return answer === question.correctAnswer
}

/**
 * Score a submitted quiz attempt.
 *
 * @param {Array<object>} questions  the quiz questions (each with type, marks,
 *                                   topic, and its answer key)
 * @param {object} answers           map of questionId -> learner answer
 * @returns {{
 *   score: number,            // marks earned
 *   total: number,            // marks available
 *   percentage: number,       // round(score/total*100), 0 when total is 0
 *   topicScores: Object<string, {correct: number, total: number}>,
 * }}
 *
 * A question with no `marks` counts as 1 mark. Questions with no `topic`
 * roll up under 'General'. An empty/missing question list scores 0/0/0%.
 */
export function computeQuizScore(questions, answers) {
  let score = 0
  let total = 0
  const topicScores = {}

  for (const question of questions || []) {
    const correct = isQuestionCorrect(question, answers?.[question.id])
    const marks = question.marks || 1
    total += marks
    if (correct) score += marks

    const topic = question.topic || 'General'
    topicScores[topic] ??= { correct: 0, total: 0 }
    topicScores[topic].total += marks
    if (correct) topicScores[topic].correct += marks
  }

  const percentage = total > 0 ? Math.round((score / total) * 100) : 0
  return { score, total, percentage, topicScores }
}
