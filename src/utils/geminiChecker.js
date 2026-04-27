import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const functions = getFunctions(app, 'us-central1')
const checkShortAnswer = httpsCallable(functions, 'checkShortAnswer')
const AI_MARKING_TIMEOUT_MS = 6500

const EQUIVALENTS = [
  ['alveoli', 'air sacs', 'air sac'],
  ['trachea', 'windpipe'],
  ['oesophagus', 'esophagus', 'food pipe'],
  ['larynx', 'voice box'],
  ['respiration', 'breathing'],
  ['inhalation', 'breathing in', 'inhale'],
  ['exhalation', 'breathing out', 'exhale'],
  ['stomata', 'leaf pores'],
]

function normalizeAnswer(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(the|a|an|is|are|to|of|and)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function answerTokens(value) {
  return new Set(normalizeAnswer(value).split(' ').filter(Boolean))
}

function equivalentMatch(expected, given) {
  const expectedNorm = normalizeAnswer(expected)
  const givenNorm = normalizeAnswer(given)
  if (!expectedNorm || !givenNorm) return false
  if (expectedNorm === givenNorm) return true
  if (expectedNorm.includes(givenNorm) || givenNorm.includes(expectedNorm)) return true
  return EQUIVALENTS.some(group => {
    const foundExpected = group.some(term => expectedNorm.includes(normalizeAnswer(term)))
    const foundGiven = group.some(term => givenNorm.includes(normalizeAnswer(term)))
    return foundExpected && foundGiven
  })
}

function localMark({ correctAnswer, studentAnswer }) {
  const expected = normalizeAnswer(correctAnswer)
  const given = normalizeAnswer(studentAnswer)
  if (!given) return { correct: false, feedback: 'You did not enter an answer.' }
  if (!expected) return null
  if (equivalentMatch(expected, given)) {
    return { correct: true, feedback: 'Correct. Good work!' }
  }

  const expectedTokens = answerTokens(expected)
  const givenTokens = answerTokens(given)
  const overlap = [...expectedTokens].filter(token => givenTokens.has(token)).length
  const required = Math.max(1, Math.ceil(expectedTokens.size * 0.75))
  if (expectedTokens.size > 1 && overlap >= required) {
    return { correct: true, feedback: 'Correct. Your wording is acceptable.' }
  }

  if (expected.length <= 40) {
    return { correct: false, feedback: `Review the expected answer: ${correctAnswer}.` }
  }
  return null
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(Object.assign(new Error('AI_TIMEOUT'), { code: 'timeout' })), timeoutMs)
    }),
  ])
}

/**
 * Ask the Firebase backend to mark a short-answer response.
 * The OpenAI API key stays server-side in the OPENAI_API_KEY function secret.
 */
export async function checkAnswerWithAI({ question, correctAnswer, studentAnswer, subject = '', grade = '' }) {
  const cleanQuestion = String(question ?? '').trim()
  const cleanAnswer = String(correctAnswer ?? '').trim()
  const cleanStudentAnswer = String(studentAnswer ?? '').trim()

  if (!cleanStudentAnswer) {
    return { correct: false, feedback: 'You did not enter an answer.' }
  }

  if (!cleanQuestion) {
    throw new Error('This question needs question text before AI can check it.')
  }

  const quickResult = localMark({ correctAnswer: cleanAnswer, studentAnswer: cleanStudentAnswer })
  if (quickResult) return quickResult

  let response
  try {
    response = await withTimeout(checkShortAnswer({
      question: cleanQuestion,
      correctAnswer: cleanAnswer,
      studentAnswer: cleanStudentAnswer,
      subject,
      grade,
    }), AI_MARKING_TIMEOUT_MS)
  } catch (error) {
    if (cleanAnswer) {
      return { correct: false, feedback: `Review the expected answer: ${cleanAnswer}.` }
    }
    // No expected answer was provided AND the AI call failed. There is
    // nothing we can compare against, so fail closed rather than crashing
    // the quiz/exam runner.
    return { correct: false, feedback: 'Could not check this answer right now. Please try again.' }
  }

  return {
    correct: Boolean(response.data?.correct),
    feedback: String(response.data?.feedback || 'Answer checked.'),
  }
}
