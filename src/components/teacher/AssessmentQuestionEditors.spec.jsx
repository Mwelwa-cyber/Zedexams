/**
 * Vitest spec for McqOptions in AssessmentQuestionEditors.jsx — M1 regression.
 *
 * Guards the maxOptions / hidden-option behaviour introduced by M1:
 *   - 4 rows rendered by default (no maxOptions)
 *   - 2 rows rendered when maxOptions=2 (options C and D not in DOM)
 *   - hidden-content hint shown when any hidden option has text
 *   - hidden-correct warning shown when correctAnswer >= maxOptions
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { McqOptions } from './AssessmentQuestionEditors.jsx'

// DiagramSvg renders an <svg> that needs real DOM measurements — stub it.
vi.mock('../diagrams/DiagramSvg', () => ({ default: () => null }))
// studioIcons renders inline SVG paths; keep it out of jsdom.
vi.mock('./studio/studioIcons', () => ({ default: () => null }))

/**
 * A minimal question object for McqOptions. By default all four options have
 * non-empty text so the hidden-content hint fires when cap < 4.
 */
function makeQuestion(overrides = {}) {
  return {
    options: ['Alpha', 'Beta', 'Gamma', 'Delta'],
    correctAnswer: 0,
    optionMedia: [],
    ...overrides,
  }
}

describe('McqOptions — maxOptions / hidden behaviour (M1)', () => {
  it('renders all 4 option rows when maxOptions is not provided', () => {
    render(
      <McqOptions
        question={makeQuestion()}
        onChangeOption={vi.fn()}
        onSelectCorrect={vi.fn()}
      />,
    )
    // Options are rendered as <input value="…"> — use getByDisplayValue.
    expect(screen.getByDisplayValue('Alpha')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Beta')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Gamma')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Delta')).toBeInTheDocument()
  })

  it('renders only 2 option rows when maxOptions=2', () => {
    render(
      <McqOptions
        question={makeQuestion()}
        onChangeOption={vi.fn()}
        onSelectCorrect={vi.fn()}
        maxOptions={2}
      />,
    )
    expect(screen.getByDisplayValue('Alpha')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Beta')).toBeInTheDocument()
    expect(screen.queryByDisplayValue('Gamma')).not.toBeInTheDocument()
    expect(screen.queryByDisplayValue('Delta')).not.toBeInTheDocument()
  })

  it('shows the hidden-content hint when hidden options have text', () => {
    // Gamma + Delta are non-empty, so 2 options are hidden with content.
    render(
      <McqOptions
        question={makeQuestion()}
        onChangeOption={vi.fn()}
        onSelectCorrect={vi.fn()}
        maxOptions={2}
      />,
    )
    expect(screen.getByText(/more option\(s\) hidden/)).toBeInTheDocument()
    expect(screen.getByText(/kept, not printed/)).toBeInTheDocument()
  })

  it('does NOT show the hidden-content hint when all hidden options are empty', () => {
    render(
      <McqOptions
        question={makeQuestion({ options: ['Alpha', 'Beta', '', ''] })}
        onChangeOption={vi.fn()}
        onSelectCorrect={vi.fn()}
        maxOptions={2}
      />,
    )
    expect(screen.queryByText(/more option\(s\) hidden/)).not.toBeInTheDocument()
  })

  it('shows the hidden-correct warning when the correct answer is in the hidden range', () => {
    // correctAnswer=2 means option C (index 2), which is hidden when cap=2.
    render(
      <McqOptions
        question={makeQuestion({ correctAnswer: 2 })}
        onChangeOption={vi.fn()}
        onSelectCorrect={vi.fn()}
        maxOptions={2}
      />,
    )
    expect(screen.getByText(/correct answer.*hidden/i)).toBeInTheDocument()
    // Letter C should appear in the warning text.
    expect(screen.getByText(/option C/)).toBeInTheDocument()
  })

  it('does NOT show the hidden-correct warning when the correct answer is within the cap', () => {
    render(
      <McqOptions
        question={makeQuestion({ correctAnswer: 0 })}
        onChangeOption={vi.fn()}
        onSelectCorrect={vi.fn()}
        maxOptions={2}
      />,
    )
    expect(screen.queryByText(/correct answer.*hidden/i)).not.toBeInTheDocument()
  })

  it('ignores a maxOptions that is out of the valid range (> allOptions.length)', () => {
    // maxOptions=10 with only 4 options → cap falls back to allOptions.length=4.
    render(
      <McqOptions
        question={makeQuestion()}
        onChangeOption={vi.fn()}
        onSelectCorrect={vi.fn()}
        maxOptions={10}
      />,
    )
    // All 4 options rendered (inputs present by their display value).
    expect(screen.getByDisplayValue('Gamma')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Delta')).toBeInTheDocument()
    // No hint because nothing is hidden.
    expect(screen.queryByText(/more option\(s\) hidden/)).not.toBeInTheDocument()
  })
})
