import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { StrictMode, useState } from 'react'
import LessonPlanStudio from './LessonPlanStudio'
import { LIBRARY_TYPES } from '../../../config/library'
import { useTeacherPlanContext } from './hooks/useTeacherPlanContext'

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
  // New-plan route by default; the edit-mode tests override this.
  useParams: vi.fn(() => ({})),
  Link: ({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>,
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

// "This week's lesson" weekly-forecast suggestion. Defaults to none (matching
// the real hook's fail-closed behaviour in tests); the applied-context tests
// below override it per test.
vi.mock('./hooks/useTeacherPlanContext', () => ({
  useTeacherPlanContext: vi.fn(() => ({ loading: false, suggestion: null })),
}))

vi.mock('../../../firebase/config', () => ({ default: {}, db: {} }))

// The AI idempotency lock is mocked to a deterministic passthrough: it runs the
// action with a fixed key and returns {ok, data} (or {ok:false, error} on a
// throw), exactly the pre-lock behaviour these studio tests were written
// against. The REAL hook holds a module-level lock per lockKey that persists
// across tests in this file — a test that leaves the callable pending (the
// 'loading'/'error' cases) would never release it, and every later generate
// would come back 'locked' and hang at 'loading'. The lock's own behaviour is
// covered by useAiOperationLock.spec.jsx + the SBA/Homework/Notes studio specs;
// here we test the studio's handling of the generate result.
vi.mock('../../../hooks/useAiOperationLock', () => ({
  useAiOperationLock: () => ({
    run: async ({ action }) => {
      try {
        return { ok: true, data: await action('11111111-1111-4111-8111-111111111111') }
      } catch (error) {
        return { ok: false, reason: 'error', error }
      }
    },
    isRunning: false,
    otherTabRunning: false,
    clear: () => {},
  }),
}))

// The quota pre-flight gate (which internally subscribes to the usage meter via
// Firestore onSnapshot). Mocked to "allowed" so generation tests aren't blocked
// and the firebase/firestore mock stays minimal. A dedicated test below
// overrides this to assert the paywall path.
vi.mock('../../../hooks/useGenerationGate', () => ({
  useGenerationGate: vi.fn(() => ({ ensureCanGenerate: vi.fn(() => true), usage: null })),
}))

// Persistent lesson memory — mocked so its Firestore writes don't flow through
// the shared `mockSetDoc` (the series-write tests assert exact setDoc counts)
// and the live subscription stays inert. Dedicated tests for the memory layer
// live in scripts/test-lesson-memory.mjs + SubtopicLessonsPanel.spec.jsx.
vi.mock('../../../utils/lessonMemoryService', () => ({
  saveLessonPlanMemory: vi.fn(() => Promise.resolve('mem-id')),
  setLessonTeachingStatus: vi.fn(() => Promise.resolve(true)),
  attachGenerationToMemory: vi.fn(() => Promise.resolve(true)),
  touchLessonProgress: vi.fn(() => Promise.resolve('prog-id')),
}))
vi.mock('./hooks/useLessonMemory', () => ({
  useLessonMemory: vi.fn(() => ({ plans: [], loading: false, error: null })),
}))

// ── Child component mocks ─────────────────────────────────────────────────────

vi.mock('./StudioShell', () => ({
  StudioShell: ({ sidebar, canvas }) => (
    <div data-testid="studio-shell">
      <div data-testid="shell-sidebar">{sidebar}</div>
      <div data-testid="shell-canvas">{canvas}</div>
    </div>
  ),
}))

vi.mock('./wizard/LessonPlanWizard', () => ({
  LessonPlanWizard: ({ studioState, isValid, onGenerate, onContinue, onViewCompleted, aiState, seriesState, appliedContext, appliedWeekNumber }) => (
    <div data-testid="studio-sidebar">
      <span data-testid="is-valid">{String(isValid)}</span>
      <span data-testid="curriculum-mode">{studioState.curriculumMode ?? 'null'}</span>
      <span data-testid="generation-status">{studioState.generationStatus}</span>
      <span data-testid="ai-loading">{String(aiState.loading)}</span>
      <span data-testid="series-completed">{seriesState.completedCount}</span>
      <span data-testid="applied-context">{String(appliedContext)}</span>
      <span data-testid="applied-week">{String(appliedWeekNumber ?? '')}</span>
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

// The real default format options, so the stub cannot drift from the studio's
// own shape — a hand-written literal here is how these specs kept passing while
// the studio read fields the stub never had.
const { initialFormatOptions } = await import('../../../utils/lessonPlanFormat.js')

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

// Auto-save: a successful generation persists the plan to the library via
// saveLessonPlanGeneration. Mock it so the studio's auto-save resolves (and so
// we can assert it ran) instead of hitting the real Firestore writer.
const { mockSaveLessonPlanGeneration, mockGetGeneration } = vi.hoisted(() => ({
  mockSaveLessonPlanGeneration: vi.fn(() => Promise.resolve('gen-id-123')),
  // Edit mode (/teacher/lesson-plans/:id/edit) fetches the saved generation;
  // resolves null by default (no edit id → never called).
  mockGetGeneration: vi.fn(() => Promise.resolve(null)),
}))
vi.mock('../../../utils/teacherLibraryService', () => ({
  saveLessonPlanGeneration: mockSaveLessonPlanGeneration,
  getGeneration: mockGetGeneration,
}))

vi.mock('./utils/studioSystemPrompt', () => ({
  STUDIO_SYSTEM_PROMPT_CBC: 'MOCK_CBC_PROMPT',
  STUDIO_SYSTEM_PROMPT_PREVIOUS: 'MOCK_PREVIOUS_PROMPT',
  STUDIO_SYSTEM_PROMPT: 'MOCK_CBC_PROMPT',
}))

// School profile (resource level for the Teacher Settings seed) — resolves
// null by default so the identity prefill behaves as before; the settings-
// seeding tests override the resolved value.
vi.mock('../../../utils/schoolProfileService', () => ({
  getSchoolProfile: vi.fn(() => Promise.resolve(null)),
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
    formatOptions: { ...initialFormatOptions('2'), illustrations: 'automatic' },
    updateFormatOption: vi.fn(),
    setFormatOption: vi.fn(),
    setAdvancedOption: vi.fn(),
    setSectionOption: vi.fn(),
    setFormatOptions: vi.fn(),
    // Static generation state — tests that exercise the generate flow must use
    // renderStudioWithGeneration() so these fields are backed by real useState.
    generationStatus: 'idle',
    setGenerationStatus: vi.fn(),
    generatedPlan: null,
    setGeneratedPlan: vi.fn(),
    wizardStep: 0,
    setWizardStep: vi.fn(),
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

describe('LessonPlanStudio — "Set up for you" applied-context flag', () => {
  const SUGGESTION = {
    grade: 'Grade 4',
    subject: 'Grade4 Math',
    subjectLabel: 'Grade4 Math',
    topic: '',
    subtopic: '',
    date: '2026-08-04',
    weekNumber: 11,
  }

  afterEach(() => {
    useTeacherPlanContext.mockImplementation(() => ({ loading: false, suggestion: null }))
  })

  it('flags appliedContext (with the week) once the suggestion actually seeds fields', async () => {
    useTeacherPlanContext.mockImplementation(() => ({ loading: false, suggestion: SUGGESTION }))
    renderStudio()
    await waitFor(() => expect(screen.getByTestId('applied-context')).toHaveTextContent('true'))
    expect(screen.getByTestId('applied-week')).toHaveTextContent('11')
  })

  it('stays false without a suggestion', () => {
    renderStudio()
    expect(screen.getByTestId('applied-context')).toHaveTextContent('false')
    expect(screen.getByTestId('applied-week')).toHaveTextContent('')
  })

  it('stays false for a Previous-curriculum teacher (the suggestion is refused, not deferred)', () => {
    useTeacherPlanContext.mockImplementation(() => ({ loading: false, suggestion: SUGGESTION }))
    renderStudio({ curriculumMode: 'previous' })
    expect(screen.getByTestId('applied-context')).toHaveTextContent('false')
    expect(screen.getByTestId('applied-week')).toHaveTextContent('')
  })

  it('stays false when every field is already filled — nothing was actually seeded', () => {
    useTeacherPlanContext.mockImplementation(() => ({ loading: false, suggestion: SUGGESTION }))
    renderStudio({
      curriculumMode: 'cbc',
      lessonDetails: {
        grade: 'Grade 3', subject: 'Grade3 Math', duration: '40', medium: 'English',
        term: '', week: '', date: '2026-08-03', time: '', teacherName: '', school: '',
      },
      topicData: { topic: '3.1 Shapes', subtopic: '3.1.1 Circles', subtopicRow: null },
    })
    expect(screen.getByTestId('applied-context')).toHaveTextContent('false')
  })
})

describe('LessonPlanStudio — mount stability (render-loop regression)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('mounts without throwing "Maximum update depth exceeded"', () => {
    // The production crash surfaced as a render loop on mount. A clean mount is
    // the regression assertion — a loop throws here.
    expect(() => renderStudio()).not.toThrow()
    expect(screen.getByTestId('studio-shell')).toBeInTheDocument()
  })

  it('mounts cleanly under React.StrictMode (double-invoked effects)', async () => {
    mockUseStudioState.mockReturnValue(makeStudioState())
    let renderResult
    expect(() => {
      renderResult = render(
        <StrictMode>
          <LessonPlanStudio />
        </StrictMode>,
      )
    }).not.toThrow()
    // Let effects/microtasks settle; a self-perpetuating effect would blow up here.
    await act(async () => { await Promise.resolve() })
    expect(renderResult.getByTestId('studio-shell')).toBeInTheDocument()
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

describe('LessonPlanStudio — quota gate (payment)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Restore the "allowed" gate so the false-gate override never leaks into
  // other tests (vi.clearAllMocks keeps mockReturnValue overrides).
  afterEach(async () => {
    const { useGenerationGate } = await import('../../../hooks/useGenerationGate')
    vi.mocked(useGenerationGate).mockReturnValue({ ensureCanGenerate: vi.fn(() => true), usage: null })
  })

  it('does not start generation or call the backend when the quota gate blocks', async () => {
    const { useGenerationGate } = await import('../../../hooks/useGenerationGate')
    // Out of quota: ensureCanGenerate returns false (and would have opened the
    // upgrade paywall). The studio must stay idle and never hit the callable.
    vi.mocked(useGenerationGate).mockReturnValue({
      ensureCanGenerate: vi.fn(() => false),
      usage: null,
    })

    renderStudioWithGeneration()
    fireEvent.click(screen.getByTestId('trigger-generate'))

    expect(screen.getByTestId('canvas-status')).toHaveTextContent('idle')
    expect(innerCallable).not.toHaveBeenCalled()
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

  it('auto-saves the generated plan to the library (no manual Save needed)', async () => {
    const { renderPlanHtml } = await import('./utils/renderPlanHtml')
    mockSaveLessonPlanGeneration.mockClear()
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })
    renderPlanHtml.mockReturnValue('<p>rendered plan</p>')

    renderStudioWithGeneration()
    fireEvent.click(screen.getByTestId('trigger-generate'))

    // A successful generation persists to the library on its own — this is what
    // makes the plan show up under Library → Lesson Plans (and feeds the
    // Template Bank trigger, which only fires on saved `lesson_plan` docs).
    await waitFor(() => {
      expect(mockSaveLessonPlanGeneration).toHaveBeenCalledTimes(1)
    })
    const arg = mockSaveLessonPlanGeneration.mock.calls[0][0]
    expect(arg.uid).toBe('test-uid-123')
    expect(arg.planJson).toBeTruthy()
    expect(arg.classification.libraryType).toBe(LIBRARY_TYPES.LESSON_PLANS)
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
      formatOptions: { ...initialFormatOptions('2'), illustrations: 'none' },
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

// ── School resources flow into the user prompt ────────────────────────────────

describe('LessonPlanStudio — school resources in user prompt', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('defaults to the BASIC resources line when lessonDetails has no resources', async () => {
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })

    renderStudioWithGeneration({ curriculumMode: 'cbc' })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(innerCallable).toHaveBeenCalled()
    })
    const { userPrompt } = innerCallable.mock.calls[0][0]
    expect(userPrompt).toContain('School resources: BASIC')
    expect(userPrompt).not.toContain('LOW-RESOURCE RURAL SCHOOL')
  })

  it('adds the hard low-resource constraint when the rural level is selected', async () => {
    innerCallable.mockResolvedValue({
      data: { text: '{"topic":"Test","stages":[]}' },
    })

    renderStudioWithGeneration({
      curriculumMode: 'cbc',
      lessonDetails: {
        grade: 'Grade 4', subject: 'Science', duration: '40', medium: 'English',
        term: '', week: '', date: '', time: '', teacherName: '', school: '',
        resources: 'low',
      },
    })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(innerCallable).toHaveBeenCalled()
    })
    const { userPrompt } = innerCallable.mock.calls[0][0]
    expect(userPrompt).toContain('LOW-RESOURCE RURAL SCHOOL')
    expect(userPrompt).toContain('HARD CONSTRAINT')
    expect(userPrompt).toContain('Do NOT include any activity that needs printing')
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
        ...initialFormatOptions('2'),
        illustrations: 'none',
        advanced: { ...initialFormatOptions('2').advanced, localLanguage },
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

// ── Auto-fill Teacher Name + School from the signed-in profile ────────────────
// The prefill now resolves the school profile first (Teacher Settings resource
// level), so the setLessonDetails call is asynchronous — hence the waitFor.

describe('LessonPlanStudio — teacher identity auto-fill', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('prefills teacherName + school from the profile, leaving prior typed values intact', async () => {
    const { useAuth } = await import('../../../contexts/AuthContext')
    useAuth.mockReturnValue({
      currentUser: { uid: 'uid-teach' },
      userProfile: { displayName: 'Mrs. Banda', school: 'Lusaka Primary' },
    })

    const setLessonDetails = vi.fn()
    renderStudio({ setLessonDetails })

    await waitFor(() => expect(setLessonDetails).toHaveBeenCalledTimes(1))
    // The updater fills empty fields from the profile…
    const updater = setLessonDetails.mock.calls[0][0]
    const empty = { teacherName: '', school: '' }
    expect(updater(empty)).toMatchObject({
      teacherName: 'Mrs. Banda',
      school: 'Lusaka Primary',
    })
    // …but never clobbers a value the teacher already typed.
    const typed = { teacherName: 'Custom Name', school: 'Custom School' }
    expect(updater(typed)).toMatchObject({
      teacherName: 'Custom Name',
      school: 'Custom School',
    })
  })

  it('does not call setLessonDetails when the profile has not loaded yet', async () => {
    const { useAuth } = await import('../../../contexts/AuthContext')
    useAuth.mockReturnValue({ currentUser: { uid: 'uid-teach' }, userProfile: null })

    const setLessonDetails = vi.fn()
    renderStudio({ setLessonDetails })

    // Give any pending microtasks a chance to flush before asserting silence.
    await new Promise((r) => setTimeout(r, 0))
    expect(setLessonDetails).not.toHaveBeenCalled()
  })
})

// ── Teacher Settings preferences seed the studio once, fill-only-blank ────────

describe('LessonPlanStudio — Teacher Settings seeding', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const PREFS_PROFILE = {
    displayName: 'Mrs. Banda',
    school: 'Lusaka Primary',
    teacherPreferences: {
      ai: {
        planDetail: 'detailed',
        teachingLanguage: 'bemba',
        rememberLastUsed: true,
        include: { reflection: false },
      },
      // §2.6 — the teacher's last-used paper format. A teacher who wants
      // 1-page point-form plans sets it once.
      lessonPlanFormat: {
        pageBudget: '1',
        writingStyle: 'point',
        marginMm: 10,
        headerStyle: 'ministry',
        environmentDisplay: 'detailed',
      },
    },
  }

  it('seeds medium, resources and the saved paper format from preferences', async () => {
    const { useAuth } = await import('../../../contexts/AuthContext')
    const { getSchoolProfile } = await import('../../../utils/schoolProfileService')
    useAuth.mockReturnValue({ currentUser: { uid: 'uid-teach' }, userProfile: PREFS_PROFILE })
    getSchoolProfile.mockResolvedValueOnce({ resourceLevel: 'low' })

    const setLessonDetails = vi.fn()
    const setFormatOptions = vi.fn()
    renderStudio({ setLessonDetails, setFormatOptions })

    await waitFor(() => expect(setLessonDetails).toHaveBeenCalledTimes(1))
    const updater = setLessonDetails.mock.calls[0][0]

    // Fields still at their defaults are seeded…
    expect(updater({ teacherName: '', school: '', medium: 'English', resources: 'basic' }))
      .toMatchObject({ medium: 'Bemba', resources: 'low' })
    // …but anything the teacher already changed is left alone.
    expect(updater({ teacherName: '', school: '', medium: 'Tonga', resources: 'full' }))
      .toMatchObject({ medium: 'Tonga', resources: 'full' })

    // The paper format is applied as ONE update, so the page-budget cascade
    // cannot overwrite the margin and header style saved alongside it.
    await waitFor(() => expect(setFormatOptions).toHaveBeenCalled())
    const formatUpdater = setFormatOptions.mock.calls[0][0]
    const seeded = formatUpdater(initialFormatOptions('2'))
    expect(seeded).toMatchObject({
      pageBudget: '1',
      writingStyle: 'point',
      marginMm: 10,
      headerStyle: 'ministry',
      environmentDisplay: 'detailed',
    })

    // Teacher Settings → "include reflection: false" still switches the
    // evaluation section off, through the new per-section toggles.
    const reflectionUpdater = setFormatOptions.mock.calls.at(-1)[0]
    expect(reflectionUpdater(initialFormatOptions('2')).sections.lessonEvaluation).toBe(false)
  })

  it('does not seed when AI Memory (rememberLastUsed) is off', async () => {
    const { useAuth } = await import('../../../contexts/AuthContext')
    const { getSchoolProfile } = await import('../../../utils/schoolProfileService')
    useAuth.mockReturnValue({
      currentUser: { uid: 'uid-teach' },
      userProfile: {
        ...PREFS_PROFILE,
        teacherPreferences: {
          ai: { ...PREFS_PROFILE.teacherPreferences.ai, rememberLastUsed: false },
        },
      },
    })
    getSchoolProfile.mockResolvedValueOnce({ resourceLevel: 'low' })

    const setLessonDetails = vi.fn()
    const updateFormatOption = vi.fn()
    renderStudio({ setLessonDetails, updateFormatOption })

    // Identity still prefills (that's profile data, not memory)…
    await waitFor(() => expect(setLessonDetails).toHaveBeenCalledTimes(1))
    const updater = setLessonDetails.mock.calls[0][0]
    const out = updater({ teacherName: '', school: '', medium: 'English', resources: 'basic' })
    // …but preference-driven fields stay at their defaults.
    expect(out).toMatchObject({ medium: 'English', resources: 'basic', teacherName: 'Mrs. Banda' })
    expect(updateFormatOption).not.toHaveBeenCalled()
  })

  it('appends the AI-preference prompt lines to the generation prompt', async () => {
    const { useAuth } = await import('../../../contexts/AuthContext')
    useAuth.mockReturnValue({
      currentUser: { uid: 'uid-teach' },
      userProfile: {
        teacherPreferences: {
          ai: {
            preferredEnglish: 'american',
            include: { homework: false, teachingAids: true },
          },
        },
      },
    })
    innerCallable.mockResolvedValue({ data: { text: '{"topic":"T","stages":[]}' } })
    renderStudioWithGeneration({
      curriculumMode: 'cbc',
      lessonDetails: {
        grade: 'G5', subject: 'Science', duration: '40', medium: 'English',
        term: '', week: '', date: '', time: '', teacherName: '', school: '',
      },
      topicData: { topic: 'Plants', subtopic: '', subtopicRow: null },
    })
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => expect(innerCallable).toHaveBeenCalled())
    const { userPrompt } = innerCallable.mock.calls[0][0]
    expect(userPrompt).toMatch(/American English/)
    expect(userPrompt).toMatch(/Do not include homework/)
    expect(userPrompt).not.toMatch(/teaching\/learning aids/)
  })
})

// ── Edit mode (/teacher/lesson-plans/:lessonPlanId/edit) ─────────────────────

describe('LessonPlanStudio — edit mode', () => {
  let useParamsMock
  beforeEach(async () => {
    vi.clearAllMocks()
    useParamsMock = (await import('react-router-dom')).useParams
  })
  afterEach(() => {
    useParamsMock.mockReturnValue({})
  })

  it('hydrates the canvas from the saved generation and marks it saved', async () => {
    useParamsMock.mockReturnValue({ lessonPlanId: 'gen-edit-1' })
    mockGetGeneration.mockResolvedValue({
      id: 'gen-edit-1',
      tool: 'lesson_plan',
      data: { lessonTitle: 'Saved plan', stages: [] },
      html: '<p>saved html</p>',
      meta: { grade: 'Grade 4' },
      library: { syllabus: 'CBC' },
    })
    renderStudioWithGeneration()

    await waitFor(() => expect(screen.getByTestId('canvas-status').textContent).toBe('done'))
    expect(mockGetGeneration).toHaveBeenCalledWith('gen-edit-1')
    // The saved pre-rendered HTML is what the canvas shows — no regeneration.
    expect(screen.getByTestId('canvas-plan').textContent).toBe('<p>saved html</p>')
    expect(innerCallable).not.toHaveBeenCalled()
  })

  it('shows a friendly error (not a blank studio) when the plan cannot be loaded', async () => {
    useParamsMock.mockReturnValue({ lessonPlanId: 'gen-gone' })
    mockGetGeneration.mockResolvedValue(null)
    renderStudioWithGeneration()

    await waitFor(() =>
      expect(screen.getByTestId('canvas-error').textContent).toMatch(/could not open that saved lesson plan/i),
    )
    // The canvas flips to its error state so the message is actually VISIBLE
    // (the error panel is gated on status === 'error'); the wizard's Back to
    // form control still lets the teacher build a new plan.
    expect(screen.getByTestId('canvas-status').textContent).toBe('error')
  })

  it('does not fetch anything on the new-plan route (no :lessonPlanId)', async () => {
    useParamsMock.mockReturnValue({})
    renderStudio()
    await waitFor(() => expect(screen.getByTestId('studio-canvas')).toBeInTheDocument())
    expect(mockGetGeneration).not.toHaveBeenCalled()
  })
})
