import { describe, it, expect } from 'vitest'
import { gradeMatching, matchingMatches } from './matchingGrading.js'

// A matching question pairs each prompt in matchingLeft[i] with the option at
// matchingRight[matchingAnswer[i]]. The learner response is a flat array:
// response[i] = the right-index they chose for left[i]. gradeMatching is the
// deterministic scorer the learner runner AND computeQuizScore both call, so it
// has to agree on every shape the editor can persist.

const question = {
  type: 'matching',
  matchingLeft: ['Cow', 'Dog', 'Hen'],
  matchingRight: ['Puppy', 'Calf', 'Chick'],
  // Cow→Calf(1), Dog→Puppy(0), Hen→Chick(2)
  matchingAnswer: [1, 0, 2],
}

describe('gradeMatching', () => {
  it('marks a fully correct response allCorrect', () => {
    const r = gradeMatching(question, [1, 0, 2])
    expect(r.allCorrect).toBe(true)
    expect(r.correctPairs).toBe(3)
    expect(r.totalPairs).toBe(3)
    expect(r.perRow).toEqual([true, true, true])
  })

  it('counts partial correctness and never marks allCorrect', () => {
    const r = gradeMatching(question, [1, 2, 2]) // Dog wrong
    expect(r.allCorrect).toBe(false)
    expect(r.correctPairs).toBe(2)
    expect(r.perRow).toEqual([true, false, true])
  })

  it('treats unset (-1 / missing) selections as wrong', () => {
    const r = gradeMatching(question, [1, -1])
    expect(r.correctPairs).toBe(1)
    expect(r.perRow).toEqual([true, false, false])
    expect(r.allCorrect).toBe(false)
  })

  it('ignores blank prompt rows (editor padding) in the total', () => {
    const padded = {
      ...question,
      matchingLeft: ['Cow', 'Dog', 'Hen', ''],
      matchingAnswer: [1, 0, 2, -1],
    }
    const r = gradeMatching(padded, [1, 0, 2])
    expect(r.totalPairs).toBe(3)
    expect(r.perRow).toEqual([true, true, true, null])
    expect(r.allCorrect).toBe(true)
  })

  it('a non-array / empty response scores zero and is not allCorrect', () => {
    expect(gradeMatching(question, undefined).correctPairs).toBe(0)
    expect(gradeMatching(question, undefined).allCorrect).toBe(false)
    expect(matchingMatches(question, undefined)).toBe(false)
  })

  it('matchingMatches mirrors allCorrect', () => {
    expect(matchingMatches(question, [1, 0, 2])).toBe(true)
    expect(matchingMatches(question, [0, 1, 2])).toBe(false)
  })
})
