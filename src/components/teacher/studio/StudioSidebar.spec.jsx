import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StudioSidebar } from './StudioSidebar'

// ── Mock all section components ───────────────────────────────────────────────
// Each mock renders a minimal sentinel so we can assert presence/absence without
// pulling in any section's own hooks or sub-dependencies.

vi.mock('./sections/CurriculumPicker.jsx', () => ({
  CurriculumPicker: ({ curriculumMode, onSelect }) => (
    <div data-testid="curriculum-picker" data-mode={curriculumMode}>
      <button onClick={() => onSelect('cbc')}>Select CBC</button>
    </div>
  ),
}))

vi.mock('./sections/LessonDetailsForm.jsx', () => ({
  LessonDetailsForm: ({ disabled }) => (
    <div data-testid="lesson-details-form" data-disabled={String(disabled)} />
  ),
}))

vi.mock('./sections/TopicSubtopicForm.jsx', () => ({
  TopicSubtopicForm: ({ disabled }) => (
    <div data-testid="topic-subtopic-form" data-disabled={String(disabled)} />
  ),
}))

vi.mock('./sections/CurriculumSummaryCard.jsx', () => ({
  CurriculumSummaryCard: () => <div data-testid="curriculum-summary-card" />,
}))

vi.mock('./sections/CoveragePanel.jsx', () => ({
  CoveragePanel: () => <div data-testid="coverage-panel" />,
}))

vi.mock('./sections/SpecificOutcomeForm.jsx', () => ({
  SpecificOutcomeForm: () => <div data-testid="specific-outcome-form" />,
}))

vi.mock('./sections/LearningEnvironmentForm.jsx', () => ({
  LearningEnvironmentForm: () => <div data-testid="learning-environment-form" />,
}))

vi.mock('./sections/LessonProgressionForm.jsx', () => ({
  LessonProgressionForm: () => <div data-testid="lesson-progression-form" />,
}))

vi.mock('./sections/TeachingProgressPanel.jsx', () => ({
  TeachingProgressPanel: ({ onContinue, onViewCompleted }) => (
    <div data-testid="teaching-progress-panel">
      <button data-testid="tpp-continue" onClick={onContinue}>Continue</button>
      <button data-testid="tpp-view-completed" onClick={onViewCompleted}>View Completed</button>
    </div>
  ),
}))

vi.mock('./sections/FormatOptionsForm.jsx', () => ({
  FormatOptionsForm: () => <div data-testid="format-options-form" />,
}))

// ── Shared test fixtures ──────────────────────────────────────────────────────

function makeStudioState(overrides = {}) {
  return {
    curriculumMode: null,
    setCurriculumMode: vi.fn(),
    lessonDetails: { grade: '', subject: '', duration: 40, medium: 'English', term: '', week: '', date: '', time: '' },
    setLessonDetail: vi.fn(),
    topicData: { topic: '', subtopic: '', subtopicRow: null },
    setTopicField: vi.fn(),
    selectedOutcomes: [],
    toggleSelectedOutcome: vi.fn(),
    learningEnvironments: [],
    toggleLearningEnvironment: vi.fn(),
    lessonSeries: { planningMode: 'single', totalLessons: 1, lessonNumber: 1, lessonFocus: '', aiSuggestedReason: '' },
    setLessonSeriesField: vi.fn(),
    lessonBreakdown: [],
    setLessonBreakdown: vi.fn(),
    formatOptions: {
      detail: 'standard',
      writingStyle: 'standard',
      format: 'modern',
      illustrations: 'none',
      advanced: {
        compactMetadata: false,
        includeEnrolment: false,
        includeAttendance: false,
        includeLessonEvaluation: false,
        autoIllustrations: false,
        localLanguage: false,
      },
    },
    setFormatOption: vi.fn(),
    setAdvancedOption: vi.fn(),
    generationStatus: 'idle',
    ...overrides,
  }
}

function makeAiState(overrides = {}) {
  return {
    recommendation: null,
    loading: false,
    error: null,
    fetchRecommendation: vi.fn(),
    ...overrides,
  }
}

function makeSeriesState(overrides = {}) {
  return {
    completedCount: 0,
    completedLessons: [],
    seriesLoading: false,
    ...overrides,
  }
}

function renderSidebar(studioOverrides = {}, aiOverrides = {}, seriesOverrides = {}, extraProps = {}) {
  const studioState = makeStudioState(studioOverrides)
  const aiState     = makeAiState(aiOverrides)
  const seriesState = makeSeriesState(seriesOverrides)
  const props = {
    studioState,
    aiState,
    seriesState,
    onGenerate: vi.fn(),
    isValid: false,
    ...extraProps,
  }
  return { ...render(<StudioSidebar {...props} />), props }
}

