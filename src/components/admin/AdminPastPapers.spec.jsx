/**
 * Behaviour tests for AdminPastPapers.jsx — /admin/papers.
 *
 * Scope: the quiz-pending surface added when the Studio's Quiz step became
 * optional. The list is where an admin who batch-uploaded an archive finds
 * the papers still owing a quiz, so what matters is that a pending paper is
 * VISIBLY pending, that the filter lists exactly those papers, and that
 * "Add quiz" deep-links back into the wizard's Quiz step rather than
 * restarting the wizard at Upload.
 *
 * The Firestore-backed list service is mocked; nothing here touches the
 * convert-to-quiz path.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {}, storage: {} }))

const mockListAll = vi.fn()
vi.mock('../../utils/pastPapers', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listAllPapersForAdmin: (...a) => mockListAll(...a) }
})
// The convert-to-quiz path pulls in the document importer → the AI assistant →
// a real getFunctions(app) at module load. Out of scope here and unmockable
// through the firebase config stub alone.
vi.mock('../../utils/paperToQuizConverter', () => ({ convertPaperToQuizDraft: vi.fn() }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'admin-1' } }) }))
vi.mock('../../hooks/useFirestore', () => ({
  useFirestore: () => ({ createQuiz: vi.fn(), saveQuestions: vi.fn() }),
}))
vi.mock('../../shared/components/SeoHelmet', () => ({ default: () => null }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn() }
})

import AdminPastPapers from './AdminPastPapers'

const PAPERS = [
  // Published with the Quiz step skipped — the case this feature exists for.
  {
    id: 'pending-1', title: 'Grade 7 Maths 2024', grade: '7', subject: 'mathematics',
    year: 2024, status: 'published', quizStatus: 'pending', quizId: null,
    pendingQuizId: 'draft-q',
  },
  // Published with a quiz attached.
  {
    id: 'attached-1', title: 'Grade 7 English 2024', grade: '7', subject: 'english',
    year: 2024, status: 'published', quizStatus: 'attached', quizId: 'q-en',
  },
  // Uploaded before quizStatus existed, but it has a quiz — must NOT be
  // reported as pending just because the field is missing.
  {
    id: 'legacy-1', title: 'Grade 12 Biology 2019', grade: '12', subject: 'biology',
    year: 2019, status: 'published', quizId: 'q-bio',
  },
]

function renderList() {
  return render(<MemoryRouter><AdminPastPapers /></MemoryRouter>)
}

function rowFor(title) {
  return screen.getByText(title).closest('li')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockListAll.mockResolvedValue(PAPERS)
})

describe('AdminPastPapers — quiz-pending surface', () => {
  it('badges only the paper whose quiz is pending', async () => {
    renderList()
    expect(await screen.findByText('Grade 7 Maths 2024')).toBeInTheDocument()
    expect(within(rowFor('Grade 7 Maths 2024')).getByText('Quiz pending')).toBeInTheDocument()
    expect(within(rowFor('Grade 7 English 2024')).queryByText('Quiz pending')).not.toBeInTheDocument()
    expect(within(rowFor('Grade 12 Biology 2019')).queryByText('Quiz pending')).not.toBeInTheDocument()
  })

  it('deep-links "Add quiz" to the wizard\'s Quiz step, not to Upload', async () => {
    renderList()
    await screen.findByText('Grade 7 Maths 2024')
    const action = within(rowFor('Grade 7 Maths 2024')).getByRole('link', { name: 'Add quiz' })
    expect(action).toHaveAttribute('href', '/admin/papers/pending-1/edit?step=quiz')
  })

  it('offers no "Add quiz" action on a paper that already has one', async () => {
    renderList()
    await screen.findByText('Grade 7 English 2024')
    expect(within(rowFor('Grade 7 English 2024')).queryByRole('link', { name: 'Add quiz' }))
      .not.toBeInTheDocument()
  })

  it('counts the backlog in the header', async () => {
    renderList()
    expect(await screen.findByText(/1 pending quiz\)/)).toBeInTheDocument()
  })

  it('the "Quiz pending" filter lists exactly the pending papers', async () => {
    const user = userEvent.setup()
    renderList()
    await screen.findByText('Grade 7 Maths 2024')
    await user.click(screen.getByRole('button', { name: /^Quiz pending/ }))
    expect(screen.getByText('Grade 7 Maths 2024')).toBeInTheDocument()
    expect(screen.queryByText('Grade 7 English 2024')).not.toBeInTheDocument()
    expect(screen.queryByText('Grade 12 Biology 2019')).not.toBeInTheDocument()
  })

  it('the quiz filter composes with the publish-status filter rather than replacing it', async () => {
    // A paper has both a publish status and a quiz status; the two axes have
    // to be independent or "Published + Quiz pending" — the whole point of the
    // optional-quiz flow — becomes unaskable.
    mockListAll.mockResolvedValue([
      ...PAPERS,
      {
        id: 'draft-1', title: 'Grade 7 Science 2025', grade: '7', subject: 'science',
        year: 2025, status: 'draft',
      },
    ])
    const user = userEvent.setup()
    renderList()
    await screen.findByText('Grade 7 Science 2025')
    await user.click(screen.getByRole('button', { name: /^Quiz pending/ }))
    expect(screen.getByText('Grade 7 Science 2025')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Published' }))
    expect(screen.getByText('Grade 7 Maths 2024')).toBeInTheDocument()
    expect(screen.queryByText('Grade 7 Science 2025')).not.toBeInTheDocument()
  })

  it('shows no pending badge or count when every paper has its quiz', async () => {
    mockListAll.mockResolvedValue(PAPERS.filter((p) => p.id !== 'pending-1'))
    renderList()
    await screen.findByText('Grade 7 English 2024')
    expect(screen.queryByText('Quiz pending')).toBeInTheDocument() // the filter chip
    expect(screen.queryAllByRole('link', { name: 'Add quiz' })).toHaveLength(0)
    expect(screen.queryByText(/pending quiz/)).not.toBeInTheDocument()
  })
})
