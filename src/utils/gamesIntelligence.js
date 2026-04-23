/**
 * Games Intelligence — the learner brain for the /games surface.
 *
 * One document per learner at `learner_profiles/{uid}` holds everything the
 * hub needs in a single read: totals, per-subject stats, per-topic stats,
 * weak topics, last session, recent games, mastery map, and today's goal.
 *
 * Pure rule/feedback/mastery helpers are exported separately so the UI can
 * derive recommendations without any extra Firestore reads.
 *
 * Privacy + rules: the doc lives at `learner_profiles/{uid}` — owner-only
 * read/write (see firestore.rules). The client computes everything; no
 * Cloud Function is required.
 */

import {
  doc, getDoc, runTransaction, serverTimestamp,
} from 'firebase/firestore'
import { db, auth } from '../firebase/config'

/* ─────────────────────────────────────────────────────────────────
 *  Tunable thresholds — single source of truth, easy to change.
 * ───────────────────────────────────────────────────────────────── */

export const THRESHOLDS = {
  strongAccuracy:     80, // ≥ → strong
  confidentAccuracy:  75, // ≥ → confident
  improvingAccuracy:  60, // ≥ → improving (else beginner)
  needsPracticeBelow: 60, // flag when avg accuracy < this
  needsPracticeMinAttempts: 2, // only flag after at least this many plays
  lowScoreAccuracy:   60, // game-level "below threshold" cutoff
  unfinishedWithin:   48 * 60 * 60 * 1000, // 48h — still counts as "continue"
  maxTopicStats:      60, // cap map size
  maxRecentGames:     20, // cap recent history
  maxWeakTopics:      5,
}

export const MASTERY_LEVELS = ['beginner', 'improving', 'confident', 'strong']

export const DAILY_GOAL_TYPES = {
  play_2:         { label: 'Play 2 games today', target: 2 },
  score_80:       { label: 'Score 80% or higher in one game', target: 1 },
  practice_weak:  { label: 'Practice a weak topic once today', target: 1 },
}

/* ─────────────────────────────────────────────────────────────────
 *  Read — one-shot learner profile fetch
 * ───────────────────────────────────────────────────────────────── */

/**
 * Load the current user's learner profile. Returns a fresh empty profile
 * (not written to Firestore) when the user is signed out or has no record
 * yet, so callers never have to null-check shape.
 */
export async function getLearnerProfile(uid) {
  const userId = uid || auth.currentUser?.uid
  if (!userId) return emptyProfile(null)
  try {
    const snap = await getDoc(doc(db, 'learner_profiles', userId))
    if (!snap.exists()) return emptyProfile(userId)
    return { userId, ...snap.data() }
  } catch (err) {
    console.warn('getLearnerProfile failed', err?.code || err?.message)
    return emptyProfile(userId)
  }
}

function emptyProfile(userId) {
  return {
    userId: userId || null,
    grade: null,
    totals:        { gamesPlayed: 0, totalScore: 0, totalCorrect: 0, totalWrong: 0, avgAccuracy: 0 },
    subjectStats:  {},
    topicStats:    {},
    weakTopics:    [],
    recentGames:   [],
    lastSession:   null,
    dailyGoal:     null,
    updatedAt:     null,
  }
}

/* ─────────────────────────────────────────────────────────────────
 *  Write — called by gamesService.saveScore after a successful save
 * ───────────────────────────────────────────────────────────────── */

/**
 * Update the learner profile with the outcome of a just-finished game.
 * Called from `saveScore` in gamesService — fire-and-forget (errors are
 * swallowed so they can't break the score save).
 *
 * @param {object} params
 * @param {object} params.game     the game document
 * @param {object} params.result   { score, accuracy, correct, wrong, timeSpent, bestStreak }
 * @param {number|null} params.userGrade  optional grade from user profile
 * @returns { beforeTopic, afterTopic, profile } for feedback generation
 */
