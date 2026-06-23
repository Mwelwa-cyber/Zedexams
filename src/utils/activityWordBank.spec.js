import { describe, it, expect } from 'vitest'
import { resolveActivityWordBank } from './activityWordBank.js'

describe('resolveActivityWordBank', () => {
  it('prefers the structured wordBank and rephrases "above" to "below"', () => {
    const { words, instructions } = resolveActivityWordBank({
      wordBank: ['backbone', 'insects', 'exoskeleton'],
      instructions: 'Fill in the blank with a word from the word box above.',
    })
    expect(words).toEqual(['backbone', 'insects', 'exoskeleton'])
    expect(instructions).toMatch(/word box below/i)
    expect(instructions).not.toMatch(/above/i)
  })

  it('pulls an inline "Word Box: …" list out of the instructions', () => {
    const { words, instructions } = resolveActivityWordBank({
      instructions:
        'Word Box: backbone, invertebrates, insects, six, snail, soft, spider, exoskeleton  ' +
        'Read each sentence carefully and fill in the blank with the most suitable word from the Word Box above.',
    })
    expect(words).toEqual([
      'backbone', 'invertebrates', 'insects', 'six',
      'snail', 'soft', 'spider', 'exoskeleton',
    ])
    expect(instructions).toMatch(/^Read each sentence/)
    expect(instructions).toMatch(/word box below/i)
    expect(instructions).not.toMatch(/above/i)
  })

  it('drops an echoed inline list when a structured wordBank is also present', () => {
    const { words, instructions } = resolveActivityWordBank({
      wordBank: ['one', 'two'],
      instructions: 'Word Box: one, two  Fill each gap with a word from the word box below.',
    })
    expect(words).toEqual(['one', 'two'])
    expect(instructions).toBe('Fill each gap with a word from the word box below.')
  })

  it('returns no words and the plain instruction when there is no word box', () => {
    const { words, instructions } = resolveActivityWordBank({
      instructions: 'Answer all the questions. Show your working where needed.',
    })
    expect(words).toEqual([])
    expect(instructions).toBe('Answer all the questions. Show your working where needed.')
  })

  it('falls back to a default instruction when the box has no lead-in', () => {
    const { words, instructions } = resolveActivityWordBank({ wordBank: ['a', 'b'] })
    expect(words).toEqual(['a', 'b'])
    expect(instructions).toMatch(/word box below/i)
  })
})
