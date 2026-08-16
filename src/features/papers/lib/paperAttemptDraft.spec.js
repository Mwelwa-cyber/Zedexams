/**
 * ACCEPTANCE 14 + 16 — the answers survive the boundary, and a spent paper
 * re-opens on its results.
 *
 * Twenty questions of real work followed by a lost session is the single most
 * expensive thing this design exists to prevent, and it is the failure a
 * learner never gives you a second chance to fix. The draft is written BEFORE
 * the results screen renders, so a crash in the window between "last answer
 * graded" and "results painted" cannot land anywhere that loses it.
 */

import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearAttemptDraft,
  readAttemptDraft,
  saveAttemptDraft,
  weakestTopic,
} from './paperAttemptDraft'

const UID = 'learner-1'
const PAPER = 'p1'

const ANSWERS = Array.from({ length: 20 }, (_, i) => ({
  questionId: `q${i}`,
  order: i,
  selectedIndex: i % 4,
  correctIndex: 1,
  correct: i % 4 === 1,
}))

beforeEach(() => {
  localStorage.clear()
})

describe('ACCEPTANCE 14 — answers survive the boundary', () => {
  it('holds all 20 answers after a save, as a fresh read would see them', () => {
    saveAttemptDraft(PAPER, UID, {
      answers: ANSWERS, score: 5, outOf: 20, complete: true, freeSetEnded: true,
    })
    // A fresh read, i.e. what a reload does — nothing is held in memory here.
    const draft = readAttemptDraft(PAPER, UID)
    expect(draft.answers).toHaveLength(20)
    expect(draft.answers[19].questionId).toBe('q19')
    expect(draft.complete).toBe(true)
    expect(draft.freeSetEnded).toBe(true)
  })

  it('is keyed per paper and per visitor, so one attempt cannot read another', () => {
    saveAttemptDraft(PAPER, UID, { answers: ANSWERS, complete: true })
    expect(readAttemptDraft('other-paper', UID)).toBeNull()
    expect(readAttemptDraft(PAPER, 'someone-else')).toBeNull()
  })

  it('reads as absent rather than being repaired when the stored shape is wrong', () => {
    localStorage.setItem(`zedexams:paperAttempt:${PAPER}:${UID}`, '{"answers":"not an array"}')
    expect(readAttemptDraft(PAPER, UID)).toBeNull()
    localStorage.setItem(`zedexams:paperAttempt:${PAPER}:${UID}`, 'not json at all')
    expect(readAttemptDraft(PAPER, UID)).toBeNull()
  })

  it('expires a draft older than a month rather than resuming a stale one', () => {
    saveAttemptDraft(PAPER, UID, { answers: ANSWERS, complete: true })
    const key = `zedexams:paperAttempt:${PAPER}:${UID}`
    const stored = JSON.parse(localStorage.getItem(key))
    stored.savedAt = new Date(Date.now() - 40 * 864e5).toISOString()
    localStorage.setItem(key, JSON.stringify(stored))
    expect(readAttemptDraft(PAPER, UID)).toBeNull()
  })

  it('clears on retry, so a fresh run is not resumed onto the old results', () => {
    saveAttemptDraft(PAPER, UID, { answers: ANSWERS, complete: true })
    clearAttemptDraft(PAPER, UID)
    expect(readAttemptDraft(PAPER, UID)).toBeNull()
  })

  it('reports failure rather than pretending when storage refuses', () => {
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError') }
    expect(saveAttemptDraft(PAPER, UID, { answers: ANSWERS })).toBe(false)
    Storage.prototype.setItem = original
  })
})

describe('the weak topic is evidence, not a guess', () => {
  it('names the topic with the most misses, once there are at least two', () => {
    const answers = [
      { questionId: 'q1', correct: false },
      { questionId: 'q2', correct: false },
      { questionId: 'q3', correct: false },
      { questionId: 'q4', correct: true },
    ]
    const questions = [
      { id: 'q1', topic: 'sentence completion' },
      { id: 'q2', topic: 'sentence completion' },
      { id: 'q3', topic: 'spelling' },
      { id: 'q4', topic: 'spelling' },
    ]
    expect(weakestTopic(answers, questions).topic).toBe('sentence completion')
  })

  it('returns null rather than naming a topic on one wrong answer', () => {
    const answers = [{ questionId: 'q1', correct: false }]
    expect(weakestTopic(answers, [{ id: 'q1', topic: 'spelling' }])).toBeNull()
  })

  it('returns null when the questions carry no topic to attribute a miss to', () => {
    const answers = [{ questionId: 'q1', correct: false }, { questionId: 'q2', correct: false }]
    expect(weakestTopic(answers, [{ id: 'q1' }, { id: 'q2' }])).toBeNull()
  })

  it('returns null for an empty or missing attempt', () => {
    expect(weakestTopic([], [])).toBeNull()
    expect(weakestTopic(undefined, undefined)).toBeNull()
  })
})
