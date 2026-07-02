/**
 * Client wrapper for the `aiLessonCount` Cloud Function.
 *
 * Asks Claude Haiku how many lessons a CBC sub-topic should be taught over
 * and returns a per-lesson breakdown (title + focus) for the Lesson Plan
 * Studio's Lesson Series builder. Pass `avoidCounts` (the counts already
 * shown) so "Get New Suggestion" genuinely re-plans the pacing instead of
 * re-rolling the same number.
 *
 * Usage:
 *   const { count, reason, breakdown } = await fetchAiLessonCount({
 *     grade: 'G5',
 *     subject: 'mathematics',
 *     topic: 'WHOLE NUMBERS',
 *     subtopic: 'Addition of whole numbers',
 *     learningActivities: ['Group work', 'Drill'],
 *     expectedStandard: 'Adds numbers up to 1000',
 *     avoidCounts: [3],
 *   })
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const functions = getFunctions(app, 'us-central1')
const aiLessonCountCallable = httpsCallable(functions, 'aiLessonCount')

// Server timeoutSeconds: 45. Small client margin.
const LESSON_COUNT_TIMEOUT_MS = 50000

function messageFromError(error) {
  const code = error?.code || ''
  const msg = error?.message || ''
  if (code.includes('resource-exhausted')) {
    return msg || 'Daily AI limit reached. Please try again tomorrow.'
  }
  if (code.includes('permission-denied')) {
    return 'AI lesson suggestions are only available to approved teachers.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in to use AI lesson suggestions.'
  }
  if (code.includes('invalid-argument')) {
    return msg || 'Pick a topic and sub-topic first.'
  }
  return msg || 'Could not get an AI suggestion. Please try again.'
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

export async function fetchAiLessonCount({
  grade,
  subject,
  topic,
  subtopic,
  learningActivities,
  expectedStandard,
  avoidCounts,
} = {}) {
  if (!topic || !subtopic) {
    throw new Error('Pick a topic and sub-topic first.')
  }
  try {
    const result = await withTimeout(
      aiLessonCountCallable({
        grade, subject, topic, subtopic,
        learningActivities, expectedStandard, avoidCounts,
      }),
      LESSON_COUNT_TIMEOUT_MS,
    )
    const data = result?.data || {}
    return {
      count: Number(data.count) || 2,
      reason: data.reason || '',
      breakdown: Array.isArray(data.breakdown) ? data.breakdown : [],
    }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}
