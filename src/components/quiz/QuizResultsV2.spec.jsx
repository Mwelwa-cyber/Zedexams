/**
 * Regression tests for QuizResultsV2.jsx — guards the pass-state celebration
 * (POLISH_PLAN item 2F). A learner who scores at or above the pass mark (50%)
 * should see the confetti burst over the score card; a learner below it should
 * not; and the burst must be skipped entirely when the OS asks for reduced
 * motion.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// firebase/config.js runs initializeApp at import time — stub it so the
// component tree can import without a real Firebase project.
vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))

const mockGetResultById = vi.fn()
const mockGetQuestions = vi.fn()
const mockGetQuizById = vi.fn()
vi.mock('../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getResultById: mockGetResultById,
    getQuestions: mockGetQuestions,
    getQuizById: mockGetQuizById,
  }),
}))

vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ userProfile: { role: 'learner' } }),
}))

vi.mock('../../hooks/useSoundEffects', () => ({
  default: () => ({
    isMuted: false,
    toggleMute: vi.fn(),
    playSuccess: vi.fn(),
    playClick: vi.fn(),
    playWarning: vi.fn(),
    primeSounds: vi.fn(),
  }),
}))

// Heavy / unrelated leaves — stub to keep the render light.
vi.mock('../../editor/RichContent', () => ({ default: () => null, getRichPlainText: () => '' }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('../diagrams/DiagramSvg', () => ({ default: () => null }))
vi.mock('../../utils/aiAssistant', () => ({ explainQuizAnswer: vi.fn() }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => ({ resultId: 'r1' }) }
})

import QuizResultsV2 from './QuizResultsV2'

// 🎊 appears only in the celebration overlay — none of the score messages
// (🏆 / 👏 / 💪 / 📖) use it, so it's an unambiguous marker for "did the
// confetti render?".
const CONFETTI_MARKER = '🎊'

function setupResult(percentage) {
  mockGetResultById.mockResolvedValue({
    quizId: 'q1', percentage, score: percentage, totalMarks: 100,
    grade: 7, subject: 'Mathematics', mode: 'practice', timeSpent: 60,
    answers: {}, topicScores: {},
  })
  mockGetQuizById.mockResolvedValue({ passages: [] })
  mockGetQuestions.mockResolvedValue([])
}

function renderResults() {
  return render(<MemoryRouter><QuizResultsV2 /></MemoryRouter>)
}

beforeEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals() })

describe('QuizResultsV2 — pass-state celebration', () => {
  it('shows the confetti burst when the learner passes (well above the mark)', async () => {
    setupResult(80)
    renderResults()
    await waitFor(() => expect(screen.getByText('Excellent!')).toBeInTheDocument())
    expect(screen.getByText(CONFETTI_MARKER)).toBeInTheDocument()
  })

  it('shows the confetti burst at exactly the 50% pass threshold', async () => {
    setupResult(50)
    renderResults()
    await waitFor(() => expect(screen.getByText('Getting There!')).toBeInTheDocument())
    expect(screen.getByText(CONFETTI_MARKER)).toBeInTheDocument()
  })

  it('does NOT show the celebration below the pass mark', async () => {
    setupResult(35)
    renderResults()
    await waitFor(() => expect(screen.getByText('Keep Practicing!')).toBeInTheDocument())
    expect(screen.queryByText(CONFETTI_MARKER)).not.toBeInTheDocument()
  })

  it('skips the celebration when the learner prefers reduced motion', async () => {
    // Stubbed global is auto-restored by vi.unstubAllGlobals() in beforeEach.
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }))
    setupResult(90)
    renderResults()
    await waitFor(() => expect(screen.getByText('Excellent!')).toBeInTheDocument())
    expect(screen.queryByText(CONFETTI_MARKER)).not.toBeInTheDocument()
  })
})