export async function updateLearnerProfileAfterGame({ game, result, userGrade = null }) {
  const uid = auth.currentUser?.uid
  if (!uid || !game || !game.id) return null

  const subject = String(game.subject || '').toLowerCase()
  const topicKey = buildTopicKey(subject, game.cbc_topic)
  const accuracy = clampPct(result.accuracy)
  const score = Number(result.score) || 0
  const correct = Number(result.correct) || 0
  const wrong = Number(result.wrong) || 0
  const timeSpent = Number(result.timeSpent) || 0

  const ref = doc(db, 'learner_profiles', uid)

  try {
    const outcome = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref)
      const existing = snap.exists() ? snap.data() : {}
      const prev = {
        totals:       existing.totals       || { gamesPlayed: 0, totalScore: 0, totalCorrect: 0, totalWrong: 0, avgAccuracy: 0 },
        subjectStats: existing.subjectStats || {},
        topicStats:   existing.topicStats   || {},
        recentGames:  existing.recentGames  || [],
        dailyGoal:    existing.dailyGoal    || null,
        grade:        existing.grade        ?? userGrade ?? (Number(game.grade) || null),
      }

      const beforeTopic = topicKey ? prev.topicStats[topicKey] : null
      const nextTopicStats = updateTopicStats(prev.topicStats, topicKey, accuracy)
      const afterTopic = topicKey ? nextTopicStats[topicKey] : null

      const nextSubjectStats = updateSubjectStats(prev.subjectStats, subject, {
        accuracy, correct, wrong, score,
      })

      const nextTotals = updateTotals(prev.totals, { score, correct, wrong, accuracy })

      const nextRecent = prependRecent(prev.recentGames, {
        gameId:    game.id,
        gameTitle: game.title || 'Game',
        subject,
        grade:     Number(game.grade) || null,
        type:      game.type || null,
        cbc_topic: game.cbc_topic || null,
        score,
        accuracy,
        playedAtMs: Date.now(),
      })

      const weakTopics = pickWeakTopics(nextTopicStats)

      const lastSession = {
        gameId:    game.id,
        gameTitle: game.title || 'Game',
        subject,
        grade:     Number(game.grade) || null,
        cbc_topic: game.cbc_topic || null,
        score,
        accuracy,
        completed: true,
        playedAtMs: Date.now(),
      }

      const nextDailyGoal = advanceDailyGoal(prev.dailyGoal, {
        accuracy,
        isWeakPractice: !!(topicKey && beforeTopic?.needsPractice),
      })

      const nextDoc = {
        userId: uid,
        grade: prev.grade,
        totals: nextTotals,
        subjectStats: nextSubjectStats,
        topicStats: nextTopicStats,
        weakTopics,
        recentGames: nextRecent,
        lastSession,
        dailyGoal: nextDailyGoal,
        updatedAt: serverTimestamp(),
      }

      tx.set(ref, nextDoc, { merge: true })

      return { beforeTopic, afterTopic, profile: { ...nextDoc, userId: uid } }
    })
    return outcome
  } catch (err) {
    console.warn('updateLearnerProfileAfterGame failed (non-fatal)', err?.code || err?.message)
    return null
  }
}

/* ─────────────────────────────────────────────────────────────────
 *  Pure helpers — mastery / stats math
 * ───────────────────────────────────────────────────────────────── */

export function buildTopicKey(subject, topic) {
  if (!subject || !topic) return null
  return `${String(subject).toLowerCase()}:${String(topic).toLowerCase().trim()}`
}

export function masteryFor(stats) {
  if (!stats || !stats.plays) return 'beginner'
  const a = stats.avgAccuracy || 0
  if (a >= THRESHOLDS.strongAccuracy) return 'strong'
  if (a >= THRESHOLDS.confidentAccuracy) return 'confident'
  if (a >= THRESHOLDS.improvingAccuracy) return 'improving'
  return 'beginner'
}

