/**
 * The Question Bank drawer / bottom sheet inside the builder.
 *
 * The bank UI itself is covered by QuestionBankBrowser.spec.jsx. What is pinned
 * here is what the SHELL is responsible for: the paper's grade/subject/topic
 * seed the filters, the builder is left interactive on desktop, and Use hands
 * the row up rather than inserting — placement is a separate, explicit step
 * (see QuestionBankPlacementPicker).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import QuestionBankPanel from './QuestionBankPanel.jsx'
import { _resetSearchCachesForTests } from '../../../utils/cache/searchCache.js'

const ROWS = [
  {
    id: 'q-frac-1', ownerId: 'u1', type: 'mcq', grade: '4', subject: 'Mathematics',
    topic: 'Fractions', marks: 2, difficulty: 'easy', usageCount: 3, preview: 'Add 1/2 and 1/4',
    data: JSON.stringify({
      text: 'Add 1/2 and 1/4', type: 'mcq', options: ['3/4', '1/2', '2/6', '1/8'],
      correctAnswer: 0, marks: 2, imageDiagram: { libraryKey: 'fraction_bar', params: { parts: 4 } },
    }),
  },
  {
    id: 'q-frac-2', ownerId: 'u1', type: 'short_answer', grade: '4', subject: 'Mathematics',
    topic: 'Fractions', marks: 3, difficulty: 'medium', usageCount: 0, preview: 'Simplify 6/8',
    data: JSON.stringify({ text: 'Simplify 6/8', type: 'short_answer', correctAnswer: '3/4', marks: 3 }),
  },
  {
    id: 'q-geo-1', ownerId: 'u1', type: 'mcq', grade: '4', subject: 'Mathematics',
    topic: 'Geometry', marks: 1, difficulty: 'easy', usageCount: 0, preview: 'Name the shape',
    data: JSON.stringify({ text: 'Name the shape', type: 'mcq', options: ['Square', 'Circle'], correctAnswer: 0, marks: 1 }),
  },
]

const searchQuestionBank = vi.fn()

vi.mock('../../../utils/questionBankService', () => ({
  searchQuestionBank: (...a) => searchQuestionBank(...a),
  parseBankQuestion: (row) => { try { return JSON.parse(row?.data || 'null') } catch { return null } },
  duplicateBankQuestion: vi.fn(async () => 'new-id'),
  editMyBankQuestion: vi.fn(async () => {}),
  toggleFavouriteQuestion: vi.fn(async () => {}),
  listFavouriteIds: vi.fn(async () => new Set()),
  deleteBankQuestion: vi.fn(async () => {}),
  getBankQuestion: vi.fn(async () => null),
  saveQuestionToBank: vi.fn(async () => 'new-id'),
}))

vi.mock('../../../components/diagrams/DiagramSvg', () => ({ default: () => <div data-testid="diagram" /> }))
vi.mock('../../../utils/quizRichText', () => ({ extractRichTextPlain: (v) => (typeof v === 'string' ? v : '') }))

describe('QuestionBankPanel', () => {
  beforeEach(() => {
    _resetSearchCachesForTests()
    searchQuestionBank.mockReset().mockResolvedValue({ rows: ROWS, error: null })
  })

  const context = { grade: '4', subject: 'Mathematics', topic: 'Fractions' }

  it('opens pre-filtered to the paper’s grade, subject and topic', async () => {
    render(<QuestionBankPanel open uid="u1" context={context} onUse={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    expect(screen.getByText('Simplify 6/8')).toBeInTheDocument()
    // Off-topic questions are filtered out, and the topic filter says so.
    expect(screen.queryByText('Name the shape')).not.toBeInTheDocument()
    // The applied topic is stated, with a way out of it.
    expect(screen.getByRole('button', { name: /Clear topic/i })).toBeInTheDocument()
  })

  it('the pre-applied topic is a filter, not a fixed scope', async () => {
    render(<QuestionBankPanel open uid="u1" context={context} onUse={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Clear topic/i }))
    await waitFor(() => expect(screen.getByText('Name the shape')).toBeInTheDocument())
  })

  it('Use hands the row and parsed question up — the drawer never inserts', async () => {
    const onUse = vi.fn()
    render(<QuestionBankPanel open uid="u1" context={context} onUse={onUse} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())

    const card = screen.getByText('Add 1/2 and 1/4').closest('[data-bank-row]')
    fireEvent.click(within(card).getByRole('button', { name: 'Use' }))

    expect(onUse).toHaveBeenCalledTimes(1)
    const [row, question] = onUse.mock.calls[0]
    expect(row.id).toBe('q-frac-1')
    // A parsed copy: mutating it must not reach the stored row string.
    expect(question.imageDiagram).toEqual({ libraryKey: 'fraction_bar', params: { parts: 4 } })
    question.imageDiagram.params.parts = 99
    expect(JSON.parse(ROWS[0].data).imageDiagram.params.parts).toBe(4)
  })

  it('the builder stays interactive behind the drawer on desktop', async () => {
    const { container } = render(
      <QuestionBankPanel open uid="u1" context={context} onUse={vi.fn()} onClose={vi.fn()} />,
    )
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    // The scrim that would block the paper is small-screen only, so the drawer
    // sits BESIDE the builder on desktop rather than over it.
    const scrim = container.querySelector('.fixed.inset-0.bg-black\\/30')
    expect(scrim).toBeTruthy()
    expect(scrim.className).toMatch(/md:hidden/)
  })

  it('renders as a bottom sheet on a phone and a right-hand drawer on desktop', async () => {
    render(<QuestionBankPanel open uid="u1" context={context} onUse={vi.fn()} onClose={vi.fn()} />)
    const panel = screen.getByLabelText('Question bank')
    // Phone: pinned to the bottom edge. Desktop: released and pinned right.
    expect(panel.className).toMatch(/inset-x-0/)
    expect(panel.className).toMatch(/bottom-0/)
    expect(panel.className).toMatch(/md:right-0/)
    expect(panel.className).toMatch(/md:top-0/)
  })

  it('is closed and inert until opened, and closes on the ×', async () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <QuestionBankPanel open={false} uid="u1" context={context} onUse={vi.fn()} onClose={onClose} />,
    )
    const panel = screen.getByLabelText('Question bank')
    expect(panel).toHaveAttribute('aria-hidden', 'true')
    // A closed drawer does not read the bank.
    expect(searchQuestionBank).not.toHaveBeenCalled()

    rerender(<QuestionBankPanel open uid="u1" context={context} onUse={vi.fn()} onClose={onClose} />)
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Close question bank/i }))
    expect(onClose).toHaveBeenCalled()
  })
})
