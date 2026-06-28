import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { useState } from 'react'
import LessonPlanStudio from './LessonPlanStudio'

// ── Firebase mocks ────────────────────────────────────────────────────────────
// vi.hoisted() runs before vi.mock() hoisting so innerCallable is defined
// when the factory closure captures it. The component calls httpsCallable()
// at module scope; returning this stable spy means tests can configure its
// behaviour with innerCallable.mockResolvedValue(…) etc.
const { innerCallable, mockUseStudioState, mockSetDoc } = vi.hoisted(() => ({
  innerCallable: vi.fn(),
  mockUseStudioState: vi.fn(),
  mockSetDoc: vi.fn(() => Promise.resolve()),
}))

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => innerCallable),
}))

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({})),
  setDoc: mockSetDoc,
  serverTimestamp: vi.fn(() => 'SERVER_TIMESTAMP'),
}))

vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(() => vi.fn()),
}))

vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ currentUser: { uid: 'test-uid-123' } })),
}))

vi.mock('./hooks/useLessonSeries', () => ({
  useLessonSeries: vi.fn(() => ({
    completedCount: 0,
    completedLessons: [],
    seriesLoading: false,
    seriesError: null,
  })),
}))

vi.mock('../../../firebase/config', () => ({ default: {}, db: {} }))

// ── Child component mocks ─────────────────────────────────────────────────────

vi.mock('./StudioShell', () => ({
  StudioShell: ({ sidebar, canvas }) => (
    <div data-testid="studio-shell">
      <div data-testid="shell-sidebar">{sidebar}</div>
      <div data-testid="shell-canvas">{canvas}</div>
    </div>
  ),
}))

vi.mock('./StudioSidebar', () => ({
  StudioSidebar: ({ studioState, isValid, onGenerate, onContinue, onViewCompleted, aiState, seriesState }) => (
    <div data-testid="studio-sidebar">
      <span data-testid="is-valid">{String(isValid)}</span>
      <span data-testid="curriculum-mode">{studioState.curriculumMode ?? 'null'}</span>
      <span data-testid="generation-status">{studioState.generationStatus}</span>
      <span data-testid="ai-loading">{String(aiState.loading)}</span>
      <span data-testid="series-completed">{seriesState.completedCount}</span>
      <button data-testid="trigger-generate" onClick={() => onGenerate(0)}>
        Generate
      </button>
      <button data-testid="trigger-continue" onClick={onContinue}>
        Continue
      </button>
      <button data-testid="trigger-view-completed" onClick={onViewCompleted}>
        View Completed
      </button>
    </div>
  ),
}))

vi.mock('./StudioCanvas', () => ({
  StudioCanvas: ({ generatedPlan, generationStatus, generationError }) => (
    <div data-testid="studio-canvas">
      <span data-testid="canvas-status">{generationStatus}</span>
      <span data-testid="canvas-plan">{generatedPlan ?? ''}</span>
      <span data-testid="canvas-error">{generationError ?? ''}</span>
    </div>
  ),
}))

vi.mock('./hooks/useAILessonCount', () => ({
  useAILessonCount: vi.fn(() => ({
    recommendation: null,
    loading: false,
    error: null,
    fetchRecommendation: vi.fn(),
  })),
}))

// Default stub for useStudioState — individual tests override via mockUseStudioState.mockReturnValueOnce()
vi.mock('./hooks/useStudioState', () => ({
  useStudioState: () => mockUseStudioState(),
}))

vi.mock('./utils/renderPlanHtml', () => ({
  renderPlanHtml: vi.fn(() => '<p>rendered plan</p>'),
}))

// Auto-illustration: the default studioState below has illustrations:
// 'automatic', so handleGenerate calls generateDiagram in the background.
// Mock it to resolve a stable URL so the generate-flow tests stay deterministic.
const { mockGenerateDiagram } = vi.hoisted(() => ({
  mockGenerateDiagram: vi.fn(() => Promise.resolve({ url: 'https://img.test/x.png' })),
}))
vi.mock('../../../utils/generateDiagram', () => ({
  generateDiagram: mockGenerateDiagram,
}))

vi.mock('./utils/studioSystemPrompt', () => ({
  STUDIO_SYSTEM_PROMPT_CBC: 'MOCK_CBC_PROMPT',
  STUDIO_SYSTEM_PROMPT_PREVIOUS: 'MOCK_PREVIOUS_PROMPT',
  STUDIO_SYSTEM_PROMPT: 'MOCK_CBC_PROMPT',
}))

