import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import QuizValidationChecklist from './QuizValidationChecklist'

// QuizValidationChecklist is the pre-publish quality gate a teacher sees before
// a quiz goes live: it partitions issues into must-fix errors vs ok-to-publish
// warnings and reports whether the quiz is publishable. A regression here
// either hides a blocking error (a broken quiz ships) or falsely blocks a clean
// one. The component is pure presentation (checks live in quizValidation.js),
// so no mocks are needed.

const errorIssue = { id: 'e1', label: 'Question 2 has no correct answer', severity: 'error' }
const warnIssue = { id: 'w1', label: 'Question 5 is very short', severity: 'warn' }

describe('QuizValidationChecklist — visibility', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <QuizValidationChecklist open={false} onClose={vi.fn()} issues={[errorIssue]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the dialog when open', () => {
    render(<QuizValidationChecklist open onClose={vi.fn()} issues={[]} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText('Pre-publish checklist')).toBeInTheDocument()
  })
})

describe('QuizValidationChecklist — error vs warning partition', () => {
  it('lists must-fix errors and reports the count', () => {
    render(<QuizValidationChecklist open onClose={vi.fn()} issues={[errorIssue]} />)
    expect(screen.getByText('Must fix before publishing')).toBeInTheDocument()
    expect(screen.getByText('Question 2 has no correct answer')).toBeInTheDocument()
    expect(screen.getByText(/1 item to fix before publishing/)).toBeInTheDocument()
  })

  it('pluralises the fix count', () => {
    render(
      <QuizValidationChecklist
        open
        onClose={vi.fn()}
        issues={[errorIssue, { id: 'e2', label: 'Missing title', severity: 'error' }]}
      />,
    )
    expect(screen.getByText(/2 items to fix before publishing/)).toBeInTheDocument()
  })

  it('shows warnings separately as ok-to-publish', () => {
    render(<QuizValidationChecklist open onClose={vi.fn()} issues={[warnIssue]} />)
    expect(screen.getByText('Worth checking (ok to publish)')).toBeInTheDocument()
    expect(screen.getByText('Question 5 is very short')).toBeInTheDocument()
    // A warning alone is not a blocker → publishable copy.
    expect(screen.getByText(/you can publish/)).toBeInTheDocument()
  })

  it('treats a warning-only quiz as green (no must-fix section)', () => {
    render(<QuizValidationChecklist open onClose={vi.fn()} issues={[warnIssue]} />)
    expect(screen.queryByText('Must fix before publishing')).not.toBeInTheDocument()
  })

  it('shows the all-clear message when there are no issues at all', () => {
    render(<QuizValidationChecklist open onClose={vi.fn()} issues={[]} />)
    expect(screen.getByText(/ready to publish/)).toBeInTheDocument()
  })
})

describe('QuizValidationChecklist — summary list', () => {
  it('renders satisfied and missing summary items', () => {
    render(
      <QuizValidationChecklist
        open
        onClose={vi.fn()}
        issues={[]}
        summary={[
          { label: 'Has a title', ok: true },
          { label: 'At least one question', ok: false },
        ]}
      />,
    )
    expect(screen.getByText('Has a title')).toBeInTheDocument()
    expect(screen.getByText('At least one question')).toBeInTheDocument()
  })
})

describe('QuizValidationChecklist — closing', () => {
  it('closes on the Close button', () => {
    const onClose = vi.fn()
    render(<QuizValidationChecklist open onClose={onClose} issues={[]} />)
    fireEvent.click(screen.getByText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on the header X', () => {
    const onClose = vi.fn()
    render(<QuizValidationChecklist open onClose={onClose} issues={[]} />)
    fireEvent.click(screen.getByLabelText('Close'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape while open', () => {
    const onClose = vi.fn()
    render(<QuizValidationChecklist open onClose={onClose} issues={[]} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on a backdrop click', () => {
    const onClose = vi.fn()
    render(<QuizValidationChecklist open onClose={onClose} issues={[]} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.mouseDown(dialog) // e.target === e.currentTarget on the overlay
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
