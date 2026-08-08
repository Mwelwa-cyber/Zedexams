/**
 * The one Question Bank UI — the component that renders both as the studio's
 * bank view and as the builder's insert drawer.
 *
 * What is pinned here is what the standalone `/teacher/question-bank` page used
 * to do and must keep doing after the move (search, every filter, preview,
 * star, duplicate, edit, delete-own), plus the two rules the move introduced:
 * **Use writes nothing to the bank**, and **editing a Master-Bank question
 * forks it** instead of writing to shared content.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import QuestionBankBrowser from './QuestionBankBrowser.jsx'
import { _resetSearchCachesForTests } from '../../utils/cache/searchCache.js'

// `data` carries the full question as a JSON string, exactly as the bank
// stores it, so the parse path runs for real.
const ROWS = [
  {
    id: 'q-frac-1', ownerId: 'u1', type: 'mcq', grade: '4', subject: 'Mathematics',
    topic: 'Fractions', marks: 2, difficulty: 'easy', usageCount: 3, source: 'manual',
    hasDiagram: true, preview: 'Add 1/2 and 1/4', createdAt: { seconds: 300 },
    data: JSON.stringify({
      text: 'Add 1/2 and 1/4', type: 'mcq', options: ['3/4', '1/2', '2/6', '1/8'],
      correctAnswer: 0, marks: 2, imageDiagram: { libraryKey: 'fraction_bar', params: { parts: 4 } },
    }),
  },
  {
    id: 'q-frac-2', ownerId: 'u1', type: 'short_answer', grade: '4', subject: 'Mathematics',
    topic: 'Fractions', marks: 3, difficulty: 'medium', usageCount: 0, source: 'ai',
    preview: 'Simplify 6/8', createdAt: { seconds: 200 },
    data: JSON.stringify({ text: 'Simplify 6/8', type: 'short_answer', correctAnswer: '3/4', marks: 3 }),
  },
  {
    id: 'q-master-1', ownerId: 'someone-else', masterEligible: true, type: 'mcq', grade: '4',
    subject: 'Mathematics', topic: 'Geometry', marks: 1, difficulty: 'easy', usageCount: 11,
    preview: 'Name the shape', version: 4, createdAt: { seconds: 100 },
    data: JSON.stringify({ text: 'Name the shape', type: 'mcq', options: ['Square', 'Circle'], correctAnswer: 0, marks: 1 }),
  },
]

const searchQuestionBank = vi.fn()
const duplicateBankQuestion = vi.fn()
const editMyBankQuestion = vi.fn()
const toggleFavouriteQuestion = vi.fn()
const listFavouriteIds = vi.fn()
const deleteBankQuestion = vi.fn()
const getBankQuestion = vi.fn()
const saveQuestionToBank = vi.fn()

vi.mock('../../utils/questionBankService', () => ({
  searchQuestionBank: (...a) => searchQuestionBank(...a),
  parseBankQuestion: (row) => { try { return JSON.parse(row?.data || 'null') } catch { return null } },
  duplicateBankQuestion: (...a) => duplicateBankQuestion(...a),
  editMyBankQuestion: (...a) => editMyBankQuestion(...a),
  toggleFavouriteQuestion: (...a) => toggleFavouriteQuestion(...a),
  listFavouriteIds: (...a) => listFavouriteIds(...a),
  deleteBankQuestion: (...a) => deleteBankQuestion(...a),
  getBankQuestion: (...a) => getBankQuestion(...a),
  saveQuestionToBank: (...a) => saveQuestionToBank(...a),
}))

vi.mock('../diagrams/DiagramSvg', () => ({ default: () => <div data-testid="diagram" /> }))
vi.mock('../../utils/quizRichText', () => ({ extractRichTextPlain: (v) => (typeof v === 'string' ? v : '') }))

function card(text) {
  return screen.getByText(text).closest('[data-bank-row]')
}

async function openMenu(text) {
  fireEvent.click(within(card(text)).getByRole('button', { name: /More actions/i }))
  return screen.getByRole('menu')
}

describe('QuestionBankBrowser', () => {
  beforeEach(() => {
    _resetSearchCachesForTests()
    searchQuestionBank.mockReset().mockResolvedValue({ rows: ROWS, error: null })
    duplicateBankQuestion.mockReset().mockResolvedValue('q-fork-1')
    editMyBankQuestion.mockReset().mockResolvedValue(undefined)
    toggleFavouriteQuestion.mockReset().mockResolvedValue(true)
    listFavouriteIds.mockReset().mockResolvedValue(new Set())
    deleteBankQuestion.mockReset().mockResolvedValue(undefined)
    getBankQuestion.mockReset().mockResolvedValue({ id: 'q-fork-1', ownerId: 'u1', version: 1, data: ROWS[2].data })
    saveQuestionToBank.mockReset()
  })

  const renderBrowser = (props = {}) =>
    render(<QuestionBankBrowser uid="u1" onUse={vi.fn()} {...props} />)

  it('lists the teacher’s own questions and the Master Bank together', async () => {
    renderBrowser()
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    expect(screen.getByText('Simplify 6/8')).toBeInTheDocument()
    expect(screen.getByText('Name the shape')).toBeInTheDocument()
    expect(within(card('Name the shape')).getByText(/Master/)).toBeInTheDocument()
  })

  it('opens pre-filtered to the seeded grade/subject/topic, and the topic clears', async () => {
    renderBrowser({ initialFilters: { grade: '4', subject: 'Mathematics', topic: 'Fractions' } })
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    // Geometry is out of scope while the paper's topic is applied…
    expect(screen.queryByText('Name the shape')).not.toBeInTheDocument()
    // …and the filter is the teacher's to change, not a fixed scope.
    fireEvent.click(screen.getByRole('button', { name: /Clear topic/i }))
    await waitFor(() => expect(screen.getByText('Name the shape')).toBeInTheDocument())
  })

  it('narrows on keyword, type, difficulty, marks, source, diagram and scope', async () => {
    renderBrowser()
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText(/Search the question bank/i), { target: { value: 'simplify' } })
    await waitFor(() => expect(screen.queryByText('Add 1/2 and 1/4')).not.toBeInTheDocument())
    expect(screen.getByText('Simplify 6/8')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Search the question bank/i), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText(/Filter by question type/i), { target: { value: 'short_answer' } })
    await waitFor(() => expect(screen.queryByText('Add 1/2 and 1/4')).not.toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Filter by question type/i), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText(/Filter by difficulty/i), { target: { value: 'medium' } })
    await waitFor(() => expect(screen.getByText('Simplify 6/8')).toBeInTheDocument())
    expect(screen.queryByText('Name the shape')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Filter by difficulty/i), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText(/Filter by marks/i), { target: { value: '3' } })
    await waitFor(() => expect(screen.queryByText('Add 1/2 and 1/4')).not.toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Filter by marks/i), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText(/Filter by source/i), { target: { value: 'ai' } })
    await waitFor(() => expect(screen.getByText('Simplify 6/8')).toBeInTheDocument())
    expect(screen.queryByText('Add 1/2 and 1/4')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Filter by source/i), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText(/Filter by diagram/i), { target: { value: 'yes' } })
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    expect(screen.queryByText('Simplify 6/8')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Filter by diagram/i), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText(/Source bank/i), { target: { value: 'master' } })
    await waitFor(() => expect(screen.getByText('Name the shape')).toBeInTheDocument())
    expect(screen.queryByText('Add 1/2 and 1/4')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/Source bank/i), { target: { value: 'mine' } })
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    expect(screen.queryByText('Name the shape')).not.toBeInTheDocument()
  })

  it('sorts by most used', async () => {
    renderBrowser()
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Sort questions/i), { target: { value: 'mostUsed' } })
    await waitFor(() => {
      const stems = [...document.querySelectorAll('[data-bank-row] p')].map(n => n.textContent)
      expect(stems[0]).toBe('Name the shape')
    })
  })

  it('one search reaches Firestore however many filters are then changed', async () => {
    renderBrowser()
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    expect(searchQuestionBank).toHaveBeenCalledTimes(1)
    fireEvent.change(screen.getByLabelText(/Filter by difficulty/i), { target: { value: 'easy' } })
    fireEvent.change(screen.getByLabelText(/Search the question bank/i), { target: { value: 'shape' } })
    await waitFor(() => expect(screen.getByText('Name the shape')).toBeInTheDocument())
    expect(searchQuestionBank).toHaveBeenCalledTimes(1)
  })

  it('preview shows the stem, options, the marked answer and the metadata', async () => {
    renderBrowser()
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    fireEvent.click(within(card('Add 1/2 and 1/4')).getByRole('button', { name: 'Preview' }))
    const dialog = await screen.findByRole('dialog', { name: /Question preview/i })
    expect(within(dialog).getByText(/A\. 3\/4/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Answer:/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Grade 4/)).toBeInTheDocument()
  })

  it('Use hands the row and the parsed question up — and writes NOTHING to the bank', async () => {
    const onUse = vi.fn()
    renderBrowser({ onUse })
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    fireEvent.click(within(card('Add 1/2 and 1/4')).getByRole('button', { name: 'Use' }))

    expect(onUse).toHaveBeenCalledTimes(1)
    const [row, question] = onUse.mock.calls[0]
    expect(row.id).toBe('q-frac-1')
    expect(question.correctAnswer).toBe(0)
    expect(question.imageDiagram).toEqual({ libraryKey: 'fraction_bar', params: { parts: 4 } })
    // The whole point of copy-on-insert: Use creates no bank document.
    expect(saveQuestionToBank).not.toHaveBeenCalled()
    expect(duplicateBankQuestion).not.toHaveBeenCalled()
    expect(editMyBankQuestion).not.toHaveBeenCalled()
  })

  it('star, duplicate and delete-own live behind the ⋯ menu', async () => {
    renderBrowser()
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())

    fireEvent.click(within(await openMenu('Add 1/2 and 1/4')).getByText(/Star this question/i))
    await waitFor(() => expect(toggleFavouriteQuestion).toHaveBeenCalledWith(
      'u1', 'q-frac-1', true, expect.objectContaining({ subject: 'Mathematics' }),
    ))

    fireEvent.click(within(await openMenu('Add 1/2 and 1/4')).getByText(/Duplicate into my bank/i))
    await waitFor(() => expect(duplicateBankQuestion).toHaveBeenCalledWith('u1', expect.objectContaining({ id: 'q-frac-1' })))

    fireEvent.click(within(await openMenu('Add 1/2 and 1/4')).getByText(/Delete from my bank/i))
    // Destructive, so it is confirmed rather than done on the click.
    expect(deleteBankQuestion).not.toHaveBeenCalled()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deleteBankQuestion).toHaveBeenCalledWith('q-frac-1'))
  })

  it('a Master-Bank question offers no delete — it is not the teacher’s to remove', async () => {
    renderBrowser()
    await waitFor(() => expect(screen.getByText('Name the shape')).toBeInTheDocument())
    const menu = await openMenu('Name the shape')
    expect(within(menu).queryByText(/Delete from my bank/i)).not.toBeInTheDocument()
  })

  it('editing a Master-Bank question FORKS it — the master record is never written to', async () => {
    renderBrowser()
    await waitFor(() => expect(screen.getByText('Name the shape')).toBeInTheDocument())
    fireEvent.click(within(await openMenu('Name the shape')).getByText(/Edit a copy in my bank/i))

    const dialog = await screen.findByRole('dialog', { name: /Edit question/i })
    fireEvent.change(within(dialog).getByLabelText(/Question text/i), { target: { value: 'Name this shape' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(editMyBankQuestion).toHaveBeenCalled())
    // Forked FIRST, then edited — and the edit targets the copy's id, never the master's.
    expect(duplicateBankQuestion).toHaveBeenCalledWith('u1', expect.objectContaining({ id: 'q-master-1' }))
    expect(editMyBankQuestion.mock.calls[0][0]).toBe('q-fork-1')
    expect(editMyBankQuestion.mock.calls[0][1]).toMatchObject({ text: 'Name this shape' })
  })

  it('editing an own question edits it in place, with no fork', async () => {
    renderBrowser()
    await waitFor(() => expect(screen.getByText('Simplify 6/8')).toBeInTheDocument())
    fireEvent.click(within(await openMenu('Simplify 6/8')).getByText(/^Edit$/))
    const dialog = await screen.findByRole('dialog', { name: /Edit question/i })
    fireEvent.change(within(dialog).getByLabelText(/Question text/i), { target: { value: 'Simplify 6/8 fully' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(editMyBankQuestion).toHaveBeenCalled())
    expect(duplicateBankQuestion).not.toHaveBeenCalled()
    expect(editMyBankQuestion.mock.calls[0][0]).toBe('q-frac-2')
  })

  it('a failed read is reported, never rendered as an empty bank', async () => {
    searchQuestionBank.mockResolvedValue({ rows: [], error: 'offline' })
    renderBrowser()
    await waitFor(() => expect(screen.getByText(/Could not load the question bank/i)).toBeInTheDocument())
    expect(screen.queryByText(/No questions found/i)).not.toBeInTheDocument()
  })

  it('an empty result with filters on offers to clear them', async () => {
    renderBrowser()
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
    fireEvent.change(screen.getByLabelText(/Search the question bank/i), { target: { value: 'zzzz' } })
    await waitFor(() => expect(screen.getByText(/No questions found/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /Clear all filters/i }))
    await waitFor(() => expect(screen.getByText('Add 1/2 and 1/4')).toBeInTheDocument())
  })
})
