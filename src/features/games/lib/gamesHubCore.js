/**
 * gamesHubCore — the Games hub's decisions, as rules rather than as JSX.
 *
 * Pure: no DOM, no React, no Firebase, no clock of its own (every function
 * that needs "now" is handed it). Node-tested by `gamesHubCore.test.js`.
 *
 * ── Why the learner's grade is a FUNCTION and not an expression ─────────
 *
 * The hub used to answer "which grade is this learner in?" twice, in two
 * different ways, three lines apart:
 *
 *   TODAY'S QUIZ · GRADE {challengeGame.grade}   ← the grade of whichever
 *                                                  game the daily rotation
 *                                                  happened to land on
 *   Grade {Number(userProfile?.grade) || 7}      ← the learner's own grade
 *
 * So a Grade 7 learner was shown "TODAY'S QUIZ · GRADE 3" above a live
 * challenge card reading "Grade 7", and the quiz behind the first card was
 * genuinely a Grade 3 quiz — the rotation is over the whole `games`
 * collection and nothing scoped it. The label was not lying about the data;
 * the data was wrong.
 *
 * `resolveLearnerGrade` is the one answer. Both hero cards render it, and
 * `getTodaysChallenge({ grade })` is scoped by it, so the two cards cannot
 * disagree and the quiz behind the first one is the learner's own grade by
 * construction rather than by review. Rendering it as a PILL on both heroes
 * (the mockup's shape) is part of the same fix: a future mismatch shows up
 * side by side on the screen instead of hiding inside an eyebrow label.
 *
 * A signed-out visitor and a profile with no grade both fall to the rollout
 * grade (`LEARNER_GRADES[0]`). That is not a guess about the person — /games
 * is a public route, and the learner side is open to exactly one grade, so
 * it is the only grade the hub could honestly offer. It replaces the old
 * hard-coded `|| 7`, which said the same thing without saying where it came
 * from and would have gone stale the day a second grade opens.
 */

import { LEARNER_GRADES } from '../../../config/curriculum.js'

/** A game counts as NEW for its first 30 days in the catalogue. */
export const NEW_GAME_WINDOW_MS = 1000 * 60 * 60 * 24 * 30

/**
 * The grade this hub is showing — for the daily-quiz query, the live
 * challenge, and the pill on both hero cards.
 *
 * @param {object|null} profile  the users/{uid} document, if loaded
 * @returns {number} an integer grade; never null, so no caller needs a fallback
 */
export function resolveLearnerGrade(profile) {
  const n = Number(String(profile?.grade ?? '').trim())
  if (Number.isInteger(n) && n > 0) return n
  return LEARNER_GRADES[0]
}

/**
 * The single meta line under a game's name: `Subject · Topic`.
 *
 * One line, not two chips. Two wrapping chips are what made Meaning Match
 * ~40px taller than Punctuation Pro, and a card list whose rows are
 * different heights cannot be scanned. A game with no topic keeps just its
 * subject rather than printing a trailing separator.
 */
export function gameMetaLine(subjectLabel, topic) {
  const parts = [subjectLabel, topic].map((p) => String(p ?? '').trim()).filter(Boolean)
  return parts.join(' · ')
}

/**
 * The ONE status pill on a game card: `Play`, `Best <n>` or `New`.
 *
 * This replaces the progress bar that used to sit here, which measured
 * nothing it could name. Three of five games rendered a 0%-filled track
 * beside "Not played yet" — a bar whose only content is that it is empty —
 * and for the other two it was drawn from `best / (points × 2)`, so Word
 * Builder's read full at "Best 120". A best score is not a completion
 * percentage; there is no completion to measure, so nothing is drawn.
 *
 * A played game shows its best score even when it is also new: what the
 * learner did outranks how long the game has been here.
 *
 * @returns {{kind: 'best'|'new'|'play', label: string}}
 */
export function gameStatusPill({ best = 0, isNew = false } = {}) {
  const score = Number(best) || 0
  if (score > 0) return { kind: 'best', label: `Best ${score}` }
  if (isNew) return { kind: 'new', label: 'New' }
  return { kind: 'play', label: 'Play' }
}

/**
 * Was this game added recently enough to be flagged NEW?
 *
 * `now` is a parameter so this is testable without a clock. Firestore
 * Timestamps and plain millisecond numbers both arrive here, and a game with
 * no creation date (every bundled seed doc) is never new — an unknown date
 * is not evidence of recency.
 */
export function isRecentlyAdded(createdAt, now) {
  const ms = typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : Number(createdAt)
  if (!Number.isFinite(ms) || ms <= 0) return false
  return now - ms < NEW_GAME_WINDOW_MS
}

/**
 * The daily hero's copy. Three states, and the third is the point.
 *
 * When the grade-scoped query finds no quiz for today, the card SAYS so and
 * offers no Play. It must never fall back to another grade's quiz — that is
 * the bug this whole module exists for — and a hero that silently disappears
 * reads as a broken page rather than as an empty day.
 */
export function dailyHeroCopy({ hasQuiz, streakDays = 0 } = {}) {
  if (!hasQuiz) {
    return { title: 'No quiz today', sub: 'Come back tomorrow for a new one', action: null }
  }
  const days = Number(streakDays) || 0
  return {
    title: 'Play with Zed',
    sub: days > 0 ? `🔥 Keep your ${days}-day streak` : '🔥 Play today to start a streak',
    action: 'Play',
  }
}
