import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const functions = getFunctions(app, 'us-central1')
const checkShortAnswer = httpsCallable(functions, 'checkShortAnswer')

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

  const response = await checkShortAnswer({
    question: cleanQuestion,
    correctAnswer: cleanAnswer,
    studentAnswer: cleanStudentAnswer,
    subject,
    grade,
  })

  return {
    correct: Boolean(response.data?.correct),
    feedback: String(response.data?.feedback || 'Answer checked.'),
  }
}
