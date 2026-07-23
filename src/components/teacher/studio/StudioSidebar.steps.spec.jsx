import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StudioSidebar, studioSteps } from './StudioSidebar'

// ── Section mocks (same sentinel pattern as StudioSidebar.spec.jsx) ──────────

vi.mock('react-router-dom', () => ({
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
}))

vi.mock('./sections/CurriculumPicker.jsx', () => ({
  CurriculumPicker: () => <div data-testid="curriculum-picker" />,
}))
vi.mock('./sections/LessonDetailsForm.jsx', () => ({
  LessonDetailsForm: () => (
    <div data-testid="lesson-details-form">
      <input aria-label="Teacher name" defaultValue="" />
    </div>
  ),
}))
vi.mock('./sections/TopicSubtopicForm.jsx', () => ({
  TopicSubtopicForm: () => <div data-testid="topic-subtopic-form" />,
}))
vi.mock('./sections/CurriculumSummaryCard.jsx', () => ({
  CurriculumSummaryCard: () => <div data-testid="curriculum-summary-card" />,
}))
vi.mock('./sections/SubtopicLessonsPanel.jsx', () => ({
  SubtopicLessonsPanel: () => <div data-testid="subtopic-lessons-panel" />,
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
  TeachingProgressPanel: () => <div data-testid="teaching-progress-panel" />,
}))
vi.mock('./sections/FormatOptionsForm.jsx', () => ({
  FormatOptionsForm: () => <div data-testid="format-options-form" />,
}))

function makeStudioState(overrides = {}) {
  return {
    curriculumMode: 'cbc',
    setCurriculumMode: vi.fn(),
    lessonDetails: { grade: '', subject: '', duration: '40', medium: 'English', date: '', time: '', teacherName: '', school: '' },
    setLessonDetail: vi.fn(),
    topicData: { topic: '', subtopic: '', subtopicRow: null },
    setTopicField: vi.fn(),
    selectedOutcomes: [],
    toggleSelectedOutcome: vi.fn(),
    learningEnvironments: [],
    toggleLearningEnvironment: vi.fn(),
    lessonSeries: { seriesId: null, planningMode: 'single' },
    setLessonSeriesField: vi.fn(),
    lessonBreakdown: [],
    setLessonBreakdown: vi.fn(),
    formatOptions: { detail: 'standard', writingStyle: 'standard', format: 'modern', advanced: {} },
    setFormatOption: vi.fn(),
    setAdvancedOption: vi.fn(),
    generationStatus: 'idle',
    ...overrides,
  }
}

function renderSidebar(studioOverrides = {}, extraProps = {}) {
  const props = {
    studioState: makeStudioState(studioOverrides),
    aiState: { recommendation: null, loading: false, error: null, fetchRecommendation: vi.fn() },
    seriesState: { completedCount: 0, completedLessons: [], seriesLoading: false },
    onGenerate: vi.fn(),
    isValid: false,
    ...extraProps,
  }
  return { ...render(<StudioSidebar {...props} />), props }
}

const visibleStep = (testId) => !screen.getByTestId(testId).closest('[hidden]')

beforeEach(() => {
  sessionStorage.clear()
})

// ── Step list model ───────────────────────────────────────────────────────────

describe('studioSteps', () => {
  it('CBC gets all 7 steps ending in Review & Generate', () => {
    const steps = studioSteps('cbc')
    expect(steps.map((s) => s.id)).toEqual([
      'curriculum', 'details', 'topic', 'outcomes', 'progression', 'format', 'review',
    ])
    expect(steps.at(-1).label).toBe('Review & Generate')
  })

  it('Previous curriculum drops the CBC-only Progression step and renames Outcomes', () => {
    const steps = studioSteps('previous')
    expect(steps.map((s) => s.id)).not.toContain('progression')
    expect(steps.find((s) => s.id === 'outcomes').label).toBe('Learning Outcomes')
  })
})

// ── One step at a time ────────────────────────────────────────────────────────

describe('StudioSidebar — progressive steps', () => {
  it('shows only the Curriculum step at first; later sections stay mounted but hidden', () => {
    renderSidebar()
    expect(visibleStep('curriculum-picker')).toBe(true)
    // Mounted (state survives) but hidden (not one long page).
    expect(screen.getByTestId('lesson-details-form')).toBeInTheDocument()
    expect(visibleStep('lesson-details-form')).toBe(false)
    expect(visibleStep('format-options-form')).toBe(false)
  })

  it('Next advances one step; Previous returns; sections stay mounted throughout', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /next: lesson details/i }))
    expect(visibleStep('lesson-details-form')).toBe(true)
    expect(visibleStep('curriculum-picker')).toBe(false)
    // The hidden step's DOM (and therefore its state) is still there.
    expect(screen.getByTestId('curriculum-picker')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /previous/i }))
    expect(visibleStep('curriculum-picker')).toBe(true)
  })

  it('step chips jump directly and mark the current step with aria-current', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /step 6: format & options/i }))
    expect(visibleStep('format-options-form')).toBe(true)
    expect(screen.getByRole('button', { name: /step 6/i })).toHaveAttribute('aria-current', 'step')
    expect(screen.getByRole('button', { name: /step 1/i })).not.toHaveAttribute('aria-current')
  })

  it('Previous is disabled on the first step', () => {
    renderSidebar()
    expect(screen.getByRole('button', { name: /previous/i })).toBeDisabled()
  })

  it('the Review step shows the summary and the last step has no Next control', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /step 7: review & generate/i }))
    expect(screen.getByText('Review your lesson')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^next:/i })).not.toBeInTheDocument()
  })

  it('the current step survives an unmount/remount (navigation away and back)', () => {
    const { unmount } = renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: /step 3: topic & subtopic/i }))
    unmount()
    renderSidebar()
    expect(visibleStep('topic-subtopic-form')).toBe(true)
  })

  it('a stored CBC-only step falls back safely when the Previous curriculum removes it', () => {
    sessionStorage.setItem('zedexams:lesson-plan-studio-step', 'progression')
    renderSidebar({ curriculumMode: 'previous' })
    // Clamped to the first step instead of pointing at a step that no longer exists.
    expect(visibleStep('curriculum-picker')).toBe(true)
  })

  it('the Generate button stays visible and wired on every step', () => {
    const { props } = renderSidebar({}, { isValid: true })
    const generate = () => screen.getByRole('button', { name: /generate lesson plan/i })
    expect(generate()).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /step 4/i }))
    expect(generate()).toBeInTheDocument()
    fireEvent.click(generate())
    expect(props.onGenerate).toHaveBeenCalledTimes(1)
  })

  it('Save draft calls onSaveDraft when provided (and is absent otherwise)', () => {
    const onSaveDraft = vi.fn()
    renderSidebar({}, { onSaveDraft })
    fireEvent.click(screen.getByRole('button', { name: /save draft/i }))
    expect(onSaveDraft).toHaveBeenCalledTimes(1)
  })

  it('does not render Save draft without an onSaveDraft handler', () => {
    renderSidebar()
    expect(screen.queryByRole('button', { name: /save draft/i })).not.toBeInTheDocument()
  })
})
