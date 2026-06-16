/**
 * Client wrapper for the `checkVisualSafety` Cloud Function — an on-demand AI
 * safety/accuracy review of a generated Visual Studio image.
 *
 * Returns { verdict: 'ok'|'review', safetyStatus: 'ok'|'flagged', issues[],
 * summary }. Only images saved in ZedExams Storage can be checked (the server
 * fetches the bytes), so this is called on freshly-generated images whose URLs
 * are Firebase Storage URLs.
 */

import { getFunctions, httpsCallable } from 'firebase/functions'
import app from '../firebase/config'

const functions = getFunctions(app, 'us-central1')
const callable = httpsCallable(functions, 'checkVisualSafety')

export async function checkVisualSafety({ imageUrl, grade, subject, topic, style } = {}) {
  if (!imageUrl) throw new Error('No image to check.')
  try {
    const res = await callable({ imageUrl, context: { grade, subject, topic, style } })
    return res?.data || { verdict: 'review', safetyStatus: 'flagged', issues: [], summary: '' }
  } catch (error) {
    const code = error?.code || ''
    const msg = error?.message || ''
    if (code.includes('permission-denied')) throw new Error('Image checking is only available to approved teachers.')
    if (code.includes('resource-exhausted')) throw new Error('You have reached today’s check limit — try again tomorrow.')
    if (code.includes('unauthenticated')) throw new Error('Please sign in to check images.')
    if (code.includes('invalid-argument')) throw new Error(msg || 'That image can’t be checked. Save it first, then check.')
    throw new Error(msg || 'The safety check failed. Please try again.')
  }
}
