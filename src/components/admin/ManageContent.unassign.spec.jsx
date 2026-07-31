/**
 * Behaviour test for the Unassign guard in /admin/content.
 *
 * Scope: one thing, because one thing is what broke. Unassign writes
 * `isPublished: false`, and BOTH read clauses on `quizzes/{id}` require that
 * field — so doing it to a quiz a past paper links to takes the paper's quiz
 * offline for every learner, paid included, while the paper goes on showing a
 * Start Quiz button. Twelve papers sat like that.
 *
 * `quizPaperLink.test.js` covers the detection. What THIS pins is the wiring:
 * that the menu item actually routes through the guard, that the write does
 * not happen until the admin confirms, and that an ordinary practice quiz is
 * not slowed down by a dialog it does not need. Re-pointing `unassign:` back
 * at the unguarded handler is a one-identifier edit; it should fail here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {}, storage: {} }))

const mockUpdateQuiz = vi.fn().mockResolvedValue(undefined)
const mockGetAllQuizzes = vi.fn()
const mockListPapers = vi.fn()

vi.mock('../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getAllLessons: mockGetAllLessons,
    updateLesson: vi.fn(),
    deleteLesson: vi.fn(),
    getAllQuizzes: mockGetAllQuizzes,
    updateQuiz: mockUpdateQuiz,
    deleteQuiz: vi.fn(),
    createQuiz: vi.fn(),
    saveQuestions: vi.fn(),
  }),
}))
const mockGetAllLessons = vi.fn()

vi.mock('../../utils/pastPapers', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listAllPapersForAdmin: (...a) => mockListPapers(...a) }
})
// Pulls the document importer → the AI assistant → a real getFunctions(app)
// at module load; out of scope here (same reason as AdminPastPapers.spec).
vi.mock('../../utils/paperToQuizConverter', () => ({ convertPaperToQuizDraft: vi.fn() }))
// examService calls getFunctions(app) at module load for the daily-exam
// callables. ManageContent only wants `todayString` from it.
vi.mock('../../utils/examService', () => ({ todayString: () => '2026-07-31' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'admin-1' } }) }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn() }
})

import ManageContent from './ManageContent'

const LINKED_QUIZ = {
  id: 'q-linked',
  title: 'Grade 7 Social Studies 2019 — Quiz',
  subject: 'social-studies',
  grade: '7',
  isPublished: true,
  publicAccess: true,
  quizType: 'past_paper',
  questionCount: 60,
}

const PLAIN_QUIZ = {
  id: 'q-plain',
  title: 'Fractions practice',
  subject: 'mathematics',
  grade: '7',
  isPublished: true,
  quizType: 'practice',
  questionCount: 10,
}

const LINKING_PAPER = {
  id: 'p-ss-2019',
  title: 'Grade 7 Social Studies Past Paper 2019',
  grade: '7',
  subject: 'social-studies',
  year: 2019,
  status: 'published',
  quizId: 'q-linked',
}

async function openRowMenu(user, quizTitle) {
  const row = (await screen.findByText(quizTitle)).closest('div[class]')
  expect(row).toBeTruthy()
  // The menu button is the only "More actions" control inside the row's card.
  const card = (await screen.findByText(quizTitle)).closest('li, div[class*="rounded"]') || row
  const button = card.querySelector('button[aria-label="More actions"]')
    || screen.getAllByLabelText('More actions')[0]
  await user.click(button)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAllLessons.mockResolvedValue([])
  mockListPapers.mockResolvedValue([LINKING_PAPER])
  try { localStorage.setItem('zx:mc:tab', 'quizzes') } catch { /* jsdom */ }
})

describe('ManageContent — unassigning a quiz a past paper links to', () => {
  it('does not write until the admin confirms', async () => {
    mockGetAllQuizzes.mockResolvedValue([LINKED_QUIZ])
    const user = userEvent.setup()
    render(<MemoryRouter><ManageContent /></MemoryRouter>)

    await openRowMenu(user, LINKED_QUIZ.title)
    await user.click(await screen.findByText('Unassign'))

    // The guard is the whole point: the destructive write must not have run.
    expect(mockUpdateQuiz).not.toHaveBeenCalled()
    expect(await screen.findByText(/attached to a past paper/i)).toBeInTheDocument()
  })

  it('names the paper that would break, and says the paper stays visible', async () => {
    mockGetAllQuizzes.mockResolvedValue([LINKED_QUIZ])
    const user = userEvent.setup()
    render(<MemoryRouter><ManageContent /></MemoryRouter>)

    await openRowMenu(user, LINKED_QUIZ.title)
    await user.click(await screen.findByText('Unassign'))

    const dialog = await screen.findByText(/stays visible in the archive/i)
    expect(dialog).toBeInTheDocument()
    expect(screen.getByText(/Grade 7 Social Studies Past Paper 2019/)).toBeInTheDocument()
  })

  it('cancelling leaves the quiz published', async () => {
    mockGetAllQuizzes.mockResolvedValue([LINKED_QUIZ])
    const user = userEvent.setup()
    render(<MemoryRouter><ManageContent /></MemoryRouter>)

    await openRowMenu(user, LINKED_QUIZ.title)
    await user.click(await screen.findByText('Unassign'))
    await user.click(screen.getByRole('button', { name: /cancel/i }))

    expect(mockUpdateQuiz).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(screen.queryByText(/attached to a past paper/i)).not.toBeInTheDocument()
    })
  })

  it('confirming still performs the unassign — this warns, it does not forbid', async () => {
    mockGetAllQuizzes.mockResolvedValue([LINKED_QUIZ])
    const user = userEvent.setup()
    render(<MemoryRouter><ManageContent /></MemoryRouter>)

    await openRowMenu(user, LINKED_QUIZ.title)
    await user.click(await screen.findByText('Unassign'))
    await user.click(screen.getByRole('button', { name: /unassign anyway/i }))

    await waitFor(() => expect(mockUpdateQuiz).toHaveBeenCalledTimes(1))
    expect(mockUpdateQuiz).toHaveBeenCalledWith('q-linked', expect.objectContaining({ isPublished: false }))
  })
})

describe('ManageContent — unassigning an ordinary practice quiz', () => {
  it('unassigns in one click, with no dialog', async () => {
    // The guard must not tax the common case.
    mockGetAllQuizzes.mockResolvedValue([PLAIN_QUIZ])
    mockListPapers.mockResolvedValue([])
    const user = userEvent.setup()
    render(<MemoryRouter><ManageContent /></MemoryRouter>)

    await openRowMenu(user, PLAIN_QUIZ.title)
    await user.click(await screen.findByText('Unassign'))

    await waitFor(() => expect(mockUpdateQuiz).toHaveBeenCalledTimes(1))
    expect(mockUpdateQuiz).toHaveBeenCalledWith('q-plain', expect.objectContaining({ isPublished: false }))
    expect(screen.queryByText(/attached to a past paper/i)).not.toBeInTheDocument()
  })
})