// ── Default studioState stub ──────────────────────────────────────────────────
// Returns the static (non-reactive) parts of studioState. The generation-
// status fields need real React state so handleGenerate's setGenerationStatus /
// setGeneratedPlan calls actually trigger re-renders. Use makeStudioState() for
// tests that don't exercise the generate flow, and renderStudioWithGeneration()
// for tests that do.

function makeStudioState(overrides = {}) {
  return {
    curriculumMode: null,
    setCurriculumMode: vi.fn(),
    lessonDetails: {
      grade: '', subject: '', duration: '40', medium: 'English',
      term: '', week: '', date: '', time: '', teacherName: '', school: '',
    },
    setLessonDetails: vi.fn(),
    updateLessonDetail: vi.fn(),
    setLessonDetail: vi.fn(),
    resetTopicData: vi.fn(),
    topicData: { topic: '', subtopic: '', subtopicRow: null },
    updateTopic: vi.fn(),
    updateSubtopic: vi.fn(),
    setTopicField: vi.fn(),
    selectedOutcomes: [],
    setSelectedOutcomes: vi.fn(),
    toggleSelectedOutcome: vi.fn(),
    learningEnvironments: [],
    toggleLearningEnvironment: vi.fn(),
    lessonSeries: {
      seriesId: null, planningMode: 'single', totalLessons: 1,
      lessonNumber: 1, lessonFocus: '', aiSuggestedReason: '',
    },
    setLessonSeries: vi.fn(),
    setLessonSeriesField: vi.fn(),
    lessonBreakdown: [],
    setLessonBreakdown: vi.fn(),
    formatOptions: {
      detail: 'standard', writingStyle: 'standard', format: 'modern',
      illustrations: 'automatic',
      advanced: {
        compactMetadata: true, includeEnrolment: false, includeAttendance: false,
        includeLessonEvaluation: true, includeKeyVocabulary: true,
        autoIllustrations: false, localLanguage: false,
      },
    },
    updateFormatOption: vi.fn(),
    setFormatOption: vi.fn(),
    setAdvancedOption: vi.fn(),
    // Static generation state — tests that exercise the generate flow must use
    // renderStudioWithGeneration() so these fields are backed by real useState.
    generationStatus: 'idle',
    setGenerationStatus: vi.fn(),
    generatedPlan: null,
    setGeneratedPlan: vi.fn(),
    ...overrides,
  }
}

// Wrapper that gives handleGenerate real React state for generationStatus /
// generatedPlan so its setters actually trigger re-renders.
function StudioStateWrapper({ stateOverrides = {} }) {
  const [generationStatus, setGenerationStatus] = useState('idle')
  const [generatedPlan, setGeneratedPlan] = useState(null)

  mockUseStudioState.mockReturnValue(
    makeStudioState({
      ...stateOverrides,
      generationStatus,
      setGenerationStatus,
      generatedPlan,
      setGeneratedPlan,
    }),
  )
  return <LessonPlanStudio />
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderStudio(stateOverrides = {}) {
  mockUseStudioState.mockReturnValue(makeStudioState(stateOverrides))
  return render(<LessonPlanStudio />)
}

function renderStudioWithGeneration(stateOverrides = {}) {
  return render(<StudioStateWrapper stateOverrides={stateOverrides} />)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('LessonPlanStudio — rendering', () => {
  it('renders the StudioShell', () => {
    renderStudio()
    expect(screen.getByTestId('studio-shell')).toBeInTheDocument()
  })

  it('renders StudioSidebar inside the shell', () => {
    renderStudio()
    expect(screen.getByTestId('studio-sidebar')).toBeInTheDocument()
  })

  it('renders StudioCanvas inside the shell', () => {
    renderStudio()
    expect(screen.getByTestId('studio-canvas')).toBeInTheDocument()
  })

  it('passes generationStatus "idle" to canvas on mount', () => {
    renderStudio()
    expect(screen.getByTestId('canvas-status')).toHaveTextContent('idle')
  })

  it('passes null generationError to canvas on mount', () => {
    renderStudio()
    expect(screen.getByTestId('canvas-error')).toHaveTextContent('')
  })
})

describe('LessonPlanStudio — isValid', () => {
  it('passes isValid=false when no fields are filled', () => {
    renderStudio()
    expect(screen.getByTestId('is-valid')).toHaveTextContent('false')
  })

  it('passes curriculumMode null on mount', () => {
    renderStudio()
    expect(screen.getByTestId('curriculum-mode')).toHaveTextContent('null')
  })
})

describe('LessonPlanStudio — seriesState stub', () => {
  it('passes completedCount=0 to sidebar', () => {
    renderStudio()
    expect(screen.getByTestId('series-completed')).toHaveTextContent('0')
  })
})

describe('LessonPlanStudio — aiState', () => {
  it('passes aiState.loading=false from useAILessonCount on mount', () => {
    renderStudio()
    expect(screen.getByTestId('ai-loading')).toHaveTextContent('false')
  })
})

describe('LessonPlanStudio — generate flow (error path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets generationStatus to "error" and shows the error message when the callable throws', async () => {
    innerCallable.mockRejectedValue(new Error('Network timeout'))

    renderStudioWithGeneration()
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('canvas-status')).toHaveTextContent('error')
    })
    expect(screen.getByTestId('canvas-error')).toHaveTextContent('Network timeout')
  })
})

