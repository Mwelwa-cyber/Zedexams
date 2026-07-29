/**
 * Behaviour tests for PastPaperStudio.jsx — the /admin/papers wizard.
 *
 * Scope: the publish write, now that the Quiz step is optional. This is the
 * one place in the feature where getting it wrong is expensive and silent —
 * the fields written here are what every learner surface reads to decide
 * whether to show a "Start Quiz" button.
 *
 * Three things are pinned:
 *   - publishing with the Quiz step skipped writes quizStatus 'pending' and
 *     quizId null (never the id of the empty quiz the Studio was authoring);
 *   - publishing with a real quiz writes quizId + quizStatus 'attached'
 *     together in ONE update, not two;
 *   - a quiz with no questions is never attached, whichever route reached
 *     step 4.
 *
 * Firestore, Storage and the import callable are mocked; the wizard is driven
 * through the `?step=` deep link the admin list uses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {}, storage: {} }))
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => vi.fn().mockResolvedValue({ data: {} }),
}))

// The linked quiz exists and holds `quizQuestionCount` questions.
let quizQuestionCount = 0
let quizExists = true
vi.mock('firebase/firestore', () => ({
  collection: (...path) => ({ path }),
  doc: (...path) => ({ path, id: 'generated-quiz-id' }),
  getDoc: vi.fn(async () => ({ exists: () => quizExists })),
  getDocs: vi.fn(async () => ({ size: quizQuestionCount, docs: [] })),
  query: (ref) => ref,
  serverTimestamp: () => 'ts',
  setDoc: vi.fn(async () => {}),
}))

const mockUpdatePaper = vi.fn(async () => {})
const mockGetPaper = vi.fn()
vi.mock('../../utils/pastPapers', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    createPaper: vi.fn(async () => 'new-paper'),
    getPaper: (...a) => mockGetPaper(...a),
    updatePaper: (...a) => mockUpdatePaper(...a),
    deletePaper: vi.fn(),
    deletePaperPdf: vi.fn(),
    resolvePaperUrl: vi.fn(async () => ''),
    uploadPaperAsset: vi.fn(),
  }
})

vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ currentUser: { uid: 'admin-1' } }) }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))

const mockNavigate = vi.fn()
let searchQuery = 'step=publish'
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ paperId: 'paper-1' }),
    useSearchParams: () => [new URLSearchParams(searchQuery), vi.fn()],
  }
})

import PastPaperStudio from './PastPaperStudio'

function savedPaper(overrides = {}) {
  return {
    id: 'paper-1',
    title: 'Grade 7 Maths 2024',
    grade: '7',
    subject: 'mathematics',
    year: 2024,
    examBoard: 'ECZ',
    status: 'draft',
    assets: [{
      path: 'papers/admin-1/paper-1/assets/0-p.pdf',
      filename: 'p.pdf',
      size: 1024,
      contentType: 'application/pdf',
    }],
    ...overrides,
  }
}

function renderStudio() {
  return render(<MemoryRouter><PastPaperStudio /></MemoryRouter>)
}

/** The one updatePaper call that carries `status` — i.e. the publish write. */
function publishWrite() {
  const calls = mockUpdatePaper.mock.calls.filter(([, fields]) => 'status' in fields)
  expect(calls).toHaveLength(1)
  return calls[0][1]
}

beforeEach(() => {
  vi.clearAllMocks()
  quizQuestionCount = 0
  quizExists = true
  searchQuery = 'step=publish'
})

describe('PastPaperStudio — publishing without a quiz', () => {
  it('publishes a skipped paper as pending, with quizId null', async () => {
    const user = userEvent.setup()
    mockGetPaper.mockResolvedValue(savedPaper())
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Publish paper/ }))

    const fields = publishWrite()
    expect(fields.status).toBe('published')
    expect(fields.quizStatus).toBe('pending')
    expect(fields.quizId).toBeNull()
  })

  it('parks the authoring quiz instead of attaching it or orphaning it', async () => {
    // The Studio mints a quiz the moment step 3 opens. Publishing pending must
    // remember it (so re-entering resumes that quiz) without ever promoting it
    // to `quizId` — it has no questions in it.
    const user = userEvent.setup()
    mockGetPaper.mockResolvedValue(savedPaper({ pendingQuizId: 'draft-q' }))
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Publish paper/ }))

    const fields = publishWrite()
    expect(fields.quizId).toBeNull()
    expect(fields.pendingQuizId).toBe('draft-q')
  })

  it('refuses to attach a linked quiz that has no questions', async () => {
    // Reached step 4 with a linked-but-empty quiz (the admin opened the editor
    // and left). An empty quiz behind a live "Start Quiz" button is the exact
    // outcome the pending state exists to prevent.
    const user = userEvent.setup()
    quizQuestionCount = 0
    mockGetPaper.mockResolvedValue(savedPaper({ quizId: 'q-empty', quizStatus: 'attached' }))
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Save changes|Publish paper/ }))

    const fields = publishWrite()
    expect(fields.quizStatus).toBe('pending')
    expect(fields.quizId).toBeNull()
  })

  it('tells the admin what publishing without a quiz will do, without blocking it', async () => {
    mockGetPaper.mockResolvedValue(savedPaper())
    renderStudio()

    expect(await screen.findByText('No quiz attached yet.')).toBeInTheDocument()
    expect(screen.getByText(/visible to learners now/)).toBeInTheDocument()
    // Informational, not an error: the button stays live.
    expect(screen.getByRole('button', { name: /Publish paper/ })).toBeEnabled()
  })
})

describe('PastPaperStudio — publishing with a quiz', () => {
  it('writes quizId and quizStatus together in one update', async () => {
    const user = userEvent.setup()
    quizQuestionCount = 12
    mockGetPaper.mockResolvedValue(savedPaper({ quizId: 'q-real', quizStatus: 'attached' }))
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Save changes|Publish paper/ }))

    const fields = publishWrite()
    expect(fields.quizId).toBe('q-real')
    expect(fields.quizStatus).toBe('attached')
    // Clearing the parked draft id is part of the same patch — a second write
    // would leave a window where the paper is readable half-attached.
    expect(fields.pendingQuizId).toBeNull()
    expect(fields.status).toBe('published')
  })

  it('resumes the draft quiz parked by an earlier skip rather than minting a second one', async () => {
    const user = userEvent.setup()
    quizQuestionCount = 5
    // The "Add quiz" flow: paper is live and pending, its authoring quiz is in
    // pendingQuizId, and the admin has since filled it in.
    mockGetPaper.mockResolvedValue(savedPaper({
      status: 'published', quizStatus: 'pending', quizId: null, pendingQuizId: 'draft-q',
    }))
    renderStudio()

    await user.click(await screen.findByRole('button', { name: /Save changes/ }))

    const fields = publishWrite()
    expect(fields.quizId).toBe('draft-q')
    expect(fields.quizStatus).toBe('attached')
  })
})

describe('PastPaperStudio — the Add quiz deep link', () => {
  it('opens on the Quiz step with Upload and Details already saved', async () => {
    searchQuery = 'step=quiz'
    mockGetPaper.mockResolvedValue(savedPaper({ status: 'published', quizStatus: 'pending' }))
    renderStudio()

    expect(await screen.findByText('Quiz authoring')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Skip for now/ })).toBeInTheDocument()
  })

  it('ignores an unrecognised step and opens at the beginning', async () => {
    searchQuery = 'step=banana'
    mockGetPaper.mockResolvedValue(savedPaper())
    renderStudio()

    expect(await screen.findByText(/Drag & drop files here/)).toBeInTheDocument()
  })
})
