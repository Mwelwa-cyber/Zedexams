// Pure scoring core for the client quiz runner (QuizRunnerV2).
//
// Extracted from the runner's submit handler so the marks/topic tally that
// decides what a learner scores can be unit-tested in isolation — mis-scoring
// is the most damaging bug class on the platform. The runner imports these
// directly; there is no behavioural difference from the old inline loop.
//
// Correctness is re-derived server-authoritatively for numeric + hotspot
// questions (never trusting the client's stored `correct` flag) using the
// same graders the server uses. Text-answer types (short answer, diagram)
// were already AI-marked at answer time, so we read their stored verdict.

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
 * Decide whether a single stored answer earns the question's marks.
 *
 * @param {object} question  the quiz question (type, correctAnswer, tolerance, correctRegion)
 * @param {*} answer         the learner's stored answer for this question
 * @returns {boolean}
 */
export function evaluateAnswer(question, answer) {
  if (isTextAnswerType(question.type)) return answer?.correct === true
  if (isNumericType(question.type)) return numericMatches(answer, question.correctAnswer, question.tolerance)
  if (isHotspotType(question.type)) return hotspotMatches(answer, question.correctRegion)
  return answer === question.correctAnswer
}

/**
 * Tally a finished attempt into score / total / percentage / per-topic
 * breakdown. Marks default to 1; topic defaults to 'General'.
 *
 * @param {Array} questions          the graded question list
 * @param {Object} [answers]         map of questionId → stored answer
 * @returns {{score:number, total:number, percentage:number, topicScores:Object}}
 */
export function scoreQuizAttempt(questions, answers = {}) {
  let score = 0
  let total = 0
  const topicScores = {}

  ;(questions || []).forEach((question) => {
    const correct = evaluateAnswer(question, answers[question.id])
    const marks = question.marks || 1
    total += marks
    if (correct) score += marks
    const topic = question.topic || 'General'
    topicScores[topic] ??= { correct: 0, total: 0 }
    topicScores[topic].total += marks
    if (correct) topicScores[topic].correct += marks
  })

  const percentage = total > 0 ? Math.round((score / total) * 100) : 0
  return { score, total, percentage, topicScores }
}