describe('LessonPlanStudio — generate flow (success path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sets generationStatus to "done" and passes rendered HTML to canvas', async () => {
    const { renderPlanHtml } = await import('./utils/renderPlanHtml')

    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })
    renderPlanHtml.mockReturnValue('<p>rendered plan</p>')

    renderStudioWithGeneration()
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('canvas-status')).toHaveTextContent('done')
    })
    expect(screen.getByTestId('canvas-plan')).toHaveTextContent('rendered plan')
  })

  it('sets generationStatus to "loading" immediately after clicking generate', async () => {
    // Never resolves so we can observe the transient loading state
    innerCallable.mockReturnValue(new Promise(() => {}))

    renderStudioWithGeneration()
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('canvas-status')).toHaveTextContent('loading')
    })
  })
})

describe('LessonPlanStudio — auto-illustration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls generateDiagram after a successful generation when illustrations are automatic', async () => {
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Photosynthesis","stages":[]}' },
    })

    renderStudioWithGeneration({
      curriculumMode: 'cbc',
      topicData: { topic: 'Photosynthesis', subtopic: 'Light reactions', subtopicRow: null },
      lessonDetails: {
        grade: 'G5', subject: 'Science', duration: '40', medium: 'English',
        term: '', week: '', date: '', time: '', teacherName: '', school: '',
      },
    })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('canvas-status')).toHaveTextContent('done')
    })
    await waitFor(() => {
      expect(mockGenerateDiagram).toHaveBeenCalledTimes(1)
    })
    // The diagram prompt is derived from the lesson topic/subtopic.
    expect(mockGenerateDiagram.mock.calls[0][0].prompt).toMatch(/Photosynthesis/)
  })

  it('does NOT call generateDiagram when illustrations is "none"', async () => {
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })

    renderStudioWithGeneration({
      curriculumMode: 'cbc',
      topicData: { topic: 'Test', subtopic: 'Sub', subtopicRow: null },
      formatOptions: {
        detail: 'standard', writingStyle: 'standard', format: 'modern',
        illustrations: 'none',
        advanced: {
          compactMetadata: true, includeEnrolment: false, includeAttendance: false,
          includeLessonEvaluation: true, includeKeyVocabulary: true,
          autoIllustrations: false, localLanguage: false,
        },
      },
    })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('canvas-status')).toHaveTextContent('done')
    })
    expect(mockGenerateDiagram).not.toHaveBeenCalled()
  })
})

describe('LessonPlanStudio — CurriculumContext', () => {
  it('renders without crashing (context provider is mounted)', () => {
    expect(() => renderStudio()).not.toThrow()
  })
})

// ── Curriculum-aware system prompt selection ──────────────────────────────────

