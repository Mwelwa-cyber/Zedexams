import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { auth } from '../firebase/config'

const functions = getFunctions(app, 'us-central1')

const aiChatCallable = httpsCallable(functions, 'aiChat')
const explainAnswerCallable = httpsCallable(functions, 'explainAnswer')
const generateQuizCallable = httpsCallable(functions, 'generateQuizQuestions')

function messageFromError(error) {
  const code = error?.code || ''
  if (code.includes('resource-exhausted')) {
    return 'Daily AI limit reached. Please try again tomorrow.'
  }
  if (code.includes('permission-denied')) {
    return 'This AI tool is only available for teachers and admins.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in before using Zed.'
  }
  return error?.message || 'Zed is unavailable right now. Please try again.'
}

export async function sendAIChat({ message, context, history = [] }) {
  try {
    const token = await auth.currentUser?.getIdToken()
    if (!token) throw new Error('Please sign in before using Zed.')

    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message, context, history }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(data.error || 'Zed is unavailable right now. Please try again.')
    }
    return String(data.reply || '').trim()
  } catch (error) {
    if (import.meta.env.DEV && !error?.message?.includes('sign in')) {
      try {
        const response = await aiChatCallable({ message, context, history })
        return String(response.data?.reply || '').trim()
      } catch (fallbackError) {
        throw new Error(messageFromError(fallbackError))
      }
    }
    throw new Error(messageFromError(error))
  }
}

export async function explainQuizAnswer(payload) {
  try {
    const response = await explainAnswerCallable(payload)
    return String(response.data?.explanation || '').trim()
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}

export async function generateAIQuizQuestions(payload) {
  try {
    const response = await generateQuizCallable(payload)
    return Array.isArray(response.data?.questions) ? response.data.questions : []
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}
