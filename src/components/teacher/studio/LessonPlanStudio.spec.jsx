import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LessonPlanStudio from './LessonPlanStudio'

// ── Firebase mocks ────────────────────────────────────────────────────────────
// vi.hoisted() runs before vi.mock() hoisting so innerCallable is defined
// when the factory closure captures it. The component calls httpsCallable()
// at module scope; returning this stable spy means tests can configure its
// behaviour with innerCallable.mockResolvedValue(…) etc.
const { innerCallable } = vi.hoisted(() => ({ innerCallable: vi.fn() }))

vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => innerCallable),
}))

vi.mock('../../../firebase/config', () => ({ default: {} }))

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
  StudioSidebar: ({ studioState, isValid, onGenerate, aiState, seriesState }) => (
    <div data-testid="studio-sidebar">
      <span data-testid="is-valid">{String(isValid)}</span>
      <span data-testid="curriculum-mode">{studioState.curriculumMode ?? 'null'}</span>
      <span data-testid="generation-status">{studioState.generationStatus}</span>
      <span data-testid="ai-loading">{String(aiState.loading)}</span>
      <span data-testid="series-completed">{seriesState.completedCount}</span>
      <button data-testid="trigger-generate" onClick={() => onGenerate(0)}>
        Generate
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

vi.mock('./utils/renderPlanHtml', () => ({
  renderPlanHtml: vi.fn(() => '<p>rendered plan</p>'),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderStudio() {
  return render(<LessonPlanStudio />)
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
    // innerCallable is what generateCallable delegates to at module scope
    innerCallable.mockRejectedValue(new Error('Network timeout'))

    renderStudio()
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

    renderStudio()
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('canvas-status')).toHaveTextContent('done')
    })
    expect(screen.getByTestId('canvas-plan')).toHaveTextContent('rendered plan')
  })

  it('sets generationStatus to "loading" immediately after clicking generate', async () => {
    // Never resolves so we can observe the transient loading state
    innerCallable.mockReturnValue(new Promise(() => {}))

    renderStudio()
    fireEvent.click(screen.getByTestId('trigger-generate'))

    await waitFor(() => {
      expect(screen.getByTestId('canvas-status')).toHaveTextContent('loading')
    })
  })
})

describe('LessonPlanStudio — CurriculumContext', () => {
  it('renders without crashing (context provider is mounted)', () => {
    expect(() => renderStudio()).not.toThrow()
  })
})
