import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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

  it('shows a plain competence, with no choice, when the sub-topic has one', () => {
    render(
      <CurriculumSummaryCard
        subtopicRow={{ ...CBC_ROW, competences: [{ specificCompetence: CBC_ROW.specificCompetence }] }}
        curriculumMode="cbc"
        selectedOutcomes={[]}
        onSelectCompetence={() => {}}
      />,
    )
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('offers every competence as a choice when the sub-topic has several', () => {
    const onSelect = vi.fn()
    const row = {
      ...CBC_ROW,
      competences: [
        { specificCompetence: CBC_ROW.specificCompetence, learningActivities: [], expectedStandard: '' },
        { specificCompetence: 'Explain the role of vitamins', learningActivities: [], expectedStandard: '' },
      ],
    }
    render(
      <CurriculumSummaryCard subtopicRow={row} curriculumMode="cbc" selectedOutcomes={[]} onSelectCompetence={onSelect} />,
    )
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios[0]).toBeChecked()
    fireEvent.click(radios[1])
    expect(onSelect).toHaveBeenCalledWith('Explain the role of vitamins')
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

// ── Choosing focus learning activities (CBC) ──────────────────────────────────

describe('CurriculumSummaryCard — focus learning activities', () => {
  it('renders each activity as a toggle the teacher can tap', () => {
    const onToggle = vi.fn()
    render(
      <CurriculumSummaryCard
        subtopicRow={CBC_ROW}
        curriculumMode="cbc"
        focusActivities={[]}
        onToggleActivity={onToggle}
      />,
    )
    const chip = screen.getByRole('button', { name: 'Role Play' })
    expect(chip).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(chip)
    expect(onToggle).toHaveBeenCalledWith('Role Play')
    expect(screen.getByText(/None selected/)).toBeInTheDocument()
  })

  it('marks the chosen activities and ignores choices from another sub-topic', () => {
    render(
      <CurriculumSummaryCard
        subtopicRow={CBC_ROW}
        curriculumMode="cbc"
        focusActivities={['Experiment', 'Not on this row']}
        onToggleActivity={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /Experiment/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Group Discussion' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/1 of 3 selected/)).toBeInTheDocument()
  })

  it('stays read-only when no toggle handler is given', () => {
    render(<CurriculumSummaryCard subtopicRow={CBC_ROW} curriculumMode="cbc" />)
    expect(screen.queryByRole('button', { name: 'Role Play' })).not.toBeInTheDocument()
    expect(screen.getByText('Role Play')).toBeInTheDocument()
  })
})
