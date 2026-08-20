/**
 * The cover — the screen that has to sell sitting a 90-minute exam to a
 * 12-year-old, and the one place the mode choice is made.
 *
 * Three behaviours are pinned here because they are decisions rather than
 * styling, and each fails silently:
 *
 *   • there is NO remembered default (§1). A child who practised yesterday may
 *     want the real thing today, so nothing reads a stored mode.
 *   • the best-score card is HIDDEN on a first attempt. A ring at 0/60 above
 *     the words "best score" is a discouraging thing to show a child who has
 *     not started, and an empty ring renders perfectly well.
 *   • a locked Exam card still names what the learner CAN do. §8's carried-over
 *     guardrail: the leave path is never a dead end.
 */

import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

import PaperQuizCover from './PaperQuizCover'
import { EXAM_ACCESS } from '../lib/examAccess'
import { QUIZ_MODE } from '../lib/quizModes'

const PAPER = { id: 'p1', title: 'Grade 7 English', subject: 'english', grade: 7, year: 2026, sourceLabel: 'PRISCA mock' }

function renderCover(overrides = {}) {
  const props = {
    paper: PAPER,
    totalQuestions: 60,
    durationMin: 90,
    subjectLabel: 'English',
    history: null,
    examAccess: { allowed: true, reason: EXAM_ACCESS.OK },
    mode: QUIZ_MODE.EXAM,
    onModeChange: vi.fn(),
    strictForward: false,
    onStrictForwardChange: vi.fn(),
    onStart: vi.fn(),
    starting: false,
    startError: '',
    bookmarked: false,
    onToggleBookmark: vi.fn(),
    onOpenHistory: vi.fn(),
    onBack: vi.fn(),
    ...overrides,
  }
  render(<MemoryRouter><PaperQuizCover {...props} /></MemoryRouter>)
  return props
}

describe('PaperQuizCover', () => {
  it('states the paper\'s own facts, not a template\'s', () => {
    renderCover()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('Grade 7')).toBeInTheDocument()
    expect(screen.getByText('2026')).toBeInTheDocument()
    expect(screen.getByText('60')).toBeInTheDocument()
    // The duration is the PAPER's, and it reaches the exam card's copy too.
    expect(screen.getByText('90')).toBeInTheDocument()
    expect(screen.getByText(/90 minutes on the clock/)).toBeInTheDocument()
  })

  it('hides the best-score card entirely on a first attempt', () => {
    renderCover({ history: null })
    expect(screen.queryByText(/BEST SCORE/)).not.toBeInTheDocument()
    expect(screen.queryByText(/practised this paper/)).not.toBeInTheDocument()
  })

  it('shows the best score, the count and the weakest part once there is one', () => {
    renderCover({
      history: { attempts: 2, best: { right: 38, total: 60, percent: 63 }, weakestPart: 'Spelling' },
    })
    expect(screen.getByText('BEST SCORE')).toBeInTheDocument()
    expect(screen.getByText('38')).toBeInTheDocument()
    expect(screen.getByText(/twice/)).toBeInTheDocument()
    expect(screen.getByText(/Spelling is your weakest part/)).toBeInTheDocument()
  })

  it('expands only the SELECTED mode card', () => {
    // A screen offering two choices should not be a wall of sixteen bullets.
    renderCover({ mode: QUIZ_MODE.EXAM })
    expect(screen.getByText(/The clock counts down/)).toBeInTheDocument()
    expect(screen.queryByText(/Every answer is explained/)).not.toBeInTheDocument()
  })

  it('reports a mode change rather than remembering one', async () => {
    // §1: "there is no remembered default." The parent owns the choice; this
    // component never reads or writes a preference.
    const props = renderCover({ mode: QUIZ_MODE.EXAM })
    await userEvent.click(screen.getByRole('button', { name: /Practice/ }))
    expect(props.onModeChange).toHaveBeenCalledWith(QUIZ_MODE.PRACTICE)
  })

  it('offers the exam settings only in exam mode', async () => {
    renderCover({ mode: QUIZ_MODE.EXAM })
    expect(screen.getByText('Strict order')).toBeInTheDocument()
    // The reassurance panel — a child about to give up ninety minutes is told,
    // BEFORE they start, that a refresh will not take it away.
    expect(screen.getByText('Safe from reloads')).toBeInTheDocument()
  })

  it('does not offer exam settings in practice mode', () => {
    renderCover({ mode: QUIZ_MODE.PRACTICE })
    expect(screen.queryByText('Strict order')).not.toBeInTheDocument()
  })

  it('strictForward is OFF by default and is a real switch', async () => {
    const props = renderCover({ strictForward: false })
    const sw = screen.getByRole('switch', { name: /Strict order/i })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(sw)
    expect(props.onStrictForwardChange).toHaveBeenCalledWith(true)
  })

  it('a locked exam card names what the learner CAN do instead', () => {
    // §8: the leave path is never a dead end, and a mode card that only says
    // "no" is a dead end with a padlock on it.
    renderCover({ examAccess: { allowed: false, reason: EXAM_ACCESS.NEEDS_FULL_PAPER } })
    expect(screen.getByText('Exam mode needs the whole paper')).toBeInTheDocument()
    expect(screen.getByText(/Practise the free section now/)).toBeInTheDocument()
  })

  it('never shows a price, a plan or a currency (§8)', () => {
    renderCover({ examAccess: { allowed: false, reason: EXAM_ACCESS.NEEDS_FULL_PAPER } })
    const text = document.body.textContent
    expect(text).not.toMatch(/kwacha|ZMW|premium|subscri|upgrade|\bpay\b/i)
  })

  it('refuses to start an exam the learner may not sit', () => {
    renderCover({ examAccess: { allowed: false, reason: EXAM_ACCESS.NEEDS_FULL_PAPER } })
    expect(screen.getByRole('button', { name: /Start the exam/ })).toBeDisabled()
  })

  it('surfaces a start failure rather than swallowing it', () => {
    renderCover({ startError: 'You need a connection to start an exam.' })
    expect(screen.getByText(/You need a connection/)).toBeInTheDocument()
  })
})
