// src/features/notes/lib/quizzes.js
//
// Reads published quizzes so a study note's quiz block can link to a real
// ZedExams quiz. Mirrors the proven query in
// src/components/teacher/classes/ClassAssignmentPicker.jsx (isPublished + grade,
// indexed by `isPublished + grade + updatedAt`, with a no-index fallback) — but
// drops the subject filter from the query and matches subject client-side via
// normalizeSubject, because notes store the subject *label* while quizzes may
// store the *slug*, and normalizeSubject canonicalises both to the label.

import { collection, getDocs, limit as fsLimit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { coerceQuiz } from '../../../schemas/quiz.js'
import { normalizeSubject } from '../../../config/curriculum'

/** Published quizzes for a grade, newest first. Never throws — returns []. */
export async function fetchPublishedQuizzes({ grade } = {}) {
  const filters = [where('isPublished', '==', true)]
  if (grade) filters.push(where('grade', '==', String(grade)))
  try {
    const q = query(collection(db, 'quizzes'), ...filters, orderBy('updatedAt', 'desc'), fsLimit(60))
    const snap = await getDocs(q)
    return snap.docs.map((d) => coerceQuiz({ id: d.id, ...d.data() })).filter(Boolean)
  } catch (err) {
    // Missing composite index (or other query error) → unordered fallback + client sort.
    console.warn('[notes] published-quiz query fell back to unordered', err)
    try {
      const snap = await getDocs(query(collection(db, 'quizzes'), ...filters, fsLimit(60)))
      return snap.docs
        .map((d) => coerceQuiz({ id: d.id, ...d.data() }))
        .filter(Boolean)
        .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))
    } catch (err2) {
      console.warn('[notes] published-quiz fallback failed', err2)
      return []
    }
  }
}

/** True if a quiz belongs to the given subject (label or slug), or no subject given. */
export function quizMatchesSubject(quiz, subject) {
  if (!subject) return true
  return normalizeSubject(quiz?.subject) === normalizeSubject(subject)
}
