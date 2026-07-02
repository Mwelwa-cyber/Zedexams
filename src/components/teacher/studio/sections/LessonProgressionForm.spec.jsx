import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LessonProgressionForm } from './LessonProgressionForm.jsx'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEFAULT_SERIES = {
  planningMode: 'single',
  totalLessons: 1,
  lessonNumber: 1,
  lessonFocus: '',
  aiSuggestedReason: '',
}

const SUBTOPIC_ROW = { subtopic: 'Addition of whole numbers', topic: 'WHOLE NUMBERS' }

function renderForm(props = {}) {
  const defaults = {
    lessonSeries: { ...DEFAULT_SERIES },
    lessonBreakdown: [],
    subtopicRow: SUBTOPIC_ROW,
    onUpdateSeries: vi.fn(),
    onUpdateBreakdown: vi.fn(),
    recommendation: null,
    loading: false,
    error: null,
    onFetchRecommendation: vi.fn(),
    ...props,
  }
  return { ...render(<LessonProgressionForm {...defaults} />), ...defaults }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ── Section header ────────────────────────────────────────────────────────────

describe('LessonProgressionForm — section header', () => {
  it('renders the "Lesson Progression" heading', () => {
    renderForm()
    expect(screen.getByText('Lesson Progression')).toBeInTheDocument()
  })

  it('shows a grey status dot when lessonBreakdown is empty', () => {
    const { container } = renderForm({ lessonBreakdown: [] })
    expect(container.querySelector('.bg-\\[\\#c9c0b0\\]')).toBeInTheDocument()
  })

  it('shows a green status dot when lessonBreakdown has items', () => {
    const { container } = renderForm({
      lessonBreakdown: [{ lessonNumber: 1, title: 'L1', focus: '', status: 'pending' }],
    })
    expect(container.querySelector('.bg-green-500')).toBeInTheDocument()
  })

  it('collapses the body when header button is clicked', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /lesson progression/i })
    fireEvent.click(toggle)
    expect(screen.queryByText('Single Lesson')).not.toBeInTheDocument()
  })

  it('expands the body again after a second click', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /lesson progression/i })
    fireEvent.click(toggle)
    fireEvent.click(toggle)
    expect(screen.getByText('Single Lesson')).toBeInTheDocument()
  })

  it('toggle button exposes aria-expanded', () => {
    renderForm()
    const toggle = screen.getByRole('button', { name: /lesson progression/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

// ── Planning mode toggle ──────────────────────────────────────────────────────

describe('LessonProgressionForm — single / series toggle', () => {
  it('renders "Single Lesson" and "Lesson Series" toggle buttons', () => {
    renderForm()
    expect(screen.getByRole('button', { name: 'Single Lesson' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lesson Series' })).toBeInTheDocument()
  })

  it('defaults to Single Lesson mode', () => {
    renderForm()
    expect(screen.getByRole('textbox', { name: /lesson focus/i })).toBeInTheDocument()
  })

  it('calls onUpdateSeries("planningMode", "series") when Lesson Series is clicked', () => {
    const onUpdateSeries = vi.fn()
    renderForm({ onUpdateSeries })
    fireEvent.click(screen.getByRole('button', { name: 'Lesson Series' }))
    expect(onUpdateSeries).toHaveBeenCalledWith('planningMode', 'series')
  })

  it('calls onUpdateSeries("planningMode", "single") when Single Lesson is clicked', () => {
    const onUpdateSeries = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      onUpdateSeries,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Single Lesson' }))
    expect(onUpdateSeries).toHaveBeenCalledWith('planningMode', 'single')
  })

  it('does not show the AI recommendation panel in single mode', () => {
    renderForm({ lessonSeries: { ...DEFAULT_SERIES, planningMode: 'single' } })
    expect(screen.queryByText(/ai recommends/i)).not.toBeInTheDocument()
  })

  it('shows the lesson focus field in single mode', () => {
    renderForm({ lessonSeries: { ...DEFAULT_SERIES, planningMode: 'single' } })
    expect(screen.getByRole('textbox', { name: /lesson focus/i })).toBeInTheDocument()
  })

  it('does not show the lesson focus field in series mode', () => {
    renderForm({ lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' } })
    expect(screen.queryByRole('textbox', { name: /lesson focus/i })).not.toBeInTheDocument()
  })
})

// ── Single lesson — lesson focus field ───────────────────────────────────────

describe('LessonProgressionForm — single lesson focus field', () => {
  it('reflects lessonFocus value', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'single', lessonFocus: 'Place value' },
    })
    expect(screen.getByRole('textbox', { name: /lesson focus/i })).toHaveValue('Place value')
  })

  it('calls onUpdateSeries("lessonFocus", value) when focus changes', () => {
    const onUpdateSeries = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'single' },
      onUpdateSeries,
    })
    fireEvent.change(screen.getByRole('textbox', { name: /lesson focus/i }), {
      target: { value: 'Number bonds' },
    })
    expect(onUpdateSeries).toHaveBeenCalledWith('lessonFocus', 'Number bonds')
  })
})

// ── Loading spinner ───────────────────────────────────────────────────────────

describe('LessonProgressionForm — shows spinner while loading', () => {
  it('shows loading text when loading is true in series mode', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      loading: true,
    })
    expect(screen.getByText(/getting ai recommendation/i)).toBeInTheDocument()
  })

  it('does not show loading text when loading is false', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      loading: false,
    })
    expect(screen.queryByText(/getting ai recommendation/i)).not.toBeInTheDocument()
  })
})

