/**
 * Behaviour tests for ExamResultsPage.jsx — the post-exam results + leaderboard
 * screen (/exam-results/:attemptId), previously without component coverage.
 *
 * These guard the load state machine and the score/tab rendering:
 *   - loading / not-found error screens,
 *   - the ScoreCard (percentage, marks, pass vs needs-work),
 *   - switching to the Leaderboard tab and rendering a subscribed row,
 *   - the "View Corrections" lazy fetch.
 *
 * All Firestore/sound/gamification services and heavy visual leaves are stubbed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

const mockGetExamAttempt = vi.fn()
const mockGetExamWithQuestions = vi.fn()
vi.mock('../../../utils/examService', () => ({
  getExamAttempt: (...a) => mockGetExamAttempt(...a),
  getExamWithQuestions: (...a) => mockGetExamWithQuestions(...a),
}))

const mockSubscribe = vi.fn()
const mockGetDailyLeaderboard = vi.fn()
vi.mock('../../../utils/examLeaderboardService', () => ({
  subscribeToDailyLeaderboard: (...a) => mockSubscribe(...a),
  getDailyLeaderboard: (...a) => mockGetDailyLeaderboard(...a),
  fmtDuration: (s) => `${s ?? 0}s`,
}))

const mockRecordExamCompletion = vi.fn()
const mockComputeRivalry = vi.fn()
vi.mock('../../../utils/gamificationService', () => ({
  recordExamCompletion: (...a) => mockRecordExamCompletion(...a),
  computeRivalry: (...a) => mockComputeRivalry(...a),
}))

vi.mock('../../../hooks/useSoundEffects', () => ({
  default: () => ({
    isMuted: false,
    toggleMute: vi.fn(),
    playSuccess: vi.fn(),
    playClick: vi.fn(),
    playWarning: vi.fn(),
    primeSounds: vi.fn(),
  }),
}))

vi.mock('../../../components/layout/Navbar', () => ({ default: () => null }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('../components/ExamCelebrations', () => ({ default: () => null }))
vi.mock('../../../editor/RichContent', () => ({
  default: ({ value }) => <span>{typeof value === 'string' ? value : ''}</span>,
}))
vi.mock('../../../shared/components/icons', () => ({ Volume2: () => null, VolumeX: () => null }))

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useParams: () => ({ attemptId: 'att-1' }) }
})

let mockCurrentUser = { uid: 'learner-1' }
vi.mock('../../../contexts/AuthContext', () => ({
  useAuth: () => ({ currentUser: mockCurrentUser }),
}))

import ExamResultsPage from './ExamResultsPage'

// ── Fixtures ────────────────────────────────────────────────────────────────

function attemptDoc(overrides = {}) {
  return {
    id: 'att-1',
    examId: 'exam-1',
    userId: 'someone-else', // != current user → skips the celebration effect
    subject: 'Mathematics',
    grade: '5',
    percentage: 72,
    score: 18,
    totalMarks: 25,
    totalQuestions: 25,
    performanceLevel: 'Very Good',
    timeTakenSeconds: 540,
    status: 'submitted',
    attemptDate: '2026-07-08',
    strengths: [],
    weaknesses: [],
    ...overrides,
  }
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/exam-results/att-1']}>
      <ExamResultsPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCurrentUser = { uid: 'learner-1' }
  mockGetExamAttempt.mockResolvedValue(attemptDoc())
  mockSubscribe.mockReturnValue(() => {}) // unsubscribe fn
  mockGetDailyLeaderboard.mockResolvedValue([])
  mockRecordExamCompletion.mockResolvedValue({ stats: {} })
  mockComputeRivalry.mockReturnValue(null)
})

// ── Tests ─────────────────────────────────────────────────────────────────

describe('ExamResultsPage — load states', () => {
  it('shows the loading screen before the attempt resolves', () => {
    mockGetExamAttempt.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(screen.getByText(/Loading results/i)).toBeInTheDocument()
  })

  it('shows the not-found card when the attempt is missing', async () => {
    mockGetExamAttempt.mockResolvedValue(null)
    renderPage()
    expect(await screen.findByText(/Result not found/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Back to Exams/i })).toBeInTheDocument()
  })

  it('surfaces a friendly error when the load throws', async () => {
    mockGetExamAttempt.mockRejectedValue(new Error('network'))
    renderPage()
    expect(await screen.findByText(/Could not load result/i)).toBeInTheDocument()
  })
})

describe('ExamResultsPage — score + tabs', () => {
  it('renders the score card with percentage, marks and a pass verdict', async () => {
    renderPage()
    expect(await screen.findByText('72%')).toBeInTheDocument()
    expect(screen.getByText(/18 \/ 25 marks/)).toBeInTheDocument()
    expect(screen.getByText(/Passed ✓/)).toBeInTheDocument()
    expect(screen.getByText('Exam Complete')).toBeInTheDocument()
    expect(screen.getByText(/Mathematics · Grade 5/)).toBeInTheDocument()
  })

  it('shows a "Needs work" verdict below 50%', async () => {
    mockGetExamAttempt.mockResolvedValue(attemptDoc({ percentage: 40, score: 10 }))
    renderPage()
    expect(await screen.findByText('40%')).toBeInTheDocument()
    expect(screen.getByText(/Needs work/)).toBeInTheDocument()
  })

  it('switches to the Leaderboard tab and renders a subscribed entry', async () => {
    mockSubscribe.mockImplementation((_filters, onUpdate) => {
      onUpdate([
        { attemptId: 'att-1', userId: 'learner-1', displayName: 'Me', rank: 1, percentage: 72, score: 18, totalMarks: 25, timeTakenSeconds: 540 },
      ])
      return () => {}
    })
    renderPage()
    await screen.findByText('72%')

    fireEvent.click(screen.getByRole('button', { name: 'Leaderboard' }))
    expect(await screen.findByText(/Today's Leaderboard/i)).toBeInTheDocument()
    expect(screen.getByText(/Me \(You\)/)).toBeInTheDocument()
    expect(mockSubscribe).toHaveBeenCalledWith(
      { subject: 'Mathematics', date: '2026-07-08' },
      expect.any(Function),
    )
  })

  it('lazily fetches questions when "View Corrections" is clicked', async () => {
    mockGetExamWithQuestions.mockResolvedValue({ questions: [] })
    renderPage()
    await screen.findByText('72%')

    fireEvent.click(screen.getAllByRole('button', { name: /View Corrections/i })[0])
    await waitFor(() =>
      expect(mockGetExamWithQuestions).toHaveBeenCalledWith('exam-1', 'att-1'),
    )
  })
})

describe('ExamResultsPage — completion rewards', () => {
  it('awards XP via the leaderboard lookup for the owner\'s submitted attempt', async () => {
    mockCurrentUser = { uid: 'learner-1' }
    mockGetExamAttempt.mockResolvedValue(attemptDoc({ userId: 'learner-1' }))
    renderPage()
    await screen.findByText('72%')
    await waitFor(() => expect(mockRecordExamCompletion).toHaveBeenCalledTimes(1))
    expect(mockRecordExamCompletion).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'learner-1' }),
    )
  })

  it('does not award XP when viewing someone else\'s attempt', async () => {
    renderPage() // default fixture userId = 'someone-else'
    await screen.findByText('72%')
    await waitFor(() => expect(mockRecordExamCompletion).not.toHaveBeenCalled())
  })
})
