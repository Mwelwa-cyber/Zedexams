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
import { gradeFillBlanks } from './fillBlanks.js'
import { gradeDiagramLabels } from './diagramLabelGrading.js'
import { matchingMatches } from './matchingGrading.js'
import { sequenceMatches } from './sequenceGrading.js'

// Essay rides the text-answer family: the learner writes a free-form response
// graded by the AI marker (same path as short_answer / diagram), with its
// verdict stamped on the answer object as `correct`.
export function isTextAnswerType(type) {
  return type === 'short_answer' || type === 'diagram' || type === 'essay'
}

/**
 * A text answer the AI grader could NOT evaluate (burst throttle, provider
 * timeout, or AI-budget rejection) is PENDING — it was never marked. It must
 * never be scored as wrong (B3/OBS-005 correctness fix): geminiChecker returns
 * `{ graded: false, pending: true }` in that case instead of a fabricated
 * `correct: false`. A genuine evaluation always carries `correct` (and, going
 * forward, `graded: true`).
 */
export function isAnswerPending(answer) {
  return answer?.pending === true || answer?.graded === false
}

export function isNumericType(type) {
  return type === 'numeric'
}

export function isHotspotType(type) {
  return type === 'hotspot'
}

export function isFillBlanksType(type) {
  return type === 'fill_blanks'
}

export function isDiagramLabelType(type) {
  return type === 'diagram_label'
}

export function isMatchingType(type) {
  return type === 'matching'
}

export function isSequenceType(type) {
  return type === 'sequence'
}

/**
 * Decide whether a single answer is correct for its question type.
 *
 *   - text (short_answer / diagram / essay): trust the upstream AI verdict
 *     stored as `answer.correct === true`.
 *   - numeric: re-grade via numericMatches(answer, correctAnswer, tolerance).
 *   - hotspot: re-grade via hotspotMatches(answer, correctRegion).
 *   - fill_blanks: re-grade per-blank against the answer key.
 *   - matching / sequence: re-grade against matchingAnswer / sequenceAnswer.
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
  // Fill-in-the-blanks grades deterministically against the per-blank answer
  // key (no AI). The learner answer is a flat array aligned to the blanks in
  // statement reading order; every blank must match for the question to score.
  if (isFillBlanksType(question.type)) {
    return gradeFillBlanks(question, answer).allCorrect
  }
  // Diagram labelling also grades deterministically: the learner answer is a
  // flat array of typed labels aligned to the gradeable markers; every marker
  // must be named correctly for the question to score (fuzzy text match per
  // marker via gradeDiagramLabels).
  if (isDiagramLabelType(question.type)) {
    return gradeDiagramLabels(question, answer).allCorrect
  }
  // Matching / sequence also grade deterministically against their dedicated
  // answer keys (matchingAnswer / sequenceAnswer). Every pair / item must land
  // correctly for the question to score — see matching/sequenceGrading.js.
  if (isMatchingType(question.type)) {
    return matchingMatches(question, answer)
  }
  if (isSequenceType(question.type)) {
    return sequenceMatches(question, answer)
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
  let pending = 0
  const topicScores = {}
  const pendingIds = []

  for (const question of questions || []) {
    const answer = answers?.[question.id]

    // A text answer the AI grader could not evaluate is PENDING — it was never
    // marked, so it must NOT be scored as wrong (that would let a transient
    // throttle/timeout lower the learner's percentage). Exclude it from the
    // graded denominator entirely; the result carries `pending`/`pendingIds`
    // so the UI can flag "awaiting marking" and a later re-grade can settle it.
    if (isTextAnswerType(question.type) && isAnswerPending(answer)) {
      pending += 1
      pendingIds.push(question.id)
      continue
    }

    const correct = isQuestionCorrect(question, answer)
    const marks = question.marks || 1
    total += marks
    if (correct) score += marks

    const topic = question.topic || 'General'
    topicScores[topic] ??= { correct: 0, total: 0 }
    topicScores[topic].total += marks
    if (correct) topicScores[topic].correct += marks
  }

  const percentage = total > 0 ? Math.round((score / total) * 100) : 0
  return { score, total, percentage, topicScores, pending, pendingIds }
}
