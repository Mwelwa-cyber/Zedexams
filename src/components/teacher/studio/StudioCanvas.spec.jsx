import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StudioCanvas } from './StudioCanvas'

// ── Mock AiGenerationProgress ─────────────────────────────────────────────────
vi.mock('../../ui/AiGenerationProgress', () => ({
  default: ({ title, preset, running, variant }) => (
    <div
      data-testid="ai-generation-progress"
      data-title={title}
      data-preset={preset}
      data-running={String(running)}
      data-variant={variant}
    />
  ),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderCanvas(props = {}) {
  const defaults = {
    generatedPlan: null,
    generationStatus: 'idle',
    generationError: null,
  }
  return render(<StudioCanvas {...defaults} {...props} />)
}

// ── lesson.css injection ──────────────────────────────────────────────────────

describe('StudioCanvas — lesson.css injection', () => {
  afterEach(() => {
    // Clean up any injected link so tests don't bleed into each other.
    const el = document.getElementById('studio-lesson-css')
    if (el) el.remove()
  })

  it('injects a <link> for /studio/lesson.css on mount', () => {
    renderCanvas()
    const link = document.getElementById('studio-lesson-css')
    expect(link).not.toBeNull()
    expect(link.rel).toBe('stylesheet')
    expect(link.href).toContain('/studio/lesson.css')
  })

  it('does not inject a duplicate link when already present', () => {
    // Pre-inject the link
    const existing = document.createElement('link')
    existing.id = 'studio-lesson-css'
    existing.rel = 'stylesheet'
    existing.href = '/studio/lesson.css'
    document.head.appendChild(existing)

    renderCanvas()

    const links = document.querySelectorAll('#studio-lesson-css')
    expect(links.length).toBe(1)
  })
})

// ── Idle state ────────────────────────────────────────────────────────────────

describe('StudioCanvas — idle state', () => {
  it('shows the "An empty page is waiting" heading', () => {
    renderCanvas({ generationStatus: 'idle' })
    expect(screen.getByRole('heading', { name: /an empty page is waiting/i })).toBeInTheDocument()
  })

  it('shows the fill-in-details description', () => {
    renderCanvas({ generationStatus: 'idle' })
    expect(screen.getByText(/fill in your details on the left/i)).toBeInTheDocument()
  })

  it('does NOT render AiGenerationProgress', () => {
    renderCanvas({ generationStatus: 'idle' })
    expect(screen.queryByTestId('ai-generation-progress')).not.toBeInTheDocument()
  })
})

// ── Loading state ─────────────────────────────────────────────────────────────

describe('StudioCanvas — loading state', () => {
  it('renders AiGenerationProgress when loading', () => {
    renderCanvas({ generationStatus: 'loading' })
    expect(screen.getByTestId('ai-generation-progress')).toBeInTheDocument()
  })

  it('passes correct props to AiGenerationProgress', () => {
    renderCanvas({ generationStatus: 'loading' })
    const el = screen.getByTestId('ai-generation-progress')
    expect(el).toHaveAttribute('data-variant', 'card')
    expect(el).toHaveAttribute('data-preset', 'lessonPlan')
    expect(el).toHaveAttribute('data-running', 'true')
    expect(el).toHaveAttribute('data-title', 'Composing your lesson plan…')
  })

  it('does NOT show the empty-state heading', () => {
    renderCanvas({ generationStatus: 'loading' })
    expect(screen.queryByRole('heading', { name: /an empty page is waiting/i })).not.toBeInTheDocument()
  })
})

// ── Done state ────────────────────────────────────────────────────────────────

describe('StudioCanvas — done state', () => {
  const HTML = '<p>Lesson plan content</p>'

  it('renders the generatedPlan HTML', () => {
    renderCanvas({ generationStatus: 'done', generatedPlan: HTML })
    expect(screen.getByText('Lesson plan content')).toBeInTheDocument()
  })

  it('renders the plan inside an element with id="doc"', () => {
    renderCanvas({ generationStatus: 'done', generatedPlan: HTML })
    const doc = document.getElementById('doc')
    expect(doc).not.toBeNull()
    expect(doc.innerHTML).toContain('Lesson plan content')
  })

  it('does NOT render AiGenerationProgress', () => {
    renderCanvas({ generationStatus: 'done', generatedPlan: HTML })
    expect(screen.queryByTestId('ai-generation-progress')).not.toBeInTheDocument()
  })

  it('does NOT show the empty-state heading', () => {
    renderCanvas({ generationStatus: 'done', generatedPlan: HTML })
    expect(screen.queryByRole('heading', { name: /an empty page is waiting/i })).not.toBeInTheDocument()
  })

  it('shows a fallback message when generatedPlan is null', () => {
    renderCanvas({ generationStatus: 'done', generatedPlan: null })
    expect(screen.getByText(/the plan is empty/i)).toBeInTheDocument()
  })

  it('shows a fallback message when generatedPlan is an empty string', () => {
    renderCanvas({ generationStatus: 'done', generatedPlan: '' })
    expect(screen.getByText(/the plan is empty/i)).toBeInTheDocument()
  })
})

// ── Error state ───────────────────────────────────────────────────────────────

describe('StudioCanvas — error state', () => {
  it('shows the generic error message', () => {
    renderCanvas({ generationStatus: 'error' })
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
  })

  it('shows the specific generationError string when provided', () => {
    renderCanvas({ generationStatus: 'error', generationError: 'Network timeout' })
    expect(screen.getByText('Network timeout')).toBeInTheDocument()
  })

  it('does NOT show the specific error text when generationError is null', () => {
    renderCanvas({ generationStatus: 'error', generationError: null })
    expect(screen.queryByText('Network timeout')).not.toBeInTheDocument()
  })

  it('does NOT render AiGenerationProgress', () => {
    renderCanvas({ generationStatus: 'error' })
    expect(screen.queryByTestId('ai-generation-progress')).not.toBeInTheDocument()
  })
})

// ── Toolbar visibility ────────────────────────────────────────────────────────

describe('StudioCanvas — toolbar visibility', () => {
  it('hides Print and Export buttons when status is "idle"', () => {
    renderCanvas({ generationStatus: 'idle' })
    expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /export word/i })).not.toBeInTheDocument()
  })

  it('hides Print and Export buttons when status is "loading"', () => {
    renderCanvas({ generationStatus: 'loading' })
    expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /export word/i })).not.toBeInTheDocument()
  })

  it('hides Print and Export buttons when status is "error"', () => {
    renderCanvas({ generationStatus: 'error' })
    expect(screen.queryByRole('button', { name: /print/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /export word/i })).not.toBeInTheDocument()
  })

  it('shows Print and Export Word buttons when status is "done"', () => {
    renderCanvas({ generationStatus: 'done', generatedPlan: '<p>plan</p>' })
    expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /export word/i })).toBeInTheDocument()
  })
})

