import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StudioCanvas } from './StudioCanvas'

// ── Mock LiveLessonPlanPreview ────────────────────────────────────────────────
// The loading state (and the post-generation reveal) render the live
// "writing itself" document preview. Stub it so this suite stays focused on the
// canvas states/toolbar; the preview has its own spec (LiveLessonPlanPreview.spec).
vi.mock('./LiveLessonPlanPreview', () => ({
  default: ({ planJson, onStop }) => (
    <div
      data-testid="live-lesson-preview"
      data-phase={planJson ? 'revealing' : 'generating'}
    >
      {typeof onStop === 'function' && <button type="button" onClick={onStop}>Stop</button>}
    </div>
  ),
}))

// ── Firebase mocks ────────────────────────────────────────────────────────────
// StudioCanvas now imports LessonPlanEditor, which pulls in the
// reviseLessonSection client wrapper → firebase/config. Stub the Firebase
// surface so the canvas renders under jsdom without real web config.
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({})),
  httpsCallable: vi.fn(() => vi.fn()),
}))
vi.mock('../../../firebase/config', () => ({ default: {}, db: {} }))

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

  it('does NOT render the live lesson preview', () => {
    renderCanvas({ generationStatus: 'idle' })
    expect(screen.queryByTestId('live-lesson-preview')).not.toBeInTheDocument()
  })
})

// ── Loading state ─────────────────────────────────────────────────────────────

describe('StudioCanvas — loading state', () => {
  it('renders the live lesson preview when loading', () => {
    renderCanvas({ generationStatus: 'loading' })
    expect(screen.getByTestId('live-lesson-preview')).toBeInTheDocument()
  })

  it('renders the live preview in its "generating" phase (no plan yet)', () => {
    renderCanvas({ generationStatus: 'loading', planJson: { lessonGoal: 'x' } })
    const el = screen.getByTestId('live-lesson-preview')
    // While loading, the preview is fed planJson=null so it types the header in.
    expect(el).toHaveAttribute('data-phase', 'generating')
  })

  it('wires the Stop control through to onStop', () => {
    const onStop = vi.fn()
    renderCanvas({ generationStatus: 'loading', onStop })
    fireEvent.click(screen.getByRole('button', { name: /stop/i }))
    expect(onStop).toHaveBeenCalledTimes(1)
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

  it('renders the plan onto real A4 sheets, not a continuous column', () => {
    // §3.3 — the preview is paginated so a teacher can see what the printer
    // produces, including where the page breaks fall.
    renderCanvas({ generationStatus: 'done', generatedPlan: HTML })
    const sheets = document.querySelectorAll('.lp-sheet')
    expect(sheets.length).toBeGreaterThan(0)
    expect(sheets[0].innerHTML).toContain('Lesson plan content')
    expect(sheets[0].querySelector('.lp-pgnum')?.textContent).toMatch(/Page 1 of/)
  })

  it('shows a measured page count, never an estimate', () => {
    renderCanvas({ generationStatus: 'done', generatedPlan: HTML })
    const badge = screen.getByTestId('page-badge')
    expect(badge.textContent).toMatch(/^\d+ pages?$/)
    expect(badge.textContent).not.toMatch(/est/i)
  })

  it('does NOT render the live generation canvas', () => {
    renderCanvas({ generationStatus: 'done', generatedPlan: HTML })
    expect(screen.queryByTestId('live-lesson-preview')).not.toBeInTheDocument()
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

describe('StudioCanvas — save to library', () => {
  const HTML = '<p>Lesson plan content</p>'
  const doneProps = { generationStatus: 'done', generatedPlan: HTML }

  it('does not render the Save button without an onSaveToLibrary handler', () => {
    renderCanvas(doneProps)
    expect(screen.queryByRole('button', { name: /save to library/i })).not.toBeInTheDocument()
  })

  it('renders an enabled Save button when canSave is true and calls the handler', () => {
    const onSaveToLibrary = vi.fn()
    renderCanvas({ ...doneProps, onSaveToLibrary, canSave: true })
    const btn = screen.getByRole('button', { name: /save to library/i })
    expect(btn).toBeEnabled()
    fireEvent.click(btn)
    expect(onSaveToLibrary).toHaveBeenCalledTimes(1)
  })

  it('disables the Save button when canSave is false and not yet saved', () => {
    renderCanvas({ ...doneProps, onSaveToLibrary: vi.fn(), canSave: false, saveStatus: 'idle' })
    expect(screen.getByRole('button', { name: /save to library/i })).toBeDisabled()
  })

  it('shows a "Saving…" state', () => {
    renderCanvas({ ...doneProps, onSaveToLibrary: vi.fn(), canSave: false, saveStatus: 'saving' })
    expect(screen.getByRole('button', { name: /saving/i })).toBeDisabled()
  })

  it('shows a Saved chip with a View link once saved and unchanged', () => {
    const onViewLibrary = vi.fn()
    renderCanvas({ ...doneProps, onSaveToLibrary: vi.fn(), canSave: false, saveStatus: 'saved', onViewLibrary })
    expect(screen.getByTestId('save-state')).toHaveTextContent(/saved/i)
    fireEvent.click(screen.getByRole('button', { name: /view/i }))
    expect(onViewLibrary).toHaveBeenCalledTimes(1)
  })

  it('offers "Save changes" again after edits land (saved but canSave true)', () => {
    renderCanvas({ ...doneProps, onSaveToLibrary: vi.fn(), canSave: true, saveStatus: 'saved' })
    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
  })

  it('surfaces a save error', () => {
    renderCanvas({ ...doneProps, onSaveToLibrary: vi.fn(), canSave: true, saveStatus: 'error', saveError: 'boom' })
    expect(screen.getByTestId('save-error')).toBeInTheDocument()
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

  it('does NOT render the live generation canvas', () => {
    renderCanvas({ generationStatus: 'error' })
    expect(screen.queryByTestId('live-lesson-preview')).not.toBeInTheDocument()
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
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens a clean print window containing only the plan (not the app chrome)', () => {
    // The fix: Print no longer calls a bare window.print() (which dumped the
    // whole React app), it opens a standalone document that reuses the preview
    // HTML so the printed page / saved PDF matches the on-screen preview.
    const writes = []
    const fakeWin = {
      document: {
        open: vi.fn(),
        write: (html) => writes.push(html),
        close: vi.fn(),
      },
    }
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWin)
    renderCanvas({ generationStatus: 'done', generatedPlan: '<p>plan</p>' })
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    expect(openSpy).toHaveBeenCalledTimes(1)
    expect(writes.join('')).toContain('<p>plan</p>')
    // The print window INLINES the shared document stylesheet rather than
    // linking the studio's — that is what makes the printout the preview.
    const printed = writes.join('')
    expect(printed).toContain('.plan-compact')
    expect(printed).toContain('@page{size:A4;margin:15mm}')
    expect(printed).not.toContain('/studio/lesson.css')
  })

  it('falls back to window.print() when the pop-up is blocked', () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})
    renderCanvas({ generationStatus: 'done', generatedPlan: '<p>plan</p>' })
    fireEvent.click(screen.getByRole('button', { name: /print/i }))
    expect(printSpy).toHaveBeenCalledTimes(1)
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
