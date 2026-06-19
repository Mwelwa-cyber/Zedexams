import { describe, it, expect, vi } from 'vitest'

// gamesIntelligence imports the Firebase db/auth at module load. Mock that so
// the pure games-recommendation logic — mastery classification, daily goals,
// the recommendation engine, and subject progress — loads without Firebase.
// These decide what each learner is nudged to play next, so they're worth
// pinning even though the Firestore reads/writes around them aren't unit-tested.
vi.mock('../firebase/config', () => ({ db: {}, auth: { currentUser: null } }))

import {
  buildTopicKey,
  masteryFor,
  todayISO,
  ensureTodayGoal,
  computeRecommendations,
  computeSubjectProgress,
  strongestSubject,
  weakestSubject,
  DAILY_GOAL_TYPES,
} from './gamesIntelligence.js'

describe('buildTopicKey', () => {
  it('lowercases and trims into subject:topic', () => {
    expect(buildTopicKey('Mathematics', '  Fractions ')).toBe('mathematics:fractions')
  })
  it('returns null when subject or topic is missing', () => {
    expect(buildTopicKey('', 'x')).toBeNull()
    expect(buildTopicKey('math', '')).toBeNull()
    expect(buildTopicKey(null, null)).toBeNull()
  })
})

describe('masteryFor', () => {
  it('is beginner with no plays', () => {
    expect(masteryFor(null)).toBe('beginner')
    expect(masteryFor({})).toBe('beginner')
    expect(masteryFor({ plays: 0, avgAccuracy: 99 })).toBe('beginner')
  })

  it('classifies on the accuracy thresholds (80 / 75 / 60)', () => {
    expect(masteryFor({ plays: 1, avgAccuracy: 80 })).toBe('strong')
    expect(masteryFor({ plays: 1, avgAccuracy: 79 })).toBe('confident')
    expect(masteryFor({ plays: 1, avgAccuracy: 75 })).toBe('confident')
    expect(masteryFor({ plays: 1, avgAccuracy: 74 })).toBe('improving')
    expect(masteryFor({ plays: 1, avgAccuracy: 60 })).toBe('improving')
    expect(masteryFor({ plays: 1, avgAccuracy: 59 })).toBe('beginner')
  })
})

describe('todayISO', () => {
  it('formats local today as YYYY-MM-DD', () => {
    const d = new Date()
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(todayISO()).toBe(expected)
  })
})

describe('ensureTodayGoal', () => {
  it('returns the existing goal when it is already for today', () => {
    const dailyGoal = { date: todayISO(), type: 'play_2', label: 'x', target: 2, progress: 1, completed: false }
    expect(ensureTodayGoal({ dailyGoal })).toBe(dailyGoal)
  })

  it('picks a practice_weak goal when the learner has weak topics', () => {
    const goal = ensureTodayGoal({ weakTopics: ['math:fractions'] })
    expect(goal.type).toBe('practice_weak')
    expect(goal.date).toBe(todayISO())
    expect(goal.completed).toBe(false)
  })

  it('picks a valid non-weak goal when there are no weak topics', () => {
    const goal = ensureTodayGoal({ weakTopics: [] })
    expect(['play_2', 'score_80']).toContain(goal.type)
    expect(goal.target).toBe(DAILY_GOAL_TYPES[goal.type].target)
    expect(goal.progress).toBe(0)
  })
})

describe('computeRecommendations', () => {
  it('returns the empty shape when there are no active games', () => {
    expect(computeRecommendations({ profile: {}, games: [] })).toEqual({
      continueLearning: null,
      practiceAgain: [],
      recommended: [],
      moveForward: [],
      popularForGrade: [],
    })
    // active:false games are filtered out → also "no games".
    const r = computeRecommendations({ profile: {}, games: [{ id: 'g', active: false }] })
    expect(r.continueLearning).toBeNull()
  })

  it('surfaces a fresh last session as Continue Learning', () => {
    const games = [{ id: 'g1', active: true, subject: 'mathematics', title: 'Maths' }]
    const profile = { lastSession: { gameId: 'g1', playedAtMs: Date.now(), accuracy: 90 } }
    const r = computeRecommendations({ profile, games })
    expect(r.continueLearning.game.id).toBe('g1')
    expect(r.continueLearning.reason).toBe('Pick up where you left off.')
  })

  it('nudges a retry when the last session scored low', () => {
    const games = [{ id: 'g1', active: true, subject: 'mathematics' }]
    const profile = { lastSession: { gameId: 'g1', playedAtMs: Date.now(), accuracy: 40 } }
    const r = computeRecommendations({ profile, games })
    expect(r.continueLearning.reason).toBe('Try again and level up.')
  })

  it('ignores a stale last session (older than the continue window)', () => {
    const games = [{ id: 'g1', active: true, subject: 'mathematics' }]
    const profile = { lastSession: { gameId: 'g1', playedAtMs: Date.now() - 72 * 60 * 60 * 1000, accuracy: 90 } }
    const r = computeRecommendations({ profile, games })
    expect(r.continueLearning).toBeNull()
  })
})

describe('computeSubjectProgress', () => {
  it('returns a row for each core subject, zeroed for an empty profile', () => {
    const rows = computeSubjectProgress({})
    expect(rows.map(r => r.subject)).toEqual(['mathematics', 'english', 'science', 'social'])
    expect(rows.every(r => r.plays === 0 && r.mastery === 'beginner' && r.percentOfCatalog === 0)).toBe(true)
  })

  it('computes catalog percentage and mastery from subject stats', () => {
    const profile = { subjectStats: { mathematics: { plays: 5, avgAccuracy: 82, lastAccuracy: 90 } } }
    const rows = computeSubjectProgress(profile, { mathematics: 10 })
    const math = rows.find(r => r.subject === 'mathematics')
    expect(math.plays).toBe(5)
    expect(math.percentOfCatalog).toBe(50)
    expect(math.mastery).toBe('strong')
    expect(math.lastAccuracy).toBe(90)
  })

  it('caps catalog percentage at 100', () => {
    const profile = { subjectStats: { english: { plays: 20, avgAccuracy: 70 } } }
    const rows = computeSubjectProgress(profile, { english: 5 })
    expect(rows.find(r => r.subject === 'english').percentOfCatalog).toBe(100)
  })
})

describe('strongestSubject / weakestSubject', () => {
  it('return null when there are no subject stats', () => {
    expect(strongestSubject({})).toBeNull()
    expect(weakestSubject({})).toBeNull()
  })

  it('strongest picks the highest average accuracy', () => {
    const profile = { subjectStats: { mathematics: { avgAccuracy: 80 }, english: { avgAccuracy: 90 } } }
    expect(strongestSubject(profile)).toBe('english')
  })

  it('weakest only considers subjects with at least 2 plays', () => {
    const profile = {
      subjectStats: {
        mathematics: { plays: 3, avgAccuracy: 50 },
        english: { plays: 1, avgAccuracy: 20 }, // ignored — too few plays
      },
    }
    expect(weakestSubject(profile)).toBe('mathematics')
  })

  it('weakest is null when no subject has enough plays', () => {
    expect(weakestSubject({ subjectStats: { mathematics: { plays: 1, avgAccuracy: 10 } } })).toBeNull()
  })
})
