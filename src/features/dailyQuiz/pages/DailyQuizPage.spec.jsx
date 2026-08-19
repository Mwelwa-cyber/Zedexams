/**
 * DailyQuizPage.spec — the runner's behaviour, in a DOM.
 *
 * The pure decisions are covered by `test:daily-quiz-view`; what needs a DOM
 * is the part that is easy to get subtly wrong and impossible to see in a
 * pure test: that an answer is locked the moment it is tapped, that the
 * feedback shown is the SERVER'S verdict rather than something the client
 * worked out, and that a practice set never claims points.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('../../../firebase/config', () => ({ default: {}, auth: {}, db: {} }))
vi.mock('../../../utils/analytics', () => ({ capture: vi.fn() }))

const mocks = vi.hoisted(() => ({
  getTodaysQuiz: vi.fn(),
  answerDailyQuizQuestion: vi.fn(),
}))
vi.mock('../services/dailyQuizService', () => ({
  getTodaysQuiz: mocks.getTodaysQuiz,
  answerDailyQuizQuestion: mocks.answerDailyQuizQuestion,
}))

import DailyQuizPage from './DailyQuizPage'

const QUESTIONS = [
  { id: 'q1', subject: 'Mathematics', text: 'What is ¾ of 48?', options: ['32', '36', '12', '64'] },
  { id: 'q2', subject: 'English', text: 'Choose the conjunction', options: ['because', 'but'] },
]

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/daily']}>
      <Routes>
        <Route path="/daily" element={<DailyQuizPage />} />
        <Route path="/daily/leaderboard" element={<div>BOARD ROUTE</div>} />
        <Route path="/dashboard" element={<div>HOME ROUTE</div>} />
        <Route path="/quizzes" element={<div>QUIZZES ROUTE</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

const ranked = (over = {}) => ({
  date: '2026-08-20', grade: '7', ranked: true, status: 'ok',
  questions: QUESTIONS, alreadyPlayed: false, result: null, canRank: true, ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getTodaysQuiz.mockResolvedValue(ranked())
})

describe('DailyQuizPage', () => {
  it('starts from the intro and shows the first question', async () => {
    renderPage()
    fireEvent.click(await screen.findByText('Start today’s quiz'))
    expect(await screen.findByText('What is ¾ of 48?')).toBeInTheDocument()
    expect(screen.getByText('Question 1 of 2')).toBeInTheDocument()
  })

  it('shows the SERVER’s verdict, not one the client worked out', async () => {
    // The client never holds the answer key, so the only thing it may render
    // is what the server sent back for the question just answered.
    mocks.answerDailyQuizQuestion.mockResolvedValue({
      questionId: 'q1', correct: false, correctAnswer: 1,
      explanation: '¾ of 48 means 48 ÷ 4 = 12, then 12 × 3 = 36.',
      finalised: false, answeredCount: 1, total: 2,
    })
    renderPage()
    fireEvent.click(await screen.findByText('Start today’s quiz'))
    fireEvent.click(await screen.findByText('32'))

    expect(await screen.findByText('Not this time')).toBeInTheDocument()
    expect(screen.getByText(/48 ÷ 4 = 12/)).toBeInTheDocument()
    // The chosen option was sent; no score was.
    expect(mocks.answerDailyQuizQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ questionId: 'q1', chosen: 0 }),
    )
    const payload = mocks.answerDailyQuizQuestion.mock.calls[0][0]
    for (const forged of ['score', 'points', 'correct']) {
      expect(payload).not.toHaveProperty(forged)
    }
  })

  it('locks the answer the moment it is tapped', async () => {
    // Re-answering would let a learner walk the options until one came back
    // green — the server refuses too, but the client must not offer it.
    mocks.answerDailyQuizQuestion.mockResolvedValue({
      questionId: 'q1', correct: true, correctAnswer: 0, explanation: '',
      finalised: false, answeredCount: 1, total: 2,
    })
    renderPage()
    fireEvent.click(await screen.findByText('Start today’s quiz'))
    fireEvent.click(await screen.findByText('32'))
    await screen.findByText(/Correct/)

    fireEvent.click(screen.getByText('36'))
    fireEvent.click(screen.getByText('12'))
    await waitFor(() => {
      expect(mocks.answerDailyQuizQuestion).toHaveBeenCalledTimes(1)
    })
  })

  it('lands on the result when the last answer finalises the attempt', async () => {
    // The last answer finalises server-side, so the result rides back with
    // it — there is no separate submit to lose.
    mocks.answerDailyQuizQuestion
      .mockResolvedValueOnce({
        questionId: 'q1', correct: true, correctAnswer: 0, explanation: '',
        finalised: false, answeredCount: 1, total: 2,
      })
      .mockResolvedValueOnce({
        questionId: 'q2', correct: true, correctAnswer: 1, explanation: '',
        finalised: true, answeredCount: 2, total: 2,
        result: {
          correct: 2, credited: 2, total: 2, points: 30, allCorrect: true,
          ranked: true, rankHidden: false,
          perQuestion: [
            { questionId: 'q1', subject: 'Mathematics', correct: true, correctAnswer: 0, explanation: '' },
            { questionId: 'q2', subject: 'English', correct: true, correctAnswer: 1, explanation: '' },
          ],
        },
      })

    renderPage()
    fireEvent.click(await screen.findByText('Start today’s quiz'))
    fireEvent.click(await screen.findByText('32'))
    fireEvent.click(await screen.findByText('Next question'))
    fireEvent.click(await screen.findByText('but'))

    expect(await screen.findByText('2 out of 2')).toBeInTheDocument()
    expect(screen.getByText(/\+30 points added to this week/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('See the leaderboard'))
    expect(screen.getByText('BOARD ROUTE')).toBeInTheDocument()
  })

  it('a learner who already played sees their result, not a replayable quiz', async () => {
    mocks.getTodaysQuiz.mockResolvedValue(ranked({
      alreadyPlayed: true,
      result: {
        correct: 1, credited: 1, total: 2, points: 10, allCorrect: false, ranked: true,
        perQuestion: [{ questionId: 'q1', subject: 'Mathematics', correct: true, correctAnswer: 0, explanation: '' }],
      },
    }))
    renderPage()
    expect(await screen.findByText('1 out of 2')).toBeInTheDocument()
    expect(screen.queryByText('Start today’s quiz')).toBeNull()
  })

  it('an unranked learner is told warmly, never refused', async () => {
    // The /child-safety promise: a learner waiting on their guardian plays
    // and keeps their score — they just do not appear on the board.
    mocks.getTodaysQuiz.mockResolvedValue(ranked({
      alreadyPlayed: true,
      result: {
        correct: 2, credited: 2, total: 2, points: 30, allCorrect: true,
        ranked: false, rankHidden: true, perQuestion: [],
      },
    }))
    renderPage()
    expect(await screen.findByText(/parent or guardian says it’s OK/)).toBeInTheDocument()
  })

  it('a practice set is labelled, and never claims points', async () => {
    mocks.getTodaysQuiz.mockResolvedValue(ranked({ ranked: false, status: 'practice' }))
    renderPage()
    expect(await screen.findByText(/don’t count towards the leaderboard/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Practise 2 anyway'))
    fireEvent.click(await screen.findByText('32'))
    // The server refuses to score practice, so the client must not ask it to.
    expect(mocks.answerDailyQuizQuestion).not.toHaveBeenCalled()
    expect(await screen.findByText('Answer saved')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Next question'))
    fireEvent.click(await screen.findByText('but'))
    fireEvent.click(await screen.findByText('See your result'))
    expect(await screen.findByText(/doesn’t count towards the board/)).toBeInTheDocument()
    expect(screen.queryByText(/points added to this week/)).toBeNull()
  })

  it('a failed load is honest and offers a way out — never "no quiz today"', async () => {
    mocks.getTodaysQuiz.mockRejectedValue(new Error('offline'))
    renderPage()
    expect(await screen.findByText(/We couldn’t load it just now/)).toBeInTheDocument()
    expect(screen.queryByText(/No quiz today/)).toBeNull()
    fireEvent.click(screen.getByText('Back to Home'))
    expect(screen.getByText('HOME ROUTE')).toBeInTheDocument()
  })

  it('an empty pool sends the learner somewhere real rather than dead-ending', async () => {
    mocks.getTodaysQuiz.mockResolvedValue(ranked({ ranked: false, questions: [] }))
    renderPage()
    expect(await screen.findByText('Nothing to practise yet')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Browse quizzes'))
    expect(screen.getByText('QUIZZES ROUTE')).toBeInTheDocument()
  })

  it('a voided question is shown as removed, not as a free correct answer', async () => {
    mocks.answerDailyQuizQuestion.mockResolvedValue({
      questionId: 'q1', correct: true, correctAnswer: null, explanation: '',
      voided: true, finalised: false, answeredCount: 1, total: 2,
    })
    renderPage()
    fireEvent.click(await screen.findByText('Start today’s quiz'))
    fireEvent.click(await screen.findByText('32'))
    expect(await screen.findByText('This question was removed')).toBeInTheDocument()
    expect(screen.getByText(/Everyone gets the points/)).toBeInTheDocument()
  })

  it('never renders a countdown', async () => {
    // Elapsed time is recorded as the board's tie-break and is never shown.
    const { container } = renderPage()
    fireEvent.click(await screen.findByText('Start today’s quiz'))
    await screen.findByText('What is ¾ of 48?')
    expect(container.textContent).not.toMatch(/\d+:\d{2}/)
    expect(container.textContent).not.toMatch(/seconds? left|time left|timer/i)
  })
})
