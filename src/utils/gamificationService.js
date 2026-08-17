/**
 * Gamification service — XP, levels, streaks, rivalry, weekly champions,
 * and a live activity feed for the daily exam ecosystem.
 *
 * Firestore document:
 *   /learnerStats/{userId}
 *     {
 *       userId,
 *       xp:                int,
 *       level:             int,
 *       currentStreak:     int,
 *       longestStreak:     int,
 *       lastActivityDate:  'YYYY-MM-DD' | null,
 *       bestPercentage:    int (0–100),
 *       examsCompleted:    int,
 *       subjectBests:      { [subject]: { bestPercentage, attempts } },
 *       processedAttempts: [{ attemptId, xp, recordedAt }],
 *       recentRanks:       [{ attemptId, subject, rank, percentage, date }],
 *       updatedAt:         serverTimestamp
 *     }
 *
 * Weekly aggregation is NOT here any more. `getWeeklyChampions` fanned out
 * seven per-day leaderboard queries and merged them; the prototype-v23
 * board replaced it with a single `attemptDate` range read, which lives in
 * `features/dailyExams/services/weeklyLeaderboardService.js` beside the
 * screen that needs it. It went with its one consumer rather than being
 * left here unused.
 *
 * The activity feed re-uses the daily leaderboard subscription shape
 * (status == submitted AND attemptDate == today), ordered by submittedAt.
 */

import {
  collection, doc, getDoc, getDocs, onSnapshot, runTransaction,
  query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { todayString } from './examService'
// Pure XP/level/streak/completion logic lives in the dependency-free core so
// it is unit-tested under plain node (scripts/test-gamification-core.mjs).
import {
  LEVELS, levelFromXp, STREAK_MILESTONES, xpForAttempt,
  defaultStats, computeExamCompletion,
} from './gamificationCore'

// Re-exported for existing importers (levelFromXp, LEVELS, xpForAttempt, …).
export { LEVELS, levelFromXp, STREAK_MILESTONES, xpForAttempt }

// ── Stats doc ─────────────────────────────────────────────────────────────────

const STATS_DOC = (uid) => doc(db, 'learnerStats', uid)

export async function getLearnerStats(uid) {
  if (!uid) return defaultStats()
  try {
    const snap = await getDoc(STATS_DOC(uid))
    if (!snap.exists()) return defaultStats()
    return { ...defaultStats(), ...snap.data() }
  } catch (err) {
    console.warn('getLearnerStats failed', err)
    return defaultStats()
  }
}

export function subscribeToLearnerStats(uid, onUpdate) {
  if (!uid) { onUpdate(defaultStats()); return () => {} }
  try {
    return onSnapshot(
      STATS_DOC(uid),
      snap => onUpdate({ ...defaultStats(), ...(snap.exists() ? snap.data() : {}) }),
      err => { console.warn('learnerStats subscribe failed', err); onUpdate(defaultStats()) },
    )
  } catch (err) {
    console.warn('learnerStats subscribe build error', err)
    onUpdate(defaultStats())
    return () => {}
  }
}

/**
 * Record an exam completion. Idempotent on attemptId, so reloading the
 * results page doesn't double-award XP.
 *
 * Returns a result envelope the UI uses to celebrate:
 *   {
 *     ok, deduped, stats,
 *     xpEarned, leveledUp, prevLevel, newLevel,
 *     isPersonalBest, previousBestPercentage,
 *     streakBefore, streakAfter, streakMilestone,
 *   }
 */
export async function recordExamCompletion({ userId, attempt, rank = null }) {
  if (!userId || !attempt?.id) return { ok: false, reason: 'bad_args' }

  const todayKey = attempt.attemptDate || todayString()
  const ref = STATS_DOC(userId)

  // The whole read-modify-write runs in a transaction: the previous read is
  // the dedup check (processedAttempts) AND the base for the +xp/+streak/
  // +examsCompleted maths. Without the transaction two concurrent completions
  // of the same attempt both read the pre-write doc, both miss the dedup, and
  // both add XP — double-counting. Firestore serialises transactions on the
  // same doc, so the second re-reads the committed doc and dedups cleanly.
  let outcome
  try {
    outcome = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      const prev = { ...defaultStats(), userId, ...(snap.exists() ? snap.data() : {}) }
      const computed = computeExamCompletion(prev, {
        attempt, rank, todayKey, nowMs: Date.now(),
      })
      if (computed.deduped) {
        return { deduped: true, stats: computed.stats }
      }
      tx.set(ref, { ...computed.next, updatedAt: serverTimestamp() }, { merge: true })
      return { deduped: false, stats: computed.next, envelope: computed.envelope }
    })
  } catch (err) {
    console.warn('recordExamCompletion write failed', err)
    return { ok: false, reason: err?.code || 'write_failed' }
  }

  if (outcome.deduped) {
    return { ok: true, deduped: true, stats: outcome.stats }
  }

  return {
    ok: true,
    stats: outcome.stats,
    ...outcome.envelope,
  }
}

// ── Rivalry messages ──────────────────────────────────────────────────────────

/**
 * Generate up to two short rivalry messages: one for the learner just above
 * the viewer (the "chase" target) and one for the learner just below (the
 * "defend" target). Returns null if the viewer isn't on the leaderboard.
 */
