/**
 * ACCEPTANCE 13 — the meter renders from question 18 and is NOT dismissible.
 *
 * "Not dismissible" is asserted as the ABSENCE of any control in the tree, not
 * as the absence of a handler. It is exactly the kind of property a
 * well-meaning later change ("let them hide it") removes without anyone
 * noticing it was load-bearing: the meter's whole job is to let the learner
 * brace, and a meter that can be dismissed is one that will be, on the first
 * question, by the learner who most needs the warning.
 */

import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import FreeSetMeter from './FreeSetMeter'
import { resolveFreeSet } from '../../../services/entitlements/freeSet'

const PAPER = {
  id: 'p1',
  totalQuestions: 60,
  sections: [
    { id: 'a1', label: 'Section A, Part 1', title: 'Grammar', from: 1, to: 20 },
    { id: 'a2', label: 'Section A, Part 2', title: 'Spelling', from: 21, to: 35 },
  ],
  freeSet: { toQuestion: 20, sectionId: 'a1' },
}
const FREE_SET = resolveFreeSet(PAPER, 60)

describe('when it appears', () => {
  it('renders nothing before the last two questions of the free set', () => {
    const { container } = render(<FreeSetMeter questionNumber={17} freeSet={FREE_SET} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders from question 18 with the count remaining', () => {
    render(<FreeSetMeter questionNumber={18} freeSet={FREE_SET} />)
    expect(screen.getByText('Question 18 of 20')).toBeTruthy()
    expect(screen.getByText('3 left in your free set')).toBeTruthy()
  })

  it('renders nothing for a learner whose plan has no free set to run out of', () => {
    const { container } = render(
      <FreeSetMeter questionNumber={19} freeSet={FREE_SET} unlocked />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the free set covers the whole paper', () => {
    const whole = resolveFreeSet(PAPER, 12)
    const { container } = render(<FreeSetMeter questionNumber={11} freeSet={whole} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('it is text, and only text', () => {
  it('renders no dialog, no button and no close control of any kind', () => {
    const { container } = render(<FreeSetMeter questionNumber={19} freeSet={FREE_SET} />)
    expect(container.querySelector('button')).toBeNull()
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    expect(container.querySelector('a')).toBeNull()
    expect(container.querySelector('input')).toBeNull()
    expect(container.querySelector('[aria-label*="close" i]')).toBeNull()
    expect(container.querySelector('[aria-label*="dismiss" i]')).toBeNull()
    // Not even a clickable handler dressed as text.
    expect(container.querySelector('[onclick]')).toBeNull()
    expect(container.textContent).not.toMatch(/✕|×|dismiss|hide/i)
  })
})