describe('LessonPlanStudio — system prompt selection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes STUDIO_SYSTEM_PROMPT_CBC when curriculumMode is "cbc"', async () => {
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })

    renderStudioWithGeneration({ curriculumMode: 'cbc' })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(innerCallable).toHaveBeenCalled()
    })
    const callArg = innerCallable.mock.calls[0][0]
    expect(callArg.systemPrompt).toBe('MOCK_CBC_PROMPT')
  })

  it('passes STUDIO_SYSTEM_PROMPT_PREVIOUS when curriculumMode is "previous"', async () => {
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })

    renderStudioWithGeneration({
      curriculumMode: 'previous',
      selectedOutcomes: ['Identify parts of a plant.'],
    })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(innerCallable).toHaveBeenCalled()
    })
    const callArg = innerCallable.mock.calls[0][0]
    expect(callArg.systemPrompt).toBe('MOCK_PREVIOUS_PROMPT')
  })

  it('defaults to STUDIO_SYSTEM_PROMPT_CBC when curriculumMode is null', async () => {
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })

    renderStudioWithGeneration({ curriculumMode: null })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(innerCallable).toHaveBeenCalled()
    })
    const callArg = innerCallable.mock.calls[0][0]
    expect(callArg.systemPrompt).toBe('MOCK_CBC_PROMPT')
  })
})

// ── CBC user prompt includes <cbc_context> ────────────────────────────────────

describe('LessonPlanStudio — CBC user prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes <cbc_context> block in the user prompt when subtopicRow has data', async () => {
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })

    renderStudioWithGeneration({
      curriculumMode: 'cbc',
      topicData: {
        topic: 'The Environment',
        subtopic: 'Environmental Management',
        subtopicRow: {
          specificCompetence: '4.3.1.1 Manage natural resources',
          learningActivities: ['Sort litter', 'Observe a pond'],
          expectedStandard: 'Natural resources managed correctly.',
        },
      },
    })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(innerCallable).toHaveBeenCalled()
    })
    const { userPrompt } = innerCallable.mock.calls[0][0]
    expect(userPrompt).toContain('<cbc_context>')
    expect(userPrompt).toContain('4.3.1.1 Manage natural resources')
    expect(userPrompt).toContain('Sort litter | Observe a pond')
    expect(userPrompt).toContain('Natural resources managed correctly.')
    expect(userPrompt).toContain('</cbc_context>')
  })

  it('does not include <previous_context> in CBC mode', async () => {
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })

    renderStudioWithGeneration({
      curriculumMode: 'cbc',
      topicData: {
        topic: 'The Environment',
        subtopic: 'Environmental Management',
        subtopicRow: {
          specificCompetence: '4.3.1.1 Manage natural resources',
          learningActivities: [],
          expectedStandard: '',
        },
      },
    })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(innerCallable).toHaveBeenCalled()
    })
    const { userPrompt } = innerCallable.mock.calls[0][0]
    expect(userPrompt).not.toContain('<previous_context>')
  })
})

// ── Previous Curriculum user prompt includes <previous_context> ───────────────

describe('LessonPlanStudio — Previous Curriculum user prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('includes <previous_context> block with numbered outcomes', async () => {
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })

    renderStudioWithGeneration({
      curriculumMode: 'previous',
      selectedOutcomes: ['Name three types of soil.', 'Describe how soil is formed.'],
    })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(innerCallable).toHaveBeenCalled()
    })
    const { userPrompt } = innerCallable.mock.calls[0][0]
    expect(userPrompt).toContain('<previous_context>')
    expect(userPrompt).toContain('1. Name three types of soil.')
    expect(userPrompt).toContain('2. Describe how soil is formed.')
    expect(userPrompt).toContain('</previous_context>')
  })

  it('does not include <cbc_context> in previous mode', async () => {
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })

    renderStudioWithGeneration({
      curriculumMode: 'previous',
      selectedOutcomes: ['Name three types of soil.'],
    })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(innerCallable).toHaveBeenCalled()
    })
    const { userPrompt } = innerCallable.mock.calls[0][0]
    expect(userPrompt).not.toContain('<cbc_context>')
  })
})

// ── Task 15: useLessonSeries wiring ──────────────────────────────────────────

describe('LessonPlanStudio — useLessonSeries wiring', () => {
  it('calls useLessonSeries with uid from useAuth and seriesId from studioState', async () => {
    const { useLessonSeries } = await import('./hooks/useLessonSeries')
    const { useAuth } = await import('../../../contexts/AuthContext')
    useAuth.mockReturnValue({ currentUser: { uid: 'user-abc' } })

    renderStudio({
      lessonSeries: { seriesId: 'series-xyz', planningMode: 'single', totalLessons: 1 },
    })

    expect(useLessonSeries).toHaveBeenCalledWith('user-abc', 'series-xyz')
  })

  it('calls useLessonSeries with null uid when not signed in', async () => {
    const { useLessonSeries } = await import('./hooks/useLessonSeries')
    const { useAuth } = await import('../../../contexts/AuthContext')
    useAuth.mockReturnValue({ currentUser: null })

    renderStudio()

    expect(useLessonSeries).toHaveBeenCalledWith(null, null)
  })
})

