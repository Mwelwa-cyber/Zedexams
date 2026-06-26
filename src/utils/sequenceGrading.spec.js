import { describe, it, expect } from 'vitest'
import { gradeSequence, sequenceMatches } from './sequenceGrading.js'

// A sequence question asks the learner to put sequenceItems into the right
// order. sequenceAnswer[i] is the 1-based target position of sequenceItems[i].
// The learner response is the ORDER they arranged: order[p] = item index placed
// at position p (0-based), so item k's position is order.indexOf(k) + 1.

// Items as displayed (jumbled); correct chronological order is Seed→Sprout→Tree.
const question = {
  type: 'sequence',
  sequenceItems: ['Tree', 'Seed', 'Sprout'],
  // Tree is 3rd, Seed is 1st, Sprout is 2nd
  sequenceAnswer: [3, 1, 2],
}

describe('gradeSequence', () => {
  it('marks the correct arrangement allCorrect', () => {
    // Seed(1), Sprout(2), Tree(0) → positions 1,2,3
    const r = gradeSequence(question, [1, 2, 0])
    expect(r.allCorrect).toBe(true)
    expect(r.correctItems).toBe(3)
    expect(r.totalItems).toBe(3)
  })

  it('the display order (untouched seed) grades against what is on screen', () => {
    // Seeded order is the display order [0,1,2] = Tree,Seed,Sprout → all wrong
    const r = gradeSequence(question, [0, 1, 2])
    expect(r.allCorrect).toBe(false)
    expect(r.correctItems).toBe(0)
  })

  it('counts partial correctness', () => {
    // Seed(1) at pos1 ✓, Tree(0) at pos2 ✗, Sprout(2) at pos3 ✗
    const r = gradeSequence(question, [1, 0, 2])
    expect(r.correctItems).toBe(1)
    expect(r.perItem[1]).toBe(true)  // Seed correct
    expect(r.allCorrect).toBe(false)
  })

  it('ignores blank padding items in the total', () => {
    const padded = {
      type: 'sequence',
      sequenceItems: ['Tree', 'Seed', 'Sprout', ''],
      sequenceAnswer: [3, 1, 2, 0],
    }
    const r = gradeSequence(padded, [1, 2, 0])
    expect(r.totalItems).toBe(3)
    expect(r.allCorrect).toBe(true)
  })

  it('a non-array / empty order scores zero', () => {
    expect(gradeSequence(question, undefined).correctItems).toBe(0)
    expect(gradeSequence(question, undefined).allCorrect).toBe(false)
    expect(sequenceMatches(question, undefined)).toBe(false)
  })

  it('sequenceMatches mirrors allCorrect', () => {
    expect(sequenceMatches(question, [1, 2, 0])).toBe(true)
    expect(sequenceMatches(question, [0, 1, 2])).toBe(false)
  })
})
