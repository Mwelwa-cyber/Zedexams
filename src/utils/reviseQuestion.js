/**
 * Client wrapper for the `reviseQuestion` Cloud Function.
 *
 * Asks Claude Haiku to rewrite a single question's text for a different
 * grade level and/or tone. Returns the revised text only — options,
 * correctAnswer, marks etc. are untouched. Teachers click "Apply" to
 * actually replace the question text in the studio.
 *
 * Usage:
 *   const { text } = await reviseQuestion({
 *     text: 'Define photosynthesis.',
 *     fromGrade: 'G7',
 *     toGrade: 'G4',
 *     subject: 'integrated_science',
 *     language: 'english',
 *     modifier: 'easier',   // optional: 'easier' | 'harder' | 'simpler'
 *   })
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const functions = getFunctions(app, 'us-central1')
const reviseQuestionCallable = httpsCallable(functions, 'reviseQuestion')

// Server timeoutSeconds: 45. Small client margin to let the server's
// own error surface first (matches the suggestAnswer pattern).
const REVISE_TIMEOUT_MS = 50000

function messageFromError(error) {
  const code = error?.code || ''
  const msg = error?.message || ''
  // usageMeter throws failed-precondition for quota; the daily AI cap
  // throws resource-exhausted. Both should show the server message.
  if (code.includes('failed-precondition') && /quota|limit|used/i.test(msg)) {
    return msg
  }
  if (code.includes('permission-denied')) {
    return 'Revising questions is only available to approved teachers.'
  }
  if (code.includes('unauthenticated')) {
    return 'Please sign in to revise questions.'
  }
  if (code.includes('invalid-argument')) {
    return msg || 'Pick a target grade or modifier first.'
  }
  return msg || 'Could not revise the question. Please try again.'
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('AI revision timed out. Please try again.')),
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

export async function reviseQuestion({ text, fromGrade, toGrade, subject, language, modifier } = {}) {
  if (!text || !String(text).trim()) {
    throw new Error('Add the question text first, then ask AI to revise it.')
  }
  if (!toGrade && !modifier) {
    throw new Error('Pick a target grade or modifier first.')
  }
  try {
    const result = await withTimeout(
      reviseQuestionCallable({
        text, fromGrade, toGrade, subject, language, modifier,
      }),
      REVISE_TIMEOUT_MS,
    )
    const data = result?.data || {}
    if (!data.text) {
      throw new Error('AI returned an empty revision. Please try again.')
    }
    return { text: data.text }
  } catch (error) {
    throw new Error(messageFromError(error))
  }
}
