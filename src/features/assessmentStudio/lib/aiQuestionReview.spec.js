import { describe, it, expect } from 'vitest'
import {
  partitionUsableQuestions,
  questionTypeLabel,
  questionPreviewText,
  optionPreviewTexts,
} from './aiQuestionReview'

const mcq = (over = {}) => ({
  type: 'mcq',
  text: 'What is 2 + 2?',
  options: ['3', '4', '5', '6'],
  correctAnswer: 1,
  marks: 1,
  ...over,
})

describe('partitionUsableQuestions — the filter that used to drop silently', () => {
  it('keeps well-formed questions of every quick-generate type', () => {
    const list = [
      mcq(),
      { type: 'short_answer', text: 'Define osmosis.', correctAnswer: 'Movement of water…' },
      { type: 'diagram', text: 'Label the heart.', correctAnswer: 'See guide' },
      { type: 'fill_blanks', text: 'Complete:', statements: [{ text: 'Water boils at ____ °C.' }] },
    ]
    const { usable, dropped } = partitionUsableQuestions(list)
    expect(usable).toHaveLength(4)
    expect(dropped).toHaveLength(0)
  })

  it('drops a question with no stem text', () => {
    const { usable, dropped } = partitionUsableQuestions([mcq({ text: '' }), mcq({ text: '<p></p>' })])
    expect(usable).toHaveLength(0)
    expect(dropped).toHaveLength(2)
  })

  it('drops an MCQ with fewer than 2 non-empty options', () => {
    const { usable, dropped } = partitionUsableQuestions([
      mcq({ options: ['only one', '', ' ', ''] }),
      mcq({ options: ['a', 'b'] }),
    ])
    expect(usable).toHaveLength(1)
    expect(dropped).toHaveLength(1)
    expect(dropped[0].options[0]).toBe('only one')
  })

  it('drops fill-in-the-blanks whose statements have no actual blank', () => {
    const noBlank = { type: 'fill_blanks', text: 'Complete:', statements: [{ text: 'Water boils at 100.' }] }
    const { usable, dropped } = partitionUsableQuestions([noBlank])
    expect(usable).toHaveLength(0)
    expect(dropped).toHaveLength(1)
  })

  it('drops short-answer / structured questions with no expected answer', () => {
    const { usable, dropped } = partitionUsableQuestions([
      { type: 'short_answer', text: 'Define osmosis.', correctAnswer: '' },
      { type: 'diagram', text: 'Label the heart.', correctAnswer: '   ' },
    ])
    expect(usable).toHaveLength(0)
    expect(dropped).toHaveLength(2)
  })

  it('tolerates junk input', () => {
    expect(partitionUsableQuestions(null)).toEqual({ usable: [], dropped: [] })
    const { usable, dropped } = partitionUsableQuestions([null, undefined, 'nope'])
    expect(usable).toHaveLength(0)
    expect(dropped).toHaveLength(3)
  })
})

describe('review-list presentation helpers', () => {
  it('labels every quick-generate type, defaulting to Multiple choice', () => {
    expect(questionTypeLabel('short_answer')).toBe('Short answer')
    expect(questionTypeLabel('fill_blanks')).toBe('Fill in the blanks')
    expect(questionTypeLabel('mcq')).toBe('Multiple choice')
    expect(questionTypeLabel(undefined)).toBe('Multiple choice')
  })

  it('previews rich-HTML stems as plain text and truncates long ones', () => {
    expect(questionPreviewText({ text: '<p>What is <strong>2 + 2</strong>?</p>' })).toBe('What is 2 + 2?')
    const long = questionPreviewText({ text: 'x'.repeat(500) })
    expect(long.length).toBeLessThanOrEqual(220)
    expect(long.endsWith('…')).toBe(true)
  })

  it('previews options as plain text, dropping empties', () => {
    expect(optionPreviewTexts(mcq({ options: ['<p>a</p>', '', 'b'] }))).toEqual(['a', 'b'])
    expect(optionPreviewTexts({})).toEqual([])
  })
})
