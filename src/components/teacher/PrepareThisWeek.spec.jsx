import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PrepareThisWeek from './PrepareThisWeek'

vi.mock('../../utils/analytics', () => ({ capture: vi.fn() }))

function renderCard(props) {
  return render(
    <MemoryRouter>
      <PrepareThisWeek {...props} />
    </MemoryRouter>,
  )
}

const READY_PREP = {
  empty: false,
  stage: 'plan',
  context: {
    grade: 'G4',
    gradeLabel: 'Grade 4',
    subject: 'integrated science',
    subjectLabel: 'Integrated Science',
    termNumber: 2,
    weekNumber: 8,
    rangeLabel: '18 May 2026 – 22 May 2026',
  },
  rows: [
    { key: 'scheme', label: 'Scheme of Work selected', detail: 'Integrated Science · Term 2', status: 'done', done: 1, target: 1, to: '/teacher/library/abc', meta: '✓' },
    { key: 'focus', label: 'Weekly Focus: 3 of 5 days prepared', detail: 'Day-by-day plan', status: 'progress', done: 3, target: 5, to: '/teacher/library/def', meta: '3 / 5' },
    { key: 'lessons', label: 'Lesson plans: 2 of 5 completed', detail: 'CBC lessons', status: 'progress', done: 2, target: 5, to: '/teacher/generate/lesson-plan', meta: '2 / 5' },
    { key: 'worksheet', label: 'Worksheet: 1 created', detail: 'Ready to assign or print', status: 'done', done: 1, target: 1, to: '/teacher/generate/worksheet', meta: '1 created' },
    { key: 'record', label: 'Record of Work: not updated', detail: 'Log your teaching', status: 'alert', done: 0, target: 1, to: '/teacher/generate/record-of-work', meta: 'Not updated' },
  ],
  continueTo: '/teacher/library/def',
  viewWeekTo: '/teacher/library/def',
}

describe('PrepareThisWeek', () => {
  it('shows an accessible loading skeleton', () => {
    renderCard({ loading: true, error: false, prep: null })
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.getByText(/loading your weekly preparation/i)).toBeInTheDocument()
  })

  it('shows the error state with a working retry', () => {
    const onRetry = vi.fn()
    renderCard({ loading: false, error: true, prep: null, onRetry })
    expect(screen.getByText(/could not load your weekly preparation/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(screen.getByRole('link', { name: /open weekly focus/i }))
      .toHaveAttribute('href', '/teacher/generate/weekly-forecast')
  })

  it('shows the set-up empty state when there is no context', () => {
    renderCard({ loading: false, error: false, prep: { empty: true, emptyReason: 'no-context', rows: [] } })
    expect(screen.getByText(/set up your grade, subjects and current term/i)).toBeInTheDocument()
    // Labelled for what it does today (opens Weekly Focus) — NOT "Set up
    // Teaching Profile", which doesn't exist yet.
    expect(screen.getByRole('link', { name: /choose grade, subject and term/i }))
      .toHaveAttribute('href', '/teacher/generate/weekly-forecast')
    expect(screen.queryByText(/set up teaching profile/i)).not.toBeInTheDocument()
  })

  it('switches to Prepare for Next Term during school holidays', () => {
    renderCard({
      loading: false,
      error: false,
      prep: {
        ...READY_PREP,
        mode: 'next-term',
        stage: 'plan',
        rows: READY_PREP.rows.slice(0, 2),
        context: {
          ...READY_PREP.context,
          termNumber: 3,
          weekNumber: 1,
          openLabel: '7 September 2026',
          daysToOpen: 26,
        },
      },
    })
    expect(screen.getByText('Prepare for Next Term')).toBeInTheDocument()
    expect(screen.queryByText('Prepare This Week')).not.toBeInTheDocument()
    expect(screen.getByText(/school opens 7 september 2026 · in 26 days/i)).toBeInTheDocument()
    // No weekly stepper and no current-week completion rows while closed.
    expect(screen.queryByRole('list', { name: /weekly stages/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/lesson plans: /i)).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /prepare week 1/i })).toBeInTheDocument()
  })

  it('marks creation-date fallback counts as estimated', () => {
    const prep = {
      ...READY_PREP,
      rows: READY_PREP.rows.map((r) =>
        r.key === 'lessons' ? { ...r, meta: '≈ 2 / 5', estimated: true } : r,
      ),
    }
    renderCard({ loading: false, error: false, prep })
    expect(screen.getByText('≈ 2 / 5')).toHaveAttribute('title', expect.stringMatching(/estimated from creation dates/i))
    expect(screen.getByText(/\(estimated from creation dates\)/i)).toBeInTheDocument()
  })

  it('renders context, stages, clickable rows and actions when ready', () => {
    renderCard({ loading: false, error: false, prep: READY_PREP })
    expect(screen.getByText('Prepare This Week')).toBeInTheDocument()
    expect(screen.getByText('Grade 4 · Term 2 · Week 8 · Integrated Science')).toBeInTheDocument()
    expect(screen.getByText('18 May 2026 – 22 May 2026')).toBeInTheDocument()

    // Stepper shows all four stages with Plan current.
    for (const label of ['Plan', 'Teach', 'Assess', 'Record']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('(current stage)')).toBeInTheDocument()

    // Every row is a link to its studio/document.
    expect(screen.getByRole('link', { name: /scheme of work selected/i }))
      .toHaveAttribute('href', '/teacher/library/abc')
    expect(screen.getByRole('link', { name: /weekly focus: 3 of 5/i }))
      .toHaveAttribute('href', '/teacher/library/def')
    expect(screen.getByRole('link', { name: /lesson plans: 2 of 5/i }))
      .toHaveAttribute('href', '/teacher/generate/lesson-plan')
    expect(screen.getByRole('link', { name: /record of work: not updated/i }))
      .toHaveAttribute('href', '/teacher/generate/record-of-work')

    // Primary + secondary actions.
    expect(screen.getByRole('link', { name: /continue weekly preparation/i }))
      .toHaveAttribute('href', '/teacher/library/def')
    expect(screen.getByRole('link', { name: /view week/i }))
      .toHaveAttribute('href', '/teacher/library/def')
  })
})