// ── Error state ───────────────────────────────────────────────────────────────

describe('LessonProgressionForm — error and retry', () => {
  it('shows the error message when error is set', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      error: 'functions/unavailable',
    })
    expect(screen.getByText('functions/unavailable')).toBeInTheDocument()
  })

  it('shows a Retry button when error is set', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      error: 'Something went wrong',
    })
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })

  it('calls onFetchRecommendation when Retry is clicked', () => {
    const onFetchRecommendation = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      error: 'Network error',
      onFetchRecommendation,
    })
    fireEvent.click(screen.getByRole('button', { name: /retry/i }))
    expect(onFetchRecommendation).toHaveBeenCalledTimes(1)
  })
})

// ── Recommendation panel ──────────────────────────────────────────────────────

describe('LessonProgressionForm — shows recommendation with count and reason', () => {
  const rec = { count: 4, reason: 'This topic spans four subtopics' }

  it('shows the recommended count', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: rec,
    })
    expect(screen.getByText(/ai recommends 4 lesson/i)).toBeInTheDocument()
  })

  it('shows the reason text', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: rec,
    })
    expect(screen.getByText('This topic spans four subtopics')).toBeInTheDocument()
  })

  it('renders the Accept button with the count', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: rec,
    })
    expect(screen.getByRole('button', { name: /accept \(4 lesson/i })).toBeInTheDocument()
  })

  it('renders the "Get New Suggestion" button', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: rec,
    })
    expect(screen.getByRole('button', { name: /get new suggestion/i })).toBeInTheDocument()
  })

  it('calls onFetchRecommendation when "Get New Suggestion" is clicked', () => {
    const onFetchRecommendation = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: rec,
      onFetchRecommendation,
    })
    fireEvent.click(screen.getByRole('button', { name: /get new suggestion/i }))
    expect(onFetchRecommendation).toHaveBeenCalledTimes(1)
  })
})

// ── Accept generates breakdown ────────────────────────────────────────────────

