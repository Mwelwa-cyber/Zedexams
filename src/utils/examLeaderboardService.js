/**
 * Daily Exam Leaderboard Service
 *
 * Queries exam_attempts for the top 10 performers on a given subject + date.
 * Sort order: highest percentage → lowest timeTaken → earliest submittedAt.
 *
 * Required Firestore composite index on exam_attempts:
 *   subject ASC · attemptDate ASC · status ASC
 *   · percentage DESC · timeTakenSeconds ASC · submittedAt ASC
 *
 * Create it at:
 *   Firebase Console → Firestore → Indexes → Composite → Add index
 */

import {
  collection, query, where, orderBy, limit, getDocs,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { todayString } from './examService'

/**
 * Fetch top-10 leaderboard for a subject on a given day.
 * @param {string} subject  — e.g. "mathematics"
 * @param {string} [date]   — "YYYY-MM-DD", defaults to today
 * @returns {Array<{ rank, attemptId, userId, displayName, score, totalMarks, percentage, timeTakenSeconds, submittedAt }>}
 */
export async function getDailyLeaderboard(subject, date = todayString()) {
  try {
    const snap = await getDocs(
      query(
        collection(db, 'exam_attempts'),
        where('subject', '==', subject),
        where('attemptDate', '==', date),
        where('status', '==', 'submitted'),
        orderBy('percentage', 'desc'),
        orderBy('timeTakenSeconds', 'asc'),
        orderBy('submittedAt', 'asc'),
        limit(10),
      ),
    )

    return snap.docs.map((d, i) => {
      const data = d.data()
      return {
        rank: i + 1,
        attemptId: d.id,
        userId: data.userId,
        displayName: data.displayName || 'Student',
        score: data.score ?? 0,
        totalMarks: data.totalMarks ?? 0,
        percentage: data.percentage ?? 0,
        timeTakenSeconds: data.timeTakenSeconds ?? 0,
        submittedAt: data.submittedAt,
      }
    })
  } catch (e) {
    console.error('getDailyLeaderboard:', e)
    return []
  }
}

/** Format seconds as "Xm Ys" */
export function fmtDuration(seconds) {
  if (!seconds && seconds !== 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}