// ── Print button ──────────────────────────────────────────────────────────────

describe('StudioCanvas — Print button', () => {
  beforeEach(() => {
    vi.spyOn(window, 'print').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls window.print() when Print is clicked', () => {
    renderCanvas({ generationStatus: 'done', generatedPlan: '<p>plan</p>' })
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    expect(window.print).toHaveBeenCalledTimes(1)
  })
})

// ── Export Word button ────────────────────────────────────────────────────────

describe('StudioCanvas — Export Word button', () => {
  it('calls the onExportWord prop when provided', () => {
    const onExportWord = vi.fn()
    renderCanvas({ generationStatus: 'done', generatedPlan: '<p>plan</p>', onExportWord })
    fireEvent.click(screen.getByRole('button', { name: /export word/i }))
    expect(onExportWord).toHaveBeenCalledTimes(1)
  })

  it('does nothing when onExportWord is not provided', () => {
    renderCanvas({ generationStatus: 'done', generatedPlan: '<p>plan</p>' })
    // Should not throw when clicked without a handler
    expect(() => fireEvent.click(screen.getByRole('button', { name: /export word/i }))).not.toThrow()
  })
})

// ── Illustrations (manual) ──────────────────────────────────────────────────────

describe('StudioCanvas — manual illustrations', () => {
  const DONE = { generationStatus: 'done', generatedPlan: '<p>plan</p>' }

  it('shows the Add Illustration button only in manual mode', () => {
    renderCanvas({ ...DONE, illustrationMode: 'automatic' })
    expect(screen.queryByRole('button', { name: /add illustration/i })).not.toBeInTheDocument()
  })

  it('shows the Add Illustration button when illustrationMode is "manual"', () => {
    renderCanvas({ ...DONE, illustrationMode: 'manual' })
    expect(screen.getByRole('button', { name: /add illustration/i })).toBeInTheDocument()
  })

  it('does not show the Add Illustration button before the plan is done', () => {
    renderCanvas({ generationStatus: 'idle', illustrationMode: 'manual' })
    expect(screen.queryByRole('button', { name: /add illustration/i })).not.toBeInTheDocument()
  })

  it('reveals an input when Add Illustration is clicked', () => {
    renderCanvas({ ...DONE, illustrationMode: 'manual' })
    fireEvent.click(screen.getByRole('button', { name: /add illustration/i }))
    expect(screen.getByPlaceholderText(/describe the illustration/i)).toBeInTheDocument()
  })

  it('calls onAddIllustration with the typed description on Generate', () => {
    const onAddIllustration = vi.fn()
    renderCanvas({ ...DONE, illustrationMode: 'manual', onAddIllustration })
    fireEvent.click(screen.getByRole('button', { name: /add illustration/i }))
    fireEvent.change(screen.getByPlaceholderText(/describe the illustration/i), {
      target: { value: 'water cycle diagram' },
    })
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }))
    expect(onAddIllustration).toHaveBeenCalledWith('water cycle diagram')
  })

  it('does not call onAddIllustration when the description is empty', () => {
    const onAddIllustration = vi.fn()
    renderCanvas({ ...DONE, illustrationMode: 'manual', onAddIllustration })
    fireEvent.click(screen.getByRole('button', { name: /add illustration/i }))
    fireEvent.click(screen.getByRole('button', { name: /^generate$/i }))
    expect(onAddIllustration).not.toHaveBeenCalled()
  })

  it('shows a generating indicator while an illustration is being made', () => {
    renderCanvas({ ...DONE, illustrationMode: 'manual', illustrationStatus: 'generating' })
    expect(screen.getByTestId('illustration-status')).toHaveTextContent(/adding illustration/i)
  })

  it('shows the generating indicator in automatic mode too', () => {
    renderCanvas({ ...DONE, illustrationMode: 'automatic', illustrationStatus: 'generating' })
    expect(screen.getByTestId('illustration-status')).toBeInTheDocument()
  })

  it('shows an error indicator when illustration generation fails', () => {
    renderCanvas({
      ...DONE,
      illustrationMode: 'automatic',
      illustrationStatus: 'error',
      illustrationError: 'Monthly diagram limit reached.',
    })
    expect(screen.getByTestId('illustration-error')).toBeInTheDocument()
  })
})
