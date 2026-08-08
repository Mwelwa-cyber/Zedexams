/**
 * /admin/content must not publish a past paper that has no established source.
 *
 * WHY THIS EXISTS. `firestore.rules` refuses a learner read of a published
 * paper whose `sourceConfidence` is not established, and the published-list
 * index is built with the same filter. So publishing an unlabelled paper is a
 * write that SUCCEEDS and achieves nothing: the admin is told "✅ Paper
 * published" and no learner will ever see it. A rejected write would at least
 * be visible; a silent success is not.
 *
 * The Past Paper Studio blocks this at its own Publish step (pinned in
 * PastPaperStudio.spec.jsx). This screen is the OTHER door — a row toggle and
 * a bulk action — and it is the one an admin reaches for while working through
 * the archive right after the source migration, which is exactly when
 * unlabelled papers are most common.
 *
 * Both directions are asserted: the guard blocks the unlabelled paper AND lets
 * the labelled one through. A guard that blocked everything would satisfy half
 * these tests while breaking publishing outright.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {}, storage: {} }))

const mockUpdatePaper = vi.fn().mockResolvedValue(undefined)
const mockListPapers = vi.fn()
const mockGetAllQuizzes = vi.fn()
const mockGetAllLessons = vi.fn()

vi.mock('../../hooks/useFirestore', () => ({
  useFirestore: () => ({
    getAllLessons: mockGetAllLessons,
    updateLesson: vi.fn(),
    deleteLesson: vi.fn(),
    getAllQuizzes: mockGetAllQuizzes,
    updateQuiz: vi.fn(),
    deleteQuiz: vi.fn(),
    createQuiz: vi.fn(),
    saveQuestions: vi.fn(),
  }),
}))

vi.mock('../../utils/pastPapers', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    listAllPapersForAdmin: (...a) => mockListPapers(...a),
    updatePaper: (...a) => mockUpdatePaper(...a),
  }
})
// Same module-load side effects the sibling spec sidesteps: the document
// importer reaches getFunctions(app), and examService does too.
vi.mock('../../utils/paperToQuizConverter', () => ({ convertPaperToQuizDraft: vi.fn() }))
vi.mock('../../utils/examService', () => ({ todayString: () => '2026-08-08' }))
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'admin-1' } }) }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => vi.fn() }
})

import ManageContent from './ManageContent'

const UNLABELLED = {
  id: 'p-unlabelled',
  title: 'In 2022 Maths',
  grade: '7',
  subject: 'mathematics',
  year: 2022,
  status: 'draft',
  source: null,
  sourceConfidence: 'unknown',
}

const LABELLED = {
  id: 'p-labelled',
  title: 'Grade 7 Mathematics — Paper 1 · ECZ · 2023',
  grade: '7',
  subject: 'mathematics',
  year: 2023,
  status: 'draft',
  source: 'ecz',
  isOfficial: true,
  sourceConfidence: 'explicit',
}

/** Open the row menu for a paper and click its Publish entry. */
async function publishFromRowMenu(user, title) {
  const card = (await screen.findByText(title)).closest('li, div[class*="rounded"]')
  const button = card?.querySelector('button[aria-label="More actions"]')
    || screen.getAllByLabelText('More actions')[0]
  await user.click(button)
  await user.click(await screen.findByText('Publish'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAllLessons.mockResolvedValue([])
  mockGetAllQuizzes.mockResolvedValue([])
  // The Past Papers tab is persisted under this key; its id is 'pastpapers'.
  try { localStorage.setItem('zed:cl:tab', 'pastpapers') } catch { /* jsdom */ }
})

describe('ManageContent — publishing a past paper with no source', () => {
  it('refuses, and writes NOTHING', async () => {
    mockListPapers.mockResolvedValue([UNLABELLED])
    const user = userEvent.setup()
    render(<MemoryRouter><ManageContent /></MemoryRouter>)

    await publishFromRowMenu(user, UNLABELLED.title)

    expect(mockUpdatePaper).not.toHaveBeenCalled()
  })

  it('says WHY, and where to fix it — not just "failed"', async () => {
    mockListPapers.mockResolvedValue([UNLABELLED])
    const user = userEvent.setup()
    render(<MemoryRouter><ManageContent /></MemoryRouter>)

    await publishFromRowMenu(user, UNLABELLED.title)

    expect(await screen.findByText(/needs a source/i)).toBeInTheDocument()
    expect(screen.getByText(/admin\/papers/i)).toBeInTheDocument()
  })

  it('STILL PUBLISHES a properly labelled paper', async () => {
    // The other direction. Without this, a guard that blocked everything would
    // pass the two tests above while breaking publishing entirely.
    mockListPapers.mockResolvedValue([LABELLED])
    const user = userEvent.setup()
    render(<MemoryRouter><ManageContent /></MemoryRouter>)

    await publishFromRowMenu(user, LABELLED.title)

    await waitFor(() => expect(mockUpdatePaper).toHaveBeenCalledTimes(1))
    expect(mockUpdatePaper).toHaveBeenCalledWith('p-labelled', { status: 'published' })
  })

  it('a paper that is merely INFERRED still publishes — inferred is established', async () => {
    // The migration writes 'inferred', and that is the state most of the
    // archive will be in. Treating it as unlabelled would hold back everything
    // the migration successfully identified.
    mockListPapers.mockResolvedValue([
      { ...LABELLED, sourceConfidence: 'inferred', source: 'prisca', isOfficial: false },
    ])
    const user = userEvent.setup()
    render(<MemoryRouter><ManageContent /></MemoryRouter>)

    await publishFromRowMenu(user, LABELLED.title)

    await waitFor(() => expect(mockUpdatePaper).toHaveBeenCalledTimes(1))
  })

  it('unpublishing an unlabelled paper is NOT blocked', async () => {
    // The guard is about making a paper live, not about touching it. An
    // unlabelled paper that somehow went live must stay retractable.
    mockListPapers.mockResolvedValue([{ ...UNLABELLED, status: 'published' }])
    const user = userEvent.setup()
    render(<MemoryRouter><ManageContent /></MemoryRouter>)

    const card = (await screen.findByText(UNLABELLED.title)).closest('li, div[class*="rounded"]')
    await user.click(card?.querySelector('button[aria-label="More actions"]')
      || screen.getAllByLabelText('More actions')[0])
    await user.click(await screen.findByText('Unpublish'))

    await waitFor(() => expect(mockUpdatePaper).toHaveBeenCalledTimes(1))
    expect(mockUpdatePaper).toHaveBeenCalledWith('p-unlabelled', { status: 'draft' })
  })
})