// ── Section presence ──────────────────────────────────────────────────────────

describe('StudioSidebar — section presence', () => {
  it('renders CurriculumPicker at the top', () => {
    renderSidebar()
    expect(screen.getByTestId('curriculum-picker')).toBeInTheDocument()
  })

  it('always renders LessonDetailsForm', () => {
    renderSidebar()
    expect(screen.getByTestId('lesson-details-form')).toBeInTheDocument()
  })

  it('always renders TopicSubtopicForm', () => {
    renderSidebar()
    expect(screen.getByTestId('topic-subtopic-form')).toBeInTheDocument()
  })

  it('always renders CurriculumSummaryCard', () => {
    renderSidebar()
    expect(screen.getByTestId('curriculum-summary-card')).toBeInTheDocument()
  })

  it('renders LearningEnvironmentForm only for the CBC curriculum', () => {
    // Learning Environment is a CBC-only concept — hidden for the Previous
    // (Outcomes-Based) curriculum and before a curriculum is chosen.
    renderSidebar({ curriculumMode: 'cbc' })
    expect(screen.getByTestId('learning-environment-form')).toBeInTheDocument()
  })

  it('does NOT render LearningEnvironmentForm for the Previous curriculum', () => {
    renderSidebar({ curriculumMode: 'previous' })
    expect(screen.queryByTestId('learning-environment-form')).not.toBeInTheDocument()
  })

  it('does NOT render LearningEnvironmentForm before a curriculum is chosen', () => {
    renderSidebar({ curriculumMode: null })
    expect(screen.queryByTestId('learning-environment-form')).not.toBeInTheDocument()
  })

  it('always renders FormatOptionsForm', () => {
    renderSidebar()
    expect(screen.getByTestId('format-options-form')).toBeInTheDocument()
  })
})

// ── LessonDetailsForm disabled state ─────────────────────────────────────────

describe('StudioSidebar — LessonDetailsForm disabled', () => {
  it('is disabled when curriculumMode is null', () => {
    renderSidebar({ curriculumMode: null })
    expect(screen.getByTestId('lesson-details-form')).toHaveAttribute('data-disabled', 'true')
  })

  it('is not disabled when curriculumMode is "cbc"', () => {
    renderSidebar({ curriculumMode: 'cbc' })
    expect(screen.getByTestId('lesson-details-form')).toHaveAttribute('data-disabled', 'false')
  })

  it('is not disabled when curriculumMode is "previous"', () => {
    renderSidebar({ curriculumMode: 'previous' })
    expect(screen.getByTestId('lesson-details-form')).toHaveAttribute('data-disabled', 'false')
  })
})

// ── TopicSubtopicForm disabled state ─────────────────────────────────────────

describe('StudioSidebar — TopicSubtopicForm disabled', () => {
  it('is disabled when grade and subject are both empty', () => {
    renderSidebar({ lessonDetails: { grade: '', subject: '', duration: 40, medium: 'English', term: '', week: '', date: '', time: '' } })
    expect(screen.getByTestId('topic-subtopic-form')).toHaveAttribute('data-disabled', 'true')
  })

  it('is disabled when only grade is filled', () => {
    renderSidebar({ lessonDetails: { grade: 'Grade 4', subject: '', duration: 40, medium: 'English', term: '', week: '', date: '', time: '' } })
    expect(screen.getByTestId('topic-subtopic-form')).toHaveAttribute('data-disabled', 'true')
  })

  it('is disabled when only subject is filled', () => {
    renderSidebar({ lessonDetails: { grade: '', subject: 'Science', duration: 40, medium: 'English', term: '', week: '', date: '', time: '' } })
    expect(screen.getByTestId('topic-subtopic-form')).toHaveAttribute('data-disabled', 'true')
  })

  it('is not disabled when both grade and subject are filled', () => {
    renderSidebar({ lessonDetails: { grade: 'Grade 4', subject: 'Science', duration: 40, medium: 'English', term: '', week: '', date: '', time: '' } })
    expect(screen.getByTestId('topic-subtopic-form')).toHaveAttribute('data-disabled', 'false')
  })
})

// ── SpecificOutcomeForm — previous mode only ──────────────────────────────────

describe('StudioSidebar — SpecificOutcomeForm visibility', () => {
  it('is NOT rendered when curriculumMode is null', () => {
    renderSidebar({ curriculumMode: null })
    expect(screen.queryByTestId('specific-outcome-form')).not.toBeInTheDocument()
  })

  it('is NOT rendered when curriculumMode is "cbc"', () => {
    renderSidebar({ curriculumMode: 'cbc' })
    expect(screen.queryByTestId('specific-outcome-form')).not.toBeInTheDocument()
  })

  it('IS rendered when curriculumMode is "previous"', () => {
    renderSidebar({ curriculumMode: 'previous' })
    expect(screen.getByTestId('specific-outcome-form')).toBeInTheDocument()
  })
})

