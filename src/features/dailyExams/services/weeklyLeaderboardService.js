// src/features/dailyExams/services/weeklyLeaderboardService.js
//
// Reads a week of submitted daily-exam attempts for ONE grade, so the
// weekly board can be folded out of them by learnerLeaderboardCore.
//
// ONE QUERY PER WEEK. The older `getWeeklyChampions` helper fanned out
// seven per-day leaderboard queries and merged the results; because
// `attemptDate` is a 'YYYY-MM-DD' string, a whole week is a single range
// filter instead — lexicographic and calendar order agree for that format.
//
// SCALE, stated rather than hidden. This reads the grade's attempts for
// the week and aggregates them in the browser. That is correct and cheap
// at present volumes, and it does NOT scale indefinitely: a very active
// grade will eventually exceed MAX_ATTEMPTS, at which point the honest
// answer is a server-side rollup into `leaderboards/{grade}/weeks/{weekId}`
// written by a Cloud Function, which this module's shape is meant to be
// swapped for without touching the screen. Until then the cap is REPORTED
// (`truncated`) rather than silently applied, because a board ranked from
// a truncated read looks exactly like a complete one.

import {
  collection, query, where, orderBy, limit, getDocs,
} from 'firebase/firestore'
import { db } from '../../../firebase/config'
import { weekWindow, previousWeekWindow } from '../lib/learnerLeaderboardCore'

/**
 * The read ceiling for one grade-week. Sized well above a realistic grade
 * (a learner can sit at most one attempt per subject per day, so ~50 a
 * week each) while staying a bounded read.
 */
export const MAX_ATTEMPTS = 3000

/**
 * Only the fields the board actually needs come off each doc.
 *
 * `answers` and the per-attempt analytics are NOT on the top-level doc at
 * all — the grader keeps them in the owner-only `private/` subcollection
 * precisely so a cross-user reader like this one cannot reach them.
 */
function toRow(doc) {
  const d = doc.data()
  return {
    userId: d.userId,
    displayName: d.displayName || '',
    score: d.score ?? 0,
    percentage: d.percentage ?? 0,
    attemptDate: d.attemptDate || '',
  }
}

/**
 * Fetch every submitted attempt for `grade` inside one week.
 *
 * Requires the composite index
 *   exam_attempts: grade ASC · status ASC · attemptDate ASC
 * (the pre-existing grade index orders `attemptDate` BEFORE `status`, which
 * cannot serve a range on attemptDate alongside an equality on status).
 *
 * @param {{ grade: string|number, window: object }} args
 * @returns {Promise<{ attempts: object[], truncated: boolean }>}
 */
export async function fetchWeekAttempts({ grade, window: win }) {
  if (!grade) return { attempts: [], truncated: false }

  const q = query(
    collection(db, 'exam_attempts'),
    where('grade', '==', String(grade)),
    where('status', '==', 'submitted'),
    where('attemptDate', '>=', win.startKey),
    where('attemptDate', '<=', win.endKey),
    orderBy('attemptDate', 'asc'),
    limit(MAX_ATTEMPTS),
  )

  const snap = await getDocs(q)
  return {
    attempts: snap.docs.map(toRow),
    truncated: snap.size >= MAX_ATTEMPTS,
  }
}

/**
 * Everything the leaderboard screen needs, in two reads: this week's
 * attempts and last week's (for the "👑 Last week" chip).
 *
 * Last week is fetched alongside rather than after, because the two are
 * independent — serialising them would double the time the learner spends
 * looking at a skeleton for no benefit.
 *
 * A FAILURE ON LAST WEEK IS NOT A FAILURE. The champion chip is a garnish;
 * losing it must never blank the board the learner came for, so it settles
 * to null on its own while this week's read decides whether the screen can
 * render at all.
 */
export async function fetchWeeklyBoardData({ grade, now = new Date() } = {}) {
  const thisWeek = weekWindow(now)
  const lastWeek = previousWeekWindow(now)

  const [current, previous] = await Promise.all([
    fetchWeekAttempts({ grade, window: thisWeek }),
    fetchWeekAttempts({ grade, window: lastWeek }).catch(() => ({ attempts: [], truncated: false })),
  ])

  return {
    window: thisWeek,
    attempts: current.attempts,
    truncated: current.truncated,
    previousAttempts: previous.attempts,
  }
}
