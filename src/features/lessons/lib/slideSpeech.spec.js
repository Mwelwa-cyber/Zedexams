import { describe, it, expect } from 'vitest'
import { slideToSpeechText } from './slideSpeech'

describe('slideToSpeechText', () => {
  it('returns an empty string for a missing or non-object slide', () => {
    expect(slideToSpeechText(null)).toBe('')
    expect(slideToSpeechText(undefined)).toBe('')
    expect(slideToSpeechText('nope')).toBe('')
  })

  it('reads title, subtitle and body in order', () => {
    expect(
      slideToSpeechText({ title: 'Fractions', subtitle: 'Grade 5', body: 'A fraction is part of a whole' }),
    ).toBe('Fractions. Grade 5. A fraction is part of a whole.')
  })

  it('includes bullet strings in order', () => {
    expect(
      slideToSpeechText({ title: 'Key points', bullets: ['One half', 'One quarter'] }),
    ).toBe('Key points. One half. One quarter.')
  })

  it('does not double sentence-ending punctuation', () => {
    expect(slideToSpeechText({ title: 'Ready?', body: 'Let us begin!' })).toBe('Ready? Let us begin!')
  })

  it('skips empty / whitespace-only fields', () => {
    expect(slideToSpeechText({ title: '  ', subtitle: '', body: 'Only this' })).toBe('Only this.')
  })

  it('reads prompt / example / explanation for activity-style slides', () => {
    expect(
      slideToSpeechText({ title: 'Try it', prompt: 'Solve 2 + 2', explanation: 'Add the numbers' }),
    ).toBe('Try it. Solve 2 + 2. Add the numbers.')
  })

  it('returns an empty string when the slide has no readable text', () => {
    expect(slideToSpeechText({ type: 'image', imageUrl: 'x.png' })).toBe('')
  })
})