// ── CBC-only sections ─────────────────────────────────────────────────────────

describe('StudioSidebar — CBC-only sections', () => {
  it('LessonProgressionForm is NOT rendered when curriculumMode is null', () => {
    renderSidebar({ curriculumMode: null })
    expect(screen.queryByTestId('lesson-progression-form')).not.toBeInTheDocument()
  })

  it('LessonProgressionForm is NOT rendered when curriculumMode is "previous"', () => {
    renderSidebar({ curriculumMode: 'previous' })
    expect(screen.queryByTestId('lesson-progression-form')).not.toBeInTheDocument()
  })

  it('LessonProgressionForm IS rendered when curriculumMode is "cbc"', () => {
    renderSidebar({ curriculumMode: 'cbc' })
    expect(screen.getByTestId('lesson-progression-form')).toBeInTheDocument()
  })

  it('TeachingProgressPanel is NOT rendered when curriculumMode is null', () => {
    renderSidebar({ curriculumMode: null })
    expect(screen.queryByTestId('teaching-progress-panel')).not.toBeInTheDocument()
  })

  it('TeachingProgressPanel is NOT rendered when curriculumMode is "previous"', () => {
    renderSidebar({ curriculumMode: 'previous' })
    expect(screen.queryByTestId('teaching-progress-panel')).not.toBeInTheDocument()
  })

  it('TeachingProgressPanel IS rendered when curriculumMode is "cbc"', () => {
    renderSidebar({ curriculumMode: 'cbc' })
    expect(screen.getByTestId('teaching-progress-panel')).toBeInTheDocument()
  })
})

// ── Generate button ───────────────────────────────────────────────────────────

describe('StudioSidebar — Generate button', () => {
  it('renders the Generate Lesson Plan button', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: /generate lesson plan/i })).toBeInTheDocument()
  })

  it('is disabled when isValid is false', () => {
    renderSidebar({}, {}, {}, { isValid: false })
    expect(screen.getByRole('button', { name: /generate lesson plan/i })).toBeDisabled()
  })

  it('is enabled when isValid is true and status is idle', () => {
    renderSidebar({}, {}, {}, { isValid: true })
    expect(screen.getByRole('button', { name: /generate lesson plan/i })).not.toBeDisabled()
  })

  it('is disabled when isValid is true but generationStatus is "loading"', () => {
    renderSidebar({ generationStatus: 'loading' }, {}, {}, { isValid: true })
    const btn = screen.getByRole('button', { name: /generating/i })
    expect(btn).toBeDisabled()
  })

  it('shows "Generating…" label when generationStatus is "loading"', () => {
    renderSidebar({ generationStatus: 'loading' }, {}, {}, { isValid: true })
    expect(screen.getByText('Generating…')).toBeInTheDocument()
  })

  it('calls onGenerate when the button is clicked (isValid=true)', () => {
    const onGenerate = vi.fn()
    renderSidebar({}, {}, {}, { isValid: true, onGenerate })
    fireEvent.click(screen.getByRole('button', { name: /generate lesson plan/i }))
    expect(onGenerate).toHaveBeenCalledTimes(1)
  })

  it('does NOT call onGenerate when the button is disabled (isValid=false)', () => {
    const onGenerate = vi.fn()
    renderSidebar({}, {}, {}, { isValid: false, onGenerate })
    // disabled buttons don't fire click events
    fireEvent.click(screen.getByRole('button', { name: /generate lesson plan/i }))
    expect(onGenerate).not.toHaveBeenCalled()
  })
})

// ── Task 15: onContinue / onViewCompleted passthrough ────────────────────────

describe('StudioSidebar — onContinue and onViewCompleted passthrough', () => {
  it('passes onContinue through to TeachingProgressPanel', () => {
    const onContinue = vi.fn()
    renderSidebar({ curriculumMode: 'cbc' }, {}, {}, { onContinue })
    fireEvent.click(screen.getByTestId('tpp-continue'))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('passes onViewCompleted through to TeachingProgressPanel', () => {
    const onViewCompleted = vi.fn()
    renderSidebar({ curriculumMode: 'cbc' }, {}, {}, { onViewCompleted })
    fireEvent.click(screen.getByTestId('tpp-view-completed'))
    expect(onViewCompleted).toHaveBeenCalledTimes(1)
  })
})
