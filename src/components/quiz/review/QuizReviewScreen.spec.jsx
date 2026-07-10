import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import QuizReviewScreen from './QuizReviewScreen'

const q = (id, extra = {}) => ({ id, type: 'mcq', correctAnswer: 0, ...extra })

const SECTIONS = [
  { kind: 'standalone', question: q('q1') },
  { kind: 'passage', questions: [q('q2'), q('q3')] },
]

function setup(overrides = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    onJumpToSection: vi.fn(),
    onFinish: vi.fn(),
    sections: SECTIONS,
    answers: { q1: 0 },
    flagged: { q2: true },
    revealed: {},
    aiResults: {},
    ...overrides,
  }
  render(<QuizReviewScreen {...props} />)
  return props
}

describe('QuizReviewScreen', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <QuizReviewScreen open={false} onClose={() => {}} onFinish={() => {}} sections={SECTIONS} />
    )
    expect(container.firstChild).toBeNull()
  })

  it('shows counts and one chip per question', () => {
    setup()
    expect(screen.getByText('Review your answers')).toBeInTheDocument()
    expect(screen.getByText(/1 of 3 answered/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Question 1: Answered/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Question 2: Unanswered, bookmarked/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Question 3: Unanswered/ })).toBeInTheDocument()
  })

  it('EXAM MODE: no correctness marks and no Incorrect filter when nothing is revealed', () => {
    setup({ answers: { q1: 0, q2: 3, q3: 1 } })
    expect(screen.queryByRole('button', { name: /Incorrect \(/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Question \d: Correct/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Question \d: Incorrect/ })).toBeNull()
  })

  it('practice mode: revealed questions show correctness and the Incorrect filter', () => {
    setup({ answers: { q1: 0, q2: 3 }, revealed: { q1: true, q2: true } })
    expect(screen.getByRole('button', { name: /Question 1: Correct/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Question 2: Incorrect/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Incorrect \(1\)/ }))
    expect(screen.queryByRole('button', { name: /Question 1: Correct/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Question 2: Incorrect/ })).toBeInTheDocument()
  })

  it('filters to unanswered and bookmarked', () => {
    setup()
    fireEvent.click(screen.getByRole('button', { name: /Unanswered \(2\)/ }))
    expect(screen.queryByRole('button', { name: /Question 1:/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Bookmarked \(1\)/ }))
    expect(screen.getByRole('button', { name: /Question 2:/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Question 3:/ })).toBeNull()
  })

  it('tapping a chip jumps to its section and closes', () => {
    const props = setup()
    fireEvent.click(screen.getByRole('button', { name: /Question 3: Unanswered/ }))
    expect(props.onJumpToSection).toHaveBeenCalledWith(1)
    expect(props.onClose).toHaveBeenCalled()
  })

  it('warns about unanswered questions and finishes', () => {
    const props = setup()
    expect(screen.getByText(/2 unanswered questions will be marked incorrect/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Finish quiz/ }))
    expect(props.onFinish).toHaveBeenCalledTimes(1)
  })

  it('Escape closes the review', () => {
    const props = setup()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalled()
  })
})
