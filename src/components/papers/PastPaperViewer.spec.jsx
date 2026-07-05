/**
 * Behaviour tests for PastPaperViewer.jsx — the past-paper viewer page.
 *
 * Previously untested. These cover the load state machine and — most
 * importantly — the publish/visibility gate, the file's highest-risk logic:
 * an unpublished paper must only be viewable by an admin, and a non-admin
 * hitting one must get the not-found screen with no paper content leaked.
 *   - loading skeletons,
 *   - "Paper not found" for a missing paper,
 *   - the gate: unpublished ⇒ not-found for a learner, but viewable by an admin,
 *   - a published paper renders for a normal learner.
 *
 * The whole pastPapers service (firebase-backed) is mocked, and the preview
 * viewers are lazy + skipped for an asset-less paper, so only the page shell
 * is exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

vi.mock('../../firebase/config', () => ({ default: {}, auth: {}, db: {}, storage: {} }))

const mockGetPaper = vi.fn()
vi.mock('../../utils/pastPapers', () => ({
  getPaper: (...a) => mockGetPaper(...a),
  getLinkedQuizMeta: vi.fn().mockResolvedValue(null),
  listMyPaperAttempts: vi.fn().mockResolvedValue([]),
  listPublishedPapers: vi.fn().mockResolvedValue([]),
  recordPaperEvent: vi.fn().mockResolvedValue(undefined),
  resolvePaperUrl: vi.fn().mockResolvedValue(''),
}))

let mockAuth = { currentUser: { uid: 'learner-1' }, isAdmin: false }
vi.mock('../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))
vi.mock('../../contexts/DataSaverContext', () => ({ useDataSaver: () => ({ dataSaver: false }) }))
vi.mock('../seo/SeoHelmet', () => ({ default: () => null }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => ({ paperId: 'paper-1' }) }
})

import PastPaperViewer from './PastPaperViewer'

function publishedPaper(overrides = {}) {
  return {
    id: 'paper-1', title: 'Grade 7 Maths 2019', subject: 'Mathematics',
    grade: 7, year: 2019, examBoard: 'ECZ', status: 'published', ...overrides,
  }
}

function renderViewer() {
  return render(<MemoryRouter><PastPaperViewer /></MemoryRouter>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockAuth = { currentUser: { uid: 'learner-1' }, isAdmin: false }
})

describe('PastPaperViewer — load states', () => {
  it('shows loading skeletons before the paper resolves', () => {
    mockGetPaper.mockReturnValue(new Promise(() => {}))
    renderViewer()
    expect(screen.queryByText('Paper not found')).not.toBeInTheDocument()
    expect(screen.queryByText(/Past Paper/)).not.toBeInTheDocument()
  })

  it('shows "Paper not found" when the paper is missing', async () => {
    mockGetPaper.mockResolvedValue(null)
    renderViewer()
    expect(await screen.findByText('Paper not found')).toBeInTheDocument()
  })
})

describe('PastPaperViewer — publish/visibility gate', () => {
  it('hides an unpublished paper from a non-admin (not-found, no leak)', async () => {
    mockGetPaper.mockResolvedValue(publishedPaper({ status: 'draft' }))
    renderViewer()
    expect(await screen.findByText('Paper not found')).toBeInTheDocument()
    // None of the paper's metadata renders on the gate screen.
    expect(screen.queryByText(/Past Paper/)).not.toBeInTheDocument()
  })

  it('lets an admin preview an unpublished paper', async () => {
    mockAuth = { currentUser: { uid: 'admin-1' }, isAdmin: true }
    mockGetPaper.mockResolvedValue(publishedPaper({ status: 'draft' }))
    renderViewer()
    expect(await screen.findByText(/Past Paper/)).toBeInTheDocument()
    expect(screen.queryByText('Paper not found')).not.toBeInTheDocument()
  })

  it('renders a published paper for a normal learner', async () => {
    mockGetPaper.mockResolvedValue(publishedPaper())
    renderViewer()
    expect(await screen.findByText(/Past Paper/)).toBeInTheDocument()
    expect(screen.queryByText('Paper not found')).not.toBeInTheDocument()
  })
})
