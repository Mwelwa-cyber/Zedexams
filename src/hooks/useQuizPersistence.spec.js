import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  saveQuizSession,
  loadQuizSession,
  clearQuizSession,
} from './useQuizPersistence.js'

// These three functions are the only thing standing between a learner and a
// lost in-progress attempt (refresh, tab crash, accidental back-nav). They
// back onto localStorage with deliberate expiry rules — exam sessions die at
// endTime, practice sessions after 7 days — and swallow every storage error
// so a full quota never crashes the runner. Pin all of that.

const QUIZ = 'quiz1'
const USER = 'userA'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

function practiceState(overrides = {}) {
  return {
    mode: 'practice',
    answers: { q1: 2 },
    flagged: { q1: true },
    revealed: {},
    shortText: { q2: 'hello' },
    aiResults: {},
    activeSectionIndex: 1,
    endTime: null,
    startTime: Date.now() - HOUR,
    savedAt: Date.now(),
    ...overrides,
  }
}

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('saveQuizSession / loadQuizSession roundtrip', () => {
  it('saves and restores a practice session intact', () => {
    const state = practiceState()
    saveQuizSession(QUIZ, USER, state)
    expect(loadQuizSession(QUIZ, USER)).toEqual(state)
  })

  it('returns null when nothing has been saved', () => {
    expect(loadQuizSession(QUIZ, USER)).toBeNull()
  })

  it('isolates sessions by quizId and userId', () => {
    saveQuizSession(QUIZ, USER, practiceState({ answers: { q1: 1 } }))
    saveQuizSession('quiz2', USER, practiceState({ answers: { q1: 9 } }))
    expect(loadQuizSession(QUIZ, USER).answers).toEqual({ q1: 1 })
    expect(loadQuizSession('quiz2', USER).answers).toEqual({ q1: 9 })
    expect(loadQuizSession(QUIZ, 'otherUser')).toBeNull()
  })
})

describe('exam-session expiry (keyed on endTime)', () => {
  it('restores an exam session while endTime is still in the future', () => {
    const state = practiceState({ mode: 'exam', endTime: Date.now() + HOUR })
    saveQuizSession(QUIZ, USER, state)
    expect(loadQuizSession(QUIZ, USER)).toEqual(state)
  })

  it('discards an exam session once endTime has passed', () => {
    saveQuizSession(QUIZ, USER, practiceState({ mode: 'exam', endTime: Date.now() - 1 }))
    expect(loadQuizSession(QUIZ, USER)).toBeNull()
  })

  it('discards an exam session with no endTime', () => {
    saveQuizSession(QUIZ, USER, practiceState({ mode: 'exam', endTime: null }))
    expect(loadQuizSession(QUIZ, USER)).toBeNull()
  })
})

describe('includeExpired — recover a lapsed exam instead of losing it', () => {
  it('returns an expired exam (flagged) so the runner can auto-submit the saved answers', () => {
    const state = practiceState({ mode: 'exam', endTime: Date.now() - HOUR, answers: { q1: 3 } })
    saveQuizSession(QUIZ, USER, state)
    // Default still discards it — nothing changes for existing callers.
    expect(loadQuizSession(QUIZ, USER)).toBeNull()
    // Opted-in caller gets the attempt back, marked expired, answers intact.
    const recovered = loadQuizSession(QUIZ, USER, { includeExpired: true })
    expect(recovered).toMatchObject({ ...state, expired: true })
    expect(recovered.answers).toEqual({ q1: 3 })
  })

  it('does not flag a still-live exam as expired even with includeExpired', () => {
    const state = practiceState({ mode: 'exam', endTime: Date.now() + HOUR })
    saveQuizSession(QUIZ, USER, state)
    const loaded = loadQuizSession(QUIZ, USER, { includeExpired: true })
    expect(loaded).toEqual(state)
    expect(loaded.expired).toBeUndefined()
  })

  it('still discards an expired practice session regardless of includeExpired', () => {
    saveQuizSession(QUIZ, USER, practiceState({ savedAt: Date.now() - 8 * DAY }))
    expect(loadQuizSession(QUIZ, USER, { includeExpired: true })).toBeNull()
  })

  it('returns null (not an expired stub) when there is nothing saved', () => {
    expect(loadQuizSession(QUIZ, USER, { includeExpired: true })).toBeNull()
  })
})

describe('practice-session expiry (7-day TTL)', () => {
  it('restores a practice session saved within the TTL', () => {
    const state = practiceState({ savedAt: Date.now() - 6 * DAY })
    saveQuizSession(QUIZ, USER, state)
    expect(loadQuizSession(QUIZ, USER)).toEqual(state)
  })

  it('discards a practice session older than 7 days', () => {
    saveQuizSession(QUIZ, USER, practiceState({ savedAt: Date.now() - 8 * DAY }))
    expect(loadQuizSession(QUIZ, USER)).toBeNull()
  })

  it('discards a practice session with no savedAt', () => {
    saveQuizSession(QUIZ, USER, practiceState({ savedAt: undefined }))
    expect(loadQuizSession(QUIZ, USER)).toBeNull()
  })
})

describe('corruption + storage-error resilience', () => {
  it('returns null for corrupt JSON instead of throwing', () => {
    // Write garbage under the exact key the loader reads.
    localStorage.setItem(`examprep:quiz:session:${QUIZ}:${USER}`, '{not valid json')
    expect(loadQuizSession(QUIZ, USER)).toBeNull()
  })

  it('swallows a quota/write error in saveQuizSession', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveQuizSession(QUIZ, USER, practiceState())).not.toThrow()
  })

  it('returns null when reading from storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(loadQuizSession(QUIZ, USER)).toBeNull()
  })
})

describe('clearQuizSession', () => {
  it('removes a saved session', () => {
    saveQuizSession(QUIZ, USER, practiceState())
    expect(loadQuizSession(QUIZ, USER)).not.toBeNull()
    clearQuizSession(QUIZ, USER)
    expect(loadQuizSession(QUIZ, USER)).toBeNull()
  })

  it('does not throw when removal fails', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => clearQuizSession(QUIZ, USER)).not.toThrow()
  })
})
