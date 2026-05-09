/**
 * assignments — Firestore data access for class assignments.
 * Audit A10 PR 3.
 *
 * Reads are direct (rules allow any signed-in user to read assignment
 * pointers — the underlying quiz/exam still gates by its own collection
 * rules). Writes go through Cloud Functions so a tampered client can't
 * mint an assignment for a class they don't own.
 */

import {
  collection,
  getDocs,
  limit as fsLimit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import app, { db } from '../firebase/config'

const COLLECTION = 'assignments'
const fns = getFunctions(app, 'us-central1')
const createClassAssignmentCallable = httpsCallable(fns, 'createClassAssignment')
const removeClassAssignmentCallable = httpsCallable(fns, 'removeClassAssignment')
const getClassStatsCallable = httpsCallable(fns, 'getClassStats')

/**
 * Per-class analytics for the teacher dashboard. Bounded server-side
 * (30-day window, ≤200 learners, ≤25 active assignments) so a single
 * call is cheap. Returns the rendered shape — see classAnalytics.js
 * for the full schema.
 */
export async function getClassStats(classId) {
  const result = await getClassStatsCallable({ classId })
  return result.data
}

/** Active assignments for a single class, newest first. */
export async function listAssignmentsForClass(classId, { limit = 50 } = {}) {
  const q = query(
    collection(db, COLLECTION),
    where('classId', '==', classId),
    where('active', '==', true),
    orderBy('assignedAt', 'desc'),
    fsLimit(limit),
  )
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

/**
 * Active assignments across one OR many classes. Used by the
 * learner-side "From your teacher" card on GradeHub: the learner's
 * /classes list yields a small array of classIds (typically <30
 * thanks to Firestore's `in` cap), and we ask for assignments
 * across all of them in one query.
 *
 * Falls back to a serial fan-out when the caller passes more than
 * 30 classIds — vanishingly rare but the cap is real.
 */
export async function listAssignmentsForLearner(classIds, { limit = 60 } = {}) {
  if (!classIds || classIds.length === 0) return []
  if (classIds.length <= 30) {
    const q = query(
      collection(db, COLLECTION),
      where('classId', 'in', classIds),
      where('active', '==', true),
      orderBy('assignedAt', 'desc'),
      fsLimit(limit),
    )
    const snap = await getDocs(q)
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  }
  // 30+ classes — chunk through and merge.
  const seen = new Set()
  const merged = []
  for (let i = 0; i < classIds.length; i += 30) {
    const chunk = classIds.slice(i, i + 30)
    // eslint-disable-next-line no-await-in-loop
    const part = await listAssignmentsForLearner(chunk, { limit })
    for (const a of part) {
      if (seen.has(a.id)) continue
      seen.add(a.id)
      merged.push(a)
    }
  }
  return merged
    .sort((a, b) => (b.assignedAt?.toMillis?.() || 0) - (a.assignedAt?.toMillis?.() || 0))
    .slice(0, limit)
}

export async function createClassAssignment({ classId, resourceType, resourceId, dueAt }) {
  const dueAtMs = dueAt instanceof Date ? dueAt.getTime() : (typeof dueAt === 'number' ? dueAt : null)
  const result = await createClassAssignmentCallable({
    classId,
    resourceType,
    resourceId,
    dueAtMs,
  })
  return result.data
}

export async function removeClassAssignment(assignmentId) {
  const result = await removeClassAssignmentCallable({ assignmentId })
  return result.data
}
