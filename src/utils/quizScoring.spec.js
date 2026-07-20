import { describe, it, expect } from 'vitest'
import {
  computeQuizScore,
  buildResultGrading,
  isProvisionalResult,
  isQuestionCorrect,
  isAnswerPending,
  isTextAnswerType,
  isNumericType,
  isHotspotType,
  isMatchingType,
  isSequenceType,
} from './quizScoring.js'

// computeQuizScore is the marks/percentage/topic breakdown a learner sees the
// instant they submit a practice quiz. It re-grades every question from its
// persisted answer key (server-authoritative) rather than any client-stored
// `correct` flag — except text answers, which carry the AI grader's verdict.
// Wrong scoring here is the highest-visibility correctness bug on the platform.

describe('type predicates', () => {
  it('classifies the answer-handling families', () => {
    expect(isTextAnswerType('short_answer')).toBe(true)
    expect(isTextAnswerType('diagram')).toBe(true)
    expect(isTextAnswerType('mcq')).toBe(false)
    expect(isNumericType('numeric')).toBe(true)
    expect(isNumericType('mcq')).toBe(false)
    expect(isHotspotType('hotspot')).toBe(true)
    expect(isHotspotType('numeric')).toBe(false)
    // Essay rides the AI-graded text-answer family.
    expect(isTextAnswerType('essay')).toBe(true)
    expect(isMatchingType('matching')).toBe(true)
    expect(isMatchingType('sequence')).toBe(false)
    expect(isSequenceType('sequence')).toBe(true)
    expect(isSequenceType('matching')).toBe(false)
  })
})

describe('isQuestionCorrect — per type', () => {
  it('mcq / truefalse use strict equality against correctAnswer', () => {
    expect(isQuestionCorrect({ type: 'mcq', correctAnswer: 2 }, 2)).toBe(true)
    expect(isQuestionCorrect({ type: 'mcq', correctAnswer: 2 }, 1)).toBe(false)
    // No type coercion: the numeric-string '2' is NOT a correct mcq index 2.
    expect(isQuestionCorrect({ type: 'mcq', correctAnswer: 2 }, '2')).toBe(false)
    expect(isQuestionCorrect({ type: 'truefalse', correctAnswer: 0 }, 0)).toBe(true)
    expect(isQuestionCorrect({ type: 'mcq', correctAnswer: 2 }, undefined)).toBe(false)
  })

  it('text answers trust only an explicit AI verdict of correct === true', () => {
    expect(isQuestionCorrect({ type: 'short_answer' }, { correct: true })).toBe(true)
    expect(isQuestionCorrect({ type: 'short_answer' }, { correct: false })).toBe(false)
    expect(isQuestionCorrect({ type: 'diagram' }, { correct: true })).toBe(true)
    // Unmarked / missing verdict is not correct.
    expect(isQuestionCorrect({ type: 'short_answer' }, { given: 'Lusaka' })).toBe(false)
    expect(isQuestionCorrect({ type: 'short_answer' }, undefined)).toBe(false)
  })

  it('numeric re-grades via tolerance, ignoring any stored flag', () => {
    const q = { type: 'numeric', correctAnswer: 3.14, tolerance: 0.01 }
    expect(isQuestionCorrect(q, '3.15')).toBe(true)
    expect(isQuestionCorrect(q, '3.2')).toBe(false)
    // A client claiming correctness on a wrong value gets re-graded false.
    expect(isQuestionCorrect(q, { value: '99', correct: true })).toBe(false)
  })

  it('hotspot re-grades against the stored region', () => {
    const q = { type: 'hotspot', correctRegion: { x: 0.5, y: 0.5, radius: 0.1 } }
    expect(isQuestionCorrect(q, { x: 0.52, y: 0.48 })).toBe(true)
    expect(isQuestionCorrect(q, { x: 0.9, y: 0.9 })).toBe(false)
    expect(isQuestionCorrect(q, undefined)).toBe(false)
  })

  it('essay trusts the AI verdict like short_answer', () => {
    expect(isQuestionCorrect({ type: 'essay' }, { text: 'A long answer', correct: true })).toBe(true)
    expect(isQuestionCorrect({ type: 'essay' }, { text: 'A long answer', correct: false })).toBe(false)
    expect(isQuestionCorrect({ type: 'essay' }, undefined)).toBe(false)
  })

  it('matching re-grades against the matchingAnswer key', () => {
    const q = {
      type: 'matching',
      matchingLeft: ['Cow', 'Dog'],
      matchingRight: ['Puppy', 'Calf'],
      matchingAnswer: [1, 0],
    }
    expect(isQuestionCorrect(q, [1, 0])).toBe(true)
    expect(isQuestionCorrect(q, [0, 1])).toBe(false)
    expect(isQuestionCorrect(q, undefined)).toBe(false)
  })

  it('sequence re-grades against the sequenceAnswer key', () => {
    const q = {
      type: 'sequence',
      sequenceItems: ['Tree', 'Seed', 'Sprout'],
      sequenceAnswer: [3, 1, 2],
    }
    expect(isQuestionCorrect(q, [1, 2, 0])).toBe(true) // Seed,Sprout,Tree
    expect(isQuestionCorrect(q, [0, 1, 2])).toBe(false) // display order
    expect(isQuestionCorrect(q, undefined)).toBe(false)
  })

  it('returns false for a missing question', () => {
    expect(isQuestionCorrect(null, 1)).toBe(false)
  })
})

