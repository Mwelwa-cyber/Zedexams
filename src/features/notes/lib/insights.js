// src/features/notes/lib/insights.js
//
// Client access to a note's AI Summary + Key Points. Insights are generated +
// cached server-side (one doc per note in `noteInsights/{noteId}`), so we read
// the cache directly first and only call the Cloud Function on a miss.

import { doc, getDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../../../firebase/config'

const functions = getFunctions(app, 'us-central1')
// Client timeout > server (45s) so the server's own error surfaces first.
const generateNoteInsightsCallable = httpsCallable(functions, 'generateNoteInsights', { timeout: 55_000 })

/** Read the cached insights for a note, or null if not generated yet. */
export async function fetchCachedInsights(noteId) {
  if (!noteId) return null
  const snap = await getDoc(doc(db, 'noteInsights', noteId))
  if (!snap.exists()) return null
  const d = snap.data()
  if (!d?.summary) return null
  return { summary: d.summary, keyPoints: Array.isArray(d.keyPoints) ? d.keyPoints : [] }
}

/** Generate (or fetch cached) insights via the Cloud Function. */
export async function generateInsights(noteId) {
  const res = await generateNoteInsightsCallable({ noteId })
  const data = res?.data || {}
  return { summary: data.summary || '', keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints : [] }
}

/** Turn a callable/Firestore error into a learner-friendly message. */
export function insightsErrorMessage(err) {
  const code = err?.code || ''
  if (code.includes('resource-exhausted')) return 'You’ve reached today’s AI limit. Try again tomorrow.'
  if (code.includes('failed-precondition')) return 'This note doesn’t have enough text to summarise yet.'
  if (code.includes('unauthenticated')) return 'Please sign in to use AI study help.'
  if (code.includes('not-found') || code.includes('permission-denied')) return 'This note isn’t available for AI help.'
  return 'AI study help is unavailable right now. Please try again.'
}
