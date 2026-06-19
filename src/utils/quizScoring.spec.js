import { describe, it, expect } from 'vitest'
import {
  computeQuizScore,
  isQuestionCorrect,
  isTextAnswerType,
  isNumericType,
  isHotspotType,
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
    expect(computeQuizScore([], {})).toEqual({ score: 0, total: 0, percentage: 0, topicScores: {} })
    expect(computeQuizScore(undefined, undefined)).toEqual({ score: 0, total: 0, percentage: 0, topicScores: {} })
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