describe('LessonProgressionForm — accept generates breakdown', () => {
  const rec = { count: 3, reason: 'Three lessons needed' }

  it('calls onUpdateBreakdown with N items when Accept is clicked', () => {
    const onUpdateBreakdown = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: rec,
      onUpdateBreakdown,
    })
    fireEvent.click(screen.getByRole('button', { name: /accept \(3 lesson/i }))
    expect(onUpdateBreakdown).toHaveBeenCalledTimes(1)
    const breakdown = onUpdateBreakdown.mock.calls[0][0]
    expect(breakdown).toHaveLength(3)
  })

  it('generated items have correct lessonNumber sequence', () => {
    const onUpdateBreakdown = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: rec,
      onUpdateBreakdown,
    })
    fireEvent.click(screen.getByRole('button', { name: /accept \(3 lesson/i }))
    const breakdown = onUpdateBreakdown.mock.calls[0][0]
    expect(breakdown.map((b) => b.lessonNumber)).toEqual([1, 2, 3])
  })

  it('generated items use subtopicRow.subtopic in the title', () => {
    const onUpdateBreakdown = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: rec,
      subtopicRow: SUBTOPIC_ROW,
      onUpdateBreakdown,
    })
    fireEvent.click(screen.getByRole('button', { name: /accept \(3 lesson/i }))
    const breakdown = onUpdateBreakdown.mock.calls[0][0]
    expect(breakdown[0].title).toContain('Addition of whole numbers')
  })

  it('generated items have status "pending"', () => {
    const onUpdateBreakdown = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: rec,
      onUpdateBreakdown,
    })
    fireEvent.click(screen.getByRole('button', { name: /accept \(3 lesson/i }))
    const breakdown = onUpdateBreakdown.mock.calls[0][0]
    expect(breakdown.every((b) => b.status === 'pending')).toBe(true)
  })

  it('calls onUpdateSeries("totalLessons", count) when Accept is clicked', () => {
    const onUpdateSeries = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: rec,
      onUpdateSeries,
    })
    fireEvent.click(screen.getByRole('button', { name: /accept \(3 lesson/i }))
    expect(onUpdateSeries).toHaveBeenCalledWith('totalLessons', 3)
  })
})

// ── AI breakdown (titles + focus from the aiLessonCount backend) ─────────────

describe('LessonProgressionForm — accept uses the AI per-lesson breakdown', () => {
  const aiRec = {
    count: 2,
    reason: 'Concept then application.',
    source: 'ai',
    breakdown: [
      { lessonNumber: 1, title: 'Place value recap', focus: 'Revise tens and units.', status: 'pending' },
      { lessonNumber: 2, title: 'Adding with carrying', focus: 'Column addition practice.', status: 'pending' },
    ],
  }

  it('previews the AI lesson titles in the recommendation panel', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: aiRec,
    })
    expect(screen.getByText('Place value recap')).toBeInTheDocument()
    expect(screen.getByText('Adding with carrying')).toBeInTheDocument()
  })

  it('Accept seeds the breakdown with the AI titles and focus', () => {
    const onUpdateBreakdown = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: aiRec,
      onUpdateBreakdown,
    })
    fireEvent.click(screen.getByRole('button', { name: /accept \(2 lesson/i }))
    const breakdown = onUpdateBreakdown.mock.calls[0][0]
    expect(breakdown).toHaveLength(2)
    expect(breakdown[0]).toMatchObject({
      lessonNumber: 1,
      title: 'Place value recap',
      focus: 'Revise tens and units.',
      status: 'pending',
    })
    expect(breakdown[1].title).toBe('Adding with carrying')
  })

  it('Accept records the AI reason on the series', () => {
    const onUpdateSeries = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: aiRec,
      onUpdateSeries,
    })
    fireEvent.click(screen.getByRole('button', { name: /accept \(2 lesson/i }))
    expect(onUpdateSeries).toHaveBeenCalledWith('totalLessons', 2)
    expect(onUpdateSeries).toHaveBeenCalledWith('aiSuggestedReason', 'Concept then application.')
  })

  it('manual build of a different count falls back to default stubs', () => {
    const onUpdateBreakdown = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: aiRec,
      onUpdateBreakdown,
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: /number of lessons/i }), {
      target: { value: '4' },
    })
    fireEvent.click(screen.getByRole('button', { name: /build lessons/i }))
    const breakdown = onUpdateBreakdown.mock.calls[0][0]
    expect(breakdown).toHaveLength(4)
    expect(breakdown[0].title).toContain('Addition of whole numbers')
  })

  it('labels the offline heuristic fallback instead of claiming AI', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: { count: 3, reason: 'One per activity.', source: 'heuristic', breakdown: [] },
    })
    expect(screen.getByText(/suggested pacing: 3 lessons \(offline estimate\)/i)).toBeInTheDocument()
    expect(screen.queryByText(/ai recommends/i)).not.toBeInTheDocument()
  })
})

// ── Manual count builder (always available in series mode) ────────────────────