describe('computeQuizScore', () => {
  it('sums marks, rounds the percentage, and breaks down by topic', () => {
    const questions = [
      { id: 'q1', type: 'mcq', marks: 2, topic: 'Algebra', correctAnswer: 1 },
      { id: 'q2', type: 'numeric', marks: 1, topic: 'Algebra', correctAnswer: 3.14, tolerance: 0.01 },
      { id: 'q3', type: 'hotspot', marks: 1, topic: 'Maps', correctRegion: { x: 0.5, y: 0.5, radius: 0.1 } },
      { id: 'q4', type: 'short_answer', marks: 1, topic: 'Maps' },
      { id: 'q5', type: 'truefalse', marks: 1, topic: 'Logic', correctAnswer: 0 },
    ]
    const answers = {
      q1: 1, // correct → 2
      q2: '3.15', // within tolerance → 1
      q3: { x: 0.52, y: 0.48 }, // inside region → 1
      q4: { correct: true }, // AI-marked correct → 1
      q5: 1, // wrong → 0
    }
    const result = computeQuizScore(questions, answers)
    expect(result.score).toBe(5)
    expect(result.total).toBe(6)
    expect(result.percentage).toBe(83) // round(5/6*100) = 83
    expect(result.topicScores).toEqual({
      Algebra: { correct: 3, total: 3 },
      Maps: { correct: 2, total: 2 },
      Logic: { correct: 0, total: 1 },
    })
  })

  it('defaults missing marks to 1 and missing topic to General', () => {
    const questions = [
      { id: 'a', type: 'mcq', correctAnswer: 0 }, // no marks, no topic
      { id: 'b', type: 'mcq', correctAnswer: 0 },
    ]
    const result = computeQuizScore(questions, { a: 0, b: 1 })
    expect(result.total).toBe(2)
    expect(result.score).toBe(1)
    expect(result.topicScores.General).toEqual({ correct: 1, total: 2 })
  })

  it('treats an unanswered quiz as all-wrong, not a crash', () => {
    const questions = [
      { id: 'a', type: 'mcq', marks: 2, correctAnswer: 0 },
      { id: 'b', type: 'numeric', marks: 3, correctAnswer: 5, tolerance: 0 },
    ]
    const result = computeQuizScore(questions, {})
    expect(result.score).toBe(0)
    expect(result.total).toBe(5)
    expect(result.percentage).toBe(0)
  })

  it('returns a zeroed result for an empty or missing question list', () => {
    expect(computeQuizScore([], {})).toEqual({ score: 0, total: 0, percentage: 0, topicScores: {}, pending: 0, pendingIds: [] })
    expect(computeQuizScore(undefined, undefined)).toEqual({ score: 0, total: 0, percentage: 0, topicScores: {}, pending: 0, pendingIds: [] })
  })

  it('scores a mixed quiz spanning every supported type', () => {
    const questions = [
      { id: 'mcq', type: 'mcq', marks: 1, correctAnswer: 1 },
      { id: 'num', type: 'numeric', marks: 1, correctAnswer: 10, tolerance: 0 },
      { id: 'txt', type: 'short_answer', marks: 1 },
      { id: 'ess', type: 'essay', marks: 2 },
      { id: 'mat', type: 'matching', marks: 2, matchingLeft: ['A', 'B'], matchingRight: ['1', '2'], matchingAnswer: [0, 1] },
      { id: 'seq', type: 'sequence', marks: 2, sequenceItems: ['X', 'Y'], sequenceAnswer: [2, 1] },
    ]
    const answers = {
      mcq: 1,                          // ✓ 1
      num: '10',                       // ✓ 1
      txt: { correct: true },          // ✓ 1
      ess: { text: 'essay', correct: false }, // ✗ 0
      mat: [0, 1],                     // ✓ 2
      seq: [1, 0],                     // Y(pos1),X(pos2) → ✓ 2
    }
    const result = computeQuizScore(questions, answers)
    expect(result.total).toBe(9)
    expect(result.score).toBe(7) // everything but the essay
    expect(result.percentage).toBe(78) // round(7/9*100)
  })

  it('awards a perfect score as 100%', () => {
    const questions = [
      { id: 'a', type: 'mcq', marks: 1, correctAnswer: 2 },
      { id: 'b', type: 'mcq', marks: 1, correctAnswer: 3 },
    ]
    const result = computeQuizScore(questions, { a: 2, b: 3 })
    expect(result.score).toBe(2)
    expect(result.total).toBe(2)
    expect(result.percentage).toBe(100)
  })
})

