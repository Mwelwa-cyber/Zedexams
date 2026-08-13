import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TeachingProgressPanel } from './TeachingProgressPanel'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BREAKDOWN = [
  { lessonNumber: '1', title: 'Introduction to Fractions', focus: 'Concepts', status: 'completed' },
  { lessonNumber: '2', title: 'Adding Fractions',          focus: 'Skills',   status: 'completed' },
  { lessonNumber: '3', title: 'Subtracting Fractions',     focus: 'Practice', status: 'pending' },
  { lessonNumber: '4', title: 'Multiplying Fractions',     focus: 'Practice', status: 'pending' },
]

function renderPanel(props = {}) {
  const defaults = {
    lessonBreakdown:  BREAKDOWN,
    completedCount:   2,
    completedLessons: ['1', '2'],
    seriesLoading:    false,
    onContinue:       vi.fn(),
    onViewCompleted:  vi.fn(),
    ...props,
  }
  return { ...render(<TeachingProgressPanel {...defaults} />), ...defaults }
}

// ── Section header ────────────────────────────────────────────────────────────

describe('TeachingProgressPanel — section header', () => {
  it('renders the "Teaching Progress" heading', () => {
    renderPanel()
    expect(screen.getByText('Teaching Progress')).toBeInTheDocument()
  })

  it('shows a grey status dot when completedCount is 0', () => {
    const { container } = render(
      <TeachingProgressPanel
        lessonBreakdown={BREAKDOWN}
        completedCount={0}
        completedLessons={[]}
        seriesLoading={false}
        onContinue={vi.fn()}
        onViewCompleted={vi.fn()}
      />,
    )
    expect(container.querySelector('.bg-\\[\\#c9c0b0\\]')).toBeInTheDocument()
  })

  it('shows a green status dot when completedCount > 0', () => {
    const { container } = render(
      <TeachingProgressPanel
        lessonBreakdown={BREAKDOWN}
        completedCount={1}
        completedLessons={['1']}
        seriesLoading={false}
        onContinue={vi.fn()}
        onViewCompleted={vi.fn()}
      />,
    )
    expect(container.querySelector('.bg-green-500')).toBeInTheDocument()
  })
})

// ── Collapse / expand ─────────────────────────────────────────────────────────

