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
 * Weekly champions are aggregated client-side from the existing per-day
 * leaderboard queries — no new index is required.
 *
 * The activity feed re-uses the daily leaderboard subscription shape
 * (status == submitted AND attemptDate == today), ordered by submittedAt.
 */

import {
  collection, doc, getDoc, getDocs, setDoc, onSnapshot,
  query, where, orderBy, limit, serverTimestamp,
} from 'firebase/firestore'
import { db } from '../firebase/config'
import { todayString } from './examService'
import { getDailyLeaderboard } from './examLeaderboardService'

// ── Levels ────────────────────────────────────────────────────────────────────

// Cumulative XP thresholds. Title + icon used on every learner-facing surface.
// Keep the table monotonically increasing — levelFromXp walks it once.
export const LEVELS = [
  { level: 1,  threshold: 0,    title: 'Beginner',   icon: '🌱' },
  { level: 2,  threshold: 100,  title: 'Sprout',     icon: '🌿' },
  { level: 3,  threshold: 250,  title: 'Learner',    icon: '📘' },
  { level: 4,  threshold: 450,  title: 'Achiever',   icon: '🎯' },
  { level: 5,  threshold: 700,  title: 'Explorer',   icon: '🧭' },
  { level: 6,  threshold: 1000, title: 'Strategist', icon: '🧠' },
  { level: 7,  threshold: 1400, title: 'Scholar',    icon: '📚' },
  { level: 8,  threshold: 1900, title: 'Expert',     icon: '⚡' },
  { level: 9,  threshold: 2500, title: 'Star',       icon: '⭐' },
  { level: 10, threshold: 3200, title: 'Champion',   icon: '🏆' },
  { level: 12, threshold: 4500, title: 'Hero',       icon: '🦸' },
  { level: 15, threshold: 6500, title: 'Sage',       icon: '🦉' },
  { level: 20, threshold: 10000, title: 'Master',    icon: '👑' },
]

export function levelFromXp(totalXp = 0) {
  const xp = Math.max(0, Number(totalXp) || 0)
  let curr = LEVELS[0]
  let next = null
  for (let i = 0; i < LEVELS.length; i++) {
    if (LEVELS[i].threshold <= xp) curr = LEVELS[i]
    if (LEVELS[i].threshold > xp) { next = LEVELS[i]; break }
  }
  const xpInLevel = xp - curr.threshold
  const xpToNext = next ? next.threshold - curr.threshold : 0
  const xpRemaining = next ? next.threshold - xp : 0
  const progress = next && xpToNext > 0
    ? Math.min(100, Math.round((xpInLevel / xpToNext) * 100))
    : 100
  return { ...curr, totalXp: xp, nextLevel: next, xpInLevel, xpToNext, xpRemaining, progress }
}

// ── Streaks ───────────────────────────────────────────────────────────────────

export const STREAK_MILESTONES = [1, 3, 7, 14, 30, 60, 100]

function streakMilestoneReached(prevStreak, newStreak) {
  return STREAK_MILESTONES.find(m => prevStreak < m && newStreak >= m) ?? null
}

function computeStreakAfter(prevStreak, prevDate, todayKey) {
  if (!prevDate) return 1
  if (prevDate === todayKey) return prevStreak || 1   // same day: no change
  // Was the previous activity yesterday? Then extend; else reset to 1.
  const [y, m, d] = todayKey.split('-').map(Number)
  const todayMs = Date.UTC(y, m - 1, d)
  const ym = new Date(todayMs - 86400000)
  const yKey = `${ym.getUTCFullYear()}-${String(ym.getUTCMonth() + 1).padStart(2, '0')}-${String(ym.getUTCDate()).padStart(2, '0')}`
  if (prevDate === yKey) return (prevStreak || 0) + 1
  return 1
}

// ── XP rules ──────────────────────────────────────────────────────────────────

/**
 * Compute XP earned for a single submitted exam attempt.
 * Tuned so a daily learner who finishes one exam comfortably climbs ~50 XP/day
 * and a top-3 perfect-streak attempt can push 150+.
 */
export function xpForAttempt({
  percentage = 0,
  rank = null,
  streakAfter = 1,
  personalBest = false,
} = {}) {
  let xp = 50 // base: completing a daily exam
  if (percentage >= 90)      xp += 30
  else if (percentage >= 75) xp += 20
  else if (percentage >= 60) xp += 10
  if (rank === 1)            xp += 50
  else if (rank === 2)       xp += 30
  else if (rank === 3)       xp += 20
  else if (rank && rank <= 10) xp += 10
  if (personalBest)          xp += 20
  if (streakAfter >= 30)     xp += 30
  else if (streakAfter >= 7) xp += 20
  else if (streakAfter >= 3) xp += 10
  return xp
}

// ── Stats doc ─────────────────────────────────────────────────────────────────

const STATS_DOC = (uid) => doc(db, 'learnerStats', uid)