// ── Task 15: Firestore series writes on successful generation ─────────────────

describe('LessonPlanStudio — Firestore series writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSetDoc.mockResolvedValue(undefined)
  })

  it('writes series root doc and lesson doc to Firestore after successful series generation', async () => {
    const { renderPlanHtml } = await import('./utils/renderPlanHtml')
    const { useAuth } = await import('../../../contexts/AuthContext')
    useAuth.mockReturnValue({ currentUser: { uid: 'uid-writer' } })

    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })
    renderPlanHtml.mockReturnValue('<p>plan</p>')

    renderStudioWithGeneration({
      curriculumMode: 'cbc',
      lessonSeries: { seriesId: 'series-001', planningMode: 'series', totalLessons: 3 },
      lessonBreakdown: [
        { lessonNumber: 1, focus: 'Intro', coveredContent: [] },
        { lessonNumber: 2, focus: 'Dev', coveredContent: [] },
      ],
      lessonDetails: { grade: 'Grade 4', subject: 'Science', duration: '40', medium: 'English', term: '', week: '', date: '', time: '', teacherName: '', school: '' },
      topicData: { topic: 'Environment', subtopic: 'Resources', subtopicRow: null },
    })

    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalledTimes(1)
    })

    // Only call: lesson progress doc at lessonSeries/{uid}/{seriesId}/{lessonNumber}
    const [, lessonData] = mockSetDoc.mock.calls[0]
    expect(lessonData).toMatchObject({ lessonNumber: 1, status: 'completed' })
  })

  it('keeps the generated plan (status "done") when the series progress write is denied', async () => {
    const { renderPlanHtml } = await import('./utils/renderPlanHtml')
    const { useAuth } = await import('../../../contexts/AuthContext')
    useAuth.mockReturnValue({ currentUser: { uid: 'uid-writer' } })

    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })
    renderPlanHtml.mockReturnValue('<p>plan</p>')
    // Simulate a Firestore PERMISSION_DENIED on the progress write.
    mockSetDoc.mockRejectedValueOnce(new Error('Missing or insufficient permissions.'))

    renderStudioWithGeneration({
      curriculumMode: 'cbc',
      lessonSeries: { seriesId: 'series-001', planningMode: 'series', totalLessons: 3 },
      lessonBreakdown: [{ lessonNumber: 1, focus: 'Intro', coveredContent: [] }],
      lessonDetails: { grade: 'Grade 4', subject: 'Science', duration: '40', medium: 'English', term: '', week: '', date: '', time: '', teacherName: '', school: '' },
      topicData: { topic: 'Environment', subtopic: 'Resources', subtopicRow: null },
    })

    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(mockSetDoc).toHaveBeenCalledTimes(1)
    })
    // The write failed, but the canvas must stay on the rendered plan, not flip
    // to the error state and hide it.
    expect(screen.getByTestId('canvas-status')).toHaveTextContent('done')
    expect(screen.getByTestId('canvas-error')).toHaveTextContent('')
  })

  it('does NOT write to Firestore when planningMode is "single"', async () => {
    const { renderPlanHtml } = await import('./utils/renderPlanHtml')
    renderPlanHtml.mockReturnValue('<p>plan</p>')
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })

    renderStudioWithGeneration({
      lessonSeries: { seriesId: null, planningMode: 'single', totalLessons: 1 },
    })

    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('canvas-status')).toHaveTextContent('done')
    })

    expect(mockSetDoc).not.toHaveBeenCalled()
  })
})

// ── Task 15: handleContinue ───────────────────────────────────────────────────