describe('TeachingProgressPanel — collapse/expand', () => {
  it('body is visible by default (starts open)', () => {
    renderPanel()
    expect(screen.getByText(/lessons completed/)).toBeInTheDocument()
  })

  it('hides the body after clicking the toggle button', () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: /teaching progress/i })
    fireEvent.click(toggle)
    expect(screen.queryByText(/lessons completed/)).not.toBeInTheDocument()
  })

  it('shows the body again after a second click', () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: /teaching progress/i })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.getByText(/lessons completed/)).toBeInTheDocument()
  })

  it('toggle button exposes aria-expanded', () => {
    renderPanel()
    const toggle = screen.getByRole('button', { name: /teaching progress/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

// ── Empty state ───────────────────────────────────────────────────────────────

describe('TeachingProgressPanel — empty state', () => {
  it('shows the empty message when lessonBreakdown is empty', () => {
    render(
      <TeachingProgressPanel
        lessonBreakdown={[]}
        completedCount={0}
        completedLessons={[]}
        seriesLoading={false}
        onContinue={vi.fn()}
        onViewCompleted={vi.fn()}
      />,
    )
    expect(screen.getByText('No lesson series started yet.')).toBeInTheDocument()
  })

  it('does not show the progress bar when lessonBreakdown is empty', () => {
    const { container } = render(
      <TeachingProgressPanel
        lessonBreakdown={[]}
        completedCount={0}
        completedLessons={[]}
        seriesLoading={false}
        onContinue={vi.fn()}
        onViewCompleted={vi.fn()}
      />,
    )
    expect(container.querySelector('[role="progressbar"]')).not.toBeInTheDocument()
  })

  it('does not show action buttons when lessonBreakdown is empty', () => {
    render(
      <TeachingProgressPanel
        lessonBreakdown={[]}
        completedCount={0}
        completedLessons={[]}
        seriesLoading={false}
        onContinue={vi.fn()}
        onViewCompleted={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: /continue next lesson/i })).not.toBeInTheDocument()
  })
})

// ── Progress display ──────────────────────────────────────────────────────────

describe('TeachingProgressPanel — progress display', () => {
  it('shows "X of Y lessons completed" text', () => {
    renderPanel({ completedCount: 2, completedLessons: ['1', '2'] })
    expect(screen.getByText('2 of 4 lessons completed')).toBeInTheDocument()
  })

  it('shows "0 of Y lessons completed" when nothing is done', () => {
    renderPanel({ completedCount: 0, completedLessons: [] })
    expect(screen.getByText('0 of 4 lessons completed')).toBeInTheDocument()
  })

  it('renders a progressbar element', () => {
    renderPanel()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('sets progressbar width to 50% when 2 of 4 lessons are complete', () => {
    const { container } = render(
      <TeachingProgressPanel
        lessonBreakdown={BREAKDOWN}
        completedCount={2}
        completedLessons={['1', '2']}
        seriesLoading={false}
        onContinue={vi.fn()}
        onViewCompleted={vi.fn()}
      />,
    )
    const bar = container.querySelector('[role="progressbar"]')
    expect(bar.style.width).toBe('50%')
  })

  it('sets progressbar width to 0% when completedCount is 0', () => {
    const { container } = render(
      <TeachingProgressPanel
        lessonBreakdown={BREAKDOWN}
        completedCount={0}
        completedLessons={[]}
        seriesLoading={false}
        onContinue={vi.fn()}
        onViewCompleted={vi.fn()}
      />,
    )
    const bar = container.querySelector('[role="progressbar"]')
    expect(bar.style.width).toBe('0%')
  })

  it('sets progressbar width to 100% when all lessons complete', () => {
    const allDone = BREAKDOWN.map((l) => String(l.lessonNumber))
    const { container } = render(
      <TeachingProgressPanel
        lessonBreakdown={BREAKDOWN}
        completedCount={4}
        completedLessons={allDone}
        seriesLoading={false}
        onContinue={vi.fn()}
        onViewCompleted={vi.fn()}
      />,
    )
    const bar = container.querySelector('[role="progressbar"]')
    expect(bar.style.width).toBe('100%')
  })
})

// ── Per-lesson indicators ─────────────────────────────────────────────────────

describe('TeachingProgressPanel — per-lesson indicators', () => {
  it('shows ✓ for completed lessons', () => {
    renderPanel({ completedLessons: ['1', '2'], completedCount: 2 })
    // Two completed lessons → two ✓ marks
    const ticks = screen.getAllByLabelText('Completed')
    expect(ticks).toHaveLength(2)
  })

  it('shows ▶ for the next pending lesson', () => {
    // lessons 1 & 2 done; lesson 3 is next
    renderPanel({ completedLessons: ['1', '2'], completedCount: 2 })
    const nextMarkers = screen.getAllByLabelText('Next lesson')
    expect(nextMarkers).toHaveLength(1)
  })

  it('shows ○ for remaining pending lessons after the next one', () => {
    // 1 & 2 done, 3 = next (▶), 4 = pending (○)
    renderPanel({ completedLessons: ['1', '2'], completedCount: 2 })
    const pending = screen.getAllByLabelText('Pending')
    expect(pending).toHaveLength(1)
  })

  it('shows ▶ on the first lesson when none are completed', () => {
    renderPanel({ completedLessons: [], completedCount: 0 })
    const nextMarkers = screen.getAllByLabelText('Next lesson')
    expect(nextMarkers).toHaveLength(1)
    // Lesson 1 title is visible beside it
    expect(screen.getByText('Introduction to Fractions')).toBeInTheDocument()
  })

  it('shows no ▶ when all lessons are completed', () => {
    const allDone = BREAKDOWN.map((l) => String(l.lessonNumber))
    renderPanel({ completedLessons: allDone, completedCount: 4 })
    expect(screen.queryByLabelText('Next lesson')).not.toBeInTheDocument()
  })

  it('renders all lesson titles', () => {
    renderPanel()
    for (const item of BREAKDOWN) {
      expect(screen.getByText(item.title)).toBeInTheDocument()
    }
  })
})

// ── Loading state ─────────────────────────────────────────────────────────────

describe('TeachingProgressPanel — loading state', () => {
  it('shows a loading spinner when seriesLoading is true', () => {
    renderPanel({ seriesLoading: true })
    expect(screen.getByLabelText('Loading')).toBeInTheDocument()
  })

  it('does not show the spinner when seriesLoading is false', () => {
    renderPanel({ seriesLoading: false })
    expect(screen.queryByLabelText('Loading')).not.toBeInTheDocument()
  })

  it('disables "Continue Next Lesson" button when loading', () => {
    renderPanel({ seriesLoading: true })
    expect(screen.getByRole('button', { name: /continue next lesson/i })).toBeDisabled()
  })

  it('disables "View Completed" button when loading', () => {
    renderPanel({ seriesLoading: true, completedCount: 2, completedLessons: ['1', '2'] })
    expect(screen.getByRole('button', { name: /view completed/i })).toBeDisabled()
  })

  it('enables buttons when not loading', () => {
    renderPanel({ seriesLoading: false })
    expect(screen.getByRole('button', { name: /continue next lesson/i })).not.toBeDisabled()
  })
})

// ── Action buttons ────────────────────────────────────────────────────────────

describe('TeachingProgressPanel — action buttons', () => {
  it('calls onContinue when "Continue Next Lesson" is clicked', () => {
    const onContinue = vi.fn()
    renderPanel({ onContinue })
    fireEvent.click(screen.getByRole('button', { name: /continue next lesson/i }))
    expect(onContinue).toHaveBeenCalledTimes(1)
  })

  it('shows "View Completed" button when completedCount > 0', () => {
    renderPanel({ completedCount: 1, completedLessons: ['1'] })
    expect(screen.getByRole('button', { name: /view completed/i })).toBeInTheDocument()
  })

  it('hides "View Completed" button when completedCount is 0', () => {
    renderPanel({ completedCount: 0, completedLessons: [] })
    expect(screen.queryByRole('button', { name: /view completed/i })).not.toBeInTheDocument()
  })

  it('calls onViewCompleted when "View Completed" is clicked', () => {
    const onViewCompleted = vi.fn()
    renderPanel({ completedCount: 2, completedLessons: ['1', '2'], onViewCompleted })
    fireEvent.click(screen.getByRole('button', { name: /view completed/i }))
    expect(onViewCompleted).toHaveBeenCalledTimes(1)
  })

  it('always shows "Continue Next Lesson" button when breakdown is non-empty', () => {
    renderPanel({ completedCount: 0, completedLessons: [] })
    expect(screen.getByRole('button', { name: /continue next lesson/i })).toBeInTheDocument()
  })
})
