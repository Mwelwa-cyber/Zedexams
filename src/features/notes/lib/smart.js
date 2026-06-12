// src/features/notes/lib/smart.js
//
// Client access to a note's cached AI highlights (noteSmart/{noteId}) and the
// admin-only generate callable. Mirrors insights.js.

import { doc, getDoc } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../../../firebase/config'

const functions = getFunctions(app, 'us-central1')
const generateNoteSmartCallable = httpsCallable(functions, 'generateNoteSmart', { timeout: 90_000 })

/** Read cached highlights: { [blockId]: string[] } (empty object if none). */
export async function fetchNoteSmart(noteId) {
  if (!noteId) return null
  const snap = await getDoc(doc(db, 'noteSmart', noteId))
  if (!snap.exists()) return null
  const d = snap.data()
  return {
    highlights: d?.highlights && typeof d.highlights === 'object' ? d.highlights : {},
    sections: Array.isArray(d?.sections) ? d.sections : [],
  }
}

/** Admin-only: (re)generate highlights for a note. */
export async function generateNoteSmart(noteId) {
  const res = await generateNoteSmartCallable({ noteId })
  return res?.data || {}
}

export function smartErrorMessage(err) {
  const code = err?.code || ''
  if (code.includes('resource-exhausted')) return 'You’ve reached today’s AI limit. Try again tomorrow.'
  if (code.includes('failed-precondition')) return 'Add some study blocks first, then generate highlights.'
  if (code.includes('permission-denied')) return 'Only staff can generate highlights.'
  return 'Could not generate highlights right now. Please try again.'
}