describe('LessonProgressionForm — manual count builder', () => {
  it('shows the manual "Number of lessons" builder in series mode with no recommendation', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: null,
      loading: false,
      error: null,
    })
    expect(screen.getByRole('spinbutton', { name: /number of lessons/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /build lessons/i })).toBeInTheDocument()
  })

  it('does not show the manual builder in single mode', () => {
    renderForm({ lessonSeries: { ...DEFAULT_SERIES, planningMode: 'single' } })
    expect(screen.queryByRole('button', { name: /build lessons/i })).not.toBeInTheDocument()
  })

  it('builds a breakdown of the typed count even without a recommendation', () => {
    const onUpdateBreakdown = vi.fn()
    const onUpdateSeries = vi.fn()
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      recommendation: null,
      onUpdateBreakdown,
      onUpdateSeries,
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: /number of lessons/i }), {
      target: { value: '4' },
    })
    fireEvent.click(screen.getByRole('button', { name: /build lessons/i }))
    expect(onUpdateBreakdown).toHaveBeenCalledTimes(1)
    expect(onUpdateBreakdown.mock.calls[0][0]).toHaveLength(4)
    expect(onUpdateSeries).toHaveBeenCalledWith('totalLessons', 4)
  })

  it('still offers the manual builder when the suggestion errors', () => {
    renderForm({
      lessonSeries: { ...DEFAULT_SERIES, planningMode: 'series' },
      error: 'functions/unavailable',
    })
    // Error is shown, but the manual path is still available (not blocked).
    expect(screen.getByText('functions/unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /build lessons/i })).toBeInTheDocument()
  })
})

// ── Breakdown list renders ────────────────────────────────────────────────────

describe('LessonProgressionForm — breakdown list renders', () => {
  const breakdown = [
    { lessonNumber: 1, title: 'Lesson 1: Intro', focus: 'Basics', status: 'pending' },
    { lessonNumber: 2, title: 'Lesson 2: Practice', focus: 'Drills', status: 'pending' },
  ]

  it('renders a card for each breakdown item', () => {
    renderForm({ lessonBreakdown: breakdown })
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
  })

  it('renders title inputs for each item', () => {
    renderForm({ lessonBreakdown: breakdown })
    expect(screen.getByRole('textbox', { name: /lesson 1 title/i })).toHaveValue('Lesson 1: Intro')
    expect(screen.getByRole('textbox', { name: /lesson 2 title/i })).toHaveValue('Lesson 2: Practice')
  })

  it('calls onUpdateBreakdown with updated array when a title changes', () => {
    const onUpdateBreakdown = vi.fn()
    renderForm({ lessonBreakdown: breakdown, onUpdateBreakdown })

    fireEvent.change(screen.getByRole('textbox', { name: /lesson 1 title/i }), {
      target: { value: 'Updated Title' },
    })

    expect(onUpdateBreakdown).toHaveBeenCalledTimes(1)
    const next = onUpdateBreakdown.mock.calls[0][0]
    expect(next[0].title).toBe('Updated Title')
    expect(next[1].title).toBe('Lesson 2: Practice')
  })

  it('calls onUpdateBreakdown with reordered array when Move Down is clicked on first item', () => {
    const onUpdateBreakdown = vi.fn()
    renderForm({ lessonBreakdown: breakdown, onUpdateBreakdown })

    const moveDownButtons = screen.getAllByRole('button', { name: /move down/i })
    fireEvent.click(moveDownButtons[0])

    expect(onUpdateBreakdown).toHaveBeenCalledTimes(1)
    const next = onUpdateBreakdown.mock.calls[0][0]
    expect(next[0].title).toBe('Lesson 2: Practice')
    expect(next[1].title).toBe('Lesson 1: Intro')
  })

  it('calls onUpdateBreakdown with item removed when Delete is clicked', () => {
    const onUpdateBreakdown = vi.fn()
    renderForm({ lessonBreakdown: breakdown, onUpdateBreakdown })

    const deleteButtons = screen.getAllByRole('button', { name: /delete lesson/i })
    fireEvent.click(deleteButtons[0])

    expect(onUpdateBreakdown).toHaveBeenCalledTimes(1)
    const next = onUpdateBreakdown.mock.calls[0][0]
    expect(next).toHaveLength(1)
    expect(next[0].title).toBe('Lesson 2: Practice')
  })
})
