import { describe, expect, it } from 'vitest'
import {
  isTextAnswerType,
  isNumericType,
  isHotspotType,
  evaluateAnswer,
  scoreQuizAttempt,
} from './quizScoring'

describe('answer-type predicates', () => {
  it('classify text / numeric / hotspot types', () => {
    expect(isTextAnswerType('short_answer')).toBe(true)
    expect(isTextAnswerType('diagram')).toBe(true)
    expect(isTextAnswerType('mcq')).toBe(false)
    expect(isNumericType('numeric')).toBe(true)
    expect(isNumericType('mcq')).toBe(false)
    expect(isHotspotType('hotspot')).toBe(true)
    expect(isHotspotType('numeric')).toBe(false)
  })
})

describe('evaluateAnswer', () => {
  it('mcq: strict equality against correctAnswer', () => {
    expect(evaluateAnswer({ type: 'mcq', correctAnswer: 2 }, 2)).toBe(true)
    expect(evaluateAnswer({ type: 'mcq', correctAnswer: 2 }, 1)).toBe(false)
    // No coercion — a stringified index does not match the numeric key.
    expect(evaluateAnswer({ type: 'mcq', correctAnswer: 2 }, '2')).toBe(false)
  })

  it('truefalse / unknown types fall through to equality', () => {
    expect(evaluateAnswer({ type: 'truefalse', correctAnswer: 0 }, 0)).toBe(true)
    expect(evaluateAnswer({ type: 'truefalse', correctAnswer: 0 }, 1)).toBe(false)
  })

  it('numeric: re-graded with tolerance (ignores any stored flag)', () => {
    expect(evaluateAnswer({ type: 'numeric', correctAnswer: 3.14, tolerance: 0.01 }, '3.15')).toBe(true)
    expect(evaluateAnswer({ type: 'numeric', correctAnswer: 3.14, tolerance: 0.01 }, '3.2')).toBe(false)
    expect(evaluateAnswer({ type: 'numeric', correctAnswer: 3.14 }, '')).toBe(false)
  })

  it('hotspot: re-graded from the persisted region', () => {
    const q = { type: 'hotspot', correctRegion: { x: 0.5, y: 0.5, radius: 0.1 } }
    expect(evaluateAnswer(q, { x: 0.52, y: 0.48 })).toBe(true)
    expect(evaluateAnswer(q, { x: 0.9, y: 0.1 })).toBe(false)
  })

  it('text answers: trust the stored AI verdict only when correct === true', () => {
    expect(evaluateAnswer({ type: 'short_answer' }, { text: 'Lusaka', correct: true })).toBe(true)
    expect(evaluateAnswer({ type: 'short_answer' }, { text: 'wrong', correct: false })).toBe(false)
    expect(evaluateAnswer({ type: 'diagram' }, undefined)).toBe(false)
    // A truthy-but-not-true flag does not earn the mark.
    expect(evaluateAnswer({ type: 'short_answer' }, { correct: 'yes' })).toBe(false)
  })
})

describe('scoreQuizAttempt', () => {
  it('returns zeroes for an empty quiz', () => {
    expect(scoreQuizAttempt([], {})).toEqual({ score: 0, total: 0, percentage: 0, topicScores: {} })
    expect(scoreQuizAttempt(null)).toEqual({ score: 0, total: 0, percentage: 0, topicScores: {} })
  })

  it('weights by per-question marks (default 1)', () => {
    const questions = [
      { id: 'a', type: 'mcq', correctAnswer: 0, marks: 3, topic: 'Algebra' },
      { id: 'b', type: 'mcq', correctAnswer: 1, topic: 'Algebra' }, // default 1 mark
    ]
    const res = scoreQuizAttempt(questions, { a: 0, b: 9 })
    expect(res.score).toBe(3) // only the 3-mark question is right
    expect(res.total).toBe(4)
    expect(res.percentage).toBe(75)
  })

  it('rounds the percentage to the nearest integer', () => {
    const questions = [
      { id: 'a', type: 'mcq', correctAnswer: 0 },
      { id: 'b', type: 'mcq', correctAnswer: 0 },
      { id: 'c', type: 'mcq', correctAnswer: 0 },
    ]
    // 2/3 correct → 66.67 → 67
    expect(scoreQuizAttempt(questions, { a: 0, b: 0, c: 9 }).percentage).toBe(67)
  })

  it('builds a per-topic breakdown, defaulting a missing topic to General', () => {
    const questions = [
      { id: 'a', type: 'mcq', correctAnswer: 0, topic: 'Maps' },
      { id: 'b', type: 'mcq', correctAnswer: 0, topic: 'Maps' },
      { id: 'c', type: 'mcq', correctAnswer: 0 }, // no topic
    ]
    const res = scoreQuizAttempt(questions, { a: 0, b: 9, c: 0 })
    expect(res.topicScores).toEqual({
      Maps: { correct: 1, total: 2 },
      General: { correct: 1, total: 1 },
    })
  })

  it('scores a mixed-type quiz with server-authoritative re-grade', () => {
    const questions = [
      { id: 'q1', type: 'mcq', marks: 2, topic: 'A', correctAnswer: 1 },
      { id: 'q2', type: 'numeric', marks: 1, topic: 'A', correctAnswer: 3.14, tolerance: 0.01 },
      { id: 'q3', type: 'hotspot', marks: 1, topic: 'B', correctRegion: { x: 0.5, y: 0.5, radius: 0.1 } },
      { id: 'q4', type: 'short_answer', marks: 1, topic: 'B', correctAnswer: 'Lusaka' },
      { id: 'q5', type: 'truefalse', marks: 1, topic: 'C', correctAnswer: 0 },
    ]
    const answers = {
      q1: 1, // correct (2)
      q2: '3.15', // within tolerance (1)
      q3: { x: 0.52, y: 0.48 }, // inside region (1)
      q4: { text: 'lusaka', correct: true }, // AI-marked correct (1)
      q5: 1, // wrong (0)
    }
    const res = scoreQuizAttempt(questions, answers)
    expect(res.score).toBe(5)
    expect(res.total).toBe(6)
    expect(res.percentage).toBe(83)
    expect(res.topicScores).toEqual({
      A: { correct: 3, total: 3 },
      B: { correct: 2, total: 2 },
      C: { correct: 0, total: 1 },
    })
  })

  it('treats unanswered questions as wrong (no entry in the answers map)', () => {
    const questions = [
      { id: 'a', type: 'mcq', correctAnswer: 0, marks: 2 },
      { id: 'b', type: 'numeric', correctAnswer: 5, marks: 2 },
    ]
    const res = scoreQuizAttempt(questions, {})
    expect(res).toMatchObject({ score: 0, total: 4, percentage: 0 })
  })
})