function updateTopicStats(prev, key, accuracy) {
  if (!key) return prev
  const now = Date.now()
  const existing = prev[key] || { plays: 0, sumAccuracy: 0, trend: [], lastPlayedAtMs: 0 }
  const plays = existing.plays + 1
  const sumAccuracy = (existing.sumAccuracy || 0) + accuracy
  const avgAccuracy = Math.round(sumAccuracy / plays)
  const trend = [...(existing.trend || []), accuracy].slice(-5)
  const next = {
    plays,
    sumAccuracy,
    avgAccuracy,
    trend,
    lastPlayedAtMs: now,
    needsPractice:
      plays >= THRESHOLDS.needsPracticeMinAttempts &&
      avgAccuracy < THRESHOLDS.needsPracticeBelow,
    mastery: null,
  }
  next.mastery = masteryFor(next)
  const merged = { ...prev, [key]: next }
  // Cap map size — drop oldest by lastPlayedAtMs.
  const entries = Object.entries(merged)
  if (entries.length <= THRESHOLDS.maxTopicStats) return merged
  entries.sort(([, a], [, b]) => (b.lastPlayedAtMs || 0) - (a.lastPlayedAtMs || 0))
  return Object.fromEntries(entries.slice(0, THRESHOLDS.maxTopicStats))
}

function updateSubjectStats(prev, subject, { accuracy, correct, wrong, score }) {
  if (!subject) return prev
  const existing = prev[subject] || {
    plays: 0, totalCorrect: 0, totalWrong: 0, sumAccuracy: 0, totalScore: 0, lastAccuracy: 0,
  }
  const plays = existing.plays + 1
  const sumAccuracy = existing.sumAccuracy + accuracy
  return {
    ...prev,
    [subject]: {
      plays,
      totalCorrect: existing.totalCorrect + correct,
      totalWrong:   existing.totalWrong + wrong,
      sumAccuracy,
      avgAccuracy:  Math.round(sumAccuracy / plays),
      totalScore:   existing.totalScore + score,
      lastAccuracy: accuracy,
      lastPlayedAtMs: Date.now(),
    },
  }
}

function updateTotals(prev, { score, correct, wrong, accuracy }) {
  const gamesPlayed = prev.gamesPlayed + 1
  const totalCorrect = prev.totalCorrect + correct
  const totalWrong = prev.totalWrong + wrong
  const totalScore = prev.totalScore + score
  // Rolling avg across all plays — weight by accuracy per round, not answers.
  const prevAvg = prev.avgAccuracy || 0
  const avgAccuracy = Math.round(((prevAvg * (gamesPlayed - 1)) + accuracy) / gamesPlayed)
  return { gamesPlayed, totalScore, totalCorrect, totalWrong, avgAccuracy }
}

function prependRecent(prev, entry) {
  const dedup = (prev || []).filter((r) => r.gameId !== entry.gameId)
  return [entry, ...dedup].slice(0, THRESHOLDS.maxRecentGames)
}

function pickWeakTopics(topicStats) {
  return Object.entries(topicStats || {})
    .filter(([, t]) => t?.needsPractice)
    .sort(([, a], [, b]) => (a.avgAccuracy || 0) - (b.avgAccuracy || 0))
    .slice(0, THRESHOLDS.maxWeakTopics)
    .map(([key, t]) => ({
      key,
      subject: key.split(':')[0],
      topic: key.split(':').slice(1).join(':'),
      avgAccuracy: t.avgAccuracy,
      plays: t.plays,
      mastery: t.mastery,
    }))
}

/* ─────────────────────────────────────────────────────────────────
 *  Daily goal — picks one challenge per day, tracks progress
 * ───────────────────────────────────────────────────────────────── */

