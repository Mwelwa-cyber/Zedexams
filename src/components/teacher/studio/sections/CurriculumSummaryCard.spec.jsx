import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CurriculumSummaryCard } from './CurriculumSummaryCard'

const CBC_ROW = {
  specificCompetence: 'Identify food groups and their functions',
  learningActivities: ['Group Discussion', 'Role Play', 'Experiment'],
  expectedStandard: 'Learner can categorise foods by nutrient group',
}

const PREVIOUS_ROW = {
  specificOutcomes: [
    'Describe the water cycle',
    'Explain evaporation',
    'Identify condensation',
  ],
}

// ── Null guard ─────────────────────────────────────────────────────────────────

describe('CurriculumSummaryCard — null guard', () => {
  it('renders nothing when subtopicRow is null', () => {
    const { container } = render(
      <CurriculumSummaryCard subtopicRow={null} curriculumMode="cbc" selectedOutcomes={[]} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when subtopicRow is null for previous mode', () => {
    const { container } = render(
      <CurriculumSummaryCard subtopicRow={null} curriculumMode="previous" selectedOutcomes={[]} />,
    )
    expect(container.firstChild).toBeNull()
  })
})

// ── Card chrome ────────────────────────────────────────────────────────────────

describe('CurriculumSummaryCard — card chrome', () => {
  it('renders the Curriculum Summary header', () => {
    render(
      <CurriculumSummaryCard subtopicRow={CBC_ROW} curriculumMode="cbc" selectedOutcomes={[]} />,
    )
    expect(screen.getByText(/Curriculum Summary/)).toBeInTheDocument()
  })
})

// ── CBC mode ──────────────────────────────────────────────────────────────────

describe('CurriculumSummaryCard — CBC mode', () => {
  it('shows the Specific Competence section label', () => {
    render(
      <CurriculumSummaryCard subtopicRow={CBC_ROW} curriculumMode="cbc" selectedOutcomes={[]} />,
    )
    expect(screen.getByText('Specific Competence')).toBeInTheDocument()
  })

  it('renders the specificCompetence value', () => {
    render(
      <CurriculumSummaryCard subtopicRow={CBC_ROW} curriculumMode="cbc" selectedOutcomes={[]} />,
    )
    expect(screen.getByText('Identify food groups and their functions')).toBeInTheDocument()
  })

  it('shows the Learning Activities section label', () => {
    render(
      <CurriculumSummaryCard subtopicRow={CBC_ROW} curriculumMode="cbc" selectedOutcomes={[]} />,
    )
    expect(screen.getByText('Learning Activities')).toBeInTheDocument()
  })

  it('renders one ActivityChip per learning activity', () => {
    render(
      <CurriculumSummaryCard subtopicRow={CBC_ROW} curriculumMode="cbc" selectedOutcomes={[]} />,
    )
    expect(screen.getByText('Group Discussion')).toBeInTheDocument()
    expect(screen.getByText('Role Play')).toBeInTheDocument()
    expect(screen.getByText('Experiment')).toBeInTheDocument()
  })

  it('renders ActivityChips as pill spans with rounded-full class', () => {
    const { container } = render(
      <CurriculumSummaryCard subtopicRow={CBC_ROW} curriculumMode="cbc" selectedOutcomes={[]} />,
    )
    const chips = container.querySelectorAll('.rounded-full')
    expect(chips.length).toBe(3)
  })

  it('shows the Expected Standard section label', () => {
    render(
      <CurriculumSummaryCard subtopicRow={CBC_ROW} curriculumMode="cbc" selectedOutcomes={[]} />,
    )
    expect(screen.getByText('Expected Standard')).toBeInTheDocument()
  })

  it('renders the expectedStandard value', () => {
    render(
      <CurriculumSummaryCard subtopicRow={CBC_ROW} curriculumMode="cbc" selectedOutcomes={[]} />,
    )
    expect(
      screen.getByText('Learner can categorise foods by nutrient group'),
    ).toBeInTheDocument()
  })

  it('does NOT render Specific Outcomes section in CBC mode', () => {
    render(
      <CurriculumSummaryCard subtopicRow={CBC_ROW} curriculumMode="cbc" selectedOutcomes={[]} />,
    )
    expect(screen.queryByText('Specific Outcomes')).not.toBeInTheDocument()
  })
})

// ── Previous Curriculum mode ───────────────────────────────────────────────────

describe('CurriculumSummaryCard — Previous Curriculum mode', () => {
  it('shows the Specific Outcomes section label', () => {
    render(
      <CurriculumSummaryCard
        subtopicRow={PREVIOUS_ROW}
        curriculumMode="previous"
        selectedOutcomes={[]}
      />,
    )
    expect(screen.getByText('Specific Outcomes')).toBeInTheDocument()
  })

  it('renders each outcome as a paragraph', () => {
    render(
      <CurriculumSummaryCard
        subtopicRow={PREVIOUS_ROW}
        curriculumMode="previous"
        selectedOutcomes={[]}
      />,
    )
    expect(screen.getByText('Describe the water cycle')).toBeInTheDocument()
    expect(screen.getByText('Explain evaporation')).toBeInTheDocument()
    expect(screen.getByText('Identify condensation')).toBeInTheDocument()
  })

  it('does NOT apply highlight classes to non-selected outcomes', () => {
    const { container } = render(
      <CurriculumSummaryCard
        subtopicRow={PREVIOUS_ROW}
        curriculumMode="previous"
        selectedOutcomes={[]}
      />,
    )
    const highlighted = container.querySelectorAll('.bg-blue-50')
    expect(highlighted.length).toBe(0)
  })

  it('applies highlight to a selected outcome', () => {
    render(
      <CurriculumSummaryCard
        subtopicRow={PREVIOUS_ROW}
        curriculumMode="previous"
        selectedOutcomes={['Explain evaporation']}
      />,
    )
    const highlighted = screen.getByText('Explain evaporation')
    expect(highlighted.className).toMatch(/bg-blue-50/)
    expect(highlighted.className).toMatch(/border-blue-400/)
  })

  it('highlights only the matching outcome, not the others', () => {
    const { container } = render(
      <CurriculumSummaryCard
        subtopicRow={PREVIOUS_ROW}
        curriculumMode="previous"
        selectedOutcomes={['Explain evaporation']}
      />,
    )
    const highlighted = container.querySelectorAll('.bg-blue-50')
    expect(highlighted.length).toBe(1)
  })

  it('can highlight multiple outcomes at once', () => {
    const { container } = render(
      <CurriculumSummaryCard
        subtopicRow={PREVIOUS_ROW}
        curriculumMode="previous"
        selectedOutcomes={['Describe the water cycle', 'Identify condensation']}
      />,
    )
    const highlighted = container.querySelectorAll('.bg-blue-50')
    expect(highlighted.length).toBe(2)
  })

  it('does NOT render CBC fields in previous mode', () => {
    render(
      <CurriculumSummaryCard
        subtopicRow={PREVIOUS_ROW}
        curriculumMode="previous"
        selectedOutcomes={[]}
      />,
    )
    expect(screen.queryByText('Specific Competence')).not.toBeInTheDocument()
    expect(screen.queryByText('Learning Activities')).not.toBeInTheDocument()
    expect(screen.queryByText('Expected Standard')).not.toBeInTheDocument()
  })
})