describe('LessonPlanStudio — handleContinue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls handleGenerate with the index of the first non-completed lesson', async () => {
    const { useLessonSeries } = await import('./hooks/useLessonSeries')
    // Lessons 1 and 2 completed; lesson 3 is next (index 2 in breakdown)
    useLessonSeries.mockReturnValue({
      completedCount: 2,
      completedLessons: ['1', '2'],
      seriesLoading: false,
      seriesError: null,
    })

    innerCallable.mockReturnValue(new Promise(() => {})) // never resolves

    renderStudioWithGeneration({
      curriculumMode: 'cbc',
      lessonSeries: { seriesId: 'series-abc', planningMode: 'series', totalLessons: 3 },
      lessonBreakdown: [
        { lessonNumber: 1, focus: 'A', coveredContent: [] },
        { lessonNumber: 2, focus: 'B', coveredContent: [] },
        { lessonNumber: 3, focus: 'C', coveredContent: [] },
      ],
    })

    fireEvent.click(screen.getByTestId('trigger-continue'))

    await waitFor(() => {
      expect(screen.getByTestId('canvas-status')).toHaveTextContent('loading')
    })

    // handleGenerate was invoked (status flipped to loading)
    expect(innerCallable).toHaveBeenCalledTimes(1)
  })
})

// ── Task 15: handleViewCompleted ─────────────────────────────────────────────

describe('LessonPlanStudio — handleViewCompleted', () => {
  it('navigates to /teacher/library when View Completed is clicked', async () => {
    const mockNavigate = vi.fn()
    const routerMod = await import('react-router-dom')
    vi.mocked(routerMod.useNavigate).mockReturnValue(mockNavigate)

    renderStudio()
    fireEvent.click(screen.getByTestId('trigger-view-completed'))

    expect(mockNavigate).toHaveBeenCalledWith('/teacher/library')
  })
})

// ── Control wiring audit: single lesson focus, local language ─────────────────

describe('LessonPlanStudio — single-lesson focus wiring', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('includes the single-lesson Lesson Focus in the user prompt', async () => {
    innerCallable.mockResolvedValue({ data: { text: '{"topic":"T","stages":[]}' } })

    renderStudioWithGeneration({
      curriculumMode: 'cbc',
      topicData: { topic: 'Water', subtopic: 'Rivers', subtopicRow: null },
      lessonSeries: {
        seriesId: null, planningMode: 'single', totalLessons: 1,
        lessonNumber: 1, lessonFocus: 'Identifying local rivers', aiSuggestedReason: '',
      },
    })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => expect(innerCallable).toHaveBeenCalled())
    const { userPrompt } = innerCallable.mock.calls[0][0]
    expect(userPrompt).toContain('Focus for THIS lesson: Identifying local rivers')
  })
})

describe('LessonPlanStudio — local language wiring', () => {
  beforeEach(() => { vi.clearAllMocks() })

  function withLocalLanguage(medium, localLanguage) {
    return {
      curriculumMode: 'cbc',
      topicData: { topic: 'Water', subtopic: 'Rivers', subtopicRow: null },
      lessonDetails: {
        grade: 'G5', subject: 'Science', duration: '40', medium,
        term: '', week: '', date: '', time: '', teacherName: '', school: '',
      },
      formatOptions: {
        detail: 'standard', writingStyle: 'standard', format: 'modern', illustrations: 'none',
        advanced: {
          compactMetadata: true, includeEnrolment: false, includeAttendance: false,
          includeLessonEvaluation: true, includeKeyVocabulary: true,
          autoIllustrations: false, localLanguage,
        },
      },
    }
  }

  it('adds a local-language directive when the toggle is on and medium is a local language', async () => {
    innerCallable.mockResolvedValue({ data: { text: '{"topic":"T","stages":[]}' } })
    renderStudioWithGeneration(withLocalLanguage('Bemba', true))
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => expect(innerCallable).toHaveBeenCalled())
    const { userPrompt } = innerCallable.mock.calls[0][0]
    expect(userPrompt).toMatch(/Write the lesson plan content .* in Bemba/)
  })

  it('does NOT add the directive when the toggle is off', async () => {
    innerCallable.mockResolvedValue({ data: { text: '{"topic":"T","stages":[]}' } })
    renderStudioWithGeneration(withLocalLanguage('Bemba', false))
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => expect(innerCallable).toHaveBeenCalled())
    const { userPrompt } = innerCallable.mock.calls[0][0]
    expect(userPrompt).not.toMatch(/Write the lesson plan content .* in Bemba/)
  })

  it('does NOT add the directive when medium is English even if toggle is on', async () => {
    innerCallable.mockResolvedValue({ data: { text: '{"topic":"T","stages":[]}' } })
    renderStudioWithGeneration(withLocalLanguage('English', true))
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => expect(innerCallable).toHaveBeenCalled())
    const { userPrompt } = innerCallable.mock.calls[0][0]
    expect(userPrompt).not.toMatch(/local language of instruction/)
  })
})
