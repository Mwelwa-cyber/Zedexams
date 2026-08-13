import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { CoveragePanel } from './CoveragePanel'

const COVERAGE = {
  totalSubtopics: 4,
  coveredCount: 2,
  percent: 50,
  gaps: [
    { topic: 'Fractions', subtopic: 'Improper Fractions' },
    { topic: 'Whole Numbers', subtopic: 'Rounding' },
  ],
  nextSuggestion: { topic: 'Fractions', subtopic: 'Improper Fractions' },
}

function renderPanel(props = {}) {
  const defaults = {
    grade: 'Grade 4',
    subject: 'Mathematics Syllabus (Grades 4-6)',
    loading: false,
    coverage: COVERAGE,
    onSelectGap: vi.fn(),
    ...props,
  }
  return { ...render(<CoveragePanel {...defaults} />), onSelectGap: defaults.onSelectGap }
}

describe('CoveragePanel', () => {
  it('renders nothing until a grade and subject are chosen', () => {
    const { container } = render(<CoveragePanel grade="" subject="" coverage={COVERAGE} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the coverage percent and counts', () => {
    renderPanel()
    expect(screen.getByText('50%')).toBeInTheDocument()
    expect(screen.getByText('2 of 4 subtopics planned')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50')
  })

  it('lists the gaps and jumps to one when clicked', () => {
    const { onSelectGap } = renderPanel()
    fireEvent.click(screen.getByText('Rounding'))
    expect(onSelectGap).toHaveBeenCalledWith('Whole Numbers', 'Rounding')
  })

  it('offers a "Plan next" suggestion that jumps to the first gap', () => {
    const { onSelectGap } = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: /plan next: improper fractions/i }))
    expect(onSelectGap).toHaveBeenCalledWith('Fractions', 'Improper Fractions')
  })

  it('celebrates full coverage with no gaps', () => {
    renderPanel({ coverage: { totalSubtopics: 2, coveredCount: 2, percent: 100, gaps: [], nextSuggestion: null } })
    expect(screen.getByText(/every subtopic has a lesson plan/i)).toBeInTheDocument()
  })

  it('shows a loading hint while coverage resolves', () => {
    renderPanel({ loading: true, coverage: null })
    expect(screen.getByText(/checking your coverage/i)).toBeInTheDocument()
  })
})
