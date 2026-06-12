/**
 * Player progression — levels + ranks derived from total game points.
 *
 * This is the meta-layer that gives the per-round score a *destination*:
 * points feed an XP curve, the curve fills a level, and crossing level bands
 * earns a named rank (Rookie → Legend). Pure + dependency-free so it can be
 * unit-tested in plain Node (scripts/test-game-progress.mjs) and imported by
 * both the hub and the game engines.
 *
 * "Total points" here means the same figure the games hub already shows — the
 * sum of the player's recent saved scores — so no new Firestore data or
 * migration is needed; progression lights up from existing history.
 */

/**
 * Named ranks, each unlocked at a level threshold. The rank is the concrete,
 * art-free reward for levelling — a title the learner earns and shows off.
 * `min` is the first level at which the rank applies; keep ascending.
 */
export const RANKS = [
  { min: 1,  title: 'Rookie',   emoji: '🌱', tone: 'emerald' },
  { min: 3,  title: 'Learner',  emoji: '📘', tone: 'sky' },
  { min: 5,  title: 'Scholar',  emoji: '🎓', tone: 'blue' },
  { min: 8,  title: 'Whiz',     emoji: '⚡', tone: 'amber' },
  { min: 11, title: 'Champion', emoji: '🏅', tone: 'orange' },
  { min: 15, title: 'Master',   emoji: '👑', tone: 'violet' },
  { min: 20, title: 'Legend',   emoji: '🏆', tone: 'rose' },
]

/**
 * Cumulative points required to *reach* a given level. Level 1 starts at 0.
 *
 * Per-level cost rises linearly — climbing from level L to L+1 costs
 * 100 + (L-1)·50 points — so this is the closed form of that sum:
 *   sum_{k=1}^{L-1} (100 + (k-1)·50) = 100·(L-1) + 50·((L-1)(L-2)/2)
 */
export function pointsForLevel(level) {
  const L = Math.max(1, Math.floor(level))
  const steps = L - 1
  return 100 * steps + 50 * ((steps * (steps - 1)) / 2)
}

/** The rank that applies at a given level. */
export function rankForLevel(level) {
  const L = Math.max(1, Math.floor(level))
  let rank = RANKS[0]
  for (const r of RANKS) {
    if (L >= r.min) rank = r
    else break
  }
  return rank
}

/** The next rank a player is working toward, or null if already at the top. */
export function nextRankAfter(level) {
  const L = Math.max(1, Math.floor(level))
  return RANKS.find((r) => r.min > L) || null
}

/**
 * Full progression snapshot for a points total.
 *
 * @param {number} totalPoints lifetime/recent points
 * @returns {{
 *   level: number,
 *   points: number,
 *   xpIntoLevel: number,    // points earned since reaching this level
 *   xpForLevel: number,     // points needed to clear this level
 *   pointsToNext: number,   // points still needed for the next level
 *   progress: number,       // 0..100 toward the next level
 *   rank: { title, emoji, tone, min },
 *   nextRank: { title, emoji, tone, min } | null,
 *   levelsToNextRank: number, // levels remaining until the next rank (0 if none)
 * }}
 */
export function levelInfo(totalPoints) {
  const p = Math.max(0, Math.floor(Number(totalPoints) || 0))

  let level = 1
  // Bounded: cost grows quadratically, so this terminates in tens of steps.
  while (pointsForLevel(level + 1) <= p) level++

  const base = pointsForLevel(level)
  const next = pointsForLevel(level + 1)
  const xpForLevel = next - base
  const xpIntoLevel = p - base
  const pointsToNext = Math.max(0, next - p)
  const progress = xpForLevel > 0 ? Math.round((xpIntoLevel / xpForLevel) * 100) : 0
  const rank = rankForLevel(level)
  const nextRank = nextRankAfter(level)

  return {
    level,
    points: p,
    xpIntoLevel,
    xpForLevel,
    pointsToNext,
    progress: Math.max(0, Math.min(100, progress)),
    rank,
    nextRank,
    levelsToNextRank: nextRank ? nextRank.min - level : 0,
  }
}

/**
 * Compare a before/after points total to detect a level-up (and whether it
 * also unlocked a new rank). Drives the celebratory banner on the done screen.
 *
 * @param {number} before points total before the round
 * @param {number} after points total after the round
 */
export function levelUpInfo(before, after) {
  const a = levelInfo(before)
  const b = levelInfo(after)
  const leveledUp = b.level > a.level
  return {
    leveledUp,
    fromLevel: a.level,
    toLevel: b.level,
    levelsGained: Math.max(0, b.level - a.level),
    rank: b.rank,
    newRank: leveledUp && b.rank.title !== a.rank.title ? b.rank : null,
    after: b,
  }
}