export function computeRivalry(rows, myUserId) {
  if (!Array.isArray(rows) || !myUserId) return null
  const myIdx = rows.findIndex(r => r.userId === myUserId)
  if (myIdx < 0) return null
  const me    = rows[myIdx]
  const above = myIdx > 0                    ? rows[myIdx - 1] : null
  const below = myIdx < rows.length - 1       ? rows[myIdx + 1] : null
  const messages = []

  if (above) {
    const pctDiff = above.percentage - me.percentage
    const mkDiff  = above.score - me.score
    if (pctDiff > 0) {
      messages.push({
        tone: 'challenge',
        icon: '🎯',
        text: `Only ${pctDiff}% behind ${above.displayName} (Rank #${above.rank}).`,
      })
    } else if (pctDiff === 0 && mkDiff > 0) {
      messages.push({
        tone: 'challenge',
        icon: '⚡',
        text: `${above.displayName} edged you out by ${mkDiff} mark${mkDiff === 1 ? '' : 's'} — same percentage!`,
      })
    }
  }
  if (below) {
    const pctDiff = me.percentage - below.percentage
    const mkDiff  = me.score - below.score
    if (pctDiff > 0) {
      messages.push({
        tone: 'good',
        icon: '🚀',
        text: `You're ahead of ${below.displayName} by ${pctDiff} percentage point${pctDiff === 1 ? '' : 's'}.`,
      })
    } else if (pctDiff === 0 && mkDiff > 0) {
      messages.push({
        tone: 'good',
        icon: '🚀',
        text: `You're holding off ${below.displayName} by ${mkDiff} mark${mkDiff === 1 ? '' : 's'}.`,
      })
    }
  }

  return { myRank: me.rank, messages }
}

// ── Live activity feed ────────────────────────────────────────────────────────

/**
 * Subscribe to today's most recent submitted attempts as an activity feed.
 * Re-uses the daily leaderboard's index (subject?, attemptDate, status) and
 * orders by submittedAt DESC.
 */
export function subscribeToRecentActivity({ subject, grade, date } = {}, onUpdate) {
  try {
    const parts = [
      where('status', '==', 'submitted'),
      where('attemptDate', '==', date || todayString()),
    ]
    if (subject) parts.push(where('subject', '==', subject))
    if (grade)   parts.push(where('grade', '==', String(grade)))
    parts.push(orderBy('submittedAt', 'desc'), limit(15))
    const q = query(collection(db, 'exam_attempts'), ...parts)
    return onSnapshot(
      q,
      snap => onUpdate(
        snap.docs.map(d => {
          const data = d.data()
          return {
            id: d.id,
            userId: data.userId,
            displayName: data.displayName || 'Student',
            subject: data.subject || '',
            grade: data.grade || '',
            percentage: data.percentage ?? 0,
            score: data.score ?? 0,
            totalMarks: data.totalMarks ?? 0,
            submittedAt: data.submittedAt,
          }
        }),
        null,
      ),
      err => { console.warn('activity feed subscribe failed', err); onUpdate([], err?.code || 'subscribe_failed') },
    )
  } catch (err) {
    console.warn('activity feed query build failed', err)
    onUpdate([], err?.message || 'query_failed')
    return () => {}
  }
}

/**
 * One-shot fetch of today's submitted attempts. Used by surfaces that
 * don't need realtime updates (e.g. the results-page activity teaser).
 */
export async function getRecentActivity({ subject, grade, date } = {}) {
  try {
    const parts = [
      where('status', '==', 'submitted'),
      where('attemptDate', '==', date || todayString()),
    ]
    if (subject) parts.push(where('subject', '==', subject))
    if (grade)   parts.push(where('grade', '==', String(grade)))
    parts.push(orderBy('submittedAt', 'desc'), limit(15))
    const snap = await getDocs(query(collection(db, 'exam_attempts'), ...parts))
    return snap.docs.map(d => {
      const data = d.data()
      return {
        id: d.id,
        userId: data.userId,
        displayName: data.displayName || 'Student',
        subject: data.subject || '',
        grade: data.grade || '',
        percentage: data.percentage ?? 0,
        score: data.score ?? 0,
        totalMarks: data.totalMarks ?? 0,
        submittedAt: data.submittedAt,
      }
    })
  } catch (err) {
    console.warn('getRecentActivity failed', err)
    return []
  }
}

// ── Display helpers ───────────────────────────────────────────────────────────

export function streakBadge(streak) {
  if (streak >= 30) return { icon: '👑', label: 'Diamond Streak', tone: 'gold'   }
  if (streak >= 14) return { icon: '🔥', label: 'On Fire',        tone: 'red'    }
  if (streak >= 7)  return { icon: '🔥', label: '7-Day Streak',   tone: 'orange' }
  if (streak >= 3)  return { icon: '✨', label: '3-Day Streak',   tone: 'amber'  }
  if (streak >= 1)  return { icon: '🌱', label: 'Just Started',   tone: 'green'  }
  return null
}

export function timeAgo(ts) {
  if (!ts) return ''
  const ms = ts?.toMillis ? ts.toMillis() : (ts instanceof Date ? ts.getTime() : Number(ts))
  if (!Number.isFinite(ms)) return ''
  const diff = Math.max(0, Date.now() - ms)
  if (diff < 60_000)         return 'just now'
  if (diff < 3_600_000)      return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000)     return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}
