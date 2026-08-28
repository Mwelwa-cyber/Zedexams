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
import { resolvePaperUrl } from '../../../utils/pastPapers'

// jsdom ships neither observer; the image page list wires an
// IntersectionObserver (visible-page tracking) on mount.
if (!globalThis.IntersectionObserver) {
  globalThis.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return [] }
  }
}

vi.mock('../../../firebase/config', () => ({
  default: {}, auth: {}, db: {}, storage: {},
  whenAppCheckReady: vi.fn().mockResolvedValue({ initialized: true }),
}))

const mockGetPaper = vi.fn()
vi.mock('../../../utils/pastPapers', () => ({
  getPaper: (...a) => mockGetPaper(...a),
  getLinkedQuizMeta: vi.fn().mockResolvedValue(null),
  listMyPaperAttempts: vi.fn().mockResolvedValue([]),
  listPublishedPapers: vi.fn().mockResolvedValue([]),
  recordPaperEvent: vi.fn().mockResolvedValue(undefined),
  resolvePaperUrl: vi.fn().mockResolvedValue(''),
}))

let mockAuth = { currentUser: { uid: 'learner-1' }, isAdmin: false }
vi.mock('../../../contexts/AuthContext', () => ({ useAuth: () => mockAuth }))
vi.mock('../../../contexts/DataSaverContext', () => ({ useDataSaver: () => ({ dataSaver: false }) }))
vi.mock('../../../shared/components/SeoHelmet', () => ({ default: () => null }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, useNavigate: () => mockNavigate, useParams: () => ({ paperId: 'paper-1' }) }
})

import PastPaperViewer from './PastPaperViewer'

function publishedPaper(overrides = {}) {
  return {
    id: 'paper-1', title: 'Grade 7 Maths 2019', subject: 'Mathematics',
    grade: 7, year: 2019, examBoard: 'ECZ', status: 'published',
    // A published paper carries its source: the Firestore rules refuse a
    // learner read of one that does not, so a fixture without it is a paper
    // this component would never be handed.
    source: 'ecz', isOfficial: true, sourceConfidence: 'explicit',
    ...overrides,
  }
}

