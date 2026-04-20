/**
 * Daily Exam Leaderboard Service
 *
 * Provides both one-shot fetches and real-time onSnapshot subscriptions
 * for the daily exam leaderboard.
 *
 * Ranking order:
 *   1. percentage DESC  (highest score first)
 *   2. score DESC       (raw marks, breaks ties when percentages match)
 *   3. submittedAt ASC  (earliest submission wins remaining ties)
 *
 * Required Firestore composite indexes on exam_attempts:
 *   Without grade filter:
 *     subject ASC · attemptDate ASC · status ASC
 *     · percentage DESC · score DESC · submittedAt ASC
 *
 *   With grade filter:
 *     subject ASC · grade ASC · attemptDate ASC · status ASC
 *     · percentage DESC · score DESC · submittedAt ASC
 */

import {
  collection, query, where, orderBy, limit,
  getDocs, onSnapshot,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { todayString } from './examService'

const MAX_ROWS = 25

// ── helpers ───────────────────────────────────────────────────────────────────

function buildQuery({ subject, grade, date }) {
  const parts = [
    where('status',      '==', 'submitted'),
    where('attemptDate', '==', date ?? todayString()),
  ]
  if (subject) parts.push(where('subject', '==', subject))
  if (grade)   parts.push(where('grade',   '==', String(grade)))
  parts.push(
    orderBy('percentage',  'desc'),
    orderBy('score',       'desc'),
    orderBy('submittedAt', 'asc'),
    limit(MAX_ROWS),
  )
  return query(collection(db, 'exam_attempts'), ...parts)
}

function mapDocs(snap) {
  return snap.docs.map((d, i) => {
    const data = d.data()
    return {
      rank:             i + 1,
      attemptId:        d.id,
      userId:           data.userId,
      displayName:      data.displayName || 'Student',
      subject:          data.subject     || '',
      grade:            data.grade       || '',
      score:            data.score       ?? 0,
      totalMarks:       data.totalMarks  ?? 0,
      totalQuestions:   data.totalQuestions ?? data.totalMarks ?? 0,
      percentage:       data.percentage  ?? 0,
      timeTakenSeconds: data.timeTakenSeconds ?? 0,
      submittedAt:      data.submittedAt,
      attemptDate:      data.attemptDate || '',
    }
  })
}

// ── real-time subscription ────────────────────────────────────────────────────

/**
 * Subscribe to the daily leaderboard in real time.
 *
 * @param {{ subject?: string, grade?: string|number, date?: string }} filters
 * @param {(rows: object[], error: string|null) => void} onUpdate
 * @returns {() => void}  unsubscribe function
 */
export function subscribeToDailyLeaderboard(filters = {}, onUpdate) {
  try {
    const q = buildQuery(filters)
    return onSnapshot(
      q,
      snap  => onUpdate(mapDocs(snap), null),
      err   => {
        console.error('leaderboard subscription error', err)
        onUpdate([], err?.code || err?.message || 'subscription_failed')
      },
    )
  } catch (err) {
    console.error('subscribeToDailyLeaderboard build error', err)
    onUpdate([], err?.message || 'query_failed')
    return () => {}
  }
}

// ── one-shot fetch (kept for ExamResultsPage) ─────────────────────────────────

/**
 * Fetch the leaderboard once (no live updates).
 * @param {string} subject
 * @param {string} [date]   YYYY-MM-DD, defaults to today
 * @param {string} [grade]
 */
export async function getDailyLeaderboard(subject, date, grade) {
  try {
    const snap = await getDocs(buildQuery({ subject, grade, date }))
    return mapDocs(snap)
  } catch (e) {
    console.error('getDailyLeaderboard:', e)
    return []
  }
}

// ── formatting helpers ─────────────────────────────────────────────────────────

export function fmtDuration(seconds) {
  if (seconds == null) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

export function fmtDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = dateStr.split('-')
  return new Date(Number(y), Number(m) - 1, Number(d))
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
}
