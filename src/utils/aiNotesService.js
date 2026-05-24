/**
 * AI-generated notes — learner-side service.
 *
 * Mirrors src/utils/aiPracticeQuizService.js but for the notes
 * artifact type. Two jobs:
 *   1. listPublishedNotesForLearner  — Firestore onSnapshot query
 *      scoped to the learner's grade + published status only.
 *   2. loadNotes                     — single-doc fetch with a
 *      defensive status re-check (defence in depth: rules say
 *      learners can only read published, but the reader also refuses
 *      anything stale).
 *
 * No submission, no scoring, no downstream task queue — reading notes
 * doesn't trigger any agent work. Notes are a passive surface.
 *
 * Hard rules:
 *   - The list query never touches draft / needs_review / rejected /
 *     regenerate_required artifacts (Firestore rule + explicit
 *     status filter).
 *   - Never writes to any collection — read-only.
 */

import {
  collection, doc, getDoc, limit as fsLimit, onSnapshot,
  orderBy, query, where,
} from 'firebase/firestore'
import { db } from '../firebase/config'

const CONTENT_COLLECTION = 'aiGeneratedContent'

/**
 * onSnapshot subscriber. Returns an `unsubscribe` function.
 *
 * @param {object} args
 * @param {string|number} args.grade   the learner's registered grade
 * @param {function} args.onChange     (artifacts[]) => void
 * @param {function} [args.onError]    (err) => void
 * @param {number}   [args.limit=60]
 * @returns {function} unsubscribe
 */
export function listPublishedNotesForLearner({
  grade, onChange, onError, limit: pageLimit = 60,
}) {
  if (!grade || !onChange) {
    if (onChange) onChange([])
    return () => {}
  }
  const q = query(
    collection(db, CONTENT_COLLECTION),
    where('type', '==', 'notes'),
    where('status', '==', 'published'),
    where('grade', '==', String(grade)),
    orderBy('createdAt', 'desc'),
    fsLimit(pageLimit),
  )
  return onSnapshot(
    q,
    snap => onChange(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { if (onError) onError(err) },
  )
}

/**
 * Single-doc fetch for the reader. Refuses to return anything whose
 * status is not 'published' OR whose grade doesn't match the learner.
 * The Firestore rule already prevents the read in the first place
 * for non-published docs; the grade check here is a defence against
 * a tampered URL.
 */
export async function loadNotes({ contentId, learnerGrade }) {
  if (!contentId) throw new Error('contentId required')
  const snap = await getDoc(doc(db, CONTENT_COLLECTION, contentId))
  if (!snap.exists()) {
    const err = new Error('Notes not found')
    err.code = 'not_found'
    throw err
  }
  const data = snap.data() || {}
  if (data.type !== 'notes') {
    const err = new Error('Wrong content type')
    err.code = 'wrong_type'
    throw err
  }
  if (data.status !== 'published') {
    const err = new Error('These notes are not published')
    err.code = 'not_published'
    throw err
  }
  if (learnerGrade != null && String(data.grade) !== String(learnerGrade)) {
    const err = new Error(`These notes are for Grade ${data.grade}, not your grade`)
    err.code = 'grade_mismatch'
    throw err
  }
  return { id: snap.id, ...data }
}

// Reading-time estimate for the list card. Falls back to a body-word
// count when the runner-stamped estimatedReadingMinutes is missing.
export function estimatedReadingMinutesForNotes(artifact) {
  const content = (artifact && artifact.content) || {}
  if (Number.isInteger(content.estimatedReadingMinutes) &&
      content.estimatedReadingMinutes > 0) {
    return content.estimatedReadingMinutes
  }
  const body = typeof content.body === 'string' ? content.body : ''
  if (!body) return 1
  const words = body.trim().split(/\s+/).length
  return Math.max(1, Math.round(words / 200))
}
