import { describe, it, expect } from 'vitest'
import { splitSpecificOutcomes } from '../splitSpecificOutcomes.js'

// splitSpecificOutcomes splits a 2013-curriculum SPECIFIC OUTCOMES cell
// (which concatenates all numbered outcomes into a single string) into an
// array of individual outcome strings, one per numbered code.

describe('splitSpecificOutcomes', () => {
  it('splits two outcomes separated by a space', () => {
    const raw = '10.1.3.1 Explain the Agro-ecological zones of Zambia. 10.1.3.2 State the duration of rainfall in Zambia.'
    expect(splitSpecificOutcomes(raw)).toEqual([
      '10.1.3.1 Explain the Agro-ecological zones of Zambia.',
      '10.1.3.2 State the duration of rainfall in Zambia.',
    ])
  })

  it('handles a single outcome with no split needed', () => {
    const raw = '10.1.2.1 Explain the importance of a farmer in a nation.'
    expect(splitSpecificOutcomes(raw)).toEqual([
      '10.1.2.1 Explain the importance of a farmer in a nation.',
    ])
  })

  it('handles multiple outcomes on a single cell', () => {
    const raw = '10.1.1.1 State the importance of agriculture. 10.1.1.2 Classify agriculture as an applied science or as a technology. 10.1.1.3 Explain why the knowledge and skills of people trained in agriculture are needed.'
    const result = splitSpecificOutcomes(raw)
    expect(result).toHaveLength(3)
    expect(result[0]).toBe('10.1.1.1 State the importance of agriculture.')
    expect(result[1]).toBe('10.1.1.2 Classify agriculture as an applied science or as a technology.')
    expect(result[2]).toBe('10.1.1.3 Explain why the knowledge and skills of people trained in agriculture are needed.')
  })

  it('trims whitespace from each outcome', () => {
    const raw = '  10.2.1.1 Identify different types of rocks.   10.2.1.2 List some minerals found in different rocks.  '
    const result = splitSpecificOutcomes(raw)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('10.2.1.1 Identify different types of rocks.')
    expect(result[1]).toBe('10.2.1.2 List some minerals found in different rocks.')
  })

  it('returns an empty array for an empty string', () => {
    expect(splitSpecificOutcomes('')).toEqual([])
  })

  it('returns an empty array for a whitespace-only string', () => {
    expect(splitSpecificOutcomes('   ')).toEqual([])
  })

  it('returns an empty array for null', () => {
    expect(splitSpecificOutcomes(null)).toEqual([])
  })

  it('returns an empty array for undefined', () => {
    expect(splitSpecificOutcomes(undefined)).toEqual([])
  })

  it('returns an empty array for a non-string value', () => {
    expect(splitSpecificOutcomes(42)).toEqual([])
  })

  it('does not split on 3-part codes (not 4-part)', () => {
    // "10.1.3" is not a valid outcome code — only 4-part codes trigger a split.
    const raw = '10.1.3 Some section heading that should not be split.'
    expect(splitSpecificOutcomes(raw)).toEqual([
      '10.1.3 Some section heading that should not be split.',
    ])
  })

  it('handles outcomes separated by newlines instead of spaces', () => {
    const raw = '10.1.1.1 State the importance.\n10.1.1.2 Classify agriculture.'
    const result = splitSpecificOutcomes(raw)
    expect(result).toHaveLength(2)
    expect(result[0]).toBe('10.1.1.1 State the importance.')
    expect(result[1]).toBe('10.1.1.2 Classify agriculture.')
  })
})