// B3/OBS-005 correctness: a text answer the AI grader could not evaluate
// (burst throttle / provider timeout / AI-budget rejection) is PENDING — it
// must never be scored as wrong, and a transient failure must never lower the
// learner's percentage.
describe('pending (ungraded) text answers are never scored wrong', () => {
  it('isAnswerPending recognises the pending/ungraded shapes', () => {
    expect(isAnswerPending({ pending: true })).toBe(true)
    expect(isAnswerPending({ graded: false })).toBe(true)
    expect(isAnswerPending({ correct: true })).toBe(false)
    expect(isAnswerPending({ correct: false })).toBe(false)
    expect(isAnswerPending(undefined)).toBe(false)
  })

  it('a CORRECT answer that failed to grade (throttle) is pending, not wrong', () => {
    const questions = [
      { id: 'mcq', type: 'mcq', marks: 1, correctAnswer: 1 },
      { id: 'ess', type: 'essay', marks: 3, topic: 'Writing' },
    ]
    // The essay was genuinely correct but the AI grader was throttled → pending.
    const result = computeQuizScore(questions, { mcq: 1, ess: { text: 'a great essay', pending: true } })
    // The essay is EXCLUDED from the denominator — not scored 0/3.
    expect(result.score).toBe(1)
    expect(result.total).toBe(1) // only the MCQ counts
    expect(result.percentage).toBe(100) // NOT 25 (1/4) — the throttle can't lower it
    expect(result.pending).toBe(1)
    expect(result.pendingIds).toEqual(['ess'])
    expect(result.topicScores.Writing).toBeUndefined() // pending topic not rolled up
  })

  it('graded:false (provider failure) is treated the same as pending', () => {
    const questions = [{ id: 'sa', type: 'short_answer', marks: 2 }]
    const result = computeQuizScore(questions, { sa: { text: 'ans', graded: false } })
    expect(result.score).toBe(0)
    expect(result.total).toBe(0) // excluded, not counted wrong
    expect(result.pending).toBe(1)
  })

  it('a genuinely evaluated wrong answer still scores 0 (graded, not pending)', () => {
    const questions = [{ id: 'sa', type: 'short_answer', marks: 2 }]
    const result = computeQuizScore(questions, { sa: { text: 'wrong', correct: false } })
    expect(result.score).toBe(0)
    expect(result.total).toBe(2) // counted — it WAS evaluated
    expect(result.pending).toBe(0)
  })

  it('a genuinely evaluated correct answer still scores full marks', () => {
    const questions = [{ id: 'sa', type: 'short_answer', marks: 2 }]
    const result = computeQuizScore(questions, { sa: { text: 'right', correct: true } })
    expect(result.score).toBe(2)
    expect(result.total).toBe(2)
    expect(result.pending).toBe(0)
  })
})

describe('buildResultGrading — a pending attempt is persisted as provisional', () => {
  it('marks an attempt with pending answers provisional with a null finalScore', () => {
    const questions = [
      { id: 'mcq', type: 'mcq', correctAnswer: 1, marks: 1 },
      { id: 'ess', type: 'essay', marks: 1 },
    ]
    // The MCQ is correct and the essay could not be graded → partial 100%.
    const score = computeQuizScore(questions, { mcq: 1, ess: { text: 'x', pending: true } })
    expect(score.percentage).toBe(100)
    const grading = buildResultGrading(score)
    expect(grading).toEqual({
      gradingStatus: 'pending',
      scoreStatus: 'provisional',
      pendingQuestionIds: ['ess'],
      finalScore: null, // the inflated partial mark never becomes authoritative
    })
    expect(isProvisionalResult(grading)).toBe(true)
  })

  it('marks a fully graded attempt final with an authoritative finalScore', () => {
    const questions = [{ id: 'mcq', type: 'mcq', correctAnswer: 1, marks: 1 }]
    const grading = buildResultGrading(computeQuizScore(questions, { mcq: 1 }))
    expect(grading).toEqual({
      gradingStatus: 'complete',
      scoreStatus: 'final',
      pendingQuestionIds: [],
      finalScore: 100,
    })
    expect(isProvisionalResult(grading)).toBe(false)
  })

  it('treats legacy results (no status fields) as final, not provisional', () => {
    expect(isProvisionalResult({ percentage: 80 })).toBe(false)
    expect(isProvisionalResult(null)).toBe(false)
  })
})