export function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function advanceDailyGoal(prev, { accuracy, isWeakPractice }) {
  const today = todayISO()
  const goal = (prev && prev.date === today)
    ? { ...prev }
    : pickDailyGoal(today, { hasWeakness: isWeakPractice })

  if (goal.completed) return goal

  if (goal.type === 'play_2') {
    goal.progress = Math.min(goal.target, (goal.progress || 0) + 1)
  } else if (goal.type === 'score_80') {
    if (accuracy >= 80) goal.progress = goal.target
  } else if (goal.type === 'practice_weak') {
    if (isWeakPractice) goal.progress = goal.target
  }
  goal.completed = goal.progress >= goal.target
  return goal
}

function pickDailyGoal(date, { hasWeakness }) {
  const type = hasWeakness ? 'practice_weak' : (hashDay(date) % 2 === 0 ? 'play_2' : 'score_80')
  const meta = DAILY_GOAL_TYPES[type]
  return { date, type, label: meta.label, target: meta.target, progress: 0, completed: false }
}

function hashDay(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** Ensure today's goal is present on the profile (called by the hub for
 *  signed-in users who haven't played yet today). Pure — no Firestore. */
export function ensureTodayGoal(profile) {
  const today = todayISO()
  if (profile?.dailyGoal?.date === today) return profile.dailyGoal
  const hasWeakness = (profile?.weakTopics?.length || 0) > 0
  return pickDailyGoal(today, { hasWeakness })
}

/* ─────────────────────────────────────────────────────────────────
 *  Recommendations — pure rules, no Firestore
 *
 *  Returns a labelled set of recommendations. Callers pick the sections
 *  they want to render.
 *
 *  Priority order when the same game could land in multiple buckets:
 *    1. unfinishedOrContinue (most recent incomplete / unfinished session)
 *    2. practiceAgain        (weakness-based support games)
 *    3. recommended          (grade/subject matched, not yet played)
 *    4. moveForward          (next topic/difficulty for strong learners)
 *    5. popularForGrade      (safe fallback)
 * ───────────────────────────────────────────────────────────────── */

export function computeRecommendations({ profile, games, fallbackGrade = null }) {
  const allGames = (games || []).filter((g) => g && g.active !== false)
  if (allGames.length === 0) {
    return { continueLearning: null, practiceAgain: [], recommended: [], moveForward: [], popularForGrade: [] }
  }

  const grade = profile?.grade ?? fallbackGrade ?? null
  const playedIds = new Set((profile?.recentGames || []).map((r) => r.gameId))
  const playedSubjects = new Set((profile?.recentGames || []).map((r) => r.subject).filter(Boolean))

  const byId = new Map(allGames.map((g) => [g.id, g]))

  /* 1. Continue Learning ------------------------------------------------ */
  const last = profile?.lastSession
  let continueLearning = null
  if (last?.gameId && byId.has(last.gameId)) {
    const freshEnough = !last.playedAtMs || (Date.now() - last.playedAtMs) < THRESHOLDS.unfinishedWithin
    if (freshEnough) {
      const reason = (last.accuracy != null && last.accuracy < THRESHOLDS.lowScoreAccuracy)
        ? 'Try again and level up.'
        : 'Pick up where you left off.'
      continueLearning = {
        game: byId.get(last.gameId),
        reason,
        accuracy: last.accuracy,
      }
    }
  }

  /* 2. Practice Again --------------------------------------------------- */
  const weakTopics = profile?.weakTopics || []
  const practiceAgain = []
  const usedForPractice = new Set()
  for (const w of weakTopics) {
    // Find a different game touching the same subject+topic that the learner
    // hasn't played recently.
    const match = allGames.find((g) => {
      if (usedForPractice.has(g.id)) return false
      if (g.id === continueLearning?.game?.id) return false
      const subj = String(g.subject || '').toLowerCase()
      const topic = String(g.cbc_topic || '').toLowerCase().trim()
      return subj === w.subject && topic === w.topic
    }) || allGames.find((g) => String(g.subject || '').toLowerCase() === w.subject && !playedIds.has(g.id))
    if (match) {
      practiceAgain.push({
        game: match,
        weakTopic: w,
        label: `Practice again: ${toTitle(w.topic)}`,
        reason: `You're improving in ${toTitle(w.subject)}. A little more practice will help.`,
      })
      usedForPractice.add(match.id)
    }
    if (practiceAgain.length >= 3) break
  }

  /* 3. Recommended for you --------------------------------------------- */
  const claimed = new Set([
    continueLearning?.game?.id,
    ...practiceAgain.map((p) => p.game.id),
  ].filter(Boolean))

  const scored = allGames
    .filter((g) => !claimed.has(g.id))
    .map((g) => {
      let s = 0
      const gGrade = Number(g.grade)
      const gSubject = String(g.subject || '').toLowerCase()
      if (grade && gGrade === Number(grade)) s += 4
      else if (grade && Math.abs(gGrade - Number(grade)) === 1) s += 1.5
      if (playedSubjects.has(gSubject)) s += 1.5
      if (!playedIds.has(g.id)) s += 1
      if (g.difficulty === 'easy') s += 0.3
      return { g, s }
    })
    .sort((a, b) => b.s - a.s)

  const recommended = scored.slice(0, 3).map(({ g }, i) => ({
    game: g,
    label: i === 0 ? 'Recommended for You' : i === 1 ? 'Popular in Your Grade' : 'New for You',
    reason: i === 0 ? 'Matched to your grade and interests.' : i === 1 ? `Loved by Grade ${grade || '—'} learners.` : 'A fresh challenge to try.',
  }))

  /* 4. Move Forward — next step for strong topics ---------------------- */
  const strongTopics = Object.entries(profile?.topicStats || {})
    .filter(([, t]) => t.mastery === 'strong' || t.mastery === 'confident')
    .map(([key]) => key)
  const moveForwardClaimed = new Set([...claimed, ...recommended.map((r) => r.game.id)])
  const moveForward = []
  for (const key of strongTopics) {
    const [subj, topic] = [key.split(':')[0], key.split(':').slice(1).join(':')]
    const next = allGames.find((g) => {
      if (moveForwardClaimed.has(g.id)) return false
      const gSubj = String(g.subject || '').toLowerCase()
      const gTopic = String(g.cbc_topic || '').toLowerCase().trim()
      if (gSubj !== subj) return false
      // prefer a NEW topic in the same subject, or a harder version of the same topic
      if (gTopic === topic) return g.difficulty === 'hard' || g.difficulty === 'medium'
      return !playedIds.has(g.id)
    })
    if (next) {
      moveForward.push({
        game: next,
        label: `Ready for more ${toTitle(subj)}`,
        reason: `Great work on ${toTitle(topic)}. Try this next.`,
      })
      moveForwardClaimed.add(next.id)
    }
    if (moveForward.length >= 2) break
  }

  /* 5. Popular-for-grade — safe fallback ------------------------------- */
  const popularForGrade = allGames
    .filter((g) => !grade || Number(g.grade) === Number(grade))
    .slice(0, 6)

  return { continueLearning, practiceAgain, recommended, moveForward, popularForGrade }
}

function toTitle(s) {
  if (!s) return ''
  return String(s).split(/\s|_|-/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/* ─────────────────────────────────────────────────────────────────
 *  Smart feedback — encouraging, child-friendly, always non-shaming
 * ───────────────────────────────────────────────────────────────── */

/**
 * Build a feedback payload for the Done screen.
 *
 * @param {object} params
 * @param {object} params.game
 * @param {object} params.result   the just-saved result
 * @param {object|null} params.updateOutcome  return value of updateLearnerProfileAfterGame
 * @returns {{
 *   headline: string,
 *   tone: 'celebrate' | 'steady' | 'encourage',
 *   strengths: string[],
 *   weakAreas: string[],
 *   suggestedNext: string | null,
 *   improvement: number | null
 * }}
 */
export function buildSmartFeedback({ game, result, updateOutcome }) {
  const accuracy = clampPct(result?.accuracy)
  const subject = String(game?.subject || '').toLowerCase()
  const subjectLabel = toTitle(subject) || 'this subject'
  const topic = game?.cbc_topic || null

  const before = updateOutcome?.beforeTopic
  const after  = updateOutcome?.afterTopic
  const improvement = (before && after) ? (after.avgAccuracy - before.avgAccuracy) : null

  let tone = 'encourage'
  let headline = 'Nice effort — every try makes you stronger.'
  if (accuracy >= 85) {
    tone = 'celebrate'
    headline = `Amazing work in ${subjectLabel}!`
  } else if (accuracy >= 65) {
    tone = 'steady'
    headline = `Great going in ${subjectLabel} — you're getting better.`
  } else {
    tone = 'encourage'
    headline = `Good try! Let's practice ${topic ? toTitle(topic) : subjectLabel} a little more.`
  }

  const strengths = []
  const weakAreas = []
  if (accuracy >= 80) strengths.push(`Strong accuracy in ${subjectLabel}.`)
  if (result?.bestStreak >= 5) strengths.push(`Nice streak of ${result.bestStreak} in a row!`)
  if (improvement != null && improvement > 3) strengths.push(`You improved ${improvement}% in this topic.`)

  if (accuracy < 60 && topic) weakAreas.push(`${toTitle(topic)} needs a little more practice.`)
  if (after?.needsPractice && topic) weakAreas.push(`Keep building confidence in ${toTitle(topic)}.`)

  let suggestedNext = null
  if (after?.needsPractice) {
    suggestedNext = `Try another ${subjectLabel} game on ${toTitle(topic || 'this topic')} to level up.`
  } else if (accuracy >= 85) {
    suggestedNext = `You're ready for a harder ${subjectLabel} challenge!`
  } else if (accuracy >= 60) {
    suggestedNext = `One more round will help it stick — try again when you're ready.`
  } else {
    suggestedNext = `A fresh practice round will help — you've got this.`
  }

  // Safety: never shame, never use negative framing
  return { headline, tone, strengths, weakAreas, suggestedNext, improvement }
}

/* ─────────────────────────────────────────────────────────────────
 *  Aggregate stats for hub display (pure)
 * ───────────────────────────────────────────────────────────────── */

export function computeSubjectProgress(profile, catalogBySubject = {}) {
  const out = []
  const subjects = ['mathematics', 'english', 'science', 'social']
  for (const s of subjects) {
    const stat = profile?.subjectStats?.[s]
    const catalog = catalogBySubject[s] || 0
    const plays = stat?.plays || 0
    const percentOfCatalog = catalog > 0 ? Math.min(100, Math.round((plays / catalog) * 100)) : 0
    out.push({
      subject: s,
      plays,
      avgAccuracy: stat?.avgAccuracy || 0,
      mastery: masteryForSubject(stat),
      percentOfCatalog,
      lastAccuracy: stat?.lastAccuracy || 0,
    })
  }
  return out
}

function masteryForSubject(stat) {
  if (!stat || !stat.plays) return 'beginner'
  return masteryFor({ plays: stat.plays, avgAccuracy: stat.avgAccuracy })
}

export function strongestSubject(profile) {
  const stats = Object.entries(profile?.subjectStats || {})
  if (!stats.length) return null
  stats.sort(([, a], [, b]) => (b.avgAccuracy || 0) - (a.avgAccuracy || 0))
  const [slug] = stats[0]
  return slug
}

export function weakestSubject(profile) {
  const stats = Object.entries(profile?.subjectStats || {}).filter(([, s]) => s.plays >= 2)
  if (!stats.length) return null
  stats.sort(([, a], [, b]) => (a.avgAccuracy || 0) - (b.avgAccuracy || 0))
  const [slug] = stats[0]
  return slug
}

/* ─────────────────────────────────────────────────────────────────
 *  Utilities
 * ───────────────────────────────────────────────────────────────── */

function clampPct(n) {
  const v = Number(n)
  if (Number.isNaN(v)) return 0
  return Math.max(0, Math.min(100, Math.round(v)))
}