// "The paper's header rendered". Probed on the h1 rather than on a phrase in
// the subtitle: it used to be /Past Paper/, from the line the source badge
// replaced, and a probe tied to prose breaks every time the prose is edited.
const HEADER = { level: 1, name: /Grade 7/ }
const findHeader = () => screen.findByRole('heading', HEADER)
const queryHeader = () => screen.queryByRole('heading', HEADER)

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
    expect(queryHeader()).not.toBeInTheDocument()
  })

  it('shows "Paper not found" when the paper is missing', async () => {
    mockGetPaper.mockResolvedValue(null)
    renderViewer()
    expect(await screen.findByText('Paper not found')).toBeInTheDocument()
  })

  // A failed READ (permission-denied from an App Check race, offline, a
  // Firestore blip) is not the same fact as the paper genuinely not
  // existing, and must not be reported with the same "moved or unpublished"
  // copy — see PastPaperViewer.jsx's load effect for the full account.
  it('shows a distinct, retriable message when the read itself fails', async () => {
    mockGetPaper.mockRejectedValue(new Error('permission-denied'))
    renderViewer()
    expect(await screen.findByText("Couldn't load this paper")).toBeInTheDocument()
    expect(screen.queryByText('Paper not found')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('retries the read when "Try again" is pressed', async () => {
    mockGetPaper.mockRejectedValueOnce(new Error('permission-denied'))
    mockGetPaper.mockResolvedValueOnce(publishedPaper())
    renderViewer()
    const retry = await screen.findByRole('button', { name: 'Try again' })
    retry.click()
    expect(await findHeader()).toBeInTheDocument()
    expect(mockGetPaper).toHaveBeenCalledTimes(2)
  })
})

describe('PastPaperViewer — publish/visibility gate', () => {
  it('hides an unpublished paper from a non-admin (not-found, no leak)', async () => {
    mockGetPaper.mockResolvedValue(publishedPaper({ status: 'draft' }))
    renderViewer()
    expect(await screen.findByText('Paper not found')).toBeInTheDocument()
    // None of the paper's metadata renders on the gate screen.
    expect(queryHeader()).not.toBeInTheDocument()
  })

  it('lets an admin preview an unpublished paper', async () => {
    mockAuth = { currentUser: { uid: 'admin-1' }, isAdmin: true }
    mockGetPaper.mockResolvedValue(publishedPaper({ status: 'draft' }))
    renderViewer()
    expect(await findHeader()).toBeInTheDocument()
    expect(screen.queryByText('Paper not found')).not.toBeInTheDocument()
  })

  it('renders a published paper for a normal learner', async () => {
    mockGetPaper.mockResolvedValue(publishedPaper())
    renderViewer()
    expect(await findHeader()).toBeInTheDocument()
    expect(screen.queryByText('Paper not found')).not.toBeInTheDocument()
  })
})

describe('PastPaperViewer — optional quiz (quizStatus)', () => {
  // Every case here asks the same question from a different angle: can the
  // learner reach a quiz that isn't there? The paper itself must always be
  // fully visible — publishing without a quiz gates the quiz, not the paper.
  function quizLinks() {
    return screen.queryAllByRole('link', { name: /quiz/i })
      .filter((el) => el.getAttribute('href')?.endsWith('/quiz'))
  }

  it('offers the quiz when one is attached', async () => {
    mockGetPaper.mockResolvedValue(publishedPaper({ quizId: 'q1', quizStatus: 'attached' }))
    renderViewer()
    expect(await findHeader()).toBeInTheDocument()
    expect(screen.getAllByText('Quiz Available').length).toBeGreaterThan(0)
    expect(quizLinks().length).toBeGreaterThan(0)
  })

  it('shows "Quiz coming soon" and no quiz link when the quiz is pending', async () => {
    mockGetPaper.mockResolvedValue(publishedPaper({ quizStatus: 'pending', quizId: null }))
    renderViewer()
    // The paper is live and readable — only the quiz launcher is withheld.
    expect(await findHeader()).toBeInTheDocument()
    expect(screen.getAllByText(/Quiz coming soon/i).length).toBeGreaterThan(0)
    expect(screen.queryByText('Quiz Available')).not.toBeInTheDocument()
    expect(quizLinks()).toHaveLength(0)
  })

  it('never links to the draft quiz a pending paper is still carrying', async () => {
    // The Studio parks its authoring quiz on the paper. If the viewer read the
    // raw id, "Start Quiz" would open a quiz with no questions in it.
    mockGetPaper.mockResolvedValue(publishedPaper({
      quizStatus: 'pending', quizId: 'draft-q', pendingQuizId: 'draft-q',
    }))
    renderViewer()
    expect(await findHeader()).toBeInTheDocument()
    expect(screen.getAllByText(/Quiz coming soon/i).length).toBeGreaterThan(0)
    expect(quizLinks()).toHaveLength(0)
  })

  it('still offers the quiz on a paper published before quizStatus existed', async () => {
    mockGetPaper.mockResolvedValue(publishedPaper({ quizId: 'legacy-q' }))
    renderViewer()
    expect(await findHeader()).toBeInTheDocument()
    expect(screen.getAllByText('Quiz Available').length).toBeGreaterThan(0)
    expect(quizLinks().length).toBeGreaterThan(0)
  })

  it('shows "Quiz coming soon" on an old paper that never had a quiz', async () => {
    mockGetPaper.mockResolvedValue(publishedPaper())
    renderViewer()
    expect(await findHeader()).toBeInTheDocument()
    expect(screen.getAllByText(/Quiz coming soon/i).length).toBeGreaterThan(0)
    expect(quizLinks()).toHaveLength(0)
  })
})

describe('PastPaperViewer — mobile scrolling / touch behaviour', () => {
  function imagePaper() {
    return publishedPaper({
      assets: [{ path: 'papers/paper-1/page-1.jpg', contentType: 'image/jpeg' }],
    })
  }

  it('renders page images with pan-x pan-y touch-action (a swipe on the paper always scrolls, never freezes)', async () => {
    vi.mocked(resolvePaperUrl).mockResolvedValue('https://cdn.test/page-1.jpg')
    mockGetPaper.mockResolvedValue(imagePaper())
    renderViewer()
    const img = await screen.findByAltText(/Question paper page 1 of 1/)
    // pan-y keeps single-finger vertical scroll down the stack; pan-x lets a
    // swipe that starts ON the page pan a zoomed page across its own strip.
    expect(img.style.touchAction).toBe('pan-x pan-y')
    // Never `none` — that is what would freeze the scroll, and it is the whole
    // reason this assertion exists.
    expect(img.style.touchAction).not.toBe('none')
    // `pinch-zoom` used to be listed here. It is gone deliberately: the stack
    // implements pinch itself (usePinchZoom), because the Capacitor Android
    // WebView ships with the browser's own pinch switched off, so the keyword
    // bought a learner on the phone nothing while still letting a browser that
    // DOES honour it fight our handler for the same two fingers.
    expect(img.style.touchAction).not.toContain('pinch-zoom')
    // A long-press must not start an image drag that swallows the scroll.
    expect(img.style.userSelect).toBe('none')
  })

  it('keeps the "loading page" overlay non-interactive so it cannot swallow touches', async () => {
    vi.mocked(resolvePaperUrl).mockResolvedValue('https://cdn.test/page-1.jpg')
    mockGetPaper.mockResolvedValue(imagePaper())
    renderViewer()
    // In jsdom the <img> onLoad never fires, so the overlay is still shown —
    // exactly the "invisible overlay over rendered content" risk. It must be
    // pointer-events-none so scroll/tap pass straight through to the page.
    const overlay = await screen.findByText(/Loading page 1/)
    expect(overlay.className).toMatch(/pointer-events-none/)
  })
})
