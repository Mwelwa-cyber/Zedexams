// src/features/lessons/lib/firestore.js
//
// Learner-side read helper for slide-based interactive lessons.
//
// Lessons and notes currently share the `lessons` Firestore collection.
// A document is a slide-based lesson when it has a non-empty `slides`
// array and no `noteFormat`; a note carries `noteFormat` and uses
// `content` / `fileUrl` instead. Firestore rules give learners read
// access where `isPublished == true`, so we query on that and split
// the two doc shapes client-side.

import {
  collection, query, where, orderBy, onSnapshot,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'

const LESSONS = 'lessons'

function isSlideLesson(doc) {
  if (!doc) return false
  if (doc.noteFormat) return false
  return Array.isArray(doc.slides) && doc.slides.length > 0
}

/**
 * Subscribe to published slide-based lessons for a specific grade.
 *
 * The Firestore rule on the `lessons` collection grants learner reads
 * via `resource.data.isPublished == true`, so the query must include
 * that exact field. The slide-vs-note split is applied client-side
 * because Firestore can't query for "field is missing".
 */
export function subscribeLearnerLessons({ grade, subject }, onChange, onError) {
  if (!grade) {
    onChange([])
    return () => {}
  }
  const constraints = [
    where('isPublished', '==', true),
    where('grade', '==', String(grade)),
  ]
  if (subject) constraints.push(where('subject', '==', subject))
  constraints.push(orderBy('publishedAt', 'desc'))

  const q = query(collection(db, LESSONS), ...constraints)
  return onSnapshot(
    q,
    (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      onChange(all.filter(isSlideLesson))
    },
    (err) => {
      console.error('[lessons] subscribeLearnerLessons error:', err)
      onError?.(err)
    },
  )
}
