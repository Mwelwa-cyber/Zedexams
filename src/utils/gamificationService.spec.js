import { describe, it, expect, vi } from 'vitest'

// gamificationService imports the Firebase db (and two services that do too)
// at module load. Mock those so the PURE economy functions — levelFromXp,
// xpForAttempt, computeRivalry, streakBadge, timeAgo — load without standing
// up Firebase. These decide every learner's XP, level, streak badge and
// rivalry copy, so they're worth pinning even though the Firestore I/O around
// them isn't unit-tested here.
vi.mock('../firebase/config', () => ({ db: {} }))
vi.mock('./examService', () => ({ todayString: () => '2026-06-19' }))

import {
  levelFromXp,
  xpForAttempt,
  computeRivalry,
  streakBadge,
  timeAgo,
  LEVELS,
} from './gamificationService.js'

describe('levelFromXp', () => {
  it('starts everyone at level 1 with 0 progress', () => {
    const r = levelFromXp(0)
    expect(r.level).toBe(1)
    expect(r.totalXp).toBe(0)
    expect(r.xpInLevel).toBe(0)
    expect(r.progress).toBe(0)
    expect(r.nextLevel?.level).toBe(2)
  })

  it('reports linear progress toward the next threshold', () => {
    const r = levelFromXp(50) // halfway from 0 to the level-2 threshold of 100
    expect(r.level).toBe(1)
    expect(r.xpInLevel).toBe(50)
    expect(r.xpToNext).toBe(100)
    expect(r.xpRemaining).toBe(50)
    expect(r.progress).toBe(50)
  })

  it('promotes exactly on the threshold', () => {
    const r = levelFromXp(100)
    expect(r.level).toBe(2)
    expect(r.threshold).toBe(100)
  })

  it('caps at the top level with null nextLevel and 100% progress', () => {
    const r = levelFromXp(10_000_000)
    expect(r.level).toBe(LEVELS[LEVELS.length - 1].level)
    expect(r.nextLevel).toBeNull()
    expect(r.progress).toBe(100)
    expect(r.xpRemaining).toBe(0)
  })

  it('clamps negative / non-numeric / missing XP to 0', () => {
    expect(levelFromXp(-50).level).toBe(1)
    expect(levelFromXp('abc').totalXp).toBe(0)
    expect(levelFromXp().totalXp).toBe(0)
  })
})

describe('xpForAttempt', () => {
  it('awards the base 50 XP for simply completing an exam', () => {
    expect(xpForAttempt()).toBe(50)
    expect(xpForAttempt({ percentage: 59 })).toBe(50)
  })

  it('adds a banded score bonus', () => {
    expect(xpForAttempt({ percentage: 60 })).toBe(60) // +10
    expect(xpForAttempt({ percentage: 75 })).toBe(70) // +20
    expect(xpForAttempt({ percentage: 95 })).toBe(80) // +30
  })

  it('adds a rank bonus that tapers off after the top 10', () => {
    expect(xpForAttempt({ rank: 1 })).toBe(100) // +50
    expect(xpForAttempt({ rank: 2 })).toBe(80) // +30
    expect(xpForAttempt({ rank: 3 })).toBe(70) // +20
    expect(xpForAttempt({ rank: 10 })).toBe(60) // +10
    expect(xpForAttempt({ rank: 11 })).toBe(50) // none
  })

  it('adds streak and personal-best bonuses', () => {
    expect(xpForAttempt({ streakAfter: 3 })).toBe(60) // +10
    expect(xpForAttempt({ streakAfter: 7 })).toBe(70) // +20
    expect(xpForAttempt({ streakAfter: 30 })).toBe(80) // +30
    expect(xpForAttempt({ personalBest: true })).toBe(70) // +20
  })

  it('stacks every bonus for a perfect top-rank streak attempt', () => {
    // 50 base + 30 (>=90) + 50 (rank 1) + 20 (PB) + 30 (streak >=30) = 180
    expect(xpForAttempt({ percentage: 100, rank: 1, personalBest: true, streakAfter: 30 })).toBe(180)
  })
})

describe('computeRivalry', () => {
  const rows = [
    { userId: 'a', displayName: 'Ann', rank: 1, percentage: 90, score: 18 },
    { userId: 'me', displayName: 'Me', rank: 2, percentage: 80, score: 16 },
    { userId: 'b', displayName: 'Bob', rank: 3, percentage: 70, score: 14 },
  ]

  it('returns null for bad input or a user not on the board', () => {
    expect(computeRivalry(null, 'me')).toBeNull()
    expect(computeRivalry(rows, null)).toBeNull()
    expect(computeRivalry(rows, 'ghost')).toBeNull()
  })

  it('produces a challenge (above) and a good (below) message in the middle', () => {
    const r = computeRivalry(rows, 'me')
    expect(r.myRank).toBe(2)
    expect(r.messages).toHaveLength(2)
    expect(r.messages[0].tone).toBe('challenge')
    expect(r.messages[0].text).toContain('10% behind Ann')
    expect(r.messages[1].tone).toBe('good')
    expect(r.messages[1].text).toContain('ahead of Bob')
  })

  it('omits the challenge message when the user is rank 1', () => {
    const r = computeRivalry(rows, 'a')
    expect(r.myRank).toBe(1)
    expect(r.messages.every(m => m.tone === 'good')).toBe(true)
  })

  it('uses the mark tie-break when percentages are equal', () => {
    const tie = [
      { userId: 'a', displayName: 'Ann', rank: 1, percentage: 80, score: 17 },
      { userId: 'me', displayName: 'Me', rank: 2, percentage: 80, score: 16 },
    ]
    const r = computeRivalry(tie, 'me')
    expect(r.messages[0].text).toContain('edged you out by 1 mark')
    expect(r.messages[0].text).toContain('same percentage')
  })
})

describe('streakBadge', () => {
  it('returns null below a 1-day streak', () => {
    expect(streakBadge(0)).toBeNull()
  })

  it('escalates the badge with the streak length', () => {
    expect(streakBadge(1).label).toBe('Just Started')
    expect(streakBadge(3).label).toBe('3-Day Streak')
    expect(streakBadge(7).label).toBe('7-Day Streak')
    expect(streakBadge(14).label).toBe('On Fire')
    expect(streakBadge(30).label).toBe('Diamond Streak')
  })
})

describe('timeAgo', () => {
  it('returns empty string for falsy or unparseable timestamps', () => {
    expect(timeAgo(null)).toBe('')
    expect(timeAgo(undefined)).toBe('')
    expect(timeAgo('not-a-time')).toBe('')
  })

  it('buckets recent times into human strings', () => {
    const now = Date.now()
    expect(timeAgo(now)).toBe('just now')
    expect(timeAgo(now - 2 * 60_000)).toBe('2m ago')
    expect(timeAgo(now - 2 * 3_600_000)).toBe('2h ago')
    expect(timeAgo(now - 3 * 86_400_000)).toBe('3d ago')
  })

  it('accepts a Firestore Timestamp via toMillis()', () => {
    expect(timeAgo({ toMillis: () => Date.now() })).toBe('just now')
  })

  it('accepts a Date instance', () => {
    expect(timeAgo(new Date(Date.now() - 2 * 60_000))).toBe('2m ago')
  })
})
