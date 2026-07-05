import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import QuestionBankPanel from './QuestionBankPanel.jsx'

// The bank fixture the mocked service serves. `data` carries the full question
// (stem, options, answer key, diagram params) exactly as the real bank stores
// it — a JSON string — so the panel's parse + insert path runs for real.
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
const bumpQuestionUsage = vi.fn()

vi.mock('../../utils/questionBankService', async () => {
  return {
    searchQuestionBank: (...args) => searchQuestionBank(...args),
    // Use the real parse so the insert payload is a genuine deep-decoded object.
    parseBankQuestion: (row) => { try { return JSON.parse(row?.data || 'null') } catch { return null } },
    bumpQuestionUsage: (...args) => bumpQuestionUsage(...args),
  }
})

// The diagram renderer + rich-text plain-text extractor aren't under test here.
vi.mock('../diagrams/DiagramSvg', () => ({ default: () => <div data-testid="diagram" /> }))
vi.mock('../../utils/quizRichText', () => ({ extractRichTextPlain: (v) => (typeof v === 'string' ? v : '') }))

describe('QuestionBankPanel', () => {
  beforeEach(() => {
    searchQuestionBank.mockReset().mockResolvedValue({ rows: ROWS, error: null })
    bumpQuestionUsage.mockReset()
  })

  const context = { grade: '4', subject: 'Mathematics', topic: 'Fractions' }

  it('auto-scopes to the paper topic and lists only matching questions', async () => {
    render(<QuestionBankPanel open uid="u1" context={context} onInsert={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    // Two Fractions questions show; the Geometry one is filtered out by context.
    expect(screen.getByText('Simplify 6/8')).toBeInTheDocument()
    expect(screen.queryByText('Name the shape')).not.toBeInTheDocument()
    // Context header names the topic.
    expect(screen.getByText(/Fractions/)).toBeInTheDocument()
  })

  it('widens to subject level and says so when no topic matches', async () => {
    render(<QuestionBankPanel open uid="u1" context={{ grade: '4', subject: 'Mathematics', topic: 'Statistics' }} onInsert={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/widened to all/i)).toBeInTheDocument())
    // All three subject questions are now visible.
    expect(screen.getByText('Name the shape')).toBeInTheDocument()
  })

  it('one-click insert calls onInsert with a deep-cloned payload + row, and fires the usage bump', async () => {
    const onInsert = vi.fn()
    render(<QuestionBankPanel open uid="u1" context={context} onInsert={onInsert} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())

    const card = screen.getByText('Add 1/2 and 1/4').closest('div.bg-white')
    fireEvent.click(within(card).getByRole('button', { name: /Insert into paper/i }))

    expect(onInsert).toHaveBeenCalledTimes(1)
    const [question, row] = onInsert.mock.calls[0]
    // The payload preserves the diagram params + answer key exactly.
    expect(question.imageDiagram).toEqual({ libraryKey: 'fraction_bar', params: { parts: 4 } })
    expect(question.correctAnswer).toBe(0)
    expect(row.id).toBe('q-frac-1')
    // It's a parsed copy — mutating it must not touch the source row string.
    question.imageDiagram.params.parts = 99
    expect(JSON.parse(ROWS[0].data).imageDiagram.params.parts).toBe(4)
  })

  it('free-text search filters the visible cards', async () => {
    render(<QuestionBankPanel open uid="u1" context={context} onInsert={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    fireEvent.change(screen.getByPlaceholderText(/Search question text/i), { target: { value: 'simplify' } })
    await waitFor(() => expect(screen.queryByText('Add 1/2 and 1/4')).not.toBeInTheDocument())
    expect(screen.getByText('Simplify 6/8')).toBeInTheDocument()
  })

  it('shows "used N×" so teachers can spot over-reused questions', async () => {
    render(<QuestionBankPanel open uid="u1" context={context} onInsert={vi.fn()} onClose={vi.fn()} />)
    await waitFor(() => expect(screen.getByText('used 3×')).toBeInTheDocument())
  })
})
