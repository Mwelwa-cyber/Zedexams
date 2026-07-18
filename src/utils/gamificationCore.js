/**
 * gamificationCore — the PURE, dependency-free heart of the learner XP /
 * level / streak system. No Firebase, no DOM, no clock: every function here
 * is a deterministic transform of its inputs, so `scripts/test-gamification-
 * core.mjs` exercises it under plain node.
 *
 * The Firestore-bound wrapper (subscribe, read, transactional write) lives in
 * gamificationService.js and calls `computeExamCompletion` inside a
 * transaction — the read-modify-write of xp/streak/examsCompleted must be
 * atomic so two concurrent completions of the same attempt can't both pass the
 * dedup check and double-count. This split is what makes that logic testable.
 */

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

export const STREAK_MILESTONES = [1, 3, 7, 14, 30, 60, 100]

export function streakMilestoneReached(prevStreak, newStreak) {
  return STREAK_MILESTONES.find(m => prevStreak < m && newStreak >= m) ?? null
}

export function computeStreakAfter(prevStreak, prevDate, todayKey) {
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

export function defaultStats() {
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

/**
 * Pure exam-completion transform. Given the CURRENT stats doc (`prev`) and the
 * attempt, returns either a dedup no-op or the next stats doc + the celebration
 * envelope. The caller runs this INSIDE a Firestore transaction so `prev` is
 * the transactionally-read current value and the write is atomic — that is
 * what stops two concurrent completions of the same attempt from both passing
 * the `processedAttempts` dedup and double-awarding XP / streak / count.
 *
 * @param {object} prev      current learnerStats (already normalised)
 * @param {object} p
 * @param {object} p.attempt {id, percentage, subject, attemptDate}
 * @param {number|null} p.rank
 * @param {string} p.todayKey resolved YYYY-MM-DD (caller supplies the clock)
 * @param {number} p.nowMs    recordedAt stamp (caller supplies the clock)
 * @returns {{deduped:true, stats:object} | {deduped:false, next:object, envelope:object}}
 */
export function computeExamCompletion(prev, { attempt, rank = null, todayKey, nowMs }) {
  const base = { ...defaultStats(), ...(prev || {}) }

  // Dedup: this attempt was already recorded. Because the caller reads `prev`
  // transactionally, a concurrent duplicate re-reads the just-written doc and
  // lands here — the +1s never run twice.
  if ((base.processedAttempts || []).some(pa => pa.attemptId === attempt.id)) {
    return { deduped: true, stats: base }
  }

  const percentage = Number(attempt.percentage) || 0
  const subject = attempt.subject || ''

  const subjectBests = { ...(base.subjectBests || {}) }
  const existing = subjectBests[subject] || { bestPercentage: 0, attempts: 0 }
  subjectBests[subject] = {
    bestPercentage: Math.max(existing.bestPercentage || 0, percentage),
    attempts: (existing.attempts || 0) + 1,
    lastDate: todayKey,
  }

  const newStreak = computeStreakAfter(base.currentStreak, base.lastActivityDate, todayKey)
  const streakMilestone = streakMilestoneReached(base.currentStreak, newStreak)
  const isPersonalBest = percentage > (base.bestPercentage ?? 0)

  const xpEarned = xpForAttempt({ percentage, rank, streakAfter: newStreak, personalBest: isPersonalBest })

  const prevLevel = levelFromXp(base.xp || 0)
  const newXp = (base.xp || 0) + xpEarned
  const newLevel = levelFromXp(newXp)
  const leveledUp = newLevel.level > prevLevel.level

  const processedAttempts = [
    ...(base.processedAttempts || []),
    { attemptId: attempt.id, xp: xpEarned, recordedAt: nowMs },
  ].slice(-30)

  const recentRanks = [
    ...(base.recentRanks || []),
    { attemptId: attempt.id, subject, rank: rank ?? null, percentage, date: todayKey },
  ].slice(-20)

  const next = {
    userId: base.userId,
    xp: newXp,
    level: newLevel.level,
    currentStreak: newStreak,
    longestStreak: Math.max(base.longestStreak || 0, newStreak),
    lastActivityDate: todayKey,
    bestPercentage: Math.max(base.bestPercentage || 0, percentage),
    examsCompleted: (base.examsCompleted || 0) + 1,
    subjectBests,
    processedAttempts,
    recentRanks,
  }

  return {
    deduped: false,
    next,
    envelope: {
      xpEarned,
      leveledUp,
      prevLevel,
      newLevel,
      isPersonalBest,
      previousBestPercentage: base.bestPercentage || 0,
      streakBefore: base.currentStreak || 0,
      streakAfter: newStreak,
      streakMilestone,
    },
  }
}
