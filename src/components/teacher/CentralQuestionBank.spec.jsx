/**
 * Regression for three bugs in CentralQuestionBank's "Use" button:
 *
 * (a) navigator.clipboard?.writeText fired without await inside a sync
 *     try/catch — async rejections were unhandled while the success toast
 *     fired regardless.
 * (b) Missing navigator.clipboard silently no-oped with a success toast.
 * (c) Payload was JSON.stringify(q) which parsePastedQuestions cannot parse.
 *
 * Fix: async handleUse, clipboard-absent fallback toast, payload built by the
 * new exported questionToPasteText helper in the format the parser accepts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import CentralQuestionBank, { questionToPasteText } from './CentralQuestionBank.jsx'
import { parsePastedQuestions } from '../../utils/pasteQuestionParser.js'
import { _resetSearchCachesForTests } from '../../utils/cache/searchCache.js'

// ── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: { uid: 'u-test' } }),
}))

const mockSearchQuestionBank = vi.fn()
const mockListFavouriteIds   = vi.fn()

vi.mock('../../utils/questionBankService', () => ({
  searchQuestionBank:     (...a) => mockSearchQuestionBank(...a),
  parseBankQuestion:      (row)  => { try { return JSON.parse(row?.data || 'null') } catch { return null } },
  duplicateBankQuestion:  vi.fn(async () => {}),
  editMyBankQuestion:     vi.fn(async () => {}),
  toggleFavouriteQuestion:vi.fn(async () => {}),
  listFavouriteIds:       (...a) => mockListFavouriteIds(...a),
}))

// extractRichTextPlain: treat all values as plain strings in these tests.
vi.mock('../../utils/quizRichText.js', () => ({
  extractRichTextPlain: (v) => (typeof v === 'string' ? v : ''),
}))

// SeoHelmet doesn't affect behaviour; suppress its DOM side-effects.
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MCQ_Q = {
  type: 'mcq',
  text: 'What is the capital of Zambia?',
  options: ['Lusaka', 'Ndola', 'Kitwe', 'Livingstone'],
  correctAnswer: 0,
  marks: 2,
}

const SHORT_Q = {
  type: 'short_answer',
  text: 'Name the longest river in Zambia.',
  options: [],
  correctAnswer: 'The Zambezi River',
  marks: 3,
}

function makeRow(q) {
  return {
    id: 'q-1', ownerId: 'u-test',
    type: q.type, grade: '7', subject: 'Social Studies',
    marks: q.marks,
    data: JSON.stringify(q),
  }
}

// ── Pure-function round-trip tests ───────────────────────────────────────────

describe('questionToPasteText → parsePastedQuestions round-trip', () => {
  it('MCQ: produces exactly 1 question with correct text, options, answer and marks', () => {
    const text   = questionToPasteText(MCQ_Q, { marks: 2 })
    const parsed = parsePastedQuestions(text)

    expect(parsed).toHaveLength(1)
    const q = parsed[0]
    expect(q.text).toBe('What is the capital of Zambia?')
    expect(q.type).toBe('mcq')
    expect(q.options[0]).toBe('Lusaka')
    expect(q.options[1]).toBe('Ndola')
    expect(q.options[2]).toBe('Kitwe')
    expect(q.options[3]).toBe('Livingstone')
    expect(q.correctAnswer).toBe(0)  // A → index 0
    expect(q.marks).toBe(2)
  })

  it('non-MCQ: produces exactly 1 question with correct text, answer and marks', () => {
    const text   = questionToPasteText(SHORT_Q, { marks: 3 })
    const parsed = parsePastedQuestions(text)

    expect(parsed).toHaveLength(1)
    const q = parsed[0]
    expect(q.text).toBe('Name the longest river in Zambia.')
    expect(q.marks).toBe(3)
    expect(q.correctAnswer).toBe('The Zambezi River')
  })
})

// ── handleUse integration tests ──────────────────────────────────────────────

describe('CentralQuestionBank handleUse clipboard behaviour', () => {
  beforeEach(() => {
    // Each test remounts the component fresh — reset the shared search cache
    // too, so a previous test's cached result never masks whether this
    // test's mock is actually being called.
    _resetSearchCachesForTests()
    mockSearchQuestionBank.mockReset().mockResolvedValue({ rows: [makeRow(MCQ_Q)], error: null })
    mockListFavouriteIds.mockReset().mockResolvedValue(new Set())
  })

  afterEach(() => {
    // Restore clipboard to whatever it was so tests don't bleed into each other.
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
      writable: true,
    })
  })

  it('shows the fallback toast (not success) when navigator.clipboard is undefined', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined, configurable: true, writable: true,
    })

    render(<CentralQuestionBank />)
    const btn = await screen.findByRole('button', { name: /^use$/i })
    fireEvent.click(btn)

    await waitFor(() =>
      expect(screen.getByText(/open the question bank picker/i)).toBeInTheDocument()
    )
    // The success toast must not appear.
    expect(screen.queryByText(/question copied/i)).not.toBeInTheDocument()
  })

  it('shows the fallback toast and no unhandled rejection when writeText rejects', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'))
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true, writable: true,
    })

    render(<CentralQuestionBank />)
    const btn = await screen.findByRole('button', { name: /^use$/i })
    fireEvent.click(btn)

    // If the rejection were unhandled, Vitest would fail the test. A passing
    // test means the rejection was caught inside handleUse.
    await waitFor(() =>
      expect(screen.getByText(/open the question bank picker/i)).toBeInTheDocument()
    )
    expect(screen.queryByText(/question copied/i)).not.toBeInTheDocument()
  })

  it('shows the success toast when writeText resolves', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true, writable: true,
    })

    render(<CentralQuestionBank />)
    const btn = await screen.findByRole('button', { name: /^use$/i })
    fireEvent.click(btn)

    await waitFor(() =>
      expect(screen.getByText(/question copied/i)).toBeInTheDocument()
    )
    expect(writeText).toHaveBeenCalledTimes(1)
    // The payload written to the clipboard must be parseable by the paste importer.
    const payload = writeText.mock.calls[0][0]
    expect(parsePastedQuestions(payload)).toHaveLength(1)
  })
})
