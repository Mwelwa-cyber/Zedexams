/**
 * Client wrapper for the `suggestAnswer` Cloud Function.
 *
 * Asks Claude Haiku to predict the correct answer for one question. The
 * studio renders the suggestion behind an "AI-suggested" badge until the
 * teacher edits or confirms it. Never auto-applies for the teacher.
 *
 * Usage:
 *   const { answer, rationale, confidence } = await suggestAnswer({
 *     type: 'mcq',
 *     text: 'What is 7 × 8?',
 *     options: ['54','55','56','57'],
 *     grade: 'G5',
 *     subject: 'mathematics',
 *   })
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const functions = getFunctions(app, 'us-central1')
const suggestAnswerCallable = httpsCallable(functions, 'suggestAnswer')

// Server timeoutSeconds: 45. Small client margin.
const SUGGEST_TIMEOUT_MS = 50000

function messageFromError(error) {
  const code = error?.code || ''
  const msg = error?.message || ''
  // usageMeter throws failed-precondition for quota; resource-exhausted
  // is only thrown by the daily AI cap in aiService.
  if (code.includes('failed-precondition') && /quota|limit|used/i.test(msg)) {
    return msg
  }
  if (code.includes('permission-denied')) {
    return 'Suggesting answers is only available to approved teachers.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in to use AI answer suggestions.'
  }
  if (code.includes('invalid-argument')) {
    return msg || 'Question is missing required fields.'
  }
  return msg || 'Could not suggest an answer. Please try again.'
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('AI suggestion timed out. Please try again.')),
      ms,
    )
    promise
      .then(
        value => { clearTimeout(timer); resolve(value) },
        err => { clearTimeout(timer); reject(err) },
      )
      .catch(err => { clearTimeout(timer); reject(err) })
  })
}

export async function suggestAnswer({ type, text, options, wordBank, unit, tolerance, grade, subject, language } = {}) {
  if (!text || !String(text).trim()) {
    throw new Error('Add some question text first, then ask AI for the answer.')
  }
  try {
    const result = await withTimeout(
      suggestAnswerCallable({
        type, text, options, wordBank, unit, tolerance, grade, subject, language,
      }),
      SUGGEST_TIMEOUT_MS,
    )
    const data = result?.data || {}
    return {
      answer: data.answer,
      rationale: data.rationale || '',
      confidence: data.confidence || 'low',
      type: data.type || type,
    }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}