function defaultStats() {
  return {
    xp: 0,
    level: 1,
    currentStreak: 0,
    longestStreak: 0,
    lastActivityDate: null,
    bestPercentage: 0,
    examsCompleted: 0,
    subjectBests: {},
    processedAttempts: [],
    recentRanks: [],
  }
}

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

  const prev = await getLearnerStats(userId)
  if ((prev.processedAttempts || []).some(p => p.attemptId === attempt.id)) {
    return { ok: true, deduped: true, stats: prev }
  }

  const todayKey = attempt.attemptDate || todayString()
  const percentage = Number(attempt.percentage) || 0
  const subject    = attempt.subject || ''

  const subjectBests = { ...(prev.subjectBests || {}) }
  const existing = subjectBests[subject] || { bestPercentage: 0, attempts: 0 }
  subjectBests[subject] = {
    bestPercentage: Math.max(existing.bestPercentage || 0, percentage),
    attempts: (existing.attempts || 0) + 1,
    lastDate: todayKey,
  }

  const newStreak       = computeStreakAfter(prev.currentStreak, prev.lastActivityDate, todayKey)
  const streakMilestone = streakMilestoneReached(prev.currentStreak, newStreak)
  const isPersonalBest  = percentage > (prev.bestPercentage ?? 0)

  const xpEarned = xpForAttempt({ percentage, rank, streakAfter: newStreak, personalBest: isPersonalBest })

  const prevLevel = levelFromXp(prev.xp || 0)
  const newXp     = (prev.xp || 0) + xpEarned
  const newLevel  = levelFromXp(newXp)
  const leveledUp = newLevel.level > prevLevel.level

  const processedAttempts = [
    ...(prev.processedAttempts || []),
    { attemptId: attempt.id, xp: xpEarned, recordedAt: Date.now() },
  ].slice(-30)

  const recentRanks = [
    ...(prev.recentRanks || []),
    { attemptId: attempt.id, subject, rank: rank ?? null, percentage, date: todayKey },
  ].slice(-20)

  const next = {
    userId,
    xp: newXp,
    level: newLevel.level,
    currentStreak: newStreak,
    longestStreak: Math.max(prev.longestStreak || 0, newStreak),
    lastActivityDate: todayKey,
    bestPercentage: Math.max(prev.bestPercentage || 0, percentage),
    examsCompleted: (prev.examsCompleted || 0) + 1,
    subjectBests,
    processedAttempts,
    recentRanks,
    updatedAt: serverTimestamp(),
  }

  try {
    await setDoc(STATS_DOC(userId), next, { merge: true })
  } catch (err) {
    console.warn('recordExamCompletion write failed', err)
    return { ok: false, reason: err?.code || 'write_failed' }
  }

  return {
    ok: true,
    stats: next,
    xpEarned,
    leveledUp,
    prevLevel,
    newLevel,
    isPersonalBest,
    previousBestPercentage: prev.bestPercentage || 0,
    streakBefore: prev.currentStreak || 0,
    streakAfter: newStreak,
    streakMilestone,
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

// ── Weekly champions ─────────────────────────────────────────────────────────

/**
 * Aggregate the past `days` daily leaderboards into a weekly champion list.
 * Re-uses the existing per-day index — no new composite index required.
 *
 * Sort key:
 *   totalScore DESC (sum of percentages across days)
 *   bestRank   ASC  (tie-break: who reached the highest rank in any one day)
 */
export async function getWeeklyChampions({ subject, grade, days = 7 } = {}) {
  const now = new Date()
  const dateKeys = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    dateKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }

  const dailyResults = await Promise.all(
    dateKeys.map(k => getDailyLeaderboard(subject || undefined, k, grade || undefined)),
  )

  const agg = new Map()
  dailyResults.forEach((rows, idx) => {
    const day = dateKeys[idx]
    for (const r of rows) {
      const cur = agg.get(r.userId) || {
        userId: r.userId,
        displayName: r.displayName,
        bestPercentage: 0,
        totalAttempts: 0,
        totalScore: 0,
        bestRank: 999,
        subjects: new Set(),
        days: new Set(),
      }
      cur.bestPercentage = Math.max(cur.bestPercentage, r.percentage)
      cur.totalAttempts += 1
      cur.totalScore    += r.percentage
      cur.bestRank      = Math.min(cur.bestRank, r.rank)
      if (r.subject) cur.subjects.add(r.subject)
      cur.days.add(day)
      agg.set(r.userId, cur)
    }
  })

  return Array.from(agg.values())
    .map(u => ({
      userId: u.userId,
      displayName: u.displayName,
      bestPercentage: u.bestPercentage,
      avgPercentage: Math.round(u.totalScore / Math.max(1, u.totalAttempts)),
      totalAttempts: u.totalAttempts,
      totalScore: u.totalScore,
      bestRank: u.bestRank,
      subjectsCount: u.subjects.size,
      activeDays: u.days.size,
    }))
    .sort((a, b) => (b.totalScore - a.totalScore) || (a.bestRank - b.bestRank))
    .slice(0, 10)
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
