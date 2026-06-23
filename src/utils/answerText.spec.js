import { describe, it, expect } from 'vitest'
import { answerToText } from './answerText.js'

describe('answerToText', () => {
  it('resolves an mcq option index to its label', () => {
    const q = { type: 'mcq', options: ['Red', 'Green', 'Blue'] }
    expect(answerToText(q, 2)).toBe('Blue')
    expect(answerToText(q, undefined)).toBe('No answer')
  })

  it('reads the text off a short-answer / essay {text} object', () => {
    const q = { type: 'short_answer' }
    expect(answerToText(q, { text: 'Photosynthesis', correct: true })).toBe('Photosynthesis')
    expect(answerToText({ type: 'essay' }, { text: 'My essay…' })).toBe('My essay…')
  })

  it('renders a matching learner answer as prompt → option pairs', () => {
    const q = {
      type: 'matching',
      matchingLeft: ['Cow', 'Dog'],
      matchingRight: ['Puppy', 'Calf'],
      matchingAnswer: [1, 0],
    }
    expect(answerToText(q, [1, 0])).toBe('Cow → Calf; Dog → Puppy')
    // Expected-answer call passes the empty correctAnswer → falls back to key
    expect(answerToText(q, '')).toBe('Cow → Calf; Dog → Puppy')
    // Unset selection renders a dash, never crashes
    expect(answerToText(q, [-1, 0])).toBe('Cow → —; Dog → Puppy')
  })

  it('renders a sequence answer as a numbered order, from array or key', () => {
    const q = {
      type: 'sequence',
      sequenceItems: ['Tree', 'Seed', 'Sprout'],
      sequenceAnswer: [3, 1, 2],
    }
    // Learner order [1,2,0] = Seed, Sprout, Tree
    expect(answerToText(q, [1, 2, 0])).toBe('1. Seed  2. Sprout  3. Tree')
    // Expected-answer call (empty string) derives the order from the key
    expect(answerToText(q, '')).toBe('1. Seed  2. Sprout  3. Tree')
  })
})
